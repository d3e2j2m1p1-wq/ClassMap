// ═══════════════════════════════════════════════
//  LAYOUT SELECTION
//  Select one or several items, move them together (snapping to neighbours and to the grid),
//  duplicate, delete, line up and space evenly — plus the live seat count in the toolbar.
//   • Click = select · Shift/Ctrl-click = add or remove · drag a box on the background = select inside
//   • Touch screens: "Select several" toggle, then tap items
//   • Ctrl+D duplicate · Delete remove · Ctrl+A select all · arrows nudge (Shift = one grid step) · Esc deselect
//   • Hold Alt while dragging to place freely (no snapping)
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { state, uid } from '../core/state.js';
import { undoToast, plural } from '../core/ui.js';
import { editorOpen, markDirty } from '../storage/autosave.js';
import { renderLayoutCanvas } from './canvas.js';
import { undo } from '../editor/undo.js';

export const GRID = 14;        // half the background dot spacing, so items sit on the dots
const SNAP_DIST = 7;           // px: how close an edge must come to a neighbour's edge to snap

store.selectedIds = new Set();
let multiTap = false;          // touch "Select several" mode

const canvasEl = () => document.getElementById('layoutCanvas');
const itemEl = id => canvasEl().querySelector(`.canvas-item[data-id="${CSS.escape(id)}"]`);
const selectedItems = () => state.layoutItems.filter(i => store.selectedIds.has(i.id));
const snapGrid = v => Math.round(v / GRID) * GRID;

// ── Selection state ──
export function setSelection(ids) {
  store.selectedIds = new Set(ids);
  store.selectedItemId = ids.length ? ids[ids.length - 1] : null;
  refreshSelection();
}
export const clearSelection = () => setSelection([]);
export function selectAllItems() { setSelection(state.layoutItems.map(i => i.id)); }
function toggleSelected(id) {
  const ids = [...store.selectedIds];
  setSelection(store.selectedIds.has(id) ? ids.filter(x => x !== id) : [...ids, id]);
}

// Re-apply the "selected" outline and update the toolbar (after any render)
export function refreshSelection() {
  const alive = new Set(state.layoutItems.map(i => i.id));
  [...store.selectedIds].forEach(id => { if (!alive.has(id)) store.selectedIds.delete(id); });
  document.querySelectorAll('#layoutCanvas .canvas-item').forEach(el =>
    el.classList.toggle('selected', store.selectedIds.has(el.dataset.id)));
  const n = store.selectedIds.size;
  const bar = document.getElementById('selTools');
  if (bar) {
    bar.hidden = n === 0;
    bar.dataset.n = n >= 3 ? '3' : String(n);
    const sel = selectedItems();
    bar.dataset.name = n === 1 && ['table', 'zone'].includes(sel[0]?.type) ? '1' : '0';
    bar.dataset.tables = sel.filter(i => i.type === 'table').length >= 2 ? '1' : '0';
    document.getElementById('selCount').textContent = n === 1 ? '1 selected' : n + ' selected';
  }
  const hint = document.getElementById('toolHint');
  if (hint) hint.hidden = n > 0;
  updateSeatCount();
}

// ── Live seat count: "28 seats · 26 students" ──
export function updateSeatCount() {
  const el = document.getElementById('seatCount');
  if (!el) return;
  const seats = state.layoutItems.reduce((n, i) =>
    n + (i.type === 'seat' ? 1 : i.type === 'table' ? (i.seatPositions || []).length : 0), 0);
  const students = state.students.length;
  const short = students - seats;
  el.className = 'seat-count ' + (!students ? '' : short > 0 ? 'short' : 'ok');
  el.textContent = `${plural(seats, 'seat')} · ${plural(students, 'student')}` +
    (students && short > 0 ? ` · ${short} more needed` : '');
}

