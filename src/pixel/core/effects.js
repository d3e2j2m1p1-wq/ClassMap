// ═══════════════════════════════════════════════
//  Live effects, worked out while compositing (nothing is stored in the pixels until you apply):
//   • modifiers: a stack on one layer — mirror, outline, shadow, tile repeat, colour shift
//   • magic layers: one drawn frame, the other frames made by a motion (bob, sway, squash,
//     spin, blink)
//   • post-processing: effects on the finished picture — drop shadow, glow, outline,
//     scanlines, colour grade
//  Every function takes full-canvas RGBA pixels (W × H × 4) and returns a new array.
// ═══════════════════════════════════════════════
import { outlinePixels, adjustColors } from './colorops.js';
import { hexToRgba } from './color.js';
import { rasterize } from './transform.js';
import { contentBounds } from './sprite.js';

const rgba = c => (Array.isArray(c) ? c : hexToRgba(c || '#000000') || [0, 0, 0, 255]);

// Source-over of one pixel array onto another (b on top of a), both full canvas
function over(a, b) {
  const out = a.slice();
  for (let i = 0; i < b.length; i += 4) {
    const sa = b[i + 3] / 255;
    if (!sa) continue;
    const da = out[i + 3] / 255, oa = sa + da * (1 - sa);
    for (let c = 0; c < 3; c++) out[i + c] = (b[i + c] * sa + out[i + c] * da * (1 - sa)) / oa;
    out[i + 3] = oa * 255;
  }
  return out;
}

// Flip a whole canvas
export function flip(px, W, H, axis) {
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = axis === 'v' ? x : W - 1 - x, sy = axis === 'h' ? y : H - 1 - y;
    out.set(px.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
  }
  return out;
}

// Mirror: the art plus its reflection (h = left↔right, v = up↕down, both = four ways)
export function mirror(px, W, H, { axis = 'h' } = {}) {
  let out = px;
  if (axis === 'h' || axis === 'both') out = over(out, flip(out, W, H, 'h'));
  if (axis === 'v' || axis === 'both') out = over(out, flip(out, W, H, 'v'));
  return out === px ? px.slice() : out;
}

// A copy of the art's shape in one colour, moved by (dx, dy)
function silhouette(px, W, H, dx, dy, color, alpha = 1) {
  const out = new Uint8ClampedArray(px.length), c = rgba(color);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x - dx, sy = y - dy;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const a = px[(sy * W + sx) * 4 + 3];
    if (!a) continue;
    out.set([c[0], c[1], c[2], Math.round(a * (c[3] / 255) * alpha)], (y * W + x) * 4);
  }
  return out;
}

// Shadow: a coloured copy behind the art
export function shadow(px, W, H, { dx = 1, dy = 1, color = '#000000', opacity = 50 } = {}) {
  return over(silhouette(px, W, H, dx, dy, color, opacity / 100), px);
}

// Outline (outside or inside, sides only or with corners)
export function outline(px, W, H, { color = '#000000', eight = false, inside = false } = {}) {
  return outlinePixels(px, W, H, rgba(color), { eight, inside });
}

// Tile repeat: the art's bounding box repeated across the canvas with a gap
export function tileRepeat(px, W, H, { gapX = 1, gapY = 1, axis = 'both' } = {}) {
  const b = contentBounds(px, W, H);
  if (!b) return px.slice();
  const sx = b.w + Math.max(0, gapX), sy = b.h + Math.max(0, gapY);
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let ox = x - b.x, oy = y - b.y;
    if (axis !== 'v') ox = ((ox % sx) + sx) % sx;
    if (axis !== 'h') oy = ((oy % sy) + sy) % sy;
    if (ox < 0 || oy < 0 || ox >= b.w || oy >= b.h) continue;
    const s = ((b.y + oy) * W + b.x + ox) * 4;
    if (px[s + 3]) out.set(px.subarray(s, s + 4), (y * W + x) * 4);
  }
  return out;
}

// Glow: a soft halo of colour around the art, `size` pixels wide, fading out
export function glow(px, W, H, { color = '#FFF1A8', size = 2, opacity = 70 } = {}) {
  const c = rgba(color), n = W * H, dist = new Float32Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (px[i * 4 + 3]) dist[i] = 0;
  // two-pass chamfer distance (good enough for a few pixels)
  const D = Math.SQRT2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (x) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
    if (y) { dist[i] = Math.min(dist[i], dist[i - W] + 1); if (x) dist[i] = Math.min(dist[i], dist[i - W - 1] + D); if (x < W - 1) dist[i] = Math.min(dist[i], dist[i - W + 1] + D); }
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (x < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
    if (y < H - 1) { dist[i] = Math.min(dist[i], dist[i + W] + 1); if (x < W - 1) dist[i] = Math.min(dist[i], dist[i + W + 1] + D); if (x) dist[i] = Math.min(dist[i], dist[i + W - 1] + D); }
  }
  const halo = new Uint8ClampedArray(px.length);
  for (let i = 0; i < n; i++) {
    const d = dist[i];
    if (d === 0 || d > size + 0.01) continue;
    const k = Math.ceil(((size + 1 - d) / (size + 1)) * 4) / 4;          // stepped, so it stays pixel-art
    halo.set([c[0], c[1], c[2], Math.round(c[3] * k * opacity / 100)], i * 4);
  }
  return over(halo, px);
}

