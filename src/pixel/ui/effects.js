// ═══════════════════════════════════════════════
//  Panels for live effects: a layer's modifier stack, a magic layer's motion, and the
//  picture's post-processing. They sit to the side so the canvas shows the result as you go.
// ═══════════════════════════════════════════════
import { state, emit } from '../editor/state.js';
import { find } from '../core/layers.js';
import { MODIFIERS, POST, MOTIONS, liveStack } from '../core/effects.js';
import { hexToRgba, rgbaToHex } from '../core/color.js';
import { openDialog, confirmBox, toast, esc, seg, toggle, range, bindControls } from './dialogs.js';
import { colorWell } from './paltools.js';
import { ICONS } from './icons.js';
import * as live from '../editor/live.js';

// How each setting is shown
const SPEC = {
  axis: (v, type) => seg('axis', v, type === 'tile' ? [['both', 'Both ways'], ['h', 'Sideways'], ['v', 'Up / down']] : [['h', 'Left ↔ right'], ['v', 'Up ↕ down'], ['both', 'Both']]),
  eight: v => toggle('eight', v, 'Corners too'),
  inside: v => toggle('inside', v, 'Inside the art'),
  dx: v => range('dx', v, -8, 8, 'Sideways'),
  dy: v => range('dy', v, -8, 8, 'Up / down'),
  opacity: v => range('opacity', v, 0, 100, 'Strength', '%'),
  gapX: v => range('gapX', v, 0, 32, 'Gap sideways'),
  gapY: v => range('gapY', v, 0, 32, 'Gap up / down'),
  h: v => range('h', v, -180, 180, 'Hue', '°'),
  s: v => range('s', v, -100, 100, 'Saturation', '%'),
  v: v => range('v', v, -100, 100, 'Value', '%'),
  size: v => range('size', v, 1, 6, 'Size'),
  amount: v => range('amount', v, 0, 100, 'Darkness', '%'),
  gap: v => range('gap', v, 2, 4, 'Every … rows'),
  tintAmount: v => range('tintAmount', v, 0, 100, 'Tint', '%'),
};
const COLOR_KEYS = ['color', 'tint'];

// The list of effects with add / remove / reorder / on-off / settings
function stackEditor(el, table, get, set, onChange) {
  let open = null;
  const draw = () => {
    const list = get();
    el.innerHTML = `
      <div class="px-stack">${list.map((m, i) => `
        <div class="px-stack-row ${open === m.id ? 'open' : ''}" data-id="${m.id}">
          <div class="px-stack-head">
            <label class="px-toggle px-stack-on"><input type="checkbox" data-on="${m.id}" ${m.on !== false ? 'checked' : ''} aria-label="${esc(table[m.type].label)} on"><span class="px-switch"></span></label>
            <button type="button" class="px-stack-name" data-open="${m.id}">${esc(table[m.type].label)}</button>
            <button type="button" class="px-icon-btn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Earlier" title="Earlier">↑</button>
            <button type="button" class="px-icon-btn" data-del="${m.id}" aria-label="Remove" title="Remove">${ICONS.trash}</button>
          </div>
          ${open === m.id ? `<div class="px-stack-body" data-body="${m.id}">${Object.keys(table[m.type].defaults).map(k => (COLOR_KEYS.includes(k) ? `<div class="px-ends"><div class="px-mini-label">Colour</div><span data-well="${k}"></span></div>` : SPEC[k]?.(m[k], m.type) || '')).join('')}</div>` : ''}
        </div>`).join('') || '<p class="px-hint">Nothing yet. Add one below.</p>'}</div>
      <div class="px-stack-add"><select class="px-stack-type">${Object.entries(table).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('')}</select>
        <button type="button" class="px-btn px-btn-ghost" data-add>Add</button></div>`;
    const body = el.querySelector('.px-stack-body');
    if (body) {
      const m = list.find(x => x.id === open);
      bindControls(body, (k, v) => { patch(m.id, { [k]: v }); });
      body.querySelectorAll('[data-well]').forEach(w => w.append(colorWell(hexToRgba(m[w.dataset.well]) || [0, 0, 0, 255], c => patch(m.id, { [w.dataset.well]: rgbaToHex(c) }), 'Colour')));
    }
  };
  const patch = (id, p) => { set(get().map(m => (m.id === id ? { ...m, ...p } : m))); onChange(); };
  el.addEventListener('change', e => {
    const id = e.target.dataset.on;
    if (id) patch(id, { on: e.target.checked });
  });
  el.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const list = get();
    if (t.dataset.open) { open = open === t.dataset.open ? null : t.dataset.open; draw(); return; }
    if (t.dataset.up) { const i = Number(t.dataset.up); const l = list.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; set(l); onChange(); draw(); return; }
    if (t.dataset.del) { set(list.filter(m => m.id !== t.dataset.del)); onChange(); draw(); return; }
    if (t.hasAttribute('data-add')) {
      const type = el.querySelector('.px-stack-type').value;
      const m = (table === POST ? live.newPost : live.newModifier)(type);
      set([...list, m]); open = m.id; onChange(); draw();
    }
  });
  draw();
}

// Side panel: Done keeps the changes (one undo step), Cancel / ✕ puts them back
function sidePanel(title, body, s, extra = []) {
  let kept = false;
  return openDialog({
    title, body, className: 'px-col-dlg px-tool-dlg px-fx-dlg',
    actions: [...extra, { label: 'Cancel', value: null }, { label: 'Done', kind: 'primary', onClick: () => { kept = true; s.done(); } }],
  }).then(v => { if (!kept && v !== 'baked') s.cancel(); return v; });
}

