// ═══════════════════════════════════════════════
//  Tilemap layers in the editor.
//   • Tiles mode: the brush places the chosen tile (with its flips), the eraser empties cells,
//     the bucket fills connected cells, the eye dropper picks the tile under it.
//   • Pixels mode: draw as usual; when the stroke ends, the change goes into the tiles, so
//     every place that tile is used changes too. Drawing in an empty cell makes a new tile.
//  Every change copies what it changes (tiles, maps, cels), so undo just swaps them back.
// ═══════════════════════════════════════════════
import { state, emit } from './state.js';
import { commitSince, snapshot, structural, applyStruct } from './doc.js';
import * as T from '../core/tiles.js';
import { find, walk } from '../core/layers.js';
import { uid } from '../core/sprite.js';
import { linePoints } from '../core/raster.js';
import { toast } from '../ui/dialogs.js';

let view = null;
export function initTilemap(v) { view = v; }

export const tileUI = () => (state.tileUI ||= { mode: 'tiles', pick: 1, flags: 0 });
export const activeTilemap = () => { const n = state.sprite && find(state.sprite, state.layerId)?.node; return n?.kind === 'tilemap' ? n : null; };
export const tilesetOf = n => state.sprite?.tilesets?.find(t => t.id === n?.tilesetId) || null;
export const tileModeOn = () => !!activeTilemap() && tileUI().mode === 'tiles';

// Every tilemap cel has a map (new frames, new layers…) and pixels drawn from it
export function fixTilemaps(sp) {
  if (!sp.tilesets?.length) return;
  walk(sp.layers, n => {
    if (n.kind !== 'tilemap') return;
    const set = sp.tilesets.find(t => t.id === n.tilesetId);
    if (!set) return;
    const { cols, rows } = T.gridSize(sp.width, sp.height, set.tw, set.th);
    for (const f of sp.frames) {
      const i = sp.cels.findIndex(c => c.layerId === n.id && c.frameId === f.id);
      const c = sp.cels[i];
      if (!c) { const map = new Uint32Array(cols * rows); sp.cels.push({ layerId: n.id, frameId: f.id, x: 0, y: 0, w: sp.width, h: sp.height, map, pixels: T.renderMap(sp.width, sp.height, set, map) }); continue; }
      if (!c.map || c.map.length !== cols * rows) { const map = new Uint32Array(cols * rows); sp.cels[i] = { ...c, map, pixels: T.renderMap(sp.width, sp.height, set, map) }; }
    }
  });
}

// New cel objects with fresh pixels for every tilemap layer using `set`
function rerender(sp, set) {
  const ids = new Set();
  walk(sp.layers, n => { if (n.kind === 'tilemap' && n.tilesetId === set.id) ids.add(n.id); });
  const done = new Map();
  sp.cels = sp.cels.map(c => {
    if (!ids.has(c.layerId) || !c.map) return c;
    if (!done.has(c.map)) done.set(c.map, T.renderMap(sp.width, sp.height, set, c.map));
    return { ...c, pixels: done.get(c.map) };
  });
}
// Swap in a copy of a tileset (copy-on-write), returning the copy
function ownSet(sp, set) {
  const copy = { ...set, tiles: set.tiles.slice() };
  sp.tilesets = sp.tilesets.map(t => (t.id === set.id ? copy : t));
  return copy;
}

