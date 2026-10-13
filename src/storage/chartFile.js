import { store } from '../core/store.js';
import { renderAssignPanel } from '../assign/panel.js';
import { CUSTOM_COLORS, KIND_DEFAULTS, getGenderGroups, migrateGroupKinds, state } from '../core/state.js';
import { confirmDialog, plural, showToast } from '../core/ui.js';
import { renderRoster } from '../editor/roster.js';
import { renderTempRules } from '../editor/rules.js';
import { ensureGenderGroups } from '../landing/roster.js';
import { renderLayoutCanvas } from '../layout/canvas.js';
import { shrinkImage } from '../layout/image.js';
import { normTableDefaults, updateTableToolBadge } from '../layout/tableGroups.js';
import { mergeNameList, nameList, nameStatus } from '../roster/nameList.js';
import { firstNameOf } from '../roster/builtinNames.js';
import { flushSave, markDirty } from './autosave.js';
import { downloadJSON } from './backup.js';
import { resetHistory } from '../editor/undo.js';

// ═══════════════════════════════════════════════
//  EXPORT / IMPORT (JSON backup file)
// ═══════════════════════════════════════════════
export function exportData() {
  flushSave();
  const data = {
    className: document.getElementById('classNameInput').value,
    students: state.students, hardRules: state.hardRules, tempRules: state.tempRules,
    genderGroups: getGenderGroups(),
    nameList: nameList,
    sessionNotes: document.getElementById('sessionNotes').value,
    genderMode: state.genderMode, layoutItems: state.layoutItems,
    assignments: state.assignments, pins: state.pins || [], tableDefaults: state.tableDefaults, layoutImg: store.layoutImg, nextId: store.nextId,
  };
  downloadJSON(data, (data.className || 'classmap').replace(/[^a-z0-9]/gi, '-') + '.json');
}

// Header "Import chart file": pick a file exported with "Export chart file"
export function importDataFromFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importChartText(reader.result);
  reader.readAsText(file);
}

// A chart file's students + roster groups, made consistent.
// Older exports only name a student's group by an internal id (or 'boy'/'girl') and don't
// include the group list, so those students would lose their sorting. Work out each unknown
// group from its students' first names (built-in + learned name list): the most boy-named
// group becomes Boys, the most girl-named becomes Girls, anything else a custom group.
// Returns { students, groups, converted } — copies; the file data isn't changed.
export function normalizeImportedGroups(data) {
  const students = (Array.isArray(data.students) ? data.students : []).map(s => ({ ...s }));
  const groups = (Array.isArray(data.genderGroups) ? data.genderGroups : []).map(g => ({ ...g }));
  migrateGroupKinds(groups);
  const kindGroup = kind => {
    let g = groups.find(x => x.kind === kind);
    if (!g) {
      g = { ...KIND_DEFAULTS[kind] };
      if (groups.some(x => x.id === g.id)) g.id = 'g_' + kind + '_' + Date.now();
      groups.push(g);
    }
    return g.id;
  };
  const known = new Set(groups.map(g => g.id));
  const map = {};

  // very old files: 'boy' / 'girl' / 'none'
  students.forEach(s => {
    if (s.gender === 'boy') map.boy = kindGroup('boys');
    else if (s.gender === 'girl') map.girl = kindGroup('girls');
    else if (s.gender === 'none') map.none = null;
  });

  const unknown = [...new Set(students.map(s => s.gender).filter(g => g && !known.has(g) && !(g in map)))];
  if (unknown.length) {
    const score = id => students.filter(s => s.gender === id).reduce((t, s) => {
      const k = nameStatus(firstNameOf(s.name)).kind;
      return t + (k === 'boys' ? 1 : k === 'girls' ? -1 : 0);
    }, 0);
    const ranked = unknown.map(id => ({ id, score: score(id) })).sort((a, b) => b.score - a.score);
    const hasKind = kind => groups.some(g => g.kind === kind);
    if (ranked[0].score > 0 && !hasKind('boys')) map[ranked.shift().id] = kindGroup('boys');
    const last = ranked[ranked.length - 1];
    if (last && last.score < 0 && !hasKind('girls')) map[ranked.pop().id] = kindGroup('girls');
    ranked.forEach((r, i) => {
      const id = 'g_' + Date.now() + '_' + i;
      groups.push({ id, label: 'Group ' + (i + 1), color: CUSTOM_COLORS[i % CUSTOM_COLORS.length], kind: 'custom' });
      map[r.id] = id;
    });
  }
  const converted = Object.keys(map).length > 0;
  students.forEach(s => { if (s.gender in map) s.gender = map[s.gender]; });
  return { students, groups, converted };
}

