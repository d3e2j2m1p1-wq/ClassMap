import { store } from '../core/store.js';
import { syncOnHome } from '../storage/drive.js';
import { renderAssignPanel } from '../assign/panel.js';
import { cleanAssignments } from '../assign/seats.js';
import { state } from '../core/state.js';
import { actionToast, confirmDialog, plural, prettyDate, showToast, undoToast } from '../core/ui.js';
import { renderRoster } from '../editor/roster.js';
import { renderTempRules } from '../editor/rules.js';
import { renderTimeline } from './charts.js';
import { hideLanding, showLanding, switchLandingTab } from './landing.js';
import { renderLayoutCanvas } from '../layout/canvas.js';
import { normTableDefaults, updateTableToolBadge } from '../layout/tableGroups.js';
import { flushSave, markDirty } from '../storage/autosave.js';
import { localDateStr, markDeleted, saveLandingData, unmarkDeleted } from '../storage/landingData.js';
import { resetHistory } from '../editor/undo.js';
import { switchPanel } from '../editor/panels.js';

// ── Create / Open chart ──
export function createNewChart() {
  if (!store.activeClassId) { showToast('Select a class first'); return; }
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  flushSave();
  // Make this the active chart context first (groups/colours are looked up through it)
  window._currentChartClassId = store.activeClassId;
  window._currentChartId = null;
  // Load class roster + rules into state
  state.students = (cls.students || []).map(s => ({...s}));
  state.hardRules = (cls.hardRules || []).map(r => ({...r}));
  state.tempRules = [];
  state.genderMode = cls.genderMode || false;
  state.layoutItems = [];
  state.assignments = {};
  state.pins = [];
  store.layoutImg = null;
  store.nextId = 1;
  state.tableDefaults = normTableDefaults(null);
  // Same room as last time: start from the class's latest chart (tables, groups, photo), nobody seated
  const prev = latestLayoutChart(cls.id);
  if (prev) {
    state.layoutItems = structuredClone(prev.data.layoutItems);
    store.layoutImg = prev.data.layoutImg || null;
    store.nextId = prev.data.nextId || 1;
    state.tableDefaults = normTableDefaults(prev.data.tableDefaults);
  }
  updateTableToolBadge();
  store.selectedSeatId = null;
  store.selectedStudentId = null;
  document.getElementById('classNameInput').value = cls.name;
  document.getElementById('sessionNotes').value = '';
  renderRoster();
  renderLayoutCanvas();
  renderTempRules();
  hideLanding();
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const panel = prev ? 'assign' : 'layout';
  document.getElementById('panel-' + panel).classList.add('active');
  document.querySelector(`[data-panel="${panel}"]`).classList.add('active');
  if (prev) renderAssignPanel();
  // Create the chart record right away so it is still there if you go back home
  saveChartToClass(true);
  resetHistory();
  if (prev) {
    actionToast(`New chart · same room as ${prettyDate(prev.date || localDateStr(prev.savedAt))}`, 'Start empty', () => {
      state.layoutItems = [];
      state.assignments = {};
      state.pins = [];
      store.layoutImg = null;
      store.nextId = 1;
      renderLayoutCanvas();
      renderAssignPanel();
      switchPanel('layout', document.querySelector('[data-panel="layout"]'));
      markDirty();
    });
  } else {
    showToast('New chart for ' + cls.name);
  }
}

// The class's most recent chart that has a room set up
export function latestLayoutChart(classId, exceptId) {
  const dateOf = ch => ch.date || localDateStr(ch.savedAt || 0);
  return store.landingData.charts
    .filter(ch => ch.classId === classId && ch.id !== exceptId && ch.data && (ch.data.layoutItems || []).length)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || (b.savedAt - a.savedAt))[0] || null;
}

// Copy a chart (room and seats) to today
export function duplicateChart(id, e) {
  e.stopPropagation();
  const ld = store.landingData;
  const idx = ld.charts.findIndex(c => c.id === id);
  if (idx < 0) return;
  const now = Date.now();
  const copy = { ...structuredClone(ld.charts[idx]), id: 'chart_' + now, savedAt: now, date: localDateStr(now) };
  ld.charts.splice(idx + 1, 0, copy);
  saveLandingData();
  renderTimeline(store.activeClassId);
  undoToast(`Copied “${copy.name || 'Untitled'}” to today`, () => {
    store.landingData.charts = store.landingData.charts.filter(c => c.id !== copy.id);
    markDeleted([copy.id]);
    saveLandingData();
    renderTimeline(store.activeClassId);
  });
}