// ── tiles mode: one press = one undo step ──
function cellSession() {
  const sp = state.sprite, n = activeTilemap(), set = tilesetOf(n);
  if (!n || !set) return null;
  if (n.locked || !n.visible) { toast(n.locked ? 'This layer is locked' : 'This layer is hidden'); return null; }
  emit('before-change');
  const before = snapshot();
  const i = sp.cels.findIndex(c => c.layerId === n.id && c.frameId === state.frameId);
  if (i < 0) return null;
  const cel = { ...sp.cels[i], map: sp.cels[i].map.slice(), pixels: sp.cels[i].pixels.slice() };
  sp.cels[i] = cel;
  const { cols, rows } = T.gridSize(sp.width, sp.height, set.tw, set.th);
  let changed = false;
  const s = {
    set, cols, rows, cel,
    cellAt: p => [Math.floor(p.x / set.tw), Math.floor(p.y / set.th)],
    get: (cx, cy) => (cx < 0 || cy < 0 || cx >= cols || cy >= rows ? null : cel.map[cy * cols + cx]),
    put(cx, cy, v) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows || cel.map[cy * cols + cx] === v) return;
      cel.map[cy * cols + cx] = v;
      T.renderCell(cel.pixels, sp.width, sp.height, set, cel.map, cols, cx, cy);
      view.invalidate(cx * set.tw, cy * set.th, (cx + 1) * set.tw - 1, (cy + 1) * set.th - 1);
      changed = true;
    },
    end(label) { if (changed) commitSince(before, label); else { sp.cels = before.cels.slice(); } },
  };
  return s;
}

const placing = erase => ({
  down(p) {
    this.s = cellSession(); if (!this.s) return;
    const u = tileUI();
    if (!erase && !this.s.set.tiles[u.pick]) { toast('Pick a tile in the tiles panel first'); this.s.end(); this.s = null; return; }
    this.v = erase ? 0 : (u.pick | u.flags) >>> 0;
    this.last = this.s.cellAt(p);
    this.s.put(...this.last, this.v);
  },
  move(p) {
    if (!this.s) return;
    const c = this.s.cellAt(p);
    for (const [x, y] of linePoints(this.last[0], this.last[1], c[0], c[1])) this.s.put(x, y, this.v);
    this.last = c;
  },
  up() { this.s?.end(erase ? 'Erase tiles' : 'Place tiles'); this.s = null; },
  cancel() { this.s?.end(); this.s = null; },
});

export const TILE_TOOLS = {
  brush: placing(false),
  eraser: placing(true),
  bucket: {
    down(p) {
      const s = cellSession(); if (!s) return;
      const [cx, cy] = s.cellAt(p), target = s.get(cx, cy), u = tileUI(), v = (u.pick | u.flags) >>> 0;
      if (target == null || target === v) { s.end(); return; }
      const stack = [[cx, cy]], seen = new Set();
      while (stack.length) {
        const [x, y] = stack.pop(), k = y * s.cols + x;
        if (seen.has(k) || s.get(x, y) !== target) continue;
        seen.add(k); s.put(x, y, v);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      s.end('Fill tiles');
    },
    move() {}, up() {}, cancel() {},
  },
  dropper: {
    down(p) { this.pick(p); }, move(p) { this.pick(p); },
    pick(p) {
      const n = activeTilemap(), set = tilesetOf(n), sp = state.sprite;
      const c = sp.cels.find(x => x.layerId === n.id && x.frameId === state.frameId);
      if (!c?.map) return;
      const { cols, rows } = T.gridSize(sp.width, sp.height, set.tw, set.th), cx = Math.floor(p.x / set.tw), cy = Math.floor(p.y / set.th);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
      const v = c.map[cy * cols + cx];
      Object.assign(tileUI(), { pick: T.tileOf(v) || tileUI().pick, flags: T.flagsOf(v) });
      emit('tiles');
    },
    up() { if (!state.tempTool && state.opts.backToTool && this.prev) emit('back-to-tool', this.prev); }, cancel() {},
  },
  move: { down() { toast('To move tiles, paint them somewhere else with the brush (tiles mode)'); }, move() {}, up() {}, cancel() {} },
};

// ── pixels mode: a finished stroke goes into the tiles ──
// stroke: the Stroke (its `base` = pixels before); the cel's pixels hold the result right now
export function strokeIntoTiles(stroke) {
  const sp = state.sprite, n = activeTilemap(), set0 = tilesetOf(n);
  const ci = sp.cels.findIndex(c => c.layerId === n.id && c.frameId === state.frameId), cel = sp.cels[ci];
  const after = cel.pixels.slice(), base = stroke.base;
  cel.pixels.set(base);                                     // the "before" picture, for undo
  const W = sp.width, H = sp.height, { tw, th } = set0, { cols } = T.gridSize(W, H, tw, th);
  const changed = new Map();                                // cell → [pixel indexes]
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (after[o] === base[o] && after[o + 1] === base[o + 1] && after[o + 2] === base[o + 2] && after[o + 3] === base[o + 3]) continue;
    const k = Math.floor((i / W | 0) / th) * cols + Math.floor((i % W) / tw);
    (changed.get(k) || changed.set(k, []).get(k)).push(i);
  }
  if (!changed.size) { view.recompose(); return; }
  emit('before-change');
  const before = snapshot();
  const set = ownSet(sp, set0), map = cel.map.slice(), copied = new Set();
  let made = 0;
  for (const [k, list] of changed) {
    const cx = k % cols, cy = (k / cols) | 0, v = map[k], t = T.tileOf(v), f = T.flagsOf(v);
    if (!t) {                                               // empty cell: a new tile
      const tile = T.cellPixels(after, W, H, tw, th, cx, cy);
      if (!tile.some((x, j) => j % 4 === 3 && x)) continue;
      set.tiles.push(tile); map[k] = set.tiles.length - 1; made++;
      continue;
    }
    if (!copied.has(t)) { set.tiles[t] = set.tiles[t].slice(); copied.add(t); }
    const tile = set.tiles[t];
    for (const i of list) {
      const [u, w] = T.tilePixelFor((i % W) - cx * tw, ((i / W) | 0) - cy * th, tw, th, f);
      tile.set(after.subarray(i * 4, i * 4 + 4), (w * tw + u) * 4);
    }
  }
  sp.cels[ci] = { ...cel, map };
  rerender(sp, set);
  commitSince(before, made ? 'New tile' : 'Draw on tiles');
  view.recompose();
  emit('tiles');
}

