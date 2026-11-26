// ═══════════════════════════════════════════════
//  Animation: frames, cels, tags and playback.
//  Frames are columns, layers are rows, and each meeting point is a cel. Linked cels share
//  one set of pixels (draw on one, they all change). Tags name a run of frames, with a
//  colour and a direction; playback loops inside the tag around the current frame.
// ═══════════════════════════════════════════════
import { state, emit } from './state.js';
import { structural } from './doc.js';
import { uid } from '../core/sprite.js';
import { leafLayers } from '../core/layers.js';
import { makePatch } from '../core/history.js';
import { applyMove } from './move.js';
import { toast } from '../ui/dialogs.js';

let view = null, commit = null;
export function initAnim(v, c) { view = v; commit = c; }

const sp = () => state.sprite;
export const frameIndex = (id = state.frameId) => sp().frames.findIndex(f => f.id === id);
const selected = () => {
  const ids = sp().frames.filter(f => state.selectedFrames.has(f.id)).map(f => f.id);
  return ids.length ? ids : [state.frameId];
};
const blank = (layerId, frameId) => ({ layerId, frameId, x: 0, y: 0, w: sp().width, h: sp().height, pixels: new Uint8ClampedArray(sp().width * sp().height * 4) });

// ── moving around ──
export function goToFrame(id, { keepSelection = false } = {}) {
  if (!sp().frames.some(f => f.id === id)) return;
  if (state.transform) applyMove();
  state.frameId = id;
  if (!keepSelection) state.selectedFrames = new Set([id]);
  if (!state.playing) view.recompose();
  else view.request();
  emit('frame');
}
export function stepFrame(d) {
  const fr = sp().frames, i = frameIndex();
  let j = i + d;
  if (j < 0 || j >= fr.length) { if (!state.settings.wrapFrames) return; j = (j + fr.length) % fr.length; }
  goToFrame(fr[j].id);
}
export const firstFrame = () => goToFrame(sp().frames[0].id);
export const lastFrame = () => goToFrame(sp().frames.at(-1).id);

// Select frames in the timeline: a click, Shift = range, Ctrl/⌘ = add or remove one
export function selectFrame(id, mode) {
  const fr = sp().frames;
  if (mode === 'range') {
    const a = frameIndex(state.frameId), b = frameIndex(id);
    state.selectedFrames = new Set(fr.slice(Math.min(a, b), Math.max(a, b) + 1).map(f => f.id));
    emit('frames'); return;
  }
  if (mode === 'toggle') {
    if (state.selectedFrames.has(id) && state.selectedFrames.size > 1) state.selectedFrames.delete(id); else state.selectedFrames.add(id);
    emit('frames'); return;
  }
  goToFrame(id);
}

// Tags keep covering the same frames when frames are added or removed before / inside them
function shiftTags(at, d) {
  for (const t of sp().tags) {
    if (t.from >= at) { t.from += d; t.to += d; } else if (t.to >= at) t.to += d;
  }
  sp().tags = sp().tags.filter(t => t.to >= t.from && t.to >= 0);
  for (const t of sp().tags) { t.from = Math.max(0, t.from); t.to = Math.min(sp().frames.length - 1, t.to); }
}

// ── frames ──
export function addFrame() {
  structural(() => {
    const i = frameIndex(), f = { id: uid(), durationMs: sp().frames[i]?.durationMs || 100 };
    sp().frames.splice(i + 1, 0, f);
    for (const l of leafLayers(sp())) sp().cels.push(blank(l.id, f.id));
    shiftTags(i + 1, 1);
    state.frameId = f.id; state.selectedFrames = new Set([f.id]);
  }, 'New frame');
}

