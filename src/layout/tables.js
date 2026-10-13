import { confirmDialog, plural, showToast, undoToast } from '../core/ui.js';
import { renderAssignPanel } from '../assign/panel.js';
import { editorOpen } from '../storage/autosave.js';
import { saveLandingData } from '../storage/landingData.js';
import { store } from '../core/store.js';
import { state } from '../core/state.js';
import { dragOffset, renderLayoutCanvas } from './canvas.js';
import { markDirty } from '../storage/autosave.js';

export function tableBBox(item) {
  if (!item.seatPositions || item.seatPositions.length === 0) return { w: 110, h: 90 };
  const SEAT = 52, PAD = 14;
  let maxX = 0, maxY = 0;
  item.seatPositions.forEach(p => {
    maxX = Math.max(maxX, p.x + SEAT);
    maxY = Math.max(maxY, p.y + SEAT);
  });
  return { w: maxX + PAD, h: maxY + PAD };
}

export function makeFreeTableSeat(item, idx, pos) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;left:${pos.x}px;top:${pos.y}px;
    width:52px;height:52px;cursor:move;z-index:2;`;
  wrap.className = 'table-seat-wrap';
  wrap.dataset.seatIdx = idx;

  const inner = document.createElement('div');
  inner.className = 'table-seat-inner canvas-seat';
  inner.textContent = '●';
  inner.title = 'Drag to reposition · ✕ to remove';
  wrap.appendChild(inner);

  // Remove button (shows on hover)
  const del = document.createElement('button');
  del.className = 'table-seat-del';
  del.textContent = '✕';
  del.style.cssText = `position:absolute;top:-7px;right:-7px;width:14px;height:14px;
    border-radius:50%;background:var(--rose);border:none;color:#fff;font-size:0.55rem;
    cursor:pointer;align-items:center;justify-content:center;z-index:3;padding:0;`;
  del.onclick = (e) => { e.stopPropagation(); removeSeatFromTable(item.id, idx); };
  wrap.appendChild(del);

  // Drag seat within the table. Pointer movement is rotated back into the
  // table's own (unrotated) coordinates so this also works on rotated tables.
  wrap.addEventListener('pointerdown', e => {
    if (e.target === del || e.button !== 0) return;
    e.stopPropagation();
    // Touching a seat also selects its table (shows the table's ✕ and ↻ on touch screens)
    const itemEl = wrap.closest('.canvas-item');
    document.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('selected'));
    if (itemEl) itemEl.classList.add('selected');
    store.selectedItemId = item.id;
    const parentEl = wrap.parentElement;
    const p0 = item.seatPositions[idx];
    const sx = e.clientX, sy = e.clientY, ox = p0.x, oy = p0.y;
    const th = (item.rotation || 0) * Math.PI / 180;
    const c = Math.cos(th), sn = Math.sin(th);

    function onMove(mv) {
      const dx = mv.clientX - sx, dy = mv.clientY - sy;
      const lx = dx * c + dy * sn;
      const ly = -dx * sn + dy * c;
      const pos2 = item.seatPositions[idx];
      pos2.x = Math.max(0, ox + lx);
      pos2.y = Math.max(0, oy + ly);
      wrap.style.left = pos2.x + 'px';
      wrap.style.top = pos2.y + 'px';
      const bbox = tableBBox(item);
      parentEl.style.width = bbox.w + 'px';
      parentEl.style.height = bbox.h + 'px';
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      markDirty();
      renderLayoutCanvas();   // groups follow the new seat positions
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

  return wrap;
}

export function addSeatToTable(tableId) {
  const item = state.layoutItems.find(i => i.id === tableId);
  if (!item) return;
  const bbox = tableBBox(item);
  // Place new seat to the right or below
  const SEAT = 52, GAP = 10;
  item.seatPositions.push({ x: 12, y: bbox.h + GAP });
  renderLayoutCanvas();
  markDirty();
}

export function removeSeatFromTable(tableId, idx) {
  const item = state.layoutItems.find(i => i.id === tableId);
  if (!item || item.seatPositions.length <= 1) return;
  item.seatPositions.splice(idx, 1);
  // Clean up any assignment for this seat
  const seatId = tableId + '_' + idx;
  delete state.assignments[seatId];
  // Re-index assignments for seats after the removed one
  for (let i = idx; i < item.seatPositions.length; i++) {
    const oldKey = tableId + '_' + (i + 1);
    const newKey = tableId + '_' + i;
    if (state.assignments[oldKey] !== undefined) {
      state.assignments[newKey] = state.assignments[oldKey];
      delete state.assignments[oldKey];
    }
  }
  renderLayoutCanvas();
  markDirty();
}

export function moveItem(e) {
  if (!store.draggingItemId) return;
  const item = state.layoutItems.find(i => i.id === store.draggingItemId);
  if (!item) return;
  const wrap = document.getElementById('layoutCanvasWrap');
  const rect = wrap.getBoundingClientRect();
  item.x = Math.max(0, e.clientX - rect.left + wrap.scrollLeft - dragOffset.x);
  item.y = Math.max(0, e.clientY - rect.top + wrap.scrollTop - dragOffset.y);
  const el = document.querySelector(`.canvas-item[data-id="${store.draggingItemId}"]`);
  if (el) { el.style.left = item.x + 'px'; el.style.top = item.y + 'px'; }
}

export function stopMove() {
  store.draggingItemId = null;
  document.onpointermove = null;
  document.onpointerup = null;
  document.onpointercancel = null;
  store._canvasMouseDownTime = 0; // prevent placement firing after a drag
  markDirty();
}

export function removeLayoutItem(id) {
  state.layoutItems = state.layoutItems.filter(i => i.id !== id);
  // Remove assignments for this item (single seat = "id", table seats = "id_N")
  Object.keys(state.assignments).forEach(k => {
    if (k === id || k.startsWith(id + '_')) delete state.assignments[k];
  });
  renderLayoutCanvas();
  markDirty();
}

export async function clearLayout() {
  const nItems = state.layoutItems.length;
  if (!nItems && !store.layoutImg) { showToast('The layout is already empty'); return; }
  const nSeated = Object.keys(state.assignments).length;
  const ok = await confirmDialog({
    title: 'Clear the whole layout?',
    details: [plural(nItems, 'item'), store.layoutImg ? 'classroom photo' : '', nSeated ? nSeated + ' seated' : ''].filter(Boolean).join(' · '),
    message: 'Tables, seats, the board and the photo are removed, and every student goes back to Unplaced.',
    confirmLabel: 'Clear layout',
    danger: true,
  });
  if (!ok) return;
  const snap = { items: state.layoutItems, assignments: state.assignments, img: store.layoutImg, chartId: window._currentChartId };
  state.layoutItems = [];
  state.assignments = {};
  store.layoutImg = null;
  renderLayoutCanvas();
  renderAssignPanel();
  markDirty();
  undoToast('Layout cleared', () => {
    if (editorOpen() && window._currentChartId === snap.chartId) {
      state.layoutItems = snap.items;
      state.assignments = snap.assignments;
      store.layoutImg = snap.img;
      renderLayoutCanvas();
      renderAssignPanel();
      markDirty();
    } else {
      // The chart was closed in the meantime: put it back in the saved chart
      const ch = store.landingData.charts.find(c => c.id === snap.chartId);
      if (!ch || !ch.data) return;
      Object.assign(ch.data, { layoutItems: snap.items, assignments: snap.assignments, layoutImg: snap.img });
      saveLandingData();
    }
  });
}
