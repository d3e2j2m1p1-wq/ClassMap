import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { confirmDialog, plural, undoToast } from '../core/ui.js';
import { renderTimeline } from './charts.js';
import { renderLdRoster } from './roster.js';
import { renderLdRules } from './rules.js';
import { CLASS_COLORS, loadLandingData, markDeleted, saveLandingData, unmarkDeleted } from '../storage/landingData.js';
import { updateWelcome } from './welcome.js';

// Read storage only once. After that the copy in memory is always the newest, so a failed
// save (storage full) can't make going home throw away work.
export let _landingLoaded = false;
export function showLanding() {
  if (!_landingLoaded) { loadLandingData(); _landingLoaded = true; }
  document.getElementById('landing-page').classList.remove('hidden');
  renderClassList();
  const keepId = store.landingData.classes.some(c => c.id === store.activeClassId)
    ? store.activeClassId
    : (store.landingData.classes[0] && store.landingData.classes[0].id);
  if (keepId) selectClass(keepId);
}

export function hideLanding() {
  document.getElementById('landing-page').classList.add('hidden');
}

export function addLandingClass() {
  const input = document.getElementById('newClassInput');
  const name = input.value.trim();
  if (!name) return;
  const id = 'cls_' + Date.now();
  const color = CLASS_COLORS[store.landingData.classes.length % CLASS_COLORS.length];
  store.landingData.classes.push({ id, name, color, students: [], hardRules: [], genderMode: false });
  saveLandingData();
  input.value = '';
  renderClassList();
  selectClass(id);
}

export async function deleteClass(id, e) {
  e.stopPropagation();
  const cls = store.landingData.classes.find(c => c.id === id);
  if (!cls) return;
  const nCharts = store.landingData.charts.filter(ch => ch.classId === id).length;
  const ok = await confirmDialog({
    title: `Delete the class “${cls.name}”?`,
    details: `${plural(cls.students.length, 'student')} · ${plural(nCharts, 'chart')}`,
    message: 'The roster, its rules and every seating chart for this class will be removed.',
    confirmLabel: 'Delete class',
    danger: true,
  });
  if (!ok) return;
  const ld = store.landingData;
  const classIdx = ld.classes.findIndex(c => c.id === id);
  if (classIdx < 0) return;
  const charts = ld.charts.filter(ch => ch.classId === id);
  ld.classes.splice(classIdx, 1);
  ld.charts = ld.charts.filter(ch => ch.classId !== id);
  markDeleted([id, ...charts.map(ch => ch.id)]);
  saveLandingData();
  if (store.activeClassId === id) {
    store.activeClassId = null;
    document.getElementById('landingDetailEmpty').style.display = '';
    document.getElementById('landingDetailContent').style.display = 'none';
  }
  renderClassList();
  undoToast(`Class “${cls.name}” deleted`, () => {
    const L = store.landingData;
    if (L.classes.some(c => c.id === id)) return;
    unmarkDeleted([id, ...charts.map(ch => ch.id)]);
    const now = Date.now();
    cls.restoredAt = now;
    charts.forEach(ch => { ch.savedAt = now; });
    L.classes.splice(Math.min(classIdx, L.classes.length), 0, cls);
    L.charts.push(...charts.filter(ch => !L.charts.some(c => c.id === ch.id)));
    saveLandingData();
    renderClassList();
    selectClass(id);
  });
}

export function renderClassList() {
  updateWelcome();
  const list = document.getElementById('classList');
  list.innerHTML = '';
  if (store.landingData.classes.length === 0) {
    list.innerHTML = '<div style="padding:20px 12px;font-size:0.8rem;color:var(--text3);text-align:center;">No classes yet.<br>Add one below.</div>';
    return;
  }
  store.landingData.classes.forEach(cls => {
    const chartCount = store.landingData.charts.filter(ch => ch.classId === cls.id).length;
    const div = document.createElement('div');
    div.className = 'class-item' + (store.activeClassId === cls.id ? ' active' : '');
    div.innerHTML = `
      <div class="class-dot" style="background:${esc(cls.color)}"></div>
      <span class="class-name">${esc(cls.name)}</span>
      <span class="class-count">${chartCount}</span>
      <button class="class-item-del" onclick="deleteClass('${cls.id}',event)" title="Delete class">✕</button>`;
    div.addEventListener('click', () => selectClass(cls.id));
    list.appendChild(div);
  });
}

export function selectClass(id) {
  store.activeClassId = id;
  const cls = store.landingData.classes.find(c => c.id === id);
  if (!cls) return;
  renderClassList();
  document.getElementById('landingDetailEmpty').style.display = 'none';
  document.getElementById('landingDetailContent').style.display = 'flex';
  document.getElementById('landingDetailClassName').textContent = cls.name;
  switchLandingTab(store.activeLandingTab);
}

export function switchLandingTab(tab, btn) {
  store.activeLandingTab = tab;
  document.querySelectorAll('.ld-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.ld-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector(`.ld-tab[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById('ldp-' + tab).classList.add('active');
  if (tab === 'charts') renderTimeline(store.activeClassId);
  if (tab === 'roster') renderLdRoster();
  if (tab === 'rules') renderLdRules();
}