// Copies land after the last selected frame. Layers set to "link on duplicate" share pixels.
export function duplicateFrames() {
  structural(() => {
    const ids = selected(), fr = sp().frames;
    const at = Math.max(...ids.map(id => frameIndex(id))) + 1;
    const made = ids.map(id => ({ id: uid(), durationMs: fr[frameIndex(id)].durationMs, from: id }));
    fr.splice(at, 0, ...made.map(({ id, durationMs }) => ({ id, durationMs })));
    for (const l of leafLayers(sp())) for (const m of made) {
      const src = sp().cels.find(c => c.layerId === l.id && c.frameId === m.from);
      if (!src) { sp().cels.push(blank(l.id, m.id)); continue; }
      if (l.autoLinkOnDuplicate) {
        const link = src.link || uid();
        sp().cels[sp().cels.indexOf(src)] = { ...src, link };
        sp().cels.push({ ...src, frameId: m.id, link });
      } else {
        const { link, ...rest } = src;
        sp().cels.push({ ...rest, frameId: m.id, pixels: src.pixels.slice() });
      }
    }
    shiftTags(at, made.length);
    state.frameId = made.at(-1).id; state.selectedFrames = new Set(made.map(m => m.id));
  }, 'Duplicate frame');
}

export function deleteFrames() {
  const ids = selected();
  if (ids.length >= sp().frames.length) { toast('An animation needs at least one frame'); return; }
  structural(() => {
    const idx = ids.map(id => frameIndex(id)).sort((a, b) => b - a);
    for (const i of idx) {
      sp().frames.splice(i, 1);
      for (const t of sp().tags) { if (t.from > i) t.from--; if (t.to >= i) t.to--; }
    }
    sp().tags = sp().tags.filter(t => t.to >= t.from);
    const gone = new Set(ids);
    sp().cels = sp().cels.filter(c => !gone.has(c.frameId));
    const next = sp().frames[Math.min(idx.at(-1), sp().frames.length - 1)];
    state.frameId = next.id; state.selectedFrames = new Set([next.id]);
  }, 'Delete frame');
}

// Move the selected frames so they start at position `to` (an index among the other frames)
export function moveFrames(ids, to) {
  structural(() => {
    const fr = sp().frames, moving = fr.filter(f => ids.includes(f.id)), rest = fr.filter(f => !ids.includes(f.id));
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, ...moving);
    sp().frames = rest;
  }, 'Move frame');
}

export function setDuration(ms, ids = selected()) {
  ms = Math.max(10, Math.min(65535, Math.round(ms)));
  structural(() => { for (const f of sp().frames) if (ids.includes(f.id)) f.durationMs = ms; }, 'Frame duration');
}

// ── cels ──
const celAt = (layerId, frameId) => sp().cels.find(c => c.layerId === layerId && c.frameId === frameId);

// Link the selected frames' cels on the active layer: the first one's pixels win
export function linkCels(layerId = state.layerId, ids = selected()) {
  const order = sp().frames.filter(f => ids.includes(f.id)).map(f => f.id);
  if (order.length < 2) { toast('Select two or more frames (Shift-click) to link'); return; }
  structural(() => {
    const first = celAt(layerId, order[0]);
    if (!first) return false;
    const link = first.link || uid();
    sp().cels[sp().cels.indexOf(first)] = { ...first, link };
    for (const id of order.slice(1)) {
      const c = celAt(layerId, id);
      if (c) sp().cels[sp().cels.indexOf(c)] = { ...c, pixels: first.pixels, link };
    }
  }, 'Link cels');
}

export function unlinkCels(layerId = state.layerId, ids = selected()) {
  structural(() => {
    let any = false;
    for (const id of ids) {
      const c = celAt(layerId, id);
      if (!c?.link) continue;
      const { link, ...rest } = c;
      sp().cels[sp().cels.indexOf(c)] = { ...rest, pixels: c.pixels.slice() };
      any = true;
    }
    if (!any) return false;
  }, 'Unlink cels');
}

// Empty the cel (keeps the frame); one undo step
export function clearCel(layerId = state.layerId, frameId = state.frameId) {
  const c = celAt(layerId, frameId);
  if (!c || !c.pixels.some((v, i) => i % 4 === 3 && v)) return;
  const before = c.pixels.slice();
  c.pixels.fill(0);
  commit(makePatch({ layerId, frameId }, before, c.pixels, c.w, { x: 0, y: 0, w: c.w, h: c.h }));
  view.recompose();
}

