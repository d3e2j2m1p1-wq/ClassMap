// ═══════════════════════════════════════════════
//  ROOM MODEL — what ClassMap understands about a room
//  Real feet (from the walls), the shape of every item, walkways a person can actually use,
//  how well each seat sees the board, what's in the door's way. Room check, Tidy up and
//  Arrange for me are all built on this. Pure geometry: works on any list of items, so
//  "Arrange for me" can test thousands of rooms that are never drawn.
// ═══════════════════════════════════════════════
import { state } from '../core/state.js';
import { tableBBox } from './tables.js';
import { fixtureSize } from './fixtures.js';
import { getAllSeats } from '../assign/seats.js';
import { edgeDist, isRectangle, pointInPoly, roomPoints } from './roomShape.js';

export const SEAT_PX = 52;
export const DEFAULT_PX_PER_FT = 26;  // a 52px seat ≈ a 2-ft student desk
export const AISLE_FT = 3;            // 36 in: a walkway a wheelchair can use
export const CELL = 14;               // walkway grid (same as the layout grid)
export const VIEW = { closeFt: 4, farFt: 30, maxAngle: 60 };

export const FURNITURE = new Set(['seat', 'table']);
export const isFurniture = i => FURNITURE.has(i.type);

// ── Scale ──
export function pxPerFt(items = state.layoutItems) {
  const room = items.find(i => i.type === 'room');
  if (room && room.feetW > 0) return fixtureSize(room)[0] / room.feetW;
  return DEFAULT_PX_PER_FT;
}
export const toFt = (px, items) => px / pxPerFt(items);

// ── Shapes: every item as a rotated box { cx, cy, w, h, a } ──
export function boxOf(item) {
  let w, h;
  if (item.type === 'seat') { w = SEAT_PX; h = SEAT_PX; }
  else if (item.type === 'table') { const b = tableBBox(item); w = b.w; h = b.h; }
  else [w, h] = fixtureSize(item);
  return { id: item.id, item, type: item.type, cx: item.x + w / 2, cy: item.y + h / 2, w, h, a: (item.rotation || 0) * Math.PI / 180 };
}
export function makeBox(cx, cy, w, h, a = 0) { return { cx, cy, w, h, a }; }

