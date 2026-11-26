// ═══════════════════════════════════════════════
//  Colours. A colour is [r, g, b, a], each 0–255 (not premultiplied).
// ═══════════════════════════════════════════════

export const TRANSPARENT = Object.freeze([0, 0, 0, 0]);

const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));

export function hexToRgba(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = i => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
}

export function rgbaToHex(c, withAlpha = c[3] !== 255) {
  const p = v => clamp255(v).toString(16).padStart(2, '0');
  return '#' + p(c[0]) + p(c[1]) + p(c[2]) + (withAlpha ? p(c[3]) : '');
}

export const sameColor = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

// h 0–360, s and v 0–1
export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

// Source-over: paint `src` on top of `dst`. Both [r,g,b,a]; returns a new array.
export function blendOver(dst, src) {
  const sa = src[3] / 255, da = dst[3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return [0, 0, 0, 0];
  const ch = i => (src[i] * sa + dst[i] * da * (1 - sa)) / oa;
  return [clamp255(ch(0)), clamp255(ch(1)), clamp255(ch(2)), clamp255(oa * 255)];
}

// How different two colours are, 0 (same) – 100 (opposite). Fully transparent pixels all count as
// the same colour, whatever RGB they happen to hold.
export function colorDistance(a, b) {
  if (a[3] === 0 && b[3] === 0) return 0;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2], da = a[3] - b[3];
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da) / 510 * 100;
}
