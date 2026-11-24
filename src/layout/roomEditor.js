// ═══════════════════════════════════════════════
//  ROOM EDITOR — shaping the walls
//  • Walls ▾ starts from a shape (rectangle, L, notched, angled, T), fitted round the room
//  • Drag a corner (snaps to the grid, to straight lines and 45° with its neighbours; Alt = free)
//  • Double-click a wall to add a corner there · double-click a corner to remove it
//  • While the walls are selected each wall shows its length in feet
//  • Doors and windows dropped near a wall line up on it
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { state, uid } from '../core/state.js';
import { showToast, undoToast } from '../core/ui.js';
import { markDirty } from '../storage/autosave.js';
import { undo } from '../editor/undo.js';
import { renderLayoutCanvas } from './canvas.js';
import { fixtureSize, roomSvg } from './fixtures.js';
import { GRID, setSelection } from './selection.js';
import { SHAPES, nearestWall, pointInPoly, roomPoints, setRoomPoints, shapePoints } from './roomShape.js';
import { closeFloatMenu, openFloatMenu, tmDiv, tmItem } from './tableGroups.js';
import { pxPerFt } from './roomModel.js';
import { wallsAround } from './templates.js';
import { zoomOf } from '../ui/zoom.js';

const SNAP = 10;   // px: how close to straight / 45° before a corner snaps

// ── Corners, wall lengths and double-click editing on the walls item in the Layout tab ──
export function decorateRoom(wrap, item) {
  const svg = wrap.querySelector('.room-svg');
  wrap.querySelectorAll('.room-corner, .room-len').forEach(e => e.remove());
  const pts = roomPoints(item);
  const ppf = pxPerFt(state.layoutItems);
  pts.forEach(([x, y], i) => {
    const h = document.createElement('div');
    h.className = 'room-corner';
    h.style.left = (x - item.x) + 'px';
    h.style.top = (y - item.y) + 'px';
    h.title = 'Drag to move this corner · double-click to remove it';
    h.addEventListener('pointerdown', e => startCornerDrag(e, item, i, wrap));
    h.addEventListener('dblclick', e => { e.stopPropagation(); removeCorner(item, i); });
    wrap.appendChild(h);
    const [nx, ny] = pts[(i + 1) % pts.length];
    const len = Math.hypot(nx - x, ny - y) / ppf;
    const l = document.createElement('div');
    l.className = 'room-len';
    l.textContent = `${Math.round(len * 2) / 2} ft`;
    l.style.left = ((x + nx) / 2 - item.x) + 'px';
    l.style.top = ((y + ny) / 2 - item.y) + 'px';
    wrap.appendChild(l);
  });
  if (svg) svg.querySelector('.room-wall').addEventListener('dblclick', e => {
    e.stopPropagation();
    const cr = document.getElementById('layoutCanvas').getBoundingClientRect();
    addCorner(item, (e.clientX - cr.left) / zoomOf('layout'), (e.clientY - cr.top) / zoomOf('layout'));
  });
}

function redraw(wrap, item) {
  wrap.style.left = item.x + 'px';
  wrap.style.top = item.y + 'px';
  const inner = wrap.querySelector('.canvas-room');
  const [w, h] = fixtureSize(item);
  inner.style.width = w + 'px';
  inner.style.height = h + 'px';
  inner.innerHTML = roomSvg(item);
  decorateRoom(wrap, item);
}

