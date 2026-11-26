// ═══════════════════════════════════════════════
//  Changes to the artwork's structure — layers, groups, canvas size — each one undoable.
//  A structural undo step stores the layer tree and the list of cels before and after.
//  Cel objects are shared, not copied: pixel edits have their own undo steps, so the
//  pixels are always right for whichever cels are in place.
// ═══════════════════════════════════════════════
import { state, emit } from './state.js';
import { uid } from '../core/sprite.js';
import { cloneTree, find, insert, remove, isGroup, leafLayers, walk, within } from '../core/layers.js';
import { composeFrame, blendInto } from '../core/compose.js';
import { contentBounds } from '../core/sprite.js';
import { toast } from '../ui/dialogs.js';

let commit = null, view = null;
export function initDoc(opts) { ({ commit, view } = opts); }

const snap = () => {
  const sp = state.sprite;
  return { layers: cloneTree(sp.layers), cels: sp.cels.slice(), width: sp.width, height: sp.height, active: state.layerId };
};

export function applyStruct(s) {
  const sp = state.sprite;
  const resized = sp.width !== s.width || sp.height !== s.height;
  sp.layers = cloneTree(s.layers); sp.cels = s.cels.slice(); sp.width = s.width; sp.height = s.height;
  setActive(find(sp, s.active) ? s.active : leafLayers(sp).at(-1)?.id);
  if (resized) { emit('resized'); view.setSprite(); } else view.recompose();
  emit('layers');
}

// Run `fn`, then record before → after as one undo step (with any pixel patches fn returns)
export function structural(fn, label) {
  const sp = state.sprite;
  if (!sp) return;
  emit('before-change');
  const before = snap();
  const extra = fn();
  if (extra === false) return;
  const after = snap();
  const step = { kind: 'struct', label, before, after };
  commit(Array.isArray(extra) && extra.length ? { kind: 'multi', steps: [step, ...extra] } : step);
  if (sp.width !== before.width || sp.height !== before.height) { emit('resized'); view.setSprite(); } else view.recompose();
  emit('layers');
}

export function setActive(id, additive = false) {
  if (!id) return;
  state.layerId = id;
  if (!additive) state.selectedLayers = new Set([id]);
  else state.selectedLayers.add(id);
  emit('layers');
}

const blankCel = (layerId, frameId) => {
  const sp = state.sprite;
  return { layerId, frameId, x: 0, y: 0, w: sp.width, h: sp.height, pixels: new Uint8ClampedArray(sp.width * sp.height * 4) };
};
const newLayer = (name, kind = 'regular') => ({ id: uid(), kind, name, visible: true, locked: false, opacity: 255, blend: 'normal', autoLinkOnDuplicate: false });
const nextName = base => {
  const names = new Set(); walk(state.sprite.layers, n => names.add(n.name));
  let i = 1; while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
};

export function addLayer(kind = 'regular', name, pixels) {
  let id;
  structural(() => {
    const sp = state.sprite, l = newLayer(name || nextName(kind === 'reference' ? 'Reference' : 'Layer'), kind);
    id = l.id;
    insert(sp, l, state.layerId, 'above');
    for (const f of sp.frames) { const c = blankCel(l.id, f.id); if (pixels && f.id === state.frameId) c.pixels.set(pixels); sp.cels.push(c); }
    state.layerId = l.id; state.selectedLayers = new Set([l.id]);
  }, 'New layer');
  return id;
}

// Put the selected layers into a new group (or an empty group if nothing fits)
export function addGroup() {
  structural(() => {
    const sp = state.sprite, g = { id: uid(), kind: 'group', name: nextName('Group'), visible: true, locked: false, opacity: 255, blend: 'normal', collapsed: false, children: [] };
    const ids = topLevelSelection();
    insert(sp, g, state.layerId, 'above');
    // keep the stacking order of what moves in
    const order = []; walk(sp.layers, n => { if (ids.includes(n.id)) order.push(n.id); });
    for (const id of order) { if (id === g.id || within(sp, g.id, id)) continue; const n = remove(sp, id); if (n) g.children.push(n); }
    state.layerId = g.id; state.selectedLayers = new Set([g.id]);
  }, 'Group');
}