// ── Where each item is drawn, in canvas pixels (rotation included) ──
function boxes() {
  const cr = canvasEl().getBoundingClientRect();
  const m = new Map();
  state.layoutItems.forEach(i => {
    const el = itemEl(i.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    m.set(i.id, { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height });
  });
  return m;
}
function unionBox(list) {
  const x0 = Math.min(...list.map(b => b.x)), y0 = Math.min(...list.map(b => b.y));
  const x1 = Math.max(...list.map(b => b.x + b.w)), y1 = Math.max(...list.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── Pointer down on an item: select, then drag the whole selection ──
export function onItemPointerDown(e, item) {
  e.stopPropagation();
  const additive = e.shiftKey || e.ctrlKey || e.metaKey || multiTap;
  if (additive) { toggleSelected(item.id); if (!store.selectedIds.has(item.id)) return; }
  else if (!store.selectedIds.has(item.id)) setSelection([item.id]);
  startGroupDrag(e, item, additive);
}

function startGroupDrag(e, item, additive) {
  const all = boxes();
  const moving = selectedItems();
  const start = moving.map(i => ({ i, x: i.x, y: i.y, el: itemEl(i.id) }));
  const gb = unionBox(moving.map(i => all.get(i.id)).filter(Boolean));
  const others = state.layoutItems.filter(i => !store.selectedIds.has(i.id)).map(i => all.get(i.id)).filter(Boolean);
  const tx = others.flatMap(b => [b.x, b.x + b.w / 2, b.x + b.w]);
  const ty = others.flatMap(b => [b.y, b.y + b.h / 2, b.y + b.h]);
  const sx = e.clientX, sy = e.clientY;
  let moved = false;

  // Closest neighbour edge/centre to any of our edges/centre, within SNAP_DIST
  const snapAxis = (pos, size, targets) => {
    let best = null;
    [pos, pos + size / 2, pos + size].forEach(c => targets.forEach(t => {
      const d = t - c;
      if (Math.abs(d) <= SNAP_DIST && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }));
    return best;
  };

  function onMove(mv) {
    let dx = mv.clientX - sx, dy = mv.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    const guides = [];
    if (!mv.altKey) {
      const bx = snapAxis(gb.x + dx, gb.w, tx);
      if (bx) { dx += bx.d; guides.push({ axis: 'x', at: bx.at }); } else dx = snapGrid(gb.x + dx) - gb.x;
      const by = snapAxis(gb.y + dy, gb.h, ty);
      if (by) { dy += by.d; guides.push({ axis: 'y', at: by.at }); } else dy = snapGrid(gb.y + dy) - gb.y;
    }
    dx = Math.max(dx, -gb.x);   // never past the top/left edge
    dy = Math.max(dy, -gb.y);
    start.forEach(s => {
      s.i.x = s.x + dx; s.i.y = s.y + dy;
      if (s.el) { s.el.style.left = s.i.x + 'px'; s.el.style.top = s.i.y + 'px'; }
    });
    drawGuides(guides);
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    drawGuides([]);
    store._canvasMouseDownTime = 0;
    if (moved) markDirty();
    else if (!additive && store.selectedIds.size > 1) setSelection([item.id]);  // plain click inside a group = just this one
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function drawGuides(guides) {
  const c = canvasEl();
  c.querySelectorAll('.layout-guide').forEach(g => g.remove());
  const wrap = document.getElementById('layoutCanvasWrap');
  const W = Math.max(c.scrollWidth, wrap.scrollWidth), H = Math.max(c.scrollHeight, wrap.scrollHeight);
  guides.forEach(g => {
    const d = document.createElement('div');
    d.className = 'layout-guide ' + g.axis;
    d.style.cssText = g.axis === 'x' ? `left:${g.at}px;top:0;height:${H}px` : `top:${g.at}px;left:0;width:${W}px`;
    c.appendChild(d);
  });
}

// ── Box select: drag on an empty spot of the canvas (mouse and pen) ──
export function startMarquee(e) {
  if (e.pointerType === 'touch') return;
  const c = canvasEl();
  const cr0 = c.getBoundingClientRect();
  const x0 = e.clientX - cr0.left, y0 = e.clientY - cr0.top;
  const keep = e.shiftKey || e.ctrlKey || e.metaKey ? [...store.selectedIds] : [];
  let box = null;
  function onMove(mv) {
    const cr = c.getBoundingClientRect();
    const x1 = mv.clientX - cr.left, y1 = mv.clientY - cr.top;
    if (!box && Math.hypot(x1 - x0, y1 - y0) < 8) return;
    if (!box) { box = document.createElement('div'); box.className = 'layout-marquee'; c.appendChild(box); }
    const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    box._r = r;
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    if (!box) return;
    const r = box._r;
    box.remove();
    const hit = [];
    boxes().forEach((b, id) => {
      if (b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) hit.push(id);
    });
    setSelection([...new Set([...keep, ...hit])]);
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// Touch: tap items to add them instead of replacing the selection
export function toggleMultiTap() {
  multiTap = !multiTap;
  const b = document.getElementById('multiTapBtn');
  if (b) { b.classList.toggle('active', multiTap); b.setAttribute('aria-pressed', multiTap); }
}

// ── Actions ──
export function duplicateSelection() {
  const items = selectedItems();
  if (!items.length) return;
  const bx = boxes();
  const gb = unionBox(items.map(i => bx.get(i.id)).filter(Boolean));
  const wrap = document.getElementById('layoutCanvasWrap');
  const roomRight = Math.max(900, wrap.clientWidth + wrap.scrollLeft);
  // Next to the selection with the same gap a row would have; below it if there's no room to the right
  const gap = GRID * 2;
  let ox = snapGrid(gb.w + gap), oy = 0;
  if (gb.x + gb.w + gap + gb.w > roomRight) { ox = 0; oy = snapGrid(gb.h + gap); }
  const copies = items.map(i => ({ ...structuredClone(i), id: uid(), x: i.x + ox, y: i.y + oy }));
  state.layoutItems.push(...copies);
  store.selectedIds = new Set(copies.map(c => c.id));
  renderLayoutCanvas();
  markDirty();
}

export function deleteSelection() {
  const ids = new Set(store.selectedIds);
  if (!ids.size) return;
  state.layoutItems = state.layoutItems.filter(i => !ids.has(i.id));
  Object.keys(state.assignments).forEach(k => {
    const itemId = k.includes('_') ? k.slice(0, k.lastIndexOf('_')) : k;
    if (ids.has(k) || ids.has(itemId)) delete state.assignments[k];
  });
  store.selectedIds = new Set();
  renderLayoutCanvas();
  markDirty();
  undoToast(`Deleted ${plural(ids.size, 'item')}`, () => undo());
}

// Line up the selection's left edges or top edges
export function alignSelection(edge) {
  const items = selectedItems();
  if (items.length < 2) return;
  const bx = boxes();
  const target = Math.min(...items.map(i => bx.get(i.id)[edge === 'left' ? 'x' : 'y']));
  items.forEach(i => {
    const b = bx.get(i.id);
    if (edge === 'left') i.x += target - b.x; else i.y += target - b.y;
  });
  renderLayoutCanvas();
  markDirty();
}

// Equal gaps between items, from the first to the last (left→right or top→bottom)
export function distributeSelection(axis) {
  const items = selectedItems();
  if (items.length < 3) return;
  const bx = boxes();
  const P = axis === 'x' ? 'x' : 'y', S = axis === 'x' ? 'w' : 'h';
  const sorted = items.map(i => ({ i, b: bx.get(i.id) })).sort((a, b) => (a.b[P] + a.b[S] / 2) - (b.b[P] + b.b[S] / 2));
  const first = sorted[0].b, last = sorted[sorted.length - 1].b;
  const span = last[P] + last[S] - first[P];
  const gap = (span - sorted.reduce((n, s) => n + s.b[S], 0)) / (sorted.length - 1);
  let pos = first[P];
  sorted.forEach(s => { s.i[P] += pos - s.b[P]; pos += s.b[S] + gap; });
  renderLayoutCanvas();
  markDirty();
}

function nudge(dx, dy) {
  selectedItems().forEach(i => { i.x = Math.max(0, i.x + dx); i.y = Math.max(0, i.y + dy); });
  renderLayoutCanvas();
  markDirty();
}

// ── Keyboard shortcuts while the Layout tab is open ──
export function initLayoutKeys() {
  document.addEventListener('keydown', e => {
    if (!editorOpen()) return;
    const panel = document.getElementById('panel-layout');
    if (!panel || !panel.classList.contains('active')) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], .modal, dialog')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); selectAllItems(); return; }
    if (mod) return;
    if (!store.selectedIds.size) return;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelection(); }
    else if (k === 'Escape') clearSelection();
    else if (k.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? GRID : 1;
      nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
    }
  });
}

// ── Names: tables ("Table 1", "Red table") and "no seats" areas ("Sink") ──
// A small text box appears over the item; Enter or clicking away saves, Esc cancels.
export function editItemName(item) {
  item = item || selectedItems()[0];
  if (!item || !['table', 'zone'].includes(item.type)) return;
  const c = canvasEl();
  c.querySelectorAll('.item-name-input').forEach(i => i.remove());
  const b = boxes().get(item.id);
  if (!b) return;
  const input = document.createElement('input');
  input.className = 'item-name-input';
  input.maxLength = 30;
  input.placeholder = item.type === 'table' ? 'Table name, e.g. Table 1' : 'Name, e.g. Sink';
  input.value = item.label || '';
  input.setAttribute('aria-label', item.type === 'table' ? 'Table name' : 'Area name');
  input.style.left = Math.max(0, b.x) + 'px';
  input.style.top = Math.max(0, b.y - 34) + 'px';
  c.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.remove();
    if (!save || v === (item.label || '')) return;
    if (v) item.label = v;
    else if (item.type === 'zone') item.label = 'No seats';
    else delete item.label;
    renderLayoutCanvas();
    markDirty();
  };
  input.addEventListener('pointerdown', e => e.stopPropagation());
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

// Name the selected tables Table 1, Table 2 … in reading order: top row first, left to right
export function numberTables() {
  const bx = boxes();
  const tables = selectedItems().filter(i => i.type === 'table' && bx.get(i.id))
    .map(i => { const b = bx.get(i.id); return { i, cx: b.x + b.w / 2, cy: b.y + b.h / 2, h: b.h }; })
    .sort((a, b) => a.cy - b.cy);
  if (tables.length < 2) return;
  // Same row = centre within ¾ of a table's height of the row's average (rows can be a little staggered)
  const rows = [];
  tables.forEach(t => {
    const row = rows[rows.length - 1];
    const avg = row && row.reduce((n, r) => n + r.cy, 0) / row.length;
    if (row && Math.abs(t.cy - avg) < Math.max(...row.map(r => r.h)) * 0.75) row.push(t); else rows.push([t]);
  });
  let n = 0;
  rows.forEach(r => r.sort((a, b) => a.cx - b.cx).forEach(t => { t.i.label = 'Table ' + (++n); }));
  renderLayoutCanvas();
  markDirty();
}
