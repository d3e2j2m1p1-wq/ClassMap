// ═══════════════════════════════════════════════
//  Colour work for ClassMap Pixel: palettes (gradients, sorting, reducing, files, Lospec),
//  indexed colour (snapping art to a palette), and the colour tools (replace, adjust, levels,
//  outline, anti-aliasing, shading). Everything here is plain functions on arrays, so it runs
//  the same in the page, in a worker and in the unit tests.
//
//  Pixels are RGBA Uint8ClampedArrays (w × h × 4). Pixel tools never change their input:
//  they return a new array, so a dialog can preview from the original as sliders move.
//  `mask` (optional) is a Uint8Array the size of the picture: only pixels with mask[i] change.
// ═══════════════════════════════════════════════
import { rgbToHsv, hsvToRgb, rgbaToHex, hexToRgba, colorDistance } from './color.js';

const clamp = v => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const colorKey = (r, g, b, a) => (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
const keyOf = c => colorKey(c[0], c[1], c[2], c[3]);
const fromKey = k => [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];
const inMask = (mask, i) => !mask || mask[i];

// ── finding colours ──

// Nearest palette entry to a colour. Fully transparent pixels stay transparent (index -1):
// transparency is always allowed, whatever the palette holds.
export function nearestFinder(palette) {
  const cache = new Map();
  const solid = palette.map((c, i) => [c, i]).filter(([c]) => c[3] > 0);
  return (r, g, b, a) => {
    if (a === 0 || !solid.length) return -1;
    const k = colorKey(r, g, b, a);
    let hit = cache.get(k);
    if (hit !== undefined) return hit;
    let best = -1, bd = Infinity;
    for (const [c, i] of solid) {
      const dr = c[0] - r, dg = c[1] - g, db = c[2] - b, da = c[3] - a;
      // weighted RGB (the eye is most sensitive to green, least to blue) plus alpha
      const d = 3 * dr * dr + 4 * dg * dg + 2 * db * db + 3 * da * da;
      if (d < bd) { bd = d; best = i; if (!d) break; }
    }
    cache.set(k, best);
    return best;
  };
}
export const nearestColor = (palette, c) => { const i = nearestFinder(palette)(c[0], c[1], c[2], c[3]); return i < 0 ? [0, 0, 0, 0] : [...palette[i]]; };

// Every colour used in some pixel arrays (transparent pixels skipped), most used first
export function colorCounts(arrays) {
  const counts = new Map();
  for (const px of arrays) {
    for (let o = 0; o < px.length; o += 4) {
      if (!px[o + 3]) continue;
      const k = colorKey(px[o], px[o + 1], px[o + 2], px[o + 3]);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ color: fromKey(k), count: n }));
}

// A palette for some art: its own colours if there are few enough (lossless), otherwise the
// `max` most representative ones (median cut weighted by how much each colour is used).
export function paletteFromArt(arrays, max = 256) {
  const counts = colorCounts(arrays);
  if (counts.length <= max) return counts.map(c => c.color);
  return medianCutColors(counts.map(c => [c.color, c.count]), max);
}

// ── indexed colour ──

// 4 × 4 ordered (Bayer) dither thresholds, −0.5 … 0.5
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);

// Every pixel → its nearest palette colour (optionally with an ordered dither). Transparent
// stays transparent. Returns a new array; pixels already in the palette never change, which is
// what makes RGBA → indexed → RGBA lossless when the palette came from the art.
export function snapToPalette(src, palette, { dither = false, width = 0, mask = null, spread = 40 } = {}) {
  const out = src.slice(), near = nearestFinder(palette);
  if (!palette.some(c => c[3] > 0)) return out;
  const exact = new Set(palette.map(keyOf));
  for (let i = 0, o = 0; o < src.length; i++, o += 4) {
    if (!inMask(mask, i)) continue;
    const a = src[o + 3];
    if (!a) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
    let r = src[o], g = src[o + 1], b = src[o + 2];
    if (exact.has(colorKey(r, g, b, a))) continue;
    if (dither && width) {
      const t = BAYER[((((i / width) | 0) & 3) << 2) | ((i % width) & 3)] * spread;
      r = clamp(r + t); g = clamp(g + t); b = clamp(b + t);
    }
    const c = palette[near(r, g, b, a)];
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
  }
  return out;
}