// Selected ids without the ones already inside another selected group
function topLevelSelection() {
  const sp = state.sprite, ids = [...state.selectedLayers].filter(id => find(sp, id));
  return ids.filter(id => !ids.some(o => o !== id && within(sp, id, o)));
}

export function duplicateLayers() {
  structural(() => {
    const sp = state.sprite, made = [];
    for (const id of topLevelSelection()) {
      const f = find(sp, id);
      const copy = cloneNode(f.node, ' copy');
      f.list.splice(f.index + 1, 0, copy);
      made.push(copy.id);
    }
    if (!made.length) return false;
    state.layerId = made.at(-1); state.selectedLayers = new Set(made);
  }, 'Duplicate layer');
}

// A copy of a layer or group (with new ids and copied pixels); cels are added to the sprite
export function cloneNode(node, suffix = '') {
  const sp = state.sprite;
  if (isGroup(node)) return { ...node, id: uid(), name: node.name + suffix, children: node.children.map(c => cloneNode(c)) };
  const l = { ...node, id: uid(), name: node.name + suffix };
  for (const c of sp.cels.filter(c => c.layerId === node.id)) sp.cels.push({ ...c, layerId: l.id, pixels: c.pixels.slice() });
  return l;
}

export function deleteLayers() {
  const sp = state.sprite, ids = topLevelSelection();
  const leftAfter = leafLayers(sp).filter(l => !ids.some(id => within(sp, l.id, id)));
  if (!leftAfter.length) { toast('A picture needs at least one layer'); return; }
  structural(() => {
    let above = null;
    for (const id of ids) {
      const f = find(sp, id); if (!f) continue;
      above = f.list[f.index - 1]?.id || f.list[f.index + 1]?.id || f.parent?.id || above;
      const gone = new Set(); walk([f.node], n => gone.add(n.id));
      remove(sp, id);
      sp.cels = sp.cels.filter(c => !gone.has(c.layerId));
    }
    const next = (above && find(sp, above)) ? above : leafLayers(sp).at(-1).id;
    state.layerId = next; state.selectedLayers = new Set([next]);
  }, 'Delete layer');
}

// Merge the active layer into the layer under it (same group)
export function mergeDown() {
  const sp = state.sprite, f = find(sp, state.layerId);
  const below = f?.list[f.index - 1];
  if (!f || isGroup(f.node) || !below || isGroup(below) || below.kind !== 'regular') { toast('Merge down needs a regular layer directly underneath'); return; }
  structural(() => {
    const top = f.node, patches = [];
    for (const fr of sp.frames) {
      const a = sp.cels.find(c => c.layerId === below.id && c.frameId === fr.id), b = sp.cels.find(c => c.layerId === top.id && c.frameId === fr.id);
      if (!a || !b) continue;
      const merged = { ...a, pixels: a.pixels.slice() };
      const k = (top.opacity ?? 255) / 255 * (b.opacity ?? 255) / 255;
      if (top.visible) for (let i = 0; i < merged.pixels.length; i += 4) if (b.pixels[i + 3]) blendInto(merged.pixels, i, b.pixels[i], b.pixels[i + 1], b.pixels[i + 2], b.pixels[i + 3] / 255 * k, top.blend || 'normal');
      sp.cels[sp.cels.indexOf(a)] = merged;
    }
    remove(sp, top.id);
    sp.cels = sp.cels.filter(c => c.layerId !== top.id);
    state.layerId = below.id; state.selectedLayers = new Set([below.id]);
    return patches;
  }, 'Merge down');
}

