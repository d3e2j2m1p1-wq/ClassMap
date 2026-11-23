// ═══════════════════════════════════════════════
//  ROOM TEMPLATES (optional) + WALLS
//  The builder starts empty — teachers place each table. "Start from a template" lays out a whole
//  room sized to the class (rows, pairs, groups of 4 or 6, U-shape) with the board, the teacher's
//  desk and walls, ready to tweak. "Walls" draws a resizable outline round the room.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { state, uid } from '../core/state.js';
import { confirmDialog, plural, showToast, undoToast } from '../core/ui.js';
import { markDirty } from '../storage/autosave.js';
import { undo } from '../editor/undo.js';
import { defaultSeatPositions, renderLayoutCanvas } from './canvas.js';
import { tableBBox } from './tables.js';
import { fixtureSize } from './fixtures.js';
import { GRID, setSelection } from './selection.js';
import { closeFloatMenu, openFloatMenu, tmDiv, tmItem } from './tableGroups.js';

const SEAT = 52;
const LEFT = 70, TOP = 112;       // where the desks start (room for the board above)

export const TEMPLATES = [
  { id: 'rows',  label: 'Rows',        sub: 'Single desks facing the board' },
  { id: 'pairs', label: 'Pairs',       sub: 'Desks of 2 in rows' },
  { id: 'pods4', label: 'Groups of 4', sub: 'Tables of 4' },
  { id: 'pods6', label: 'Groups of 6', sub: 'Tables of 6' },
  { id: 'u',     label: 'U-shape',     sub: 'Desks round three sides' },
];

const seat = (x, y) => ({ type: 'seat', x, y, rotation: 0 });
function table(x, y, n) {
  return { type: 'table', x, y, rotation: 0, seatPositions: defaultSeatPositions(n), groups: 1, groupShift: 0 };
}
// A grid of tables of `n` seats: `perRow` across, `count` in all
function tableGrid(n, count, perRow, gapX, gapY) {
  const { w, h } = tableBBox({ seatPositions: defaultSeatPositions(n) });
  const stepX = Math.ceil((w + gapX) / GRID) * GRID, stepY = Math.ceil((h + gapY) / GRID) * GRID;
  return Array.from({ length: count }, (_, i) => table(LEFT + (i % perRow) * stepX, TOP + Math.floor(i / perRow) * stepY, n));
}

// The desks/tables of a template for `n` students (no ids yet)
export function templateItems(id, n) {
  n = Math.max(1, n);
  let items = [];
  if (id === 'rows') {
    const cols = n <= 20 ? 5 : 6, stepX = 98, stepY = 98;
    items = Array.from({ length: n }, (_, i) => seat(LEFT + (i % cols) * stepX, TOP + Math.floor(i / cols) * stepY));
  } else if (id === 'pairs') {
    items = tableGrid(2, Math.ceil(n / 2), 3, 84, 56);
  } else if (id === 'pods4') {
    items = tableGrid(4, Math.ceil(n / 4), 3, 84, 70);
  } else if (id === 'pods6') {
    items = tableGrid(6, Math.ceil(n / 6), 3, 84, 70);
  } else if (id === 'u') {
    // Two sides and a back row, open towards the board
    const step = 70;
    const side = Math.max(2, Math.round(n * 0.3));
    const back = Math.max(3, n - 2 * side);
    const right = LEFT + (back + 1) * step;
    for (let i = 0; i < side; i++) items.push(seat(LEFT, TOP + i * step), seat(right, TOP + i * step));
    for (let j = 0; j < back; j++) items.push(seat(LEFT + (j + 1) * step, TOP + side * step + GRID));
  }
  // Board centred above the desks, teacher's desk top right, walls round everything
  const ext = extent(items);
  const mid = Math.round(((ext.x0 + ext.x1) / 2 - 74) / GRID) * GRID;
  items.push({ type: 'board', x: mid, y: 28, rotation: 0 });
  items.push({ type: 'teacher', x: Math.round((ext.x1 - 48) / GRID) * GRID, y: 28, rotation: 0 });
  items.unshift(wallsAround(items));
  return items;
}

function sizeOf(i) {
  if (i.type === 'seat') return [SEAT, SEAT];
  if (i.type === 'table') { const b = tableBBox(i); return [b.w, b.h]; }
  return fixtureSize(i);
}
function extent(items) {
  const e = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  items.forEach(i => {
    const [w, h] = sizeOf(i);
    e.x0 = Math.min(e.x0, i.x); e.y0 = Math.min(e.y0, i.y);
    e.x1 = Math.max(e.x1, i.x + w); e.y1 = Math.max(e.y1, i.y + h);
  });
  return e;
}
export function wallsAround(items) {
  const pad = 2 * GRID;
  const list = items.filter(i => i.type !== 'room');
  if (!list.length) return { type: 'room', x: GRID, y: GRID, w: 840, h: 560, rotation: 0 };
  const e = extent(list);
  const x = Math.max(0, Math.floor((e.x0 - pad) / GRID) * GRID), y = Math.max(0, Math.floor((e.y0 - pad) / GRID) * GRID);
  return { type: 'room', x, y, w: Math.ceil((e.x1 + pad - x) / GRID) * GRID, h: Math.ceil((e.y1 + pad - y) / GRID) * GRID, rotation: 0 };
}

// ── Toolbar: Template ▾ ──
export function openTemplateMenu(anchor) {
  closeFloatMenu();
  const n = state.students.length || 24;
  const m = tmDiv('float-menu tm-inner');
  m.appendChild(tmDiv('tm-label', `Start from a template · ${plural(n, 'student')}`));
  TEMPLATES.forEach(t => m.appendChild(tmItem(t.label, t.sub, false, () => { closeFloatMenu(); applyTemplate(t.id); })));
  openFloatMenu(m, anchor);
}

export async function applyTemplate(id) {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) return;
  const hasRoom = state.layoutItems.length > 0;
  if (hasRoom) {
    const ok = await confirmDialog({
      title: `Replace this room with “${t.label}”?`,
      message: 'Everything in the Layout tab is replaced and nobody stays seated. You can Undo right after.',
      confirmLabel: 'Replace room',
    });
    if (!ok) return;
  }
  const n = state.students.length || 24;
  state.layoutItems = templateItems(id, n).map(i => ({ ...i, id: uid() }));
  state.assignments = {};
  store.selectedIds = new Set();
  renderLayoutCanvas();
  markDirty();
  const msg = `“${t.label}” for ${plural(n, 'student')} — move, add or remove anything`;
  if (hasRoom) undoToast(msg, () => undo()); else showToast(msg, 3500);
}

// ── Toolbar: Walls — draw them round the room, or select them if they're already there ──
export function addWalls() {
  const existing = state.layoutItems.find(i => i.type === 'room');
  if (existing) {
    setSelection([existing.id]);
    showToast('Drag the walls’ corner grip to resize them.');
    return;
  }
  const w = { ...wallsAround(state.layoutItems), id: uid() };
  state.layoutItems.unshift(w);
  store.selectedIds = new Set([w.id]);
  renderLayoutCanvas();
  markDirty();
}
