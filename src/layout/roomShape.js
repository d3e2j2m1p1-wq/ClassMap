// ═══════════════════════════════════════════════
//  ROOM SHAPE — the walls as an outline of corners (any shape: L, notched, angled corner …)
//  The walls item keeps its corners relative to its own top-left (item.points); older rooms
//  without points are rectangles of item.w × item.h. Pure geometry, no drawing.
// ═══════════════════════════════════════════════

// Corners in canvas coordinates
export function roomPoints(room) {
  if (Array.isArray(room.points) && room.points.length >= 3) return room.points.map(([x, y]) => [room.x + x, room.y + y]);
  const w = room.w || 840, h = room.h || 560;
  return [[room.x, room.y], [room.x + w, room.y], [room.x + w, room.y + h], [room.x, room.y + h]];
}

// Store new corners (canvas coordinates): the item's x/y/w/h become the outline's bounding box
export function setRoomPoints(room, pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  room.x = x0; room.y = y0;
  room.w = Math.max(...xs) - x0; room.h = Math.max(...ys) - y0;
  room.points = pts.map(([x, y]) => [x - x0, y - y0]);
}

export const isRectangle = pts => pts.length === 4 &&
  pts.every(([x, y], i) => { const [nx, ny] = pts[(i + 1) % 4]; return x === nx || y === ny; });

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t, x: ax + t * dx, y: ay + t * dy };
}

export function edgeDist(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) best = Math.min(best, segDist(x, y, pts[i], pts[(i + 1) % pts.length]).d);
  return best;
}

// Nearest wall to a point: { i (wall from corner i to i+1), d, x, y (closest point), angle (degrees) }
export function nearestWall(x, y, pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const s = segDist(x, y, a, b);
    if (!best || s.d < best.d) best = { i, ...s, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, a, b };
  }
  return best;
}

// ── Shapes to start from, fitted to a box ──
export const SHAPES = [
  { id: 'rect',   label: 'Rectangle' },
  { id: 'l',      label: 'L-shape',        sub: 'one corner of the room is missing' },
  { id: 'notch',  label: 'Notched corner', sub: 'a closet or column cuts in' },
  { id: 'angled', label: 'Angled corner',  sub: 'one wall cut at 45°' },
  { id: 't',      label: 'T-shape',        sub: 'wider at the front' },
];
export function shapePoints(id, x, y, w, h, grid = 14) {
  const g = v => Math.round(v / grid) * grid;
  const X = x + w, Y = y + h;
  if (id === 'l') { const cx = g(x + w * 0.6), cy = g(y + h * 0.55); return [[x, y], [cx, y], [cx, cy], [X, cy], [X, Y], [x, Y]]; }
  if (id === 'notch') { const nx = g(x + w * 0.22), ny = g(y + h * 0.25); return [[nx, y], [X, y], [X, Y], [x, Y], [x, ny], [nx, ny]]; }
  if (id === 'angled') { const c = g(Math.min(w, h) * 0.3); return [[x, y], [X - c, y], [X, y + c], [X, Y], [x, Y]]; }
  if (id === 't') { const s = g(w * 0.18), d = g(h * 0.45); return [[x, y], [X, y], [X, y + d], [X - s, y + d], [X - s, Y], [x + s, Y], [x + s, y + d], [x, y + d]]; }
  return [[x, y], [X, y], [X, Y], [x, Y]];
}
