import { store } from '../core/store.js';
import { state, uid } from '../core/state.js';
import { appendGroupOutlines, closeFloatMenu, groupsText, openTableGroupsMenu } from './tableGroups.js';
import { addSeatToTable, makeFreeTableSeat, removeLayoutItem, tableBBox } from './tables.js';
import { markDirty } from '../storage/autosave.js';
import { GRID, clearSelection, onItemPointerDown, refreshSelection, startMarquee } from './selection.js';

// ═══════════════════════════════════════════════
//  LAYOUT CANVAS
// ═══════════════════════════════════════════════
export let currentTool = 'pointer';
store.selectedItemId = null;
store.draggingItemId = null;
export let dragOffset = { x: 0, y: 0 };
store.layoutImg = null;
store.selectedSeatId = null;   // a seated student picked by tap (assign panel)
store.selectedStudentId = null; // an unplaced student picked by tap (assign panel)

export const TOOL_HINTS = {
  pointer: 'Click to select · Shift-click or drag a box to select several · Drag to move (snaps to neighbours; hold Alt for free) · ↻ rotates.',
  seat: 'Click anywhere on the canvas to place a single seat.',
  table: 'Click to place a table. Hover Table (or tap ▾) to change seats and groups. Click a table\'s label to change just that table.',
  board: 'Click to place the board / whiteboard. Front Row and Back Row rules are measured from the board.',
  teacher: "Click to place the teacher's desk.",
};

export function setTool(name) {
  currentTool = name;
  document.querySelectorAll('.tool-btn[id^="tool-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + name);
  if (btn) btn.classList.add('active');
  document.getElementById('toolHint').textContent = TOOL_HINTS[name] || '';
}

// ── Layout canvas: time-sensitive click vs drag ──
// A quick tap/click on the background (<350ms, <8px) = PLACE item
// longer or on existing item = move/rotate
store._canvasMouseDownTime = 0;
export let _canvasMouseDownPos = null;

export function initLayoutCanvas() {
  const wrap = document.getElementById('layoutCanvasWrap');
  wrap.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const onBg = e.target === document.getElementById('layoutCanvas') ||
                 e.target === wrap ||
                 e.target.classList.contains('drop-zone-hint') ||
                 !!e.target.closest('.drop-zone-hint');
    if (!onBg) return; // clicking an item — let item handle it
    store._canvasMouseDownTime = Date.now();
    _canvasMouseDownPos = { x: e.clientX, y: e.clientY };
    if (currentTool === 'pointer') startMarquee(e);
  });
  wrap.addEventListener('pointerup', e => {
    if (!store._canvasMouseDownTime) return;
    const dt = Date.now() - store._canvasMouseDownTime;
    const dx = Math.abs(e.clientX - (_canvasMouseDownPos?.x || 0));
    const dy = Math.abs(e.clientY - (_canvasMouseDownPos?.y || 0));
    store._canvasMouseDownTime = 0;

    // Only treat as a "place" tap if: quick (<350ms) AND barely moved (<8px)
    if (dt > 350 || dx > 8 || dy > 8) return;

    if (currentTool === 'pointer') {
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) clearSelection();
      return;
    }

    const onBg = e.target === document.getElementById('layoutCanvas') ||
                 e.target === wrap ||
                 e.target.classList.contains('drop-zone-hint') ||
                 !!e.target.closest('.drop-zone-hint');
    if (!onBg) return;

    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left + wrap.scrollLeft;
    const y = e.clientY - rect.top + wrap.scrollTop;
    placeLayoutItem(x, y, e.altKey);
  });
  wrap.addEventListener('pointercancel', () => { store._canvasMouseDownTime = 0; });
}

export function placeLayoutItem(x, y, free = false) {
  // Centre the new item on the click; its corner lands on the grid so rows line up (Alt = exactly here)
  const at = (w, h) => free ? { x: x - w, y: y - h }
    : { x: Math.max(0, Math.round((x - w) / GRID) * GRID), y: Math.max(0, Math.round((y - h) / GRID) * GRID) };
  if (currentTool === 'seat') {
    addLayoutItem({ type: 'seat', ...at(18, 18) });
  } else if (currentTool === 'table') {
    const d = state.tableDefaults;
    addLayoutItem({ type: 'table', ...at(60, 50), seatPositions: defaultSeatPositions(d.seats), groups: d.groups, groupShift: 0 });
  } else if (currentTool === 'board') {
    addLayoutItem({ type: 'board', ...at(75, 12) });
  } else if (currentTool === 'teacher') {
    addLayoutItem({ type: 'teacher', ...at(24, 24) });
  }
}

// Generate default seat positions relative to table origin
export function defaultSeatPositions(n) {
  const SEAT_SIZE = 52, GAP = 10, PADDING = 14;
  const cols = n <= 2 ? n : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const positions = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    positions.push({ x: PADDING + c * (SEAT_SIZE + GAP), y: PADDING + r * (SEAT_SIZE + GAP) });
  }
  return positions;
}

export function addLayoutItem(item) {
  item.id = uid();
  item.rotation = item.rotation || 0;
  state.layoutItems.push(item);
  renderLayoutCanvas();
  markDirty();
}