export function openModifiers(id = state.layerId) {
  const n = find(state.sprite, id)?.node;
  if (!n || n.kind === 'group' || n.kind === 'reference') { toast('Pick a drawing layer for modifiers'); return; }
  const s = live.session('Modifiers');
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `<p class="px-hint">Modifiers change how "${esc(n.name)}" looks without touching its pixels. Edit the layer and they follow. They run top to bottom.</p><div class="px-stack-wrap"></div>`;
  stackEditor(body.querySelector('.px-stack-wrap'), MODIFIERS, () => find(state.sprite, id).node.modifiers || [], l => live.setModifiers(id, l), () => s.update());
  sidePanel('Modifiers', body, s, [{ label: 'Bake into pixels', value: 'baked', onClick: async () => {
    if (!liveStack(find(state.sprite, id).node.modifiers)) { toast('Add a modifier first'); return false; }
    s.done(); live.bakeLayer(id); toast('Modifiers baked into the layer');
  } }]);
}

export function openMagic(id = state.layerId) {
  let n = find(state.sprite, id)?.node;
  if (!n) return;
  if (n.kind !== 'magic') {
    if (n.kind !== 'regular') { toast('Pick a regular layer to make magic'); return; }
    id = live.makeMagic(); n = find(state.sprite, id).node;
  }
  const s = live.session('Magic layer');
  const g = () => find(state.sprite, id).node.magic;
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  const draw = () => {
    const m = g(), sp = state.sprite;
    const fromNo = sp.frames.findIndex(f => f.id === m.from) + 1 || 1;
    body.innerHTML = `
      <p class="px-hint">Draw on frame ${fromNo - 1 + state.settings.numberFrom}; the other frames are made from it with a motion.</p>
      <label class="px-field"><span>Motion</span><select class="px-magic-motion">${Object.entries(MOTIONS).map(([k, l]) => `<option value="${k}" ${k === m.motion ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${m.motion === 'spin' || m.motion === 'blink' ? '' : range('amount', m.amount, 1, m.motion === 'sway' ? 45 : m.motion === 'squash' ? 60 : 16, m.motion === 'sway' ? 'How far it rocks' : m.motion === 'squash' ? 'How much it squashes' : 'How far it moves', m.motion === 'sway' ? '°' : m.motion === 'squash' ? '%' : ' px')}
      ${range('cycle', m.cycle, 2, 32, 'Frames per loop (lower = faster)')}
      <div class="px-set-row">
        <button type="button" class="px-btn px-btn-ghost" data-m="here">Draw on this frame instead</button>
        ${sp.frames.length < m.cycle ? `<button type="button" class="px-btn px-btn-ghost" data-m="frames">Add frames to make ${m.cycle}</button>` : ''}
      </div>`;
    bindControls(body, (k, v) => { find(state.sprite, id).node.magic = { ...g(), [k]: v }; s.update(); if (k === 'cycle') draw(); });
    body.querySelector('.px-magic-motion').addEventListener('change', e => {
      const motion = e.target.value, amount = { bob: 2, sway: 12, squash: 20 }[motion] ?? g().amount;
      find(state.sprite, id).node.magic = { ...g(), motion, amount }; s.update(); draw();
    });
  };
  body.addEventListener('click', e => {
    const a = e.target.closest('[data-m]')?.dataset.m; if (!a) return;
    if (a === 'here') {
      const sp = state.sprite, oldFrom = g().from, src = sp.cels.find(c => c.layerId === id && c.frameId === oldFrom), dst = sp.cels.find(c => c.layerId === id && c.frameId === state.frameId);
      if (src && dst && src !== dst) { const i = sp.cels.indexOf(src), j = sp.cels.indexOf(dst); sp.cels[i] = { ...src, pixels: dst.pixels }; sp.cels[j] = { ...dst, pixels: src.pixels }; }
      find(sp, id).node.magic = { ...g(), from: state.frameId }; s.update(); draw();
    }
    if (a === 'frames') { s.done(); live.ensureFrames(g().cycle); toast(`The artwork now has ${state.sprite.frames.length} frames`); draw(); }
  });
  draw();
  sidePanel('Magic layer', body, s, [{ label: 'Bake into frames', value: 'baked', onClick: () => { s.done(); live.bakeLayer(id); toast('Baked: every frame is now ordinary pixels'); } }]);
}

export function openPost() {
  const sp = state.sprite;
  const s = live.session('Effects');
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `<p class="px-hint">Effects on the whole picture. They show on screen and in exports, but your layers stay untouched until you apply them.</p>
    ${toggle('show', !sp.postHidden, 'Show effects')}
    <div class="px-stack-wrap"></div>`;
  bindControls(body, (k, v) => { if (k === 'show') { sp.postHidden = !v; s.update(); emit('post'); } });
  stackEditor(body.querySelector('.px-stack-wrap'), POST, () => state.sprite.post || [], l => live.setPost(l), () => s.update());
  sidePanel('Picture effects', body, s, [{ label: 'Apply to the art', value: 'baked', onClick: async () => {
    if (!liveStack(state.sprite.post)) { toast('Add an effect first'); return false; }
    if (!(await confirmBox('Apply the effects?', 'The visible layers become one layer with the effects drawn in. You can undo this.', { ok: 'Apply' }))) return false;
    s.done(); live.applyPost(); toast('Effects applied');
  } }]);
}