export function corners(b) {
  const c = Math.cos(b.a), s = Math.sin(b.a), hw = b.w / 2, hh = b.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [b.cx + x * c - y * s, b.cy + x * s + y * c]);
}
export function aabb(b) {
  const p = corners(b);
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
// Distance from a point to a box (0 inside)
export function distToBox(b, x, y) {
  const c = Math.cos(-b.a), s = Math.sin(-b.a);
  const dx = x - b.cx, dy = y - b.cy;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  const ox = Math.max(0, Math.abs(lx) - b.w / 2), oy = Math.max(0, Math.abs(ly) - b.h / 2);
  return Math.hypot(ox, oy);
}
// Do two boxes overlap? (separating axis test; `pad` grows both a little)
export function overlaps(b1, b2, pad = 0) {
  const A = { ...b1, w: b1.w + pad, h: b1.h + pad }, B = { ...b2, w: b2.w + pad, h: b2.h + pad };
  const pa = corners(A), pb = corners(B);
  for (const box of [A, B]) {
    for (const ang of [box.a, box.a + Math.PI / 2]) {
      const ax = Math.cos(ang), ay = Math.sin(ang);
      const proj = pts => pts.map(([x, y]) => x * ax + y * ay);
      const p1 = proj(pa), p2 = proj(pb);
      if (Math.max(...p1) <= Math.min(...p2) + 0.01 || Math.max(...p2) <= Math.min(...p1) + 0.01) return false;
    }
  }
  return true;
}

// ── The room's edges: the walls, or (without walls) everything plus 2 ft ──
export function roomBounds(items = state.layoutItems) {
  const room = items.find(i => i.type === 'room');
  if (room) {
    const [w, h] = fixtureSize(room);
    const pts = roomPoints(room);
    // poly: the real outline (L-shapes, angled walls…); a plain rectangle needs no polygon tests
    return { x: room.x, y: room.y, w, h, walls: true, poly: isRectangle(pts) ? null : pts };
  }
  const list = items.filter(i => i.type !== 'room');
  if (!list.length) return { x: 0, y: 0, w: 840, h: 560, walls: false };
  const pad = 2 * pxPerFt(items);
  const e = list.map(i => aabb(boxOf(i))).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
  return { x: e.x0 - pad, y: e.y0 - pad, w: e.x1 - e.x0 + 2 * pad, h: e.y1 - e.y0 + 2 * pad, walls: false };
}
export function insideBounds(b, bounds, inset = 0) {
  const e = aabb(b);
  if (!(e.x0 >= bounds.x + inset - 0.5 && e.y0 >= bounds.y + inset - 0.5 && e.x1 <= bounds.x + bounds.w - inset + 0.5 && e.y1 <= bounds.y + bounds.h - inset + 0.5)) return false;
  if (!bounds.poly) return true;
  // shaped room: every corner inside the outline (and far enough from the walls), and no corner
  // of the room poking into the item (the inside corner of an L)
  const big = { ...b, w: b.w + 2 * inset, h: b.h + 2 * inset };
  if (!corners(big).every(([x, y]) => pointInPoly(x, y, bounds.poly) || edgeDist(x, y, bounds.poly) < 0.6)) return false;
  return !bounds.poly.some(([x, y]) => distToBox(big, x, y) === 0 && !onBoxEdge(big, x, y));
}
const onBoxEdge = (b, x, y) => {
  const c = Math.cos(-b.a), s = Math.sin(-b.a), dx = x - b.cx, dy = y - b.cy;
  const lx = Math.abs(dx * c - dy * s), ly = Math.abs(dx * s + dy * c);
  return Math.abs(lx - b.w / 2) < 0.6 || Math.abs(ly - b.h / 2) < 0.6;
};

// The direction "into the room" from a fixture on a wall (towards the middle of the room)
function inward(b, bounds) {
  const nx = -Math.sin(b.a), ny = Math.cos(b.a);
  if (bounds.poly) {
    // the side of the wall that's inside the room
    const step = Math.max(b.h, 8) + 10;
    const a = pointInPoly(b.cx + nx * step, b.cy + ny * step, bounds.poly), z = pointInPoly(b.cx - nx * step, b.cy - ny * step, bounds.poly);
    if (a !== z) return a ? [nx, ny] : [-nx, -ny];
  }
  const mx = bounds.x + bounds.w / 2 - b.cx, my = bounds.y + bounds.h / 2 - b.cy;
  return (mx * nx + my * ny) >= 0 ? [nx, ny] : [-nx, -ny];
}

// ── The board: where it is and which way the class faces ──
export function boardInfo(items, bounds) {
  const board = items.find(i => i.type === 'board');
  if (!board) return null;
  const b = boxOf(board);
  const [nx, ny] = inward(b, bounds);
  return { box: b, nx, ny };
}

// How well a point (a seat's centre) sees the board
export function viewOf(info, x, y, ppf) {
  const dx = x - info.box.cx, dy = y - info.box.cy;
  const ahead = dx * info.nx + dy * info.ny;               // straight out from the board
  const dist = Math.hypot(dx, dy) / ppf;
  const angle = Math.atan2(Math.abs(dx * info.ny - dy * info.nx), ahead) * 180 / Math.PI;
  let problem = null;
  if (ahead <= 0) problem = 'behind';
  else if (angle > VIEW.maxAngle) problem = 'angle';
  else if (ahead / ppf < VIEW.closeFt) problem = 'close';
  else if (dist > VIEW.farFt) problem = 'far';
  return { dist, angle, problem };
}

// ── Doors: the space the door swings through and just inside it must stay clear ──
export function doorZones(items, bounds) {
  return items.filter(i => i.type === 'door').map(d => {
    const b = boxOf(d);
    const [nx, ny] = inward(b, bounds);
    const reach = Math.max(b.w, 1);
    return { door: d, box: b, nx, ny, zone: makeBox(b.cx + nx * (b.h / 2 + reach / 2), b.cy + ny * (b.h / 2 + reach / 2), b.w, reach, b.a) };
  });
}

// ── Walkways ──
// A grid over the room. A cell is walkable when a person with a 3-ft walkway could stand there:
// at least half a walkway away from furniture, the teacher's desk and the walls.
// Then we flood out from the door to see what can be reached.
const BLOCKERS = new Set(['seat', 'table', 'teacher']);
export function walkways(items, bounds = roomBounds(items), opts = {}) {
  const ppf = pxPerFt(items);
  const r = (opts.aisleFt || AISLE_FT) * ppf / 2;
  const rr0 = r - CELL / 2;   // half a grid cell of slack, so a gap of exactly 3 ft still counts
  const cols = Math.max(1, Math.ceil(bounds.w / CELL)), rows = Math.max(1, Math.ceil(bounds.h / CELL));
  const blocked = new Uint8Array(cols * rows);
  const cx = c => bounds.x + (c + 0.5) * CELL, cy = rr => bounds.y + (rr + 0.5) * CELL;
  if (bounds.walls) {
    for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
      const x = cx(c), y = cy(rr);
      if (x - bounds.x < rr0 || bounds.x + bounds.w - x < rr0 || y - bounds.y < rr0 || bounds.y + bounds.h - y < rr0) blocked[rr * cols + c] = 1;
      else if (bounds.poly && (!pointInPoly(x, y, bounds.poly) || edgeDist(x, y, bounds.poly) < rr0)) blocked[rr * cols + c] = 1;
    }
  }
  const boxes = items.filter(i => BLOCKERS.has(i.type)).map(boxOf);
  boxes.forEach(b => {
    const e = aabb(b);
    const c0 = Math.max(0, Math.floor((e.x0 - r - bounds.x) / CELL)), c1 = Math.min(cols - 1, Math.ceil((e.x1 + r - bounds.x) / CELL));
    const r0 = Math.max(0, Math.floor((e.y0 - r - bounds.y) / CELL)), r1 = Math.min(rows - 1, Math.ceil((e.y1 + r - bounds.y) / CELL));
    for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++)
      if (!blocked[rr * cols + c] && distToBox(b, cx(c), cy(rr)) < rr0) blocked[rr * cols + c] = 1;
  });
  const cellAt = (x, y) => {
    const c = Math.floor((x - bounds.x) / CELL), rr = Math.floor((y - bounds.y) / CELL);
    return c >= 0 && rr >= 0 && c < cols && rr < rows ? rr * cols + c : -1;
  };
  // nearest free cell to a point, within `radius` px
  const freeNear = (x, y, radius) => {
    let best = -1, bd = Infinity;
    const k = Math.ceil(radius / CELL);
    const c0 = Math.floor((x - bounds.x) / CELL), r0 = Math.floor((y - bounds.y) / CELL);
    for (let rr = r0 - k; rr <= r0 + k; rr++) for (let c = c0 - k; c <= c0 + k; c++) {
      if (c < 0 || rr < 0 || c >= cols || rr >= rows || blocked[rr * cols + c]) continue;
      const d = Math.hypot(cx(c) - x, cy(rr) - y);
      if (d <= radius && d < bd) { bd = d; best = rr * cols + c; }
    }
    return best;
  };
  const flood = starts => {
    const seen = new Uint8Array(cols * rows);
    const q = [];
    starts.forEach(i => { if (i >= 0 && !blocked[i] && !seen[i]) { seen[i] = 1; q.push(i); } });
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % cols, rr = (i / cols) | 0;
      const nb = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, rr > 0 ? i - cols : -1, rr < rows - 1 ? i + cols : -1];
      for (const j of nb) if (j >= 0 && !blocked[j] && !seen[j]) { seen[j] = 1; q.push(j); }
    }
    return seen;
  };
  // Can someone walking the reachable cells get right up to this box?
  const reaches = (seen, b) => {
    const e = aabb(b), m = r + CELL * 1.25;
    const c0 = Math.max(0, Math.floor((e.x0 - m - bounds.x) / CELL)), c1 = Math.min(cols - 1, Math.ceil((e.x1 + m - bounds.x) / CELL));
    const r0 = Math.max(0, Math.floor((e.y0 - m - bounds.y) / CELL)), r1 = Math.min(rows - 1, Math.ceil((e.y1 + m - bounds.y) / CELL));
    for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++)
      if (seen[rr * cols + c] && distToBox(b, cx(c), cy(rr)) <= m) return true;
    return false;
  };
  return { bounds, cols, rows, blocked, r, ppf, cellAt, freeNear, flood, reaches, cx, cy };
}

