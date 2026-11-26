// ═══════════════════════════════════════════════
//  Tilemaps. A tileset is a list of small pictures (tiles) of one size; tile 0 is always the
//  empty tile. A tilemap cel holds, for every cell of a grid over the canvas, which tile goes
//  there plus how it is flipped — the same bit layout Aseprite uses:
//    bits 0–28 tile number · bit 29 flip ↔ · bit 30 flip ↕ · bit 31 swap x / y (diagonal)
//  The cel also keeps its pixels, drawn from the map, so everything else (layers, export…)
//  just sees pictures.
// ═══════════════════════════════════════════════
export const FLIP_X = 0x20000000, FLIP_Y = 0x40000000, FLIP_D = 0x80000000;
export const TILE_MASK = 0x1fffffff;
export const tileOf = v => v & TILE_MASK;
export const flagsOf = v => v & ~TILE_MASK;

export const gridSize = (W, H, tw, th) => ({ cols: Math.ceil(W / tw), rows: Math.ceil(H / th) });

export function newTileset(name, tw, th) {
  return { id: Math.random().toString(36).slice(2, 10), name, tw, th, tiles: [new Uint8ClampedArray(tw * th * 4)] };
}

// Where pixel (x, y) of a placed tile comes from in the tile itself (swap x / y needs square tiles)
function source(x, y, tw, th, f) {
  let u = x, v = y;
  if (f & FLIP_D) [u, v] = [v, u];
  if (f & FLIP_X) u = (f & FLIP_D ? th : tw) - 1 - u;
  if (f & FLIP_Y) v = (f & FLIP_D ? tw : th) - 1 - v;
  return [u, v];
}
// (the same mapping tells which tile pixel to change when you draw on a placed tile)
export const tilePixelFor = source;

// Draw one cell of a map into full-canvas pixels
export function renderCell(px, W, H, set, map, cols, cx, cy) {
  const { tw, th } = set, v = map[cy * cols + cx], t = set.tiles[tileOf(v)], f = flagsOf(v);
  const x0 = cx * tw, y0 = cy * th;
  for (let y = 0; y < th; y++) {
    const Y = y0 + y;
    if (Y >= H) break;
    for (let x = 0; x < tw; x++) {
      const X = x0 + x;
      if (X >= W) break;
      const o = (Y * W + X) * 4;
      if (!t || !tileOf(v)) { px[o] = px[o + 1] = px[o + 2] = px[o + 3] = 0; continue; }
      const [u, w] = source(x, y, tw, th, f);
      const s = (w * tw + u) * 4;
      px[o] = t[s]; px[o + 1] = t[s + 1]; px[o + 2] = t[s + 2]; px[o + 3] = t[s + 3];
    }
  }
}
export function renderMap(W, H, set, map) {
  const px = new Uint8ClampedArray(W * H * 4), { cols, rows } = gridSize(W, H, set.tw, set.th);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) renderCell(px, W, H, set, map, cols, cx, cy);
  return px;
}

// The pixels of one cell, as a tile-sized block (empty edges past the canvas)
export function cellPixels(px, W, H, tw, th, cx, cy) {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const X = cx * tw + x, Y = cy * th + y;
    if (X < W && Y < H) out.set(px.subarray((Y * W + X) * 4, (Y * W + X) * 4 + 4), (y * tw + x) * 4);
  }
  return out;
}

const empty = t => { for (let i = 3; i < t.length; i += 4) if (t[i]) return false; return true; };
const key = t => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t[i]; h = Math.imul(h, 16777619); } return h + ':' + t.length; };
const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

// Cut pictures into tiles: each frame's pixels → a map, sharing tiles (identical ones once)
export function sliceToTiles(frames, W, H, set) {
  const { cols, rows } = gridSize(W, H, set.tw, set.th);
  const index = new Map();
  set.tiles.forEach((t, i) => { if (i) { const k = key(t); (index.get(k) || index.set(k, []).get(k)).push(i); } });
  const find = t => (index.get(key(t)) || []).find(i => same(set.tiles[i], t));
  const maps = frames.map(px => {
    const map = new Uint32Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const t = cellPixels(px, W, H, set.tw, set.th, cx, cy);
      if (empty(t)) continue;
      let i = find(t);
      if (i == null) { i = set.tiles.length; set.tiles.push(t); const k = key(t); (index.get(k) || index.set(k, []).get(k)).push(i); }
      map[cy * cols + cx] = i;
    }
    return map;
  });
  return maps;
}

// Merge identical tiles (and optionally drop unused ones); returns the old → new number table
export function tidyTiles(set, maps, { dropUnused = false } = {}) {
  const used = new Set([0]);
  for (const m of maps) for (const v of m) used.add(tileOf(v));
  const remap = new Map([[0, 0]]), kept = [set.tiles[0]];
  for (let i = 1; i < set.tiles.length; i++) {
    if (dropUnused && !used.has(i)) continue;
    const t = set.tiles[i];
    const j = kept.findIndex((k, n) => n > 0 && same(k, t));
    if (j > 0) { remap.set(i, j); continue; }
    remap.set(i, kept.length); kept.push(t);
  }
  const newMaps = maps.map(m => m.map(v => ((remap.get(tileOf(v)) ?? 0) | flagsOf(v)) >>> 0));
  return { tiles: kept, maps: newMaps, removed: set.tiles.length - kept.length };
}

// The tiles as one picture, `perRow` across (for export)
export function tilesheet(set, perRow = 8, { skipEmpty = true } = {}) {
  const list = skipEmpty ? set.tiles.slice(1) : set.tiles;
  const n = Math.max(1, list.length), c = Math.min(perRow, n), r = Math.ceil(n / c);
  const w = c * set.tw, h = r * set.th, px = new Uint8ClampedArray(w * h * 4);
  list.forEach((t, i) => {
    const ox = (i % c) * set.tw, oy = Math.floor(i / c) * set.th;
    for (let y = 0; y < set.th; y++) px.set(t.subarray(y * set.tw * 4, (y + 1) * set.tw * 4), ((oy + y) * w + ox) * 4);
  });
  return { w, h, pixels: px };
}
// …and back: cut a picture into tiles (empty ones skipped)
export function tilesFromSheet(px, w, h, tw, th) {
  const out = [];
  for (let y = 0; y + th <= h; y += th) for (let x = 0; x + tw <= w; x += tw) {
    const t = new Uint8ClampedArray(tw * th * 4);
    for (let j = 0; j < th; j++) t.set(px.subarray(((y + j) * w + x) * 4, ((y + j) * w + x + tw) * 4), j * tw * 4);
    if (!empty(t)) out.push(t);
  }
  return out;
}