export async function importChartText(text) {
  let data;
  try {
    data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('bad data');
  } catch (e) {
    showToast('❌ That file isn\'t a ClassMap chart file');
    return;
  }
  const cls = store.landingData.classes.find(c => c.id === window._currentChartClassId);
  const norm = normalizeImportedGroups(data);
  const incoming = norm.students;
  // The roster belongs to the class, so loading a file with students replaces it — ask first
  if (cls && cls.students.length && incoming.length) {
    const ok = await confirmDialog({
      title: `Replace the roster of “${cls.name}”?`,
      details: `File: ${plural(incoming.length, 'student')} · Class now: ${plural(cls.students.length, 'student')}`,
      message: 'This chart file has its own roster. Loading it replaces the class roster, groups and permanent rules with the ones in the file. Cancel keeps your roster and loads nothing.',
      confirmLabel: 'Replace roster',
      danger: true,
    });
    if (!ok) return;
  }
  const replaceRoster = incoming.length > 0 || !cls;

  document.getElementById('classNameInput').value = data.className || (cls ? cls.name : '');
  if (replaceRoster) {
    state.students = incoming;
    state.hardRules = Array.isArray(data.hardRules) ? data.hardRules : [];
    state.genderMode = !!data.genderMode || (norm.converted && norm.groups.length > 0);
  } else {
    state.students = cls.students.map(s => ({ ...s }));
    state.hardRules = (cls.hardRules || []).map(r => ({ ...r }));
    state.genderMode = !!cls.genderMode;
  }
  state.tempRules = Array.isArray(data.tempRules) ? data.tempRules : [];
  state.layoutItems = Array.isArray(data.layoutItems) ? data.layoutItems : [];
  state.assignments = (data.assignments && typeof data.assignments === 'object') ? data.assignments : {};
  state.pins = Array.isArray(data.pins) ? data.pins : [];
  store.layoutImg = data.layoutImg || null;
  store.nextId = data.nextId || 1;
  state.tableDefaults = normTableDefaults(data.tableDefaults);
  updateTableToolBadge();
  document.getElementById('sessionNotes').value = data.sessionNotes || '';
  if (data.nameList) mergeNameList(data.nameList);

  // Keep the class in step with what was imported
  if (cls && replaceRoster) {
    cls.students = state.students.map(s => ({ ...s }));
    cls.hardRules = state.hardRules.map(r => ({ ...r }));
    cls.genderMode = state.genderMode;
    if (norm.groups.length) cls.genderGroups = norm.groups;
    if (cls.genderMode) ensureGenderGroups(cls);
    migrateGroupKinds(cls.genderGroups);
  }
  store.selectedSeatId = null;
  store.selectedStudentId = null;
  renderRoster();
  renderLayoutCanvas();
  renderAssignPanel();
  renderTempRules();
  store._dirty = true;
  markDirty();
  showToast('✓ Chart loaded!');
  resetHistory();
  if (store.layoutImg && store.layoutImg.length > 1500000) {
    const orig = store.layoutImg;
    shrinkImage(orig).then(small => { if (store.layoutImg === orig && small !== orig) { store.layoutImg = small; markDirty(); } });
  }
}