// Everything reachable from the doors (or, with no door, from the teacher's desk / the biggest open area)
export function reachability(items, bounds = roomBounds(items), opts = {}) {
  const w = walkways(items, bounds, opts);
  const doors = doorZones(items, bounds);
  let starts = doors.map(d => w.freeNear(d.box.cx + d.nx * (d.box.h / 2 + w.r + CELL), d.box.cy + d.ny * (d.box.h / 2 + w.r + CELL), 2 * w.r + 2 * CELL));
  const blockedDoors = doors.filter((d, i) => starts[i] < 0).map(d => d.door);
  starts = starts.filter(i => i >= 0);
  let from = 'door';
  if (!starts.length) {   // no door, or every door is blocked: walk from the desk / the middle instead
    const desk = items.find(i => i.type === 'teacher');
    if (desk) { const b = boxOf(desk); starts = [w.freeNear(b.cx, b.cy, Math.max(b.w, b.h) / 2 + w.r + 3 * CELL)]; from = 'desk'; }
    else {
      // biggest open area: the free cell furthest from everything — approximated by the room's middle
      starts = [w.freeNear(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, Math.max(bounds.w, bounds.h))];
      from = 'middle';
    }
  }
  const seen = w.flood(starts);
  const furniture = items.filter(i => isFurniture(i) || i.type === 'teacher');
  const unreachable = starts.some(i => i >= 0) ? furniture.filter(i => !w.reaches(seen, boxOf(i))) : furniture.slice();
  return { walk: w, seen, unreachable, blockedDoors, from };
}