export function openChart(ch) {
  const cls = store.landingData.classes.find(c => c.id === ch.classId);
  const data = ch.data || {};
  flushSave();
  window._currentChartClassId = ch.classId;
  window._currentChartId = ch.id;
  // Always use class-level roster + hardRules
  state.students = (cls?.students || data.students || []).map(s => ({...s}));
  state.hardRules = (cls?.hardRules || data.hardRules || []).map(r => ({...r}));
  // Copies, so the editor never changes the stored chart until it saves
  const clone = v => JSON.parse(JSON.stringify(v));
  state.tempRules = clone(data.tempRules || []);
  state.genderMode = cls?.genderMode ?? data.genderMode ?? false;
  state.layoutItems = clone(data.layoutItems || []);
  state.assignments = clone(data.assignments || {});
  state.pins = clone(data.pins || []);
  store.layoutImg = data.layoutImg || null;
  store.nextId = data.nextId || 1;
  state.tableDefaults = normTableDefaults(data.tableDefaults);
  updateTableToolBadge();
  store.selectedSeatId = null;
  store.selectedStudentId = null;
  document.getElementById('classNameInput').value = cls?.name || data.className || '';
  document.getElementById('sessionNotes').value = data.sessionNotes || '';
  renderRoster();
  renderLayoutCanvas();
  renderTempRules();
  hideLanding();
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-assign').classList.add('active');
  document.querySelector('[data-panel="assign"]').classList.add('active');
  store._dirty = false;
  renderAssignPanel();     // may mark the chart dirty if it had to drop stale seats
  showToast('Opened: ' + (ch.name || cls?.name || 'chart'));
  resetHistory();
}

export async function deleteChart(id, e) {
  e.stopPropagation();
  const ch = store.landingData.charts.find(c => c.id === id);
  if (!ch) return;
  const label = ch.name || 'Untitled';
  const seated = Object.keys((ch.data && ch.data.assignments) || {}).length;
  const ok = await confirmDialog({
    title: `Delete the chart “${label}”?`,
    details: [ch.date ? prettyDate(ch.date) : '', seated ? plural(seated, 'student') + ' seated' : ''].filter(Boolean).join(' · '),
    message: 'Its layout, classroom photo and seats will be removed.',
    confirmLabel: 'Delete chart',
    danger: true,
  });
  if (!ok) return;
  const idx = store.landingData.charts.findIndex(c => c.id === id);
  if (idx < 0) return;
  store.landingData.charts.splice(idx, 1);
  markDeleted([ch.id]);
  saveLandingData();
  renderTimeline(store.activeClassId);
  undoToast(`Chart “${label}” deleted`, () => {
    const ld = store.landingData;
    if (!ld.classes.some(c => c.id === ch.classId)) { showToast('Can\'t restore: its class was deleted'); return; }
    if (ld.charts.some(c => c.id === ch.id)) return;
    unmarkDeleted([ch.id]);
    ch.savedAt = Date.now();               // newer than the deletion, for devices that already saw it
    ld.charts.splice(Math.min(idx, ld.charts.length), 0, ch);
    saveLandingData();
    if (store.activeClassId === ch.classId) renderTimeline(store.activeClassId);
  });
}

export function saveChartToClass(silent) {
  const classId = window._currentChartClassId;
  const cls = store.landingData.classes.find(c => c.id === classId);
  if (!classId || !cls) {
    if (!silent) showToast('Open a chart from the home page first');
    return false;
  }

  cleanAssignments();

  // The roster and permanent rules belong to the class and are edited on the home
  // page, so a chart save only stores layout + session-specific data.
  const data = {
    className: document.getElementById('classNameInput').value,
    tempRules: state.tempRules,
    sessionNotes: document.getElementById('sessionNotes').value,
    layoutItems: state.layoutItems,
    assignments: state.assignments,
    tableDefaults: state.tableDefaults,
    pins: state.pins || [],
    layoutImg: store.layoutImg,
    nextId: store.nextId,
  };

  const chartName = data.className || 'Untitled';
  const now = Date.now();
  let ch = window._currentChartId ? store.landingData.charts.find(c => c.id === window._currentChartId) : null;
  if (ch) {
    ch.data = data; ch.savedAt = now; ch.name = chartName;
  } else {
    const id = 'chart_' + now;
    window._currentChartId = id;
    store.landingData.charts.push({ id, classId, name: chartName, savedAt: now, date: localDateStr(now), data });
  }

  if (!saveLandingData()) return false;
  store._dirty = false;
  if (!silent) showToast('✓ Saved to ' + cls.name);
  return true;
}

export function goHomeToRoster() {
  flushSave();
  showLanding();
  // After landing renders, switch to the roster tab
  setTimeout(() => switchLandingTab('roster', document.querySelector('.ld-tab[data-tab="roster"]')), 50);
}

export function goHome() {
  flushSave();
  showLanding();
  if (store.activeClassId) renderTimeline(store.activeClassId);
  syncOnHome();
}