function startCornerDrag(e, item, i, wrap) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const start = roomPoints(item);
  const [x0, y0] = start[i];
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  wrap.classList.add('dragging-corner');
  function onMove(mv) {
    if (!moved && Math.hypot(mv.clientX - sx, mv.clientY - sy) < 3) return;
    moved = true;
    const z = zoomOf('layout');
    let x = x0 + (mv.clientX - sx) / z, y = y0 + (mv.clientY - sy) / z;
    if (!mv.altKey) {
      x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID;
      // straight lines and 45° with the two neighbouring corners
      const n = start.length;
      [start[(i - 1 + n) % n], start[(i + 1) % n]].forEach(([nx, ny]) => {
        if (Math.abs(x - nx) < SNAP) x = nx;
        if (Math.abs(y - ny) < SNAP) y = ny;
        const dx = x - nx, dy = y - ny;
        if (Math.abs(Math.abs(dx) - Math.abs(dy)) < SNAP && Math.abs(dx) > SNAP) y = ny + Math.sign(dy) * Math.abs(dx);
      });
    }
    const pts = start.map(p => p.slice());
    pts[i] = [Math.max(0, x), Math.max(0, y)];
    setRoomPoints(item, pts);
    redraw(wrap, item);
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    wrap.classList.remove('dragging-corner');
    store._canvasMouseDownTime = 0;
    if (moved) { markDirty(); renderLayoutCanvas(); }
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function addCorner(item, x, y) {
  const pts = roomPoints(item);
  const w = nearestWall(x, y, pts);
  if (!w) return;
  const p = [Math.round(w.x / GRID) * GRID, Math.round(w.y / GRID) * GRID];
  pts.splice(w.i + 1, 0, p);
  setRoomPoints(item, pts);
  renderLayoutCanvas();
  markDirty();
  showToast('Corner added — drag it to shape the wall');
}
function removeCorner(item, i) {
  const pts = roomPoints(item);
  if (pts.length <= 3) { showToast('Walls need at least 3 corners'); return; }
  pts.splice(i, 1);
  setRoomPoints(item, pts);
  renderLayoutCanvas();
  markDirty();
}

// ── Toolbar: Walls ▾ ──
export function openWallsMenu(anchor) {
  closeFloatMenu();
  const m = tmDiv('float-menu tm-inner');
  const has = state.layoutItems.some(i => i.type === 'room');
  m.appendChild(tmDiv('tm-label', has ? 'Change the shape of the walls' : 'Draw walls round the room'));
  SHAPES.forEach(s => m.appendChild(tmItem(s.label, s.sub || '', false, () => { closeFloatMenu(); applyShape(s.id); })));
  m.appendChild(tmDiv('tm-sep'));
  m.appendChild(tmDiv('tm-label', 'Then drag the corners to match your room. Double-click a wall to add a corner.'));
  openFloatMenu(m, anchor);
}

export function applyShape(id) {
  let room = state.layoutItems.find(i => i.type === 'room');
  const had = !!room;
  const box = room ? { x: room.x, y: room.y, w: room.w || 840, h: room.h || 560 } : wallsAround(state.layoutItems);
  if (!room) { room = { type: 'room', id: uid(), rotation: 0 }; state.layoutItems.unshift(room); }
  setRoomPoints(room, shapePoints(id, box.x, box.y, box.w, box.h, GRID));
  renderLayoutCanvas();
  setSelection([room.id]);
  markDirty();
  const label = SHAPES.find(s => s.id === id).label;
  const msg = `${label} walls — drag the corners to match your room`;
  if (had) undoToast(msg, () => undo()); else showToast(msg, 3500);
}

// ── Doors and windows near a wall sit on it, turned to match ──
// Returns true when it snapped. `item` is moved/turned in place.
export function snapToWall(item, reach = 28) {
  if (item.type !== 'door' && item.type !== 'window') return false;
  const room = state.layoutItems.find(i => i.type === 'room');
  if (!room) return false;
  const [w, h] = fixtureSize(item);
  const cx = item.x + w / 2, cy = item.y + h / 2;
  const wall = nearestWall(cx, cy, roomPoints(room));
  if (!wall || wall.d > reach) return false;
  // keep the whole door on the wall: slide it along so it doesn't hang past a corner
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const half = Math.min(w / 2, len / 2);
  const t = Math.max(half / len, Math.min(1 - half / len, wall.t));
  const px = wall.a[0] + (wall.b[0] - wall.a[0]) * t, py = wall.a[1] + (wall.b[1] - wall.a[1]) * t;
  // turn it along the wall; a door also faces into the room (its swing opens inwards)
  let rot = ((Math.round(wall.angle) % 360) + 360) % 360;
  const inside = r => { const t = r * Math.PI / 180; return pointInPoly(px - Math.sin(t) * 20, py + Math.cos(t) * 20, roomPoints(room)); };
  if (!inside(rot)) rot = (rot + 180) % 360;
  item.rotation = item.type === 'window' ? rot % 180 : rot;
  item.x = px - w / 2;
  item.y = py - h / 2;
  return true;
}
