import { store } from '../core/store.js';
import { state, uid } from '../core/state.js';
import { appendGroupOutlines, closeFloatMenu, groupsText, openTableGroupsMenu } from './tableGroups.js';
import { addSeatToTable, makeFreeTableSeat, removeLayoutItem, tableBBox } from './tables.js';
import { markDirty } from '../storage/autosave.js';
import { GRID, clearSelection, editItemName, onItemPointerDown, refreshSelection, startMarquee } from './selection.js';
import { scheduleRoomCheck } from './roomCheck.js';
import { FIXTURE_SIZE, MIN_SIZE, RESIZE, fixtureSize, isFixture, makeFixture, sizeFixture } from './fixtures.js';

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
  pointer: 'Click to select · Shift-click or drag a box to select several · Drag to move (hold Alt for free) · ↻ turns (tap it = 45°) · drag a blue grip to resize.',
  seat: 'Click anywhere on the canvas to place a single seat.',
  table: 'Click to place a table. Hover Table (or tap ▾) to change seats and groups. Click a table\'s label to change just that table.',
  board: 'Click to place the board / whiteboard. Front Row and Back Row rules are measured from the board.',
  teacher: "Click to place the teacher's desk.",
  outlet: 'Click to place an outlet — handy for students with a device to charge.',
  zone: 'Click to mark an area with no seats (sink, reading corner…). Drag its corner to resize; double-click to rename.',
  door: 'Click to place a door. Drag the grip on its end to make it wider. Tags can seat students near it (Rules → Tags).',
  window: 'Click to place a window. Drag the grip on its end to make it longer. Tags can seat students away from it (Rules → Tags).',
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
  } else if (FIXTURE_SIZE[currentTool]) {
    const [w, h] = FIXTURE_SIZE[currentTool];
    addLayoutItem({ type: currentTool, ...at(w / 2, h / 2), ...(currentTool === 'zone' ? { w, h, label: 'No seats' } : {}) });
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
      <p><strong>Place your tables</strong> with the toolbar — seats, tables, the board, the teacher's desk, doors and windows.<br><br>Or <button type="button" class="hint-link" onclick="openTemplateMenu(this)">start from a template</button>, or upload a photo / floor plan of the room to trace.</p>`;
    canvas.appendChild(hint);
  }

  // Background image
  if (store.layoutImg) {
    const img = document.createElement('img');
    img.className = 'layout-image';
    img.src = store.layoutImg;
    canvas.appendChild(img);
  }

  // Walls, then "no seats" areas, underneath tables and seats
  [...state.layoutItems].sort((a, b) => layer(a) - layer(b)).forEach(item => {
    canvas.appendChild(makeLayoutElement(item));
  });
  refreshSelection();
  scheduleRoomCheck();
}