// Does every visible pixel already use a palette colour?
export function fitsPalette(arrays, palette) {
  const ok = new Set(palette.map(keyOf));
  for (const px of arrays) for (let o = 0; o < px.length; o += 4) if (px[o + 3] && !ok.has(colorKey(px[o], px[o + 1], px[o + 2], px[o + 3]))) return false;
  return true;
}

// Palette indexes for one picture (for indexed PNG / Aseprite). null if a colour isn't in the palette.
export function toIndexes(px, palette, transparentIndex) {
  const at = new Map();
  palette.forEach((c, i) => { const k = keyOf(c); if (!at.has(k)) at.set(k, i); });
  const out = new Uint8Array(px.length / 4);
  for (let i = 0, o = 0; o < px.length; i++, o += 4) {
    if (!px[o + 3]) { out[i] = transparentIndex; continue; }
    const k = at.get(colorKey(px[o], px[o + 1], px[o + 2], px[o + 3]));
    if (k === undefined) return null;
    out[i] = k;
  }
  return out;
}

// Wherever a pixel is exactly `from`, make it `to` (editing a palette colour in indexed mode).
// Returns the pixel offsets it changed, so a live edit can rewrite just those.
export function findColor(px, c) {
  const hits = [];
  for (let o = 0; o < px.length; o += 4) if (px[o] === c[0] && px[o + 1] === c[1] && px[o + 2] === c[2] && px[o + 3] === c[3]) hits.push(o);
  return hits;
}

// ── palette tools ──

// Colours between two ends. steps counts the ends; exclude drops them from the result.
export function gradient(a, b, steps, { space = 'rgb', long = false, exclude = false } = {}) {
  steps = Math.max(2, Math.min(256, Math.round(steps)));
  const out = [];
  let [ha, sa, va] = rgbToHsv(a), [hb, sb, vb] = rgbToHsv(b);
  if (sa === 0 || va === 0) ha = hb;          // greys have no hue: borrow the other end's
  if (sb === 0 || vb === 0) hb = ha;
  let dh = ((hb - ha + 540) % 360) - 180;     // the short way, −180 … 180
  if (long && dh !== 0) dh = dh > 0 ? dh - 360 : dh + 360;
  else if (long) dh = 360;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1), lerp = (x, y) => x + (y - x) * t;
    const alpha = clamp(lerp(a[3], b[3]));
    if (space === 'hsv') out.push([...hsvToRgb(ha + dh * t, lerp(sa, sb), lerp(va, vb)), alpha]);
    else out.push([clamp(lerp(a[0], b[0])), clamp(lerp(a[1], b[1])), clamp(lerp(a[2], b[2])), alpha]);
  }
  return exclude ? out.slice(1, -1) : out;
}

const lightness = c => (Math.max(c[0], c[1], c[2]) + Math.min(c[0], c[1], c[2])) / 510;
const SORT_KEYS = {
  hue: c => { const [h, s] = rgbToHsv(c); return s === 0 ? -1 : h; },   // greys first
  saturation: c => rgbToHsv(c)[1],
  lightness,
  value: c => rgbToHsv(c)[2],
  red: c => c[0], green: c => c[1], blue: c => c[2], alpha: c => c[3],
};
export const SORTS = Object.keys(SORT_KEYS);

// The new order as old indexes: order[newIndex] = oldIndex (stable for ties)
export function sortOrder(palette, by = 'hue', desc = false) {
  const f = SORT_KEYS[by] || SORT_KEYS.hue;
  const tie = c => lightness(c);
  return palette.map((c, i) => [f(c), tie(c), i])
    .sort((p, q) => (p[0] - q[0] || p[1] - q[1]) * (desc ? -1 : 1) || p[2] - q[2])
    .map(p => p[2]);
}