export function renderLayoutCanvas() {
  closeFloatMenu();
  const canvas = document.getElementById('layoutCanvas');
  canvas.innerHTML = '';

  // Show hint only when no image and no items
  if (!store.layoutImg && state.layoutItems.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'drop-zone-hint';
    hint.innerHTML = `
      <div class="hint-icon">🏫</div>
      <p><strong>Upload a classroom image</strong> (photo, floor plan, PNG/JPG) or start placing elements directly.<br><br>Use the toolbar to add seats, tables, the board, and teacher position.</p>`;
    canvas.appendChild(hint);
  }

  // Background image
  if (store.layoutImg) {
    const img = document.createElement('img');
    img.className = 'layout-image';
    img.src = store.layoutImg;
    canvas.appendChild(img);
  }

  state.layoutItems.forEach(item => {
    const el = makeLayoutElement(item);
    canvas.appendChild(el);
  });
  refreshSelection();
}

export function makeLayoutElement(item) {
  const wrap = document.createElement('div');
  wrap.className = 'canvas-item' + (store.selectedIds && store.selectedIds.has(item.id) ? ' selected' : '');
  wrap.style.left = item.x + 'px';
  wrap.style.top = item.y + 'px';
  wrap.dataset.id = item.id;

  if (item.type === 'seat') {
    const inner = document.createElement('div');
    inner.className = 'canvas-seat';
    inner.textContent = '●';
    inner.title = 'Single seat — drag to move';
    wrap.appendChild(inner);

  } else if (item.type === 'table') {
    // Table = a transparent container; seats are absolute inside it
    const seatCount = item.seatPositions ? item.seatPositions.length : 0;
    // Compute bounding box for the container
    const bbox = tableBBox(item);
    const inner = document.createElement('div');
    inner.className = 'canvas-table-free';
    inner.style.cssText = `position:relative;width:${bbox.w}px;height:${bbox.h}px;
      background:rgba(79,142,247,0.04);border:1.5px dashed rgba(79,142,247,0.25);
      border-radius:10px;`;
    inner.dataset.label = `Table · ${seatCount} seats`;

    // Label doubles as the groups button for this table
    const lbl = document.createElement('button');
    lbl.className = 'table-groups-btn';
    lbl.textContent = `${seatCount} seat${seatCount !== 1 ? 's' : ''} · ${groupsText(item.groups, seatCount)} ▾`;
    lbl.title = 'Split this table into groups';
    lbl.addEventListener('pointerdown', e => e.stopPropagation());
    lbl.addEventListener('click', e => { e.stopPropagation(); openTableGroupsMenu(item, lbl); });
    inner.appendChild(lbl);
    appendGroupOutlines(inner, item);

    // Render each seat inside
    (item.seatPositions || []).forEach((pos, idx) => {
      const s = makeFreeTableSeat(item, idx, pos);
      inner.appendChild(s);
    });

    // "+" button to add a seat
    const addSeatBtn = document.createElement('button');
    addSeatBtn.className = 'table-add-seat-btn';
    addSeatBtn.textContent = '+';
    addSeatBtn.title = 'Add seat';
    addSeatBtn.style.cssText = `position:absolute;bottom:-10px;right:-10px;
      width:22px;height:22px;border-radius:50%;background:var(--blue);border:none;
      color:#fff;font-size:0.9rem;cursor:pointer;display:flex;align-items:center;
      justify-content:center;font-weight:700;line-height:1;z-index:5;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);`;
    addSeatBtn.onclick = (e) => { e.stopPropagation(); addSeatToTable(item.id); };
    inner.appendChild(addSeatBtn);

    wrap.appendChild(inner);

  } else if (item.type === 'board') {
    const inner = document.createElement('div');
    inner.className = 'canvas-board';
    inner.textContent = '▲ Board';
    wrap.appendChild(inner);

  } else if (item.type === 'teacher') {
    const inner = document.createElement('div');
    inner.className = 'canvas-teacher';
    inner.innerHTML = '★<span>Teacher</span>';
    wrap.appendChild(inner);
  }

  // Delete button (always)
  const delBtn = document.createElement('button');
  delBtn.className = 'item-delete';
  delBtn.textContent = '✕';
  delBtn.onclick = (e) => { e.stopPropagation(); removeLayoutItem(item.id); };
  wrap.appendChild(delBtn);

  // Rotation handle
  const rotHandle = document.createElement('div');
  rotHandle.className = 'rotate-handle';
  rotHandle.title = 'Drag to rotate';
  rotHandle.textContent = '↻';
  rotHandle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    startRotate(e, item, wrap);
  });
  wrap.appendChild(rotHandle);

  // Apply saved rotation
  if (item.rotation) wrap.style.transform = `rotate(${item.rotation}deg)`;

  // Tap/click to select, drag to move
  wrap.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('table-seat-inner') ||
        e.target.classList.contains('table-seat-del') ||
        e.target.classList.contains('table-add-seat-btn') ||
        e.target === rotHandle ||
        e.target === delBtn) return;
    // Select (Shift/Ctrl adds) and drag the whole selection — see selection.js
    onItemPointerDown(e, item);
  });

  return wrap;
}

export function startRotate(e, item, el) {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
  const startRot = item.rotation || 0;

  function onMove(mv) {
    const a = Math.atan2(mv.clientY - cy, mv.clientX - cx) * 180 / Math.PI;
    let newRot = startRot + (a - startAngle);
    // Snap to 15° increments when holding shift
    if (mv.shiftKey) newRot = Math.round(newRot / 15) * 15;
    item.rotation = newRot;
    el.style.transform = `rotate(${newRot}deg)`;
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    store._canvasMouseDownTime = 0; // prevent placement after rotation
    markDirty();
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}