// Scanlines: every other row darker (CRT look)
export function scanlines(px, W, H, { amount = 35, gap = 2 } = {}) {
  const out = px.slice(), k = 1 - amount / 100, g = Math.max(2, gap);
  for (let y = 0; y < H; y++) {
    if (y % g !== g - 1) continue;
    for (let o = y * W * 4, e = o + W * 4; o < e; o += 4) { out[o] *= k; out[o + 1] *= k; out[o + 2] *= k; }
  }
  return out;
}

// Colour grade: hue / saturation / value shift plus a tint
export function grade(px, W, H, { h = 0, s = 0, v = 0, tint = '#F25F6B', tintAmount = 0 } = {}) {
  let out = adjustColors(px, { h, s, v });
  if (tintAmount > 0) {
    const t = rgba(tint), k = tintAmount / 100;
    for (let o = 0; o < out.length; o += 4) if (out[o + 3]) for (let c = 0; c < 3; c++) out[o + c] += (t[c] - out[o + c]) * k;
  }
  return out;
}

// Shift colours (a modifier, e.g. a recoloured copy of a layer)
const shiftColors = (px, W, H, o) => adjustColors(px, o);

export const MODIFIERS = {
  mirror: { label: 'Mirror', run: mirror, defaults: { axis: 'h' } },
  outline: { label: 'Outline', run: outline, defaults: { color: '#2B1D1A', eight: false, inside: false } },
  shadow: { label: 'Shadow', run: shadow, defaults: { dx: 1, dy: 1, color: '#2B1D1A', opacity: 50 } },
  tile: { label: 'Tile repeat', run: tileRepeat, defaults: { gapX: 1, gapY: 1, axis: 'both' } },
  colors: { label: 'Colour shift', run: shiftColors, defaults: { h: 0, s: 0, v: 0 } },
};
export const POST = {
  shadow: { label: 'Drop shadow', run: shadow, defaults: { dx: 1, dy: 1, color: '#2B1D1A', opacity: 45 } },
  glow: { label: 'Glow', run: glow, defaults: { color: '#FFF1A8', size: 2, opacity: 70 } },
  outline: { label: 'Outline', run: outline, defaults: { color: '#2B1D1A', eight: false, inside: false } },
  scanlines: { label: 'Scanlines (CRT)', run: scanlines, defaults: { amount: 35, gap: 2 } },
  grade: { label: 'Colour grade', run: grade, defaults: { h: 0, s: 0, v: 0, tint: '#F25F6B', tintAmount: 0 } },
};

// Run a stack ([{ type, on, ...params }]) over some pixels
export function runStack(px, W, H, stack, table) {
  let out = px;
  for (const m of stack || []) {
    if (m.on === false || !table[m.type]) continue;
    out = table[m.type].run(out, W, H, m);
  }
  return out;
}
export const liveStack = stack => (stack || []).some(m => m.on !== false);

// ── magic layers ──
export const MOTIONS = {
  bob: 'Bob (up and down)',
  sway: 'Sway (rock side to side)',
  squash: 'Squash and stretch',
  spin: 'Spin',
  blink: 'Blink',
};

// The magic layer's picture on frame number `k` (counted from its drawn frame), for a cycle of
// `cycle` frames. amount: pixels (bob), degrees (sway), percent (squash).
export function magicFrame(src, W, H, { motion = 'bob', amount = 2, cycle = 8 } = {}, k = 0) {
  const b = contentBounds(src, W, H);
  if (!b) return src.slice();
  const n = Math.max(2, cycle), t = (((k % n) + n) % n) / n, wave = Math.sin(t * Math.PI * 2);
  const block = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) block.set(src.subarray(((b.y + y) * W + b.x) * 4, ((b.y + y) * W + b.x + b.w) * 4), y * b.w * 4);
  let m;
  const cx = b.x + b.w / 2, bottom = b.y + b.h;
  if (motion === 'bob') m = [1, 0, 0, 1, b.x, b.y + Math.round(-wave * amount)];
  else if (motion === 'sway' || motion === 'spin') {
    const a = (motion === 'spin' ? t * 360 : wave * amount) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    // turn around the bottom middle (sway) or the middle (spin)
    const px0 = b.w / 2, py0 = motion === 'spin' ? b.h / 2 : b.h, ax = cx, ay = motion === 'spin' ? b.y + b.h / 2 : bottom;
    m = [c, s, -s, c, ax - (c * px0 - s * py0), ay - (s * px0 + c * py0)];
  } else if (motion === 'squash') {
    const sy = 1 + wave * amount / 100, sx = 1 / sy;
    m = [sx, 0, 0, sy, cx - (b.w / 2) * sx, bottom - b.h * sy];
  } else if (motion === 'blink') {
    // closed on the last frame of each cycle: squashed to its middle row
    if ((((k % n) + n) % n) !== n - 1) return src.slice();
    m = [1, 0, 0, 1 / b.h, b.x, Math.floor(b.y + b.h / 2)];
  } else return src.slice();
  const r = rasterize(block, b.w, b.h, m, W, H, { rotsprite: false });
  const out = new Uint8ClampedArray(src.length);
  if (r) for (let y = 0; y < r.h; y++) out.set(r.pixels.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * W + r.x) * 4);
  return out;
}