export function setCelProps(layerId, frameId, props) {
  structural(() => {
    const c = celAt(layerId, frameId);
    if (!c) return false;
    sp().cels[sp().cels.indexOf(c)] = { ...c, ...props };
  }, 'Cel');
}

// ── tags ──
const TAG_COLORS = ['#F25F6B', '#0E8A9E', '#F5B544', '#6E4FC0', '#1C8C5E', '#D93F4C'];
export function addTag() {
  const idx = selected().map(id => frameIndex(id));
  const from = Math.min(...idx), to = Math.max(...idx);
  let id;
  structural(() => {
    id = uid();
    const n = sp().tags.length + 1;
    sp().tags.push({ id, name: `Tag ${n}`, from, to, direction: 'forward', repeat: 0, color: TAG_COLORS[(n - 1) % TAG_COLORS.length] });
  }, 'New tag');
  return id;
}
export function updateTag(id, props) {
  structural(() => { const t = sp().tags.find(t => t.id === id); if (!t) return false; Object.assign(t, props); }, 'Tag');
}
export function deleteTag(id) {
  if (state.playTag === id) state.playTag = null;
  structural(() => { sp().tags = sp().tags.filter(t => t.id !== id); }, 'Delete tag');
}
export const tagsAt = i => sp().tags.filter(t => i >= t.from && i <= t.to);

// ── playback ──
let timer = 0, dir = 1;
export function playRange() {
  const fr = sp().frames, i = frameIndex();
  const t = (state.playTag && sp().tags.find(x => x.id === state.playTag)) || tagsAt(i)[0];
  return t ? { from: t.from, to: t.to, direction: t.direction } : { from: 0, to: fr.length - 1, direction: 'forward' };
}
// The next frame index for playback inside a range, given a direction
export function nextIndex(i, r, d) {
  if (r.from === r.to) return { i: r.from, d };
  if (i < r.from || i > r.to) return { i: r.direction.startsWith('reverse') || r.direction === 'pingpong-reverse' ? r.to : r.from, d: r.direction === 'reverse' || r.direction === 'pingpong-reverse' ? -1 : 1 };
  if (r.direction === 'forward') return { i: i >= r.to ? r.from : i + 1, d: 1 };
  if (r.direction === 'reverse') return { i: i <= r.from ? r.to : i - 1, d: -1 };
  let n = i + d;
  if (n > r.to) { d = -1; n = i - 1; } else if (n < r.from) { d = 1; n = i + 1; }
  return { i: n, d };
}
export function play() {
  if (state.playing || sp().frames.length < 2) return;
  if (state.transform) applyMove();
  state.playing = true;
  const r = playRange();
  dir = r.direction === 'reverse' || r.direction === 'pingpong-reverse' ? -1 : 1;
  emit('play');
  const tick = () => {
    if (!state.playing || !sp()) return;
    const range = playRange(), n = nextIndex(frameIndex(), range, dir);
    dir = n.d;
    state.frameId = sp().frames[n.i].id;
    view.request(); emit('frame');
    timer = setTimeout(tick, sp().frames[n.i].durationMs);
  };
  timer = setTimeout(tick, sp().frames[frameIndex()].durationMs);
}
export function stop() {
  if (!state.playing) return;
  state.playing = false;
  clearTimeout(timer);
  state.selectedFrames = new Set([state.frameId]);
  if (sp()) view.recompose();
  emit('play'); emit('frame');
}
export const togglePlay = () => (state.playing ? stop() : play());

// The frame order an export plays (a range and a direction)
export function exportSequence(from, to, direction) {
  const idx = [];
  for (let i = from; i <= to; i++) idx.push(i);
  if (direction === 'reverse') return idx.reverse();
  if (direction === 'pingpong') return idx.concat(idx.slice(1, -1).reverse());
  if (direction === 'pingpong-reverse') { const r = idx.reverse(); return r.concat(r.slice(1, -1).reverse()); }
  return idx;
}
