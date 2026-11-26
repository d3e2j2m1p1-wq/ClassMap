// ═══════════════════════════════════════════════
//  Live effects in the editor: layer modifiers, magic layers and post-processing.
//  Settings change live while their panel is open; closing it makes one undo step.
//  "Bake" / "Apply" turns the live result into ordinary pixels.
// ═══════════════════════════════════════════════
import { state, emit } from './state.js';
import { structural, commitSince, snapshot, applyStruct } from './doc.js';
import { find, isGroup, walk } from '../core/layers.js';
import { layerResult, finalFrame } from '../core/compose.js';
import { uid } from '../core/sprite.js';
import { MODIFIERS, POST } from '../core/effects.js';

let view = null;
export function initLive(v) { view = v; }

const node = id => find(state.sprite, id)?.node;

// A live-editing session: change things freely, then done() = one undo step (or none)
export function session(label) {
  emit('before-change');
  const key = () => JSON.stringify([state.sprite.layers, state.sprite.post, state.sprite.postHidden]);
  let before = snapshot(), k0 = key();
  return {
    update() { view.recompose(); emit('layers'); },
    // keep what's changed so far as one undo step (the panel can stay open)
    done() { if (key() !== k0) commitSince(before, label); before = snapshot(); k0 = key(); },
    cancel() { if (key() !== k0) applyStruct(before); },
  };
}

// ── modifiers ──
export const newModifier = type => ({ id: uid(), type, on: true, ...structuredClone(MODIFIERS[type].defaults) });
export const newPost = type => ({ id: uid(), type, on: true, ...structuredClone(POST[type].defaults) });
// Replace a layer's stack (always a new array, so undo snapshots stay untouched)
export function setModifiers(id, list) { const n = node(id); if (n) n.modifiers = list.map(m => ({ ...m })); }
export function setPost(list) { state.sprite.post = list.map(m => ({ ...m })); emit('post'); }

// ── magic layers ──
export const magicDefaults = () => ({ motion: 'bob', amount: 2, cycle: 8, from: state.frameId });

// The current regular layer becomes magic (drawn on this frame), or a new empty magic layer
export function makeMagic() {
  const sp = state.sprite, n = node(state.layerId);
  if (n && n.kind === 'regular' && !isGroup(n)) {
    structural(() => { n.kind = 'magic'; n.magic = magicDefaults(); }, 'Magic layer');
    return n.id;
  }
  let id;
  structural(() => {
    const l = { id: uid(), kind: 'magic', name: 'Magic', visible: true, locked: false, opacity: 255, blend: 'normal', magic: magicDefaults() };
    id = l.id;
    if (n) { const f = find(sp, n.id); f.list.splice(f.index + 1, 0, l); } else sp.layers.push(l);
    for (const fr of sp.frames) sp.cels.push({ layerId: l.id, frameId: fr.id, x: 0, y: 0, w: sp.width, h: sp.height, pixels: new Uint8ClampedArray(sp.width * sp.height * 4) });
    state.layerId = id; state.selectedLayers = new Set([id]);
  }, 'New magic layer');
  return id;
}

// Add frames (copies of the last one's timing) until there are `count`
export function ensureFrames(count) {
  const sp = state.sprite;
  if (sp.frames.length >= count) return;
  structural(() => {
    const ms = sp.frames.at(-1).durationMs, regular = [];
    walk(sp.layers, n => { if (!isGroup(n)) regular.push(n.id); });
    while (sp.frames.length < count) {
      const f = { id: uid(), durationMs: ms };
      sp.frames.push(f);
      for (const id of regular) sp.cels.push({ layerId: id, frameId: f.id, x: 0, y: 0, w: sp.width, h: sp.height, pixels: new Uint8ClampedArray(sp.width * sp.height * 4) });
    }
  }, 'Add frames');
}

// Turn a magic / modifier layer into plain pixels on every frame
export function bakeLayer(id) {
  const sp = state.sprite, n = node(id);
  if (!n) return;
  structural(() => {
    const made = sp.frames.map(f => ({ f, px: layerResult(sp, n, f.id) }));
    sp.cels = sp.cels.filter(c => c.layerId !== id);
    for (const { f, px } of made) sp.cels.push({ layerId: id, frameId: f.id, x: 0, y: 0, w: sp.width, h: sp.height, pixels: px || new Uint8ClampedArray(sp.width * sp.height * 4) });
    n.kind = 'regular'; delete n.magic; delete n.modifiers;
  }, 'Bake layer');
}

// Post-processing → pixels: the visible layers become one layer with the effects in it
export function applyPost() {
  const sp = state.sprite;
  structural(() => {
    const l = { id: uid(), kind: 'regular', name: 'Picture with effects', visible: true, locked: false, opacity: 255, blend: 'normal' };
    const cels = sp.frames.map(f => ({ layerId: l.id, frameId: f.id, x: 0, y: 0, w: sp.width, h: sp.height, pixels: finalFrame(sp, f.id) }));
    const gone = new Set();
    const keep = list => list.filter(x => { if (x.visible) { walk([x], y => gone.add(y.id)); return false; } if (isGroup(x)) x.children = keep(x.children); return true; });
    sp.layers = [...keep(sp.layers), l];
    sp.cels = sp.cels.filter(c => !gone.has(c.layerId)).concat(cels);
    sp.post = []; sp.postHidden = false;
    state.layerId = l.id; state.selectedLayers = new Set([l.id]);
  }, 'Apply effects');
  emit('post');
}