export function flattenVisible() {
  const sp = state.sprite;
  structural(() => {
    const l = newLayer('Flattened');
    const cels = sp.frames.map(fr => ({ ...blankCel(l.id, fr.id), pixels: composeFrame(sp, fr.id) }));
    const gone = new Set();
    const keep = list => list.filter(n => { if (n.visible) { walk([n], x => gone.add(x.id)); return false; } if (isGroup(n)) n.children = keep(n.children); return true; });
    sp.layers = keep(sp.layers);
    sp.cels = sp.cels.filter(c => !gone.has(c.layerId)).concat(cels);
    sp.layers.push(l);
    state.layerId = l.id; state.selectedLayers = new Set([l.id]);
  }, 'Flatten');
}

// Drag-and-drop in the layers panel
export function moveNode(id, targetId, where) {
  const sp = state.sprite;
  if (id === targetId || within(sp, targetId, id)) return;
  structural(() => { const n = remove(sp, id); insert(sp, n, targetId, where); }, 'Move layer');
}

// Name, opacity and blend mode are undoable; showing, hiding and locking just happen
export function setLayerProp(id, prop, value) {
  const n = find(state.sprite, id)?.node;
  if (!n || n[prop] === value) return;
  if (prop === 'visible' || prop === 'locked' || prop === 'collapsed') {
    n[prop] = value;
    if (prop === 'visible') view.recompose();
    emit('layers'); emit('changed');
    return;
  }
  structural(() => { find(state.sprite, id).node[prop] = value; }, 'Layer ' + prop);
}

export function rasterize(id) {
  structural(() => { const n = find(state.sprite, id)?.node; if (!n || n.kind !== 'reference') return false; n.kind = 'regular'; }, 'Rasterize');
}

// ── Canvas ──
export function resizeCanvas(w, h, ax = 0.5, ay = 0.5) {
  const sp = state.sprite;
  if (w === sp.width && h === sp.height) return;
  const dx = Math.round((w - sp.width) * ax), dy = Math.round((h - sp.height) * ay);
  structural(() => {
    sp.cels = sp.cels.map(c => {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < sp.height; y++) {
        const ty = y + dy; if (ty < 0 || ty >= h) continue;
        const x0 = Math.max(0, -dx), x1 = Math.min(sp.width, w - dx);
        if (x1 <= x0) continue;
        out.set(c.pixels.subarray((y * sp.width + x0) * 4, (y * sp.width + x1) * 4), (ty * w + x0 + dx) * 4);
      }
      return { ...c, w, h, pixels: out };
    });
    sp.width = w; sp.height = h;
  }, 'Resize canvas');
}

export function cropToContent() {
  const sp = state.sprite;
  let b = null;
  for (const f of sp.frames) {
    const r = contentBounds(composeFrame(sp, f.id), sp.width, sp.height);
    if (r) b = b ? { x0: Math.min(b.x0, r.x), y0: Math.min(b.y0, r.y), x1: Math.max(b.x1, r.x + r.w - 1), y1: Math.max(b.y1, r.y + r.h - 1) } : { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 };
  }
  if (!b) { toast('The canvas is empty'); return; }
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
  if (w === sp.width && h === sp.height) { toast('Already cropped to the art'); return; }
  structural(() => {
    sp.cels = sp.cels.map(c => {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) out.set(c.pixels.subarray(((b.y0 + y) * sp.width + b.x0) * 4, ((b.y0 + y) * sp.width + b.x1 + 1) * 4), y * w * 4);
      return { ...c, w, h, pixels: out };
    });
    sp.width = w; sp.height = h;
  }, 'Crop');
}

export function flipCanvas(axis) {
  const sp = state.sprite, W = sp.width, H = sp.height;
  structural(() => {
    sp.cels = sp.cels.map(c => {
      const s32 = new Uint32Array(c.pixels.buffer), out = new Uint8ClampedArray(W * H * 4), o32 = new Uint32Array(out.buffer);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o32[y * W + x] = s32[axis === 'h' ? y * W + (W - 1 - x) : (H - 1 - y) * W + x];
      return { ...c, pixels: out };
    });
  }, 'Flip canvas');
}