export const layer = i => i.type === 'room' ? 0 : i.type === 'zone' ? 1 : 2;

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
    // Table name ("Table 1", "Red table") leads the label — double-click it to rename
    if (item.label) {
      const nm = document.createElement('b');
      nm.className = 'table-name';
      nm.textContent = item.label;
      nm.title = 'Double-click to rename';
      nm.addEventListener('click', e => e.stopPropagation());   // the name doesn't open the groups menu
      nm.addEventListener('dblclick', e => { e.stopPropagation(); editItemName(item); });
      lbl.prepend(nm, ' · ');
    }
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

  } else if (isFixture(item)) {
    const inner = makeFixture(item);
    wrap.appendChild(inner);
    if (item.type === 'zone') inner.addEventListener('dblclick', e => { e.stopPropagation(); editItemName(item); });
    if (item.type === 'room') wrap.classList.add('is-room');
    if (RESIZE[item.type]) {
      const grip = document.createElement('div');
      grip.className = 'item-resize ' + RESIZE[item.type];
      if (RESIZE[item.type] === 'w') wrap.classList.add('thin');   // ✕ moves up, out of the grip's way
      grip.title = RESIZE[item.type] === 'w' ? 'Drag to make longer or shorter' : 'Drag to resize';
      grip.addEventListener('pointerdown', e => startResize(e, item, wrap, inner));
      wrap.appendChild(grip);
    }
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
  if (item.type !== 'room') wrap.appendChild(rotHandle);   // walls stay square to the page

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
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  const norm = r => Math.round((((r % 360) + 360) % 360) * 10) / 10;

  function onMove(mv) {
    if (!moved && Math.hypot(mv.clientX - sx, mv.clientY - sy) < 4) return;
    moved = true;
    const a = Math.atan2(mv.clientY - cy, mv.clientX - cx) * 180 / Math.PI;
    let newRot = startRot + (a - startAngle);
    if (rotSnap !== mv.shiftKey) newRot = Math.round(newRot / 45) * 45;   // 45° steps unless "free"
    item.rotation = norm(newRot);
    el.style.transform = `rotate(${item.rotation}deg)`;
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    store._canvasMouseDownTime = 0; // prevent placement after rotation
    if (!moved) {   // a tap on ↻ turns it to the next 45° step
      item.rotation = norm(Math.floor((startRot + 0.01) / 45) * 45 + 45);
      el.style.transform = `rotate(${item.rotation}deg)`;
    }
    markDirty();
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// Drag a fixture's grip to resize it: doors, windows and the board get longer or shorter; the desk,
// "no seats" areas and walls change both ways. Works when rotated; the opposite end stays put.
// Snaps to the grid (Alt = free).
function startResize(e, item, wrap, el) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const mode = RESIZE[item.type];
  const th = (item.rotation || 0) * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
  const [w0, h0] = fixtureSize(item);
  const rot = ([x, y]) => [x * cos - y * sin, x * sin + y * cos];
  const anchorOf = (w, h) => [-w / 2, mode === 'wh' ? -h / 2 : 0];   // left end, or top-left corner
  const [ax, ay] = rot(anchorOf(w0, h0));
  const anchor = [item.x + w0 / 2 + ax, item.y + h0 / 2 + ay];
  const sx = e.clientX, sy = e.clientY;
  let changed = false;
  function onMove(mv) {
    const dx = mv.clientX - sx, dy = mv.clientY - sy;
    const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;      // pointer movement along the item
    const snap = v => mv.altKey ? v : Math.round(v / GRID) * GRID;
    const min = MIN_SIZE[item.type] || GRID;
    const w = Math.max(min, snap(w0 + lx));
    const h = mode === 'wh' ? Math.max(min, snap(h0 + ly)) : h0;
    const [bx, by] = rot(anchorOf(w, h));
    item.x = anchor[0] - bx - w / 2;
    item.y = anchor[1] - by - h / 2;
    item.w = w;
    if (mode === 'wh') item.h = h;
    wrap.style.left = item.x + 'px';
    wrap.style.top = item.y + 'px';
    sizeFixture(el, item);
    changed = true;
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    store._canvasMouseDownTime = 0;
    if (changed) markDirty();
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// ── Rotation: 45° steps by default (straight is easy), or free. Shift does the other one. ──
let rotSnap = true;
try { rotSnap = localStorage.getItem('cm-rotate-free') !== '1'; } catch { /* private mode */ }
export function updateRotateButton() {
  const b = document.getElementById('rotSnapBtn');
  if (!b) return;
  b.textContent = rotSnap ? '↻ 45° steps' : '↻ Free turn';
  b.setAttribute('aria-pressed', String(!rotSnap));
  b.title = rotSnap ? 'Items turn 45° at a time (hold Shift to turn freely). Click to turn freely.' : 'Items turn freely (hold Shift for 45° steps). Click for 45° steps.';
}
export function toggleRotateSnap() {
  rotSnap = !rotSnap;
  try { localStorage.setItem('cm-rotate-free', rotSnap ? '0' : '1'); } catch { /* private mode */ }
  updateRotateButton();
}
