// ═══════════════════════════════════════════════
//  Turning lines and shapes into pixels. Everything returns plain [x, y] lists in
//  sprite pixels; the tools decide what colour goes there.
// ═══════════════════════════════════════════════

// Straight line, one pixel wide, no doubled corners (Bresenham)
export function linePoints(x0, y0, x1, y1) {
  const out = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

// "Perfect angle": snap the end point so the line runs at 0°, 90°, 45°, or a clean
// 2:1 / 1:2 pixel step (the isometric angle), whichever is nearest.
const RATIOS = [0, 0.5, 1, 2, Infinity];
export function snapLine(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  if (!dx && !dy) return [x1, y1];
  const ang = Math.atan2(Math.abs(dy), Math.abs(dx));
  let best = 0, bestD = Infinity;
  for (const r of RATIOS) {
    const a = r === Infinity ? Math.PI / 2 : Math.atan(r);
    const d = Math.abs(a - ang);
    if (d < bestD) { bestD = d; best = r; }
  }
  const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
  if (best === 0) return [x1, y0];
  if (best === Infinity) return [x0, y1];
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  if (best === 1) return [x0 + sx * len, y0 + sy * len];
  if (best === 0.5) { const w = Math.round(Math.max(Math.abs(dx), Math.abs(dy) * 2) / 2) * 2; return [x0 + sx * w, y0 + sy * w / 2]; }
  const h = Math.round(Math.max(Math.abs(dy), Math.abs(dx) * 2) / 2) * 2;      // best === 2
  return [x0 + sx * h / 2, y0 + sy * h];
}

// Brush tips: the pixel offsets a tip of `size` covers. Even sizes lean up-left of the cursor.
const tipCache = new Map();
export function tipOffsets(size, shape = 'round') {
  size = Math.max(1, Math.round(size));
  const key = shape + size;
  if (tipCache.has(key)) return tipCache.get(key);
  const start = -Math.floor((size - 1) / 2), c = (size - 1) / 2, r = size / 2 - 0.25;
  const out = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (shape === 'round' && size > 2 && (i - c) ** 2 + (j - c) ** 2 > r * r) continue;
    out.push([start + i, start + j]);
  }
  tipCache.set(key, out);
  return out;
}

// Pixel-perfect: drop the corner pixel of every "L" in a one-pixel freehand path, so curves
// stay one clean pixel wide. Feed points one at a time; it says which earlier point to take back.
export class PixelPerfect {
  constructor() { this.path = []; }
  push(x, y) {
    const p = this.path, last = p[p.length - 1];
    if (last && last[0] === x && last[1] === y) return { add: false, remove: null };
    p.push([x, y]);
    if (p.length >= 3) {
      const [a, b, c] = p.slice(-3);
      const adj = (u, v) => Math.abs(u[0] - v[0]) + Math.abs(u[1] - v[1]) === 1;
      if (adj(a, b) && adj(b, c) && Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1) {
        p.splice(p.length - 2, 1);
        return { add: true, remove: b };
      }
    }
    return { add: true, remove: null };
  }
}
export function pixelPerfectPath(points) {
  const pp = new PixelPerfect();
  for (const [x, y] of points) pp.push(x, y);
  return pp.path;
}

const box = (x0, y0, x1, y1) => [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];

export function rectPoints(x0, y0, x1, y1, filled) {
  [x0, y0, x1, y1] = box(x0, y0, x1, y1);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (filled || x === x0 || x === x1 || y === y0 || y === y1) out.push([x, y]);
  }
  return out;
}

// Ellipse that fits the box exactly, after A. Zingl's published rasterising method
export function ellipsePoints(x0, y0, x1, y1, filled) {
  [x0, y0, x1, y1] = box(x0, y0, x1, y1);
  const seen = new Set(), out = [];
  const put = (x, y) => { const k = x + ',' + y; if (!seen.has(k)) { seen.add(k); out.push([x, y]); } };
  let a = x1 - x0, b = y1 - y0, b1 = b & 1;
  let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  y0 += (b + 1) >> 1; y1 = y0 - b1;
  const A = 8 * a * a, B = 8 * b * b;
  do {
    put(x1, y0); put(x0, y0); put(x0, y1); put(x1, y1);
    const e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += A; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += B; }
  } while (x0 <= x1);
  while (y0 - y1 <= b) {
    put(x0 - 1, y0); put(x1 + 1, y0++);
    put(x0 - 1, y1); put(x1 + 1, y1--);
  }
  return filled ? fillRows(out) : out;
}

// Fill every row between its leftmost and rightmost outline pixel
function fillRows(outline) {
  const rows = new Map();
  for (const [x, y] of outline) {
    const r = rows.get(y);
    if (!r) rows.set(y, [x, x]); else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
  }
  const out = [];
  for (const [y, [a, b]] of rows) for (let x = a; x <= b; x++) out.push([x, y]);
  return out;
}

// Regular polygon with `sides` corners inside the box, first corner at the top
export function polygonVertices(x0, y0, x1, y1, sides) {
  [x0, y0, x1, y1] = box(x0, y0, x1, y1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  const v = [];
  for (let i = 0; i < sides; i++) {
    const t = -Math.PI / 2 + i * 2 * Math.PI / sides;
    v.push([Math.round(cx + rx * Math.cos(t)), Math.round(cy + ry * Math.sin(t))]);
  }
  return v;
}

export function polygonPoints(verts, filled) {
  const seen = new Set(), out = [];
  const put = (x, y) => { const k = x + ',' + y; if (!seen.has(k)) { seen.add(k); out.push([x, y]); } };
  for (let i = 0; i < verts.length; i++) {
    const [ax, ay] = verts[i], [bx, by] = verts[(i + 1) % verts.length];
    for (const [x, y] of linePoints(ax, ay, bx, by)) put(x, y);
  }
  if (!filled) return out;
  // inside: sample each pixel's centre against the edges (even-odd rule)
  const ys = verts.map(v => v[1]), xs = verts.map(v => v[0]);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    const cy = y + 0.5, hits = [];
    for (let i = 0; i < verts.length; i++) {
      const [ax, ay] = verts[i], [bx, by] = verts[(i + 1) % verts.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) hits.push(ax + (cy - ay) / (by - ay) * (bx - ax));
    }
    hits.sort((p, q) => p - q);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      for (let x = Math.ceil(hits[k] - 0.5); x <= Math.floor(hits[k + 1] - 0.5); x++) {
        if (x >= Math.min(...xs) && x <= Math.max(...xs)) put(x, y);
      }
    }
  }
  return out;
}

// One entry point for the Shape tool: 4 sides = rectangle, 0 (or ellipse) = ellipse
export function shapePoints(kind, sides, x0, y0, x1, y1, filled) {
  if (kind === 'ellipse' || sides === 0) return ellipsePoints(x0, y0, x1, y1, filled);
  if (kind === 'rect' || sides === 4) return rectPoints(x0, y0, x1, y1, filled);
  return polygonPoints(polygonVertices(x0, y0, x1, y1, Math.max(3, sides)), filled);
}

// Shift = perfect ratio (square / circle); Alt = drag out from the centre
export function shapeBox(x0, y0, x1, y1, square, fromCenter) {
  let dx = x1 - x0, dy = y1 - y0;
  if (square) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = (Math.sign(dx) || 1) * m; dy = (Math.sign(dy) || 1) * m; }
  return fromCenter ? [x0 - dx, y0 - dy, x0 + dx, y0 + dy] : [x0, y0, x0 + dx, y0 + dy];
}
