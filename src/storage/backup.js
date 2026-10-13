import { store } from '../core/store.js';
import { confirmDialog, plural, showToast, undoToast } from '../core/ui.js';
import { showLanding } from '../landing/landing.js';
import { ensureGenderGroups } from '../landing/roster.js';
import { shrinkStoredImages } from '../layout/image.js';
import { normalizeImportedGroups } from './chartFile.js';
import { mergeNameList, nameList } from '../roster/nameList.js';
import { _saveTimer, editorOpen, flushSave } from './autosave.js';
import { CLASS_COLORS, localDateStr, markDeleted, normalizeLandingData, saveLandingData } from './landingData.js';
import { noteBackupMade } from '../landing/welcome.js';

// ── Back up / restore everything (all classes, charts and the name list in one file) ──
export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportEverything() {
  if (editorOpen()) flushSave();
  downloadJSON({
    app: 'ClassMap', kind: 'full-backup', version: 2,
    exportedAt: new Date().toISOString(),
    landingData: store.landingData, nameList,
  }, 'classmap-backup-' + localDateStr(Date.now()) + '.json');
  noteBackupMade();
  showToast('✓ Backup downloaded — keep it somewhere safe (Drive, email, USB)', 4000);
}

// Home page "Import file": a full backup replaces everything (after asking);
// a single-chart file (Export JSON) is added as a new class with that chart.
export function restoreEverything(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { data = null; }
    const ld = data && data.landingData;
    const isChart = data && !ld && (Array.isArray(data.students) || Array.isArray(data.layoutItems));
    if (isChart) { addClassFromChartFile(data); return; }
    if (!ld || !Array.isArray(ld.classes) || !Array.isArray(ld.charts)) {
      showToast('❌ That file isn\'t a ClassMap file.', 5000);
      return;
    }
    const when = data.exportedAt
      ? new Date(data.exportedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : 'an unknown date';
    const ok = await confirmDialog({
      title: 'Replace everything with this backup?',
      details: `From ${when} · ${plural(ld.classes.length, 'class', 'classes')} · ${plural(ld.charts.length, 'chart')}`,
      message: 'The classes and charts on this device now will be replaced. Learned names are kept and merged.',
      confirmLabel: 'Replace everything',
      danger: true,
    });
    if (!ok) return;
    const before = store.landingData;
    clearTimeout(_saveTimer);
    store._dirty = false;
    window._currentChartClassId = null;
    window._currentChartId = null;
    store.landingData = ld;
    store.landingData.replacedAt = Date.now();   // a restore replaces what's in Google Drive too
    normalizeLandingData();
    if (data.nameList) mergeNameList(data.nameList);
    const saved = saveLandingData();
    store.activeClassId = null;
    showLandingAfterChange();
    if (saved) undoToast('Backup restored', () => {
      store.landingData = before;
      store.landingData.replacedAt = Date.now();
      normalizeLandingData();
      saveLandingData();
      store.activeClassId = null;
      showLandingAfterChange();
    }, 10000);
  };
  reader.readAsText(file);
}

// Home page after classes were added/removed: select a class, or show the empty state
function showLandingAfterChange() {
  showLanding();
  if (!store.activeClassId) {
    document.getElementById('landingDetailEmpty').style.display = '';
    document.getElementById('landingDetailContent').style.display = 'none';
  }
}

// Add a class (roster, groups, permanent rules) plus its chart from an Export JSON file
export async function addClassFromChartFile(data) {
  const norm = normalizeImportedGroups(data);
  const base = String(data.className || 'Imported class').trim() || 'Imported class';
  const taken = new Set(store.landingData.classes.map(c => c.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  const nStudents = norm.students.length;
  const ok = await confirmDialog({
    title: `Add “${name}” as a new class?`,
    details: `${plural(nStudents, 'student')} · 1 seating chart`,
    message: 'Nothing else on this device changes.',
    confirmLabel: 'Add class',
  });
  if (!ok) return;

  const now = Date.now();
  const id = 'cls_' + now;
  const cls = {
    id, name,
    color: CLASS_COLORS[store.landingData.classes.length % CLASS_COLORS.length],
    students: norm.students,
    hardRules: Array.isArray(data.hardRules) ? data.hardRules : [],
    genderMode: !!data.genderMode || (norm.converted && norm.groups.length > 0),
  };
  if (norm.groups.length) cls.genderGroups = norm.groups;
  if (cls.genderMode) ensureGenderGroups(cls);
  store.landingData.classes.push(cls);
  store.landingData.charts.push({
    id: 'chart_' + now, classId: id, name, savedAt: now, date: localDateStr(now),
    data: {
      className: name,
      tempRules: Array.isArray(data.tempRules) ? data.tempRules : [],
      sessionNotes: data.sessionNotes || '',
      layoutItems: Array.isArray(data.layoutItems) ? data.layoutItems : [],
      assignments: (data.assignments && typeof data.assignments === 'object') ? data.assignments : {},
      tableDefaults: data.tableDefaults,
      layoutImg: data.layoutImg || null,
      nextId: data.nextId || 1,
    },
  });
  if (data.nameList) mergeNameList(data.nameList);
  const saved = saveLandingData();
  store.activeClassId = id;
  showLanding();
  shrinkStoredImages();
  if (saved) undoToast(`Added class “${name}” with its seating chart`, () => {
    const L = store.landingData;
    markDeleted([id, ...L.charts.filter(ch => ch.classId === id).map(ch => ch.id)]);
    L.classes = L.classes.filter(c => c.id !== id);
    L.charts = L.charts.filter(ch => ch.classId !== id);
    saveLandingData();
    if (store.activeClassId === id) store.activeClassId = null;
    showLandingAfterChange();
  });
}