// Median cut over weighted colours: [[rgba, weight], …] → n colours (weighted averages)
export function medianCutColors(entries, n) {
  let boxes = [entries.map(([c, w]) => [c[0], c[1], c[2], c[3], Math.max(1e-6, w)])];
  while (boxes.length < n) {
    let bi = -1, bc = 0, br = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 4; ch++) { let lo = 255, hi = 0; for (const p of b) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; } if (hi - lo > br) { br = hi - lo; bi = i; bc = ch; } }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => p[bc] - q[bc]);
    const total = b.reduce((a, p) => a + p[4], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i][4]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map(b => { const t = b.reduce((a, p) => a + p[4], 0); return [0, 1, 2, 3].map(ch => clamp(b.reduce((a, p) => a + p[ch] * p[4], 0) / t)); });
}

// k-means: start from well-spread colours (heaviest first, then farthest), then settle
export function kMeansColors(entries, n, rounds = 24) {
  const pts = entries.map(([c, w]) => [c[0], c[1], c[2], c[3], Math.max(1e-6, w)]);
  if (pts.length <= n) return pts.map(p => p.slice(0, 4));
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 + (p[3] - q[3]) ** 2;
  const centres = [pts.reduce((a, p) => (p[4] > a[4] ? p : a)).slice(0, 4)];
  const near = pts.map(p => d2(p, centres[0]));
  while (centres.length < n) {
    let bi = 0, bv = -1;
    pts.forEach((p, i) => { const v = near[i] * p[4]; if (v > bv) { bv = v; bi = i; } });
    const c = pts[bi].slice(0, 4);
    centres.push(c);
    pts.forEach((p, i) => { near[i] = Math.min(near[i], d2(p, c)); });
  }
  for (let r = 0; r < rounds; r++) {
    const sum = centres.map(() => [0, 0, 0, 0, 0]);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      centres.forEach((c, i) => { const d = d2(p, c); if (d < bd) { bd = d; bi = i; } });
      const s = sum[bi];
      for (let ch = 0; ch < 4; ch++) s[ch] += p[ch] * p[4];
      s[4] += p[4];
    }
    let moved = false;
    sum.forEach((s, i) => {
      if (!s[4]) return;
      const c = [0, 1, 2, 3].map(ch => clamp(s[ch] / s[4]));
      if (d2(c, centres[i])) { moved = true; centres[i] = c; }
    });
    if (!moved) break;
  }
  return centres;
}