// ── layers ──
export function newTilemapLayer({ tw, th, tilesetId }) {
  const sp = state.sprite;
  let id;
  structural(() => {
    sp.tilesets ||= [];
    let set = sp.tilesets.find(t => t.id === tilesetId);
    if (!set) { set = T.newTileset(`Tileset ${sp.tilesets.length + 1}`, tw, th); sp.tilesets.push(set); }
    const l = { id: uid(), kind: 'tilemap', name: 'Tilemap', visible: true, locked: false, opacity: 255, blend: 'normal', tilesetId: set.id };
    id = l.id;
    const f = find(sp, state.layerId);
    if (f) f.list.splice(f.index + 1, 0, l); else sp.layers.push(l);
    state.layerId = id; state.selectedLayers = new Set([id]);
  }, 'New tilemap layer');
  tileUI().mode = 'tiles';
  emit('tiles');
  return id;
}

// A regular layer → tilemap: cut every frame into tiles (identical tiles kept once)
export function convertToTilemap(id, tw, th) {
  const sp = state.sprite, n = find(sp, id)?.node;
  if (!n || n.kind !== 'regular') { toast('Pick a regular layer to turn into tiles'); return; }
  structural(() => {
    sp.tilesets ||= [];
    const set = T.newTileset(`${n.name} tiles`, tw, th);
    const cels = sp.frames.map(f => sp.cels.find(c => c.layerId === id && c.frameId === f.id));
    const maps = T.sliceToTiles(cels.map(c => c?.pixels || new Uint8ClampedArray(sp.width * sp.height * 4)), sp.width, sp.height, set);
    sp.tilesets.push(set);
    n.kind = 'tilemap'; n.tilesetId = set.id;
    sp.cels = sp.cels.map(c => { if (c.layerId !== id) return c; const k = sp.frames.findIndex(f => f.id === c.frameId); return { ...c, map: maps[k], pixels: T.renderMap(sp.width, sp.height, set, maps[k]) }; });
    toast(`${set.tiles.length - 1} tile${set.tiles.length === 2 ? '' : 's'} made`);
  }, 'Convert to tilemap');
  tileUI().mode = 'tiles';
  emit('tiles');
}
export function convertToRegular(id) {
  structural(() => {
    const sp = state.sprite, n = find(sp, id)?.node;
    if (!n || n.kind !== 'tilemap') return false;
    n.kind = 'regular'; delete n.tilesetId;
    sp.cels = sp.cels.map(c => (c.layerId === id ? (({ map, ...rest }) => ({ ...rest, pixels: c.pixels.slice() }))(c) : c));
  }, 'Convert to regular layer');
  emit('tiles');
}

