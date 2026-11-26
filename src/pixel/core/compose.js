// ═══════════════════════════════════════════════
//  Putting layers together: opacity, groups and blend modes (W3C compositing formulas,
//  plus addition, subtract and divide). The screen, thumbnails, export and merging all use
//  this one function, so what you see is what you export.
// ═══════════════════════════════════════════════
import { isGroup } from './layers.js';

export const BLEND_MODES = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
  ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
  ['addition', 'Addition'], ['subtract', 'Subtract'], ['divide', 'Divide'],
];

// Separable modes: b = backdrop, s = source, both 0–1
const SEP = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => SEP['hard-light'](s, b),
  darken: Math.min,
  lighten: Math.max,
  'color-dodge': (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (b, s) => (s <= 0.5 ? b * 2 * s : SEP.screen(b, 2 * s - 1)),
  'soft-light': (b, s) => {
    if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    return b + (2 * s - 1) * (d - b);
  },
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  addition: (b, s) => Math.min(1, b + s),
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (s <= 0 ? (b > 0 ? 1 : 0) : Math.min(1, b / s)),
};

// Non-separable modes (hue, saturation, color, luminosity)
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clip(c) {
  const l = lum(c), n = Math.min(...c), x = Math.max(...c);
  if (n < 0) c = c.map(v => l + (v - l) * l / (l - n));
  if (x > 1) c = c.map(v => l + (v - l) * (1 - l) / (x - l));
  return c;
}
const setLum = (c, l) => { const d = l - lum(c); return clip(c.map(v => v + d)); };
const sat = c => Math.max(...c) - Math.min(...c);
function setSat(c, s) {
  const mx = Math.max(...c), mn = Math.min(...c);
  if (mx === mn) return [0, 0, 0];
  return c.map(v => (v === mx ? s : v === mn ? 0 : (v - mn) * s / (mx - mn)));
}
const NONSEP = {
  hue: (b, s) => setLum(setSat(s, sat(b)), lum(b)),
  saturation: (b, s) => setLum(setSat(b, sat(s)), lum(b)),
  color: (b, s) => setLum(s, lum(b)),
  luminosity: (b, s) => setLum(b, lum(s)),
};

// Paint one source pixel (0–255 colour, alpha 0–1 including opacity) onto dst[i..i+3]
export function blendInto(dst, i, sr, sg, sb, sa, mode) {
  if (sa <= 0) return;
  const ba = dst[i + 3] / 255;
  let r = sr, g = sg, b = sb;
  if (mode !== 'normal' && ba > 0) {
    const bc = [dst[i] / 255, dst[i + 1] / 255, dst[i + 2] / 255], sc = [sr / 255, sg / 255, sb / 255];
    let mixed;
    if (SEP[mode]) mixed = [SEP[mode](bc[0], sc[0]), SEP[mode](bc[1], sc[1]), SEP[mode](bc[2], sc[2])];
    else if (NONSEP[mode]) mixed = NONSEP[mode](bc, sc);
    else mixed = sc;
    // where the backdrop is see-through, the plain source colour shows
    r = ((1 - ba) * sc[0] + ba * mixed[0]) * 255;
    g = ((1 - ba) * sc[1] + ba * mixed[1]) * 255;
    b = ((1 - ba) * sc[2] + ba * mixed[2]) * 255;
  }
  const oa = sa + ba * (1 - sa);
  dst[i] = (r * sa + dst[i] * ba * (1 - sa)) / oa;
  dst[i + 1] = (g * sa + dst[i + 1] * ba * (1 - sa)) / oa;
  dst[i + 2] = (b * sa + dst[i + 2] * ba * (1 - sa)) / oa;
  dst[i + 3] = oa * 255;
}

const celOf = (sprite, layerId, frameId) => sprite.cels.find(c => c.layerId === layerId && c.frameId === frameId);

// Compose the visible layers of one frame for a rectangle (inclusive bounds) into `out`
// (a full-canvas RGBA array). `hook(layer, frameId)` may return a replacement cel
// (used to preview a move in place).
export function composeRect(sprite, frameId, out, rect, hook) {
  const W = sprite.width;
  const x0 = Math.max(0, rect.x0), y0 = Math.max(0, rect.y0), x1 = Math.min(W - 1, rect.x1), y1 = Math.min(sprite.height - 1, rect.y1);
  if (x1 < x0 || y1 < y0) return;
  const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
  const buf = new Uint8ClampedArray(rw * rh * 4);
  composeNodes(sprite, frameId, sprite.layers, buf, x0, y0, rw, rh, hook);
  for (let y = 0; y < rh; y++) out.set(buf.subarray(y * rw * 4, (y + 1) * rw * 4), ((y0 + y) * W + x0) * 4);
}

function composeNodes(sprite, frameId, nodes, buf, x0, y0, rw, rh, hook) {
  const W = sprite.width;
  for (const n of nodes) {
    if (!n.visible) continue;
    const op = (n.opacity ?? 255) / 255;
    if (op <= 0) continue;
    const mode = n.blend || 'normal';
    if (isGroup(n)) {
      const g = new Uint8ClampedArray(rw * rh * 4);
      composeNodes(sprite, frameId, n.children, g, x0, y0, rw, rh, hook);
      for (let i = 0; i < g.length; i += 4) if (g[i + 3]) blendInto(buf, i, g[i], g[i + 1], g[i + 2], g[i + 3] / 255 * op, mode);
      continue;
    }
    const cel = (hook && hook(n, frameId)) || celOf(sprite, n.id, frameId);
    if (!cel) continue;
    const k = op * (cel.opacity ?? 255) / 255;
    const px = cel.pixels, fast = mode === 'normal' && k >= 1;
    for (let y = 0; y < rh; y++) {
      let s = ((y0 + y) * W + x0) * 4, d = y * rw * 4;
      for (let x = 0; x < rw; x++, s += 4, d += 4) {
        const a = px[s + 3];
        if (!a) continue;
        if (fast && (a === 255 || !buf[d + 3])) { buf[d] = px[s]; buf[d + 1] = px[s + 1]; buf[d + 2] = px[s + 2]; buf[d + 3] = a; continue; }
        blendInto(buf, d, px[s], px[s + 1], px[s + 2], a / 255 * k, mode);
      }
    }
  }
}

export function composeFrame(sprite, frameId = sprite.frames[0].id, hook) {
  const out = new Uint8ClampedArray(sprite.width * sprite.height * 4);
  composeRect(sprite, frameId, out, { x0: 0, y0: 0, x1: sprite.width - 1, y1: sprite.height - 1 }, hook);
  return out;
}
