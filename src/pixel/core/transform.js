// ═══════════════════════════════════════════════
//  Move / scale / rotate / skew / flip for lifted pixels.
//  A transform maps the lifted block's own coordinates (0…w, 0…h) onto the canvas.
//  Pixels are placed by looking back from each canvas pixel (nearest neighbour), so there are
//  never gaps. RotSprite-style rotation first enlarges the art 8× with Scale2x three times,
//  which keeps edges crisp after rotating.
// ═══════════════════════════════════════════════

// 2×3 matrices: [a, b, c, d, e, f] → x' = a·x + c·y + e, y' = b·x + d·y + f
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function inverse(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

// t = { x, y, w, h (where the block was lifted from), tx, ty, sx, sy, rot (radians), kx, flipH, flipV }
export function matrixOf(t) {
  const cx = t.w / 2, cy = t.h / 2;
  const fx = (t.flipH ? -1 : 1) * (t.sx ?? 1), fy = (t.flipV ? -1 : 1) * (t.sy ?? 1);
  const c = Math.cos(t.rot || 0), s = Math.sin(t.rot || 0), k = t.kx || 0;
  let m = [1, 0, 0, 1, -cx, -cy];
  m = mul([fx, 0, 0, fy, 0, 0], m);
  m = mul([1, 0, k, 1, 0, 0], m);
  m = mul([c, s, -s, c, 0, 0], m);
  m = mul([1, 0, 0, 1, t.x + cx + (t.tx || 0), t.y + cy + (t.ty || 0)], m);
  return m;
}

export const corners = (m, w, h) => [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => apply(m, x, y));

// Scale2x (EPX): doubles pixel art without blurring it
export function scale2x(src, w, h) {
  const s = new Uint32Array(src.buffer, src.byteOffset, w * h);
  const out = new Uint8ClampedArray(w * h * 16), o = new Uint32Array(out.buffer);
  const W2 = w * 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const P = s[y * w + x];
    const A = y > 0 ? s[(y - 1) * w + x] : P, B = x < w - 1 ? s[y * w + x + 1] : P;
    const C = x > 0 ? s[y * w + x - 1] : P, D = y < h - 1 ? s[(y + 1) * w + x] : P;
    let e0 = P, e1 = P, e2 = P, e3 = P;
    if (C === A && C !== D && A !== B) e0 = A;
    if (A === B && A !== C && B !== D) e1 = B;
    if (D === C && D !== B && C !== A) e2 = C;
    if (B === D && B !== A && D !== C) e3 = D;
    const i = y * 2 * W2 + x * 2;
    o[i] = e0; o[i + 1] = e1; o[i + W2] = e2; o[i + W2 + 1] = e3;
  }
  return out;
}

// Draw the block `src` (w×h RGBA) through matrix `m` onto a canvas of W×H.
// Returns { x, y, w, h, pixels } for the covered area (clipped to the canvas), or null.
export function rasterize(src, w, h, m, W, H, { rotsprite = false } = {}) {
  const inv = inverse(m);
  if (!inv) return null;
  const cs = corners(m, w, h);
  const x0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[0])))), x1 = Math.min(W, Math.ceil(Math.max(...cs.map(c => c[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[1])))), y1 = Math.min(H, Math.ceil(Math.max(...cs.map(c => c[1]))));
  if (x1 <= x0 || y1 <= y0) return null;
  let K = 1, data = src, dw = w;
  if (rotsprite && w * h <= 512 * 512) {
    data = scale2x(scale2x(scale2x(src, w, h), w * 2, h * 2), w * 4, h * 4);
    K = 8; dw = w * 8;
  }
  const ow = x1 - x0, oh = y1 - y0, out = new Uint8ClampedArray(ow * oh * 4);
  const s32 = new Uint32Array(data.buffer, data.byteOffset, data.length / 4), o32 = new Uint32Array(out.buffer);
  for (let y = 0; y < oh; y++) {
    const py = y0 + y + 0.5;
    for (let x = 0; x < ow; x++) {
      const px = x0 + x + 0.5;
      const u = inv[0] * px + inv[2] * py + inv[4], v = inv[1] * px + inv[3] * py + inv[5];
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      o32[y * ow + x] = s32[Math.floor(v * K) * dw + Math.floor(u * K)];
    }
  }
  return { x: x0, y: y0, w: ow, h: oh, pixels: out };
}

// Copy a rectangle out of a full-canvas RGBA array, keeping only masked pixels (mask may be null)
export function lift(pixels, W, rect, mask) {
  const { x, y, w, h } = rect, out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const s = (y + j) * W + x + i;
    if (mask && !mask[s]) continue;
    out.set(pixels.subarray(s * 4, s * 4 + 4), (j * w + i) * 4);
  }
  return out;
}

// The same transform applied to a selection mask
export function rasterizeMask(mask, W, H, rect, m) {
  const block = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) if (mask[(rect.y + j) * W + rect.x + i]) block[(j * rect.w + i) * 4 + 3] = 255;
  const r = rasterize(block, rect.w, rect.h, m, W, H);
  const out = new Uint8Array(W * H);
  if (r) for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) if (r.pixels[(j * r.w + i) * 4 + 3]) out[(r.y + j) * W + r.x + i] = 1;
  return out;
}