// ── tileset changes (each one undo step) ──
function editSet(label, fn) {
  const sp = state.sprite, set0 = tilesetOf(activeTilemap());
  if (!set0) return;
  structural(() => {
    const set = ownSet(sp, set0);
    const r = fn(set, sp);
    if (r === false) return false;
    rerender(sp, set);
  }, label);
  emit('tiles');
}
// Renumber tiles everywhere this tileset is used: table maps old number → new (missing = 0)
function remapMaps(sp, set, table) {
  const ids = new Set();
  walk(sp.layers, n => { if (n.kind === 'tilemap' && n.tilesetId === set.id) ids.add(n.id); });
  const done = new Map();
  sp.cels = sp.cels.map(c => {
    if (!ids.has(c.layerId) || !c.map) return c;
    if (!done.has(c.map)) done.set(c.map, c.map.map(v => ((table.get(T.tileOf(v)) ?? 0) | (table.has(T.tileOf(v)) ? T.flagsOf(v) : 0)) >>> 0));
    return { ...c, map: done.get(c.map) };
  });
}
export const addTile = () => editSet('New tile', set => { set.tiles.push(new Uint8ClampedArray(set.tw * set.th * 4)); tileUI().pick = set.tiles.length - 1; });
export const duplicateTile = () => editSet('Duplicate tile', set => { const t = set.tiles[tileUI().pick]; if (!t || !tileUI().pick) return false; set.tiles.push(t.slice()); tileUI().pick = set.tiles.length - 1; });
export const deleteTile = () => editSet('Delete tile', (set, sp) => {
  const k = tileUI().pick; if (!k || !set.tiles[k]) return false;
  set.tiles.splice(k, 1);
  const table = new Map(); for (let i = 0; i <= set.tiles.length; i++) if (i !== k) table.set(i, i > k ? i - 1 : i);
  remapMaps(sp, set, table);
  tileUI().pick = Math.max(1, Math.min(k, set.tiles.length - 1));
});
export const tidy = dropUnused => editSet(dropUnused ? 'Remove unused tiles' : 'Merge duplicate tiles', (set, sp) => {
  const ids = new Set(); walk(sp.layers, n => { if (n.kind === 'tilemap' && n.tilesetId === set.id) ids.add(n.id); });
  const cels = sp.cels.filter(c => ids.has(c.layerId) && c.map), maps = [...new Set(cels.map(c => c.map))];
  const r = T.tidyTiles(set, maps, { dropUnused });
  if (!r.removed) { toast('Nothing to tidy'); return false; }
  set.tiles = r.tiles;
  const byOld = new Map(maps.map((m, i) => [m, r.maps[i]]));
  sp.cels = sp.cels.map(c => (byOld.has(c.map) ? { ...c, map: byOld.get(c.map) } : c));
  tileUI().pick = Math.min(tileUI().pick, set.tiles.length - 1) || 1;
  toast(`${r.removed} tile${r.removed === 1 ? '' : 's'} removed`);
});
export const importTiles = (tiles) => editSet('Import tiles', set => { set.tiles.push(...tiles); });
export const renameSet = name => editSet('Rename tileset', set => { set.name = name; });
export { applyStruct };