// ── Sightlines for every seat ──
export function sightlines(items, bounds = roomBounds(items)) {
  const info = boardInfo(items, bounds);
  if (!info) return null;
  const ppf = pxPerFt(items);
  return getAllSeats(items).map(s => ({ seat: s, ...viewOf(info, s.x + SEAT_PX / 2, s.y + SEAT_PX / 2, ppf) }));
}

// Where a piece of furniture must not be: in another piece, a "no seats" area, a door's swing,
// on the teacher's desk, or outside the walls
export function placementProblems(item, items, bounds, doors) {
  const b = boxOf(item);
  const out = [];
  if (bounds.walls && !insideBounds(b, bounds, 2)) out.push('outside');
  for (const o of items) {
    if (o === item || o.id === item.id) continue;
    if (isFurniture(o) && overlaps(b, boxOf(o), -2)) { out.push('overlap'); break; }
  }
  if (items.some(o => o.type === 'teacher' && overlaps(b, boxOf(o)))) out.push('desk');
  if (items.some(o => o.type === 'zone' && overlaps(b, boxOf(o)))) out.push('zone');
  if (doors.some(d => overlaps(b, d.zone))) out.push('door');
  return out;
}

// Nearest spot (spiralling out on the grid) where `item` has no placement problems
export function findFreeSpot(item, items, bounds, doors = doorZones(items, bounds), maxSteps = 40) {
  const x0 = item.x, y0 = item.y;
  const test = { ...item };
  const others = items.filter(o => o.id !== item.id);
  for (let k = 1; k <= maxSteps; k++) {
    let best = null, bd = Infinity;
    for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
      test.x = Math.round((x0 + dx * CELL) / CELL) * CELL;
      test.y = Math.round((y0 + dy * CELL) / CELL) * CELL;
      if (placementProblems(test, others, bounds, doors).length) continue;
      const d = Math.hypot(test.x - x0, test.y - y0);
      if (d < bd) { bd = d; best = { x: test.x, y: test.y }; }
    }
    if (best) return best;
  }
  return null;
}

export function seatCount(items) {
  return items.reduce((n, i) => n + (i.type === 'seat' ? 1 : i.type === 'table' ? (i.seatPositions || []).length : 0), 0);
}