// Merge similar colours until there are n. weights (same order as the palette) say how much
// the art uses each colour, so busy colours pull the merged result towards themselves.
export function reducePalette(palette, n, { method = 'median', weights = null } = {}) {
  n = Math.max(1, Math.round(n));
  if (palette.length <= n) return palette.map(c => [...c]);
  const entries = palette.map((c, i) => [c, weights ? 1 + weights[i] : 1]);
  const out = method === 'kmeans' ? kMeansColors(entries, n) : medianCutColors(entries, n);
  const seen = new Set();
  return out.filter(c => { const k = keyOf(c); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Lighter / darker steps along a ramp of palette entries (from index a to index b).
// Returns Map colourKey → colour one step towards b (dir 1) or towards a (dir −1).
export function shadeMap(palette, a, b, dir = 1) {
  const map = new Map();
  if (a == null || b == null || !palette[a] || !palette[b] || a === b) return map;
  const step = a < b ? 1 : -1, ramp = [];
  for (let i = a; i !== b + step; i += step) ramp.push(palette[i]);
  ramp.forEach((c, i) => { const to = ramp[i + dir]; if (to && !map.has(keyOf(c))) map.set(keyOf(c), to); });
  return map;
}
export const shadeOf = (map, r, g, b, a) => map.get(colorKey(r, g, b, a)) || null;

// ── palette files ──

// .gpl (GIMP), .pal (JASC), .hex (one colour per line), or any text holding hex codes
export function parsePalette(text, fileName = '') {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const base = fileName.replace(/\.[^.]+$/, '') || 'Imported palette';
  const first = lines[0]?.trim() || '';
  if (/^GIMP Palette/i.test(first)) {
    let name = base;
    const colors = [];
    for (const l of lines.slice(1)) {
      const t = l.trim();
      if (!t || t.startsWith('#')) continue;
      const m = /^Name:\s*(.+)$/i.exec(t);
      if (m) { name = m[1].trim(); continue; }
      if (/^Columns:/i.test(t)) continue;
      const n = /^(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d+)(?=\s|$))?/.exec(t);
      if (n) colors.push([+n[1], +n[2], +n[3], n[4] != null && /RGBA/i.test(text.slice(0, 200)) ? +n[4] : 255].map(clamp));
    }
    return { name, colors };
  }
  if (/^JASC-PAL/i.test(first)) {
    const count = parseInt(lines[2], 10) || 0, colors = [];
    for (const l of lines.slice(3)) {
      const n = /^\s*(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?/.exec(l);
      if (n) colors.push([+n[1], +n[2], +n[3], n[4] != null ? +n[4] : 255].map(clamp));
      if (count && colors.length >= count) break;
    }
    return { name: base, colors };
  }
  const colors = [];
  for (const m of String(text).matchAll(/(?:^|[^0-9a-z])#?([0-9a-f]{8}|[0-9a-f]{6})(?![0-9a-z])/gi)) {
    const c = hexToRgba(m[1]);
    if (c) colors.push(c);
  }
  return { name: base, colors };
}

export function writeGPL(name, palette) {
  return `GIMP Palette\nName: ${String(name).replace(/[\r\n]/g, ' ')}\nColumns: 8\n#\n`
    + palette.map(c => `${String(c[0]).padStart(3)} ${String(c[1]).padStart(3)} ${String(c[2]).padStart(3)}\t${rgbaToHex(c).slice(1)}`).join('\n') + '\n';
}
export const writeHEX = palette => palette.map(c => rgbaToHex(c, false).slice(1)).join('\n') + '\n';
export const writePAL = palette => `JASC-PAL\r\n0100\r\n${palette.length}\r\n` + palette.map(c => `${c[0]} ${c[1]} ${c[2]}\r\n`).join('');

// "sweetie-16", "lospec.com/palette-list/sweetie-16" or its .json / .hex URL → "sweetie-16"
export function lospecSlug(input) {
  let s = String(input || '').trim();
  const m = /palette-list\/([a-z0-9-]+)/i.exec(s);
  if (m) s = m[1];
  s = s.replace(/\.(json|hex|gpl|pal|png)$/i, '').toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(s) ? s : null;
}
// Lospec's palette JSON → { name, colors }
export function fromLospecJSON(o) {
  if (!o || !Array.isArray(o.colors) || !o.colors.length) throw new Error('No colours in that palette.');
  const colors = o.colors.map(hexToRgba).filter(Boolean);
  if (!colors.length) throw new Error('No colours in that palette.');
  return { name: String(o.name || 'Lospec palette').slice(0, 80), author: o.author ? String(o.author).slice(0, 80) : '', colors };
}

// ── colour tools on pixels ──

// Swap one colour (and, with tolerance, ones close to it) for another
export function replaceColor(src, from, to, { tolerance = 0, mask = null } = {}) {
  const out = src.slice();
  for (let i = 0, o = 0; o < src.length; i++, o += 4) {
    if (!inMask(mask, i)) continue;
    if (colorDistance([src[o], src[o + 1], src[o + 2], src[o + 3]], from) > tolerance) continue;
    if (!to[3]) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
    out[o] = to[0]; out[o + 1] = to[1]; out[o + 2] = to[2]; out[o + 3] = to[3];
  }
  return out;
}

// Shift hue (degrees), saturation and value (−100 … 100 %), and add to R, G, B, A (−255 … 255)
export function adjustColors(src, { h = 0, s = 0, v = 0, r = 0, g = 0, b = 0, a = 0 } = {}, mask = null) {
  const out = src.slice();
  const pull = (x, k) => (k >= 0 ? x + (1 - x) * k : x * (1 + k));
  const cache = new Map();
  for (let i = 0, o = 0; o < src.length; i++, o += 4) {
    if (!src[o + 3] || !inMask(mask, i)) continue;
    const k = colorKey(src[o], src[o + 1], src[o + 2], src[o + 3]);
    let c = cache.get(k);
    if (!c) {
      let rgb = [src[o], src[o + 1], src[o + 2]];
      if (h || s || v) { const [hh, ss, vv] = rgbToHsv(rgb); rgb = hsvToRgb(hh + h, pull(ss, s / 100), pull(vv, v / 100)); }
      c = [clamp(rgb[0] + r), clamp(rgb[1] + g), clamp(rgb[2] + b), clamp(src[o + 3] + a)];
      cache.set(k, c);
    }
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
  }
  return out;
}

// Levels: input black/white points, gamma, output range — for R, G, B together or one channel
export function levelsLUT({ inLo = 0, inHi = 255, gamma = 1, outLo = 0, outHi = 255 } = {}) {
  const lut = new Uint8ClampedArray(256), span = Math.max(1, inHi - inLo);
  for (let x = 0; x < 256; x++) {
    const t = Math.min(1, Math.max(0, (x - inLo) / span));
    lut[x] = clamp(outLo + (outHi - outLo) * t ** (1 / Math.max(0.05, gamma)));
  }
  return lut;
}
export function applyLevels(src, opts = {}, mask = null) {
  const out = src.slice(), lut = levelsLUT(opts), ch = opts.channel || 'all';
  const which = ch === 'all' ? [0, 1, 2] : [{ r: 0, g: 1, b: 2, a: 3 }[ch]];
  for (let i = 0, o = 0; o < src.length; i++, o += 4) {
    if (!src[o + 3] || !inMask(mask, i)) continue;
    for (const c of which) out[o + c] = lut[src[o + c]];
  }
  return out;
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Outline around what's drawn: outside = on the empty pixels touching it; inside = its own edge
export function outlinePixels(src, W, H, color, { eight = false, inside = false, mask = null } = {}) {
  const out = src.slice(), dirs = eight ? N8 : N4;
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[(y * W + x) * 4 + 3] > 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!inMask(mask, i)) continue;
    const me = solid(x, y);
    if (me !== inside) continue;
    const touches = dirs.some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;     // the canvas edge isn't "outside"
      return solid(nx, ny) !== me;
    });
    if (!touches) continue;
    out.set(color[3] ? color : [0, 0, 0, 0], i * 4);
  }
  return out;
}

// Anti-aliasing: fill the inside corner of each stair step with a colour part-way between the
// step and what's beside it. Only true corners (exactly two neighbours of one colour, at right
// angles) change, so straight edges and squares stay crisp. Over empty pixels it uses a
// translucent copy of the step's colour unless overEmpty is off.
export function antiAlias(src, W, H, { strength = 0.5, overEmpty = true, mask = null } = {}) {
  const out = src.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : (y * W + x) * 4);
  const same = (p, q) => p >= 0 && q >= 0 && src[p] === src[q] && src[p + 1] === src[q + 1] && src[p + 2] === src[q + 2] && src[p + 3] === src[q + 3];
  const pairs = [[[0, -1], [-1, 0]], [[0, -1], [1, 0]], [[0, 1], [-1, 0]], [[0, 1], [1, 0]]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    if (!inMask(mask, i)) continue;
    if (!src[o + 3] && !overEmpty) continue;
    for (const [[ax, ay], [bx, by]] of pairs) {
      const A = at(x + ax, y + ay), B = at(x + bx, y + by);
      if (A < 0 || !src[A + 3] || !same(A, B) || same(A, o)) continue;
      // the other two sides must not be that colour too (that's a notch, not a stair step)
      const C = at(x - ax, y - ay), D = at(x - bx, y - by);
      if (same(A, C) || same(A, D)) continue;
      const k = strength;
      if (!src[o + 3]) out.set([src[A], src[A + 1], src[A + 2], clamp(src[A + 3] * k)], o);
      else for (let c = 0; c < 4; c++) out[o + c] = clamp(src[o + c] + (src[A + c] - src[o + c]) * k);
      break;
    }
  }
  return out;
}
