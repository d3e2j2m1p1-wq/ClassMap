// ═══════════════════════════════════════════════
//  Selections are masks: one byte per pixel, 1 = selected.
// ═══════════════════════════════════════════════
import { ellipsePoints, polygonPoints } from './raster.js';

export function maskFromPoints(W, H, pts) {
  const m = new Uint8Array(W * H);
  for (const [x, y] of pts) if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1;
  return m;
}

export function maskRect(W, H, x0, y0, x1, y1) {
  const m = new Uint8Array(W * H);
  const a = Math.max(0, Math.min(x0, x1)), b = Math.min(W - 1, Math.max(x0, x1));
  const c = Math.max(0, Math.min(y0, y1)), d = Math.min(H - 1, Math.max(y0, y1));
  for (let y = c; y <= d; y++) m.fill(1, y * W + a, y * W + b + 1);
  return m;
}

export const maskEllipse = (W, H, x0, y0, x1, y1) => maskFromPoints(W, H, ellipsePoints(x0, y0, x1, y1, true));
export const maskPolygon = (W, H, pts) => maskFromPoints(W, H, pts.length < 3 ? pts : polygonPoints(pts, true));

// mode: replace | add | subtract | intersect | xor
export function combine(old, next, mode) {
  if (!old || mode === 'replace') return next;
  const out = new Uint8Array(next.length);
  for (let i = 0; i < out.length; i++) {
    const a = old[i], b = next[i];
    out[i] = mode === 'add' ? (a | b) : mode === 'subtract' ? (a & !b) : mode === 'intersect' ? (a & b) : (a ^ b);
  }
  return out;
}

export function invert(m) { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; }

export function bounds(m, W) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// The selection's border as line segments on pixel edges, joined into long runs
// (drawn as "marching ants"). Each segment: [x0, y0, x1, y1] in pixel-corner coordinates.
export function outline(m, W, H) {
  const segs = [];
  const sel = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
  // horizontal edges: between row y-1 and row y
  for (let y = 0; y <= H; y++) {
    let start = -1, side = 0;
    for (let x = 0; x <= W; x++) {
      const a = sel(x, y - 1), b = sel(x, y);
      const s = x < W && a !== b ? (b ? 1 : 2) : 0;
      if (s !== side) { if (side) segs.push([start, y, x, y]); start = x; side = s; }
    }
  }
  for (let x = 0; x <= W; x++) {
    let start = -1, side = 0;
    for (let y = 0; y <= H; y++) {
      const a = sel(x - 1, y), b = sel(x, y);
      const s = y < H && a !== b ? (b ? 1 : 2) : 0;
      if (s !== side) { if (side) segs.push([x, start, x, y]); start = y; side = s; }
    }
  }
  return segs;
}
