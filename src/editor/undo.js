// ═══════════════════════════════════════════════
//  UNDO / REDO for the open chart
//  Covers the layout, seats, pins, temporary rules and the classroom photo.
//  markDirty() calls recordChange() after every change; the state before it goes on the stack.
//  Ctrl+Z / ⌘Z = undo · Ctrl+Shift+Z / Ctrl+Y = redo (also the ↶ ↷ header buttons).
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { state } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { renderAssignPanel } from '../assign/panel.js';
import { renderRoster } from './roster.js';
import { renderTempRules } from './rules.js';
import { renderLayoutCanvas } from '../layout/canvas.js';
import { updateTableToolBadge } from '../layout/tableGroups.js';
import { editorOpen, markDirty } from '../storage/autosave.js';

const LIMIT = 60;
let past = [], future = [], current = null, applying = false;

const snap = () => ({
  items: structuredClone(state.layoutItems),
  assignments: { ...state.assignments },
  pins: [...(state.pins || [])],
  tempRules: structuredClone(state.tempRules || []),
  tableDefaults: { ...state.tableDefaults },
  img: store.layoutImg,
});
const sameAs = (a, b) => a && b && a.img === b.img &&
  JSON.stringify([a.items, a.assignments, a.pins, a.tempRules, a.tableDefaults]) ===
  JSON.stringify([b.items, b.assignments, b.pins, b.tempRules, b.tableDefaults]);

function updateButtons() {
  const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
  if (u) u.disabled = !past.length;
  if (r) r.disabled = !future.length;
}

// Call when a chart is opened or created: its history starts empty
export function resetHistory() {
  past = [];
  future = [];
  current = snap();
  updateButtons();
}

export function recordChange() {
  if (applying || !current) return;
  const now = snap();
  if (sameAs(current, now)) return;
  past.push(current);
  if (past.length > LIMIT) past.shift();
  future = [];
  current = now;
  updateButtons();
}

function apply(s) {
  applying = true;
  state.layoutItems = structuredClone(s.items);
  state.assignments = { ...s.assignments };
  state.pins = [...s.pins];
  state.tempRules = structuredClone(s.tempRules);
  state.tableDefaults = { ...s.tableDefaults };
  store.layoutImg = s.img;
  store.selectedSeatId = null;
  store.selectedStudentId = null;
  current = s;
  renderLayoutCanvas();
  renderAssignPanel();
  renderRoster();
  renderTempRules();
  updateTableToolBadge();
  markDirty();
  applying = false;
  updateButtons();
}

export function undo() {
  if (!past.length) { showToast('Nothing to undo'); return; }
  future.push(current);
  apply(past.pop());
}

export function redo() {
  if (!future.length) { showToast('Nothing to redo'); return; }
  past.push(current);
  apply(future.pop());
}

export function initUndo() {
  document.addEventListener('keydown', e => {
    if (!editorOpen() || !(e.ctrlKey || e.metaKey)) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
  });
  updateButtons();
}
