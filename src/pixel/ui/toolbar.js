// ═══════════════════════════════════════════════
//  Toolbox, the size / opacity sliders (with undo, redo and the quick eye-dropper square),
//  each tool's options, the settings pop-over and the info bar.
// ═══════════════════════════════════════════════
import { state, on, emit, setTool, saveSettings, TOOL_DEFAULTS } from '../editor/state.js';
import { ICONS, TOOL_INFO, TOOL_ORDER } from './icons.js';
import { popover, seg, toggle, range, bindControls, promptBox, esc, toast } from './dialogs.js';
import { keysFor, pretty } from '../editor/keymap.js';
import { brushOptions, brushClick, openText, openObjects } from './library.js';

const phone = () => matchMedia('(max-width: 700px)').matches;

// ── Toolbox ──
const keyHint = t => { const k = keysFor('tool.' + t)[0]; return k ? ` (${pretty(k)})` : ''; };
export function initToolbox(el) {
  el.innerHTML = TOOL_ORDER.map(k =>
    `<button type="button" class="px-tool" data-tool="${k}" aria-label="${TOOL_INFO[k].label}${keyHint(k)}" title="${TOOL_INFO[k].label}${keyHint(k)} — tap again for options">${ICONS[k]}</button>`).join('')
    + `<span class="px-tool-sep"></span><button type="button" class="px-tool px-sym-btn" aria-label="Symmetry" title="Symmetry — tap to switch on, tap again for options">${ICONS.symmetry}</button>`
    + `<button type="button" class="px-tool px-obj-btn" aria-label="Objects" title="Objects — stamp saved pieces of art">${ICONS.stamp}</button>`;
  el.addEventListener('click', e => {
    const b = e.target.closest('.px-tool'); if (!b) return;
    if (b.classList.contains('px-obj-btn')) { openObjects(b); return; }
    if (b.classList.contains('px-sym-btn')) {
      const S = state.settings.symmetry;
      if (!S.on) { S.on = true; saveSettings(); emit('symmetry'); } else openSymmetry(b);
      return;
    }
    if (state.settings.tool === b.dataset.tool && !state.tempTool) openToolOptions(b);
    else setTool(b.dataset.tool);
  });
  const paint = () => {
    el.querySelectorAll('.px-tool[data-tool]').forEach(b => {
      const on_ = b.dataset.tool === state.tool;
      b.classList.toggle('on', on_); b.setAttribute('aria-pressed', String(on_));
      b.classList.toggle('temp', on_ && !!state.tempTool);
    });
    const sb = el.querySelector('.px-sym-btn');
    sb.classList.toggle('on', !!state.settings.symmetry.on);
    sb.hidden = state.settings.features?.symmetry === false;
  };
  on('tool', paint); on('symmetry', paint); on('settings', paint); paint();
}

function openSymmetry(anchor) {
  const S = state.settings.symmetry;
  const el = document.createElement('div');
  el.className = 'px-opts';
  el.innerHTML = `<div class="px-pop-title">Symmetry</div>
    ${toggle('on', S.on, 'Symmetry on')}
    ${seg('mode', S.mode, [['mirror', 'Mirror'], ['rotate', 'Rotate']])}
    ${range('count', S.count, 1, 12, 'Lines / copies')}
    ${range('angle', S.angle, 0, 179, 'Angle', '°')}
    <button type="button" class="px-btn px-btn-ghost px-sym-reset">Centre it again</button>
    <p class="px-hint">Drag the round coral handle on the canvas to move the centre. Works with every drawing tool.</p>`;
  bindControls(el, (k, v) => { S[k] = v; saveSettings(); emit('symmetry'); });
  el.querySelector('.px-sym-reset').addEventListener('click', () => { S.cx = 0.5; S.cy = 0.5; S.angle = 90; saveSettings(); emit('symmetry'); });
  popover(anchor, el, { side: phone() ? 'top' : 'right', className: 'px-opts-pop' });
}

// ── Tool options ──
const MODES = v => `<div class="px-mini-label">When you select again</div>${seg('mode', v, [['replace', 'Replace'], ['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Overlap'], ['xor', 'Flip']])}`;
const OPTIONS = {
  brush: o => `
    ${seg('type', o.type, [['solid', 'Solid'], ['spray', 'Spray'], ['spray-soft', 'Soft spray']])}
    ${seg('tip', o.tip, o.type === 'solid' ? [['round', 'Round'], ['square', 'Square'], ['custom', 'Custom'], ['jumble', 'Jumble'], ['blur', 'Blur']] : [['round', 'Round'], ['square', 'Square']])}
    ${brushOptions(o)}
    ${toggle('pixelPerfect', o.pixelPerfect, 'Pixel perfect (clean 1 px curves)')}
    ${toggle('watercolor', o.watercolor, 'Blend see-through colour with what\'s under it')}
    ${toggle('pressure', o.pressure, 'Pencil pressure changes size')}
    ${range('pressureMin', o.pressureMin, 5, 100, 'Lightest press', '%')}
    ${range('stabilizer', o.stabilizer, 0, 10, 'Steady hand (smoothing)')}`,
  eraser: o => `
    ${seg('tip', o.tip, [['round', 'Round'], ['square', 'Square'], ['custom', 'Custom']])}
    ${brushOptions(o)}
    ${toggle('pixelPerfect', o.pixelPerfect, 'Pixel perfect')}
    ${toggle('pressure', o.pressure, 'Pencil pressure changes size')}
    ${range('stabilizer', o.stabilizer, 0, 10, 'Steady hand (smoothing)')}
    <p class="px-hint">Opacity under 100% fades pixels instead of clearing them.</p>`,
  line: o => `
    ${seg('tip', o.tip, [['round', 'Round'], ['square', 'Square']])}
    ${toggle('perfectAngle', o.perfectAngle, 'Perfect angles (0°, 45°, 90°, 2:1)')}
    ${toggle('watercolor', o.watercolor, 'Blend see-through colour')}
    <p class="px-hint">Hold Shift for perfect angles once.</p>`,
  shape: o => `
    ${seg('kind', o.kind, [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon']])}
    ${range('sides', o.sides, 3, 12, 'Polygon sides')}
    ${toggle('filled', o.filled, 'Filled')}
    ${toggle('perfectRatio', o.perfectRatio, 'Perfect square / circle')}
    ${toggle('fromCenter', o.fromCenter, 'Draw out from the centre')}
    ${seg('tip', o.tip, [['round', 'Round'], ['square', 'Square']])}
    ${toggle('watercolor', o.watercolor, 'Blend see-through colour')}
    <p class="px-hint">Shift = perfect ratio, Alt = from the centre.</p>`,
  bucket: o => `
    ${toggle('contiguous', o.contiguous, 'Only connected pixels')}
    ${seg('eight', o.eight ? 1 : 0, [[0, '4-way'], [1, '8-way (diagonals)']])}
    ${range('tolerance', o.tolerance, 0, 100, 'Tolerance', '%')}
    ${seg('sample', o.sample, [['layer', 'This layer'], ['all', 'Everything visible']])}
    ${toggle('watercolor', o.watercolor, 'Blend see-through colour')}`,
  select: o => `
    ${seg('shape', o.shape, [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['lasso', 'Lasso'], ['polygon', 'Polygon']])}
    ${MODES(o.mode)}
    <p class="px-hint">Tap the canvas to deselect. Polygon: tap each corner, then tap the first one (or double-tap / Enter). Shift adds, Alt subtracts.</p>`,
  wand: o => `
    ${MODES(o.mode)}
    ${toggle('contiguous', o.contiguous, 'Only connected pixels')}
    ${seg('eight', o.eight ? 1 : 0, [[0, '4-way'], [1, '8-way (diagonals)']])}
    ${range('tolerance', o.tolerance, 0, 100, 'Tolerance', '%')}
    ${seg('sample', o.sample, [['layer', 'This layer'], ['all', 'Everything visible']])}`,
  move: o => `
    ${toggle('rotsprite', o.rotsprite, 'Keep pixel edges crisp when rotating (RotSprite)')}
    <p class="px-hint">Drag inside to move, corners and edges to resize (Shift keeps the shape), the round handle to rotate (snaps to right angles; Shift = 15° steps). Arrow keys nudge 1 px, Shift+arrows 10 px. Enter or ✓ applies.</p>`,
  text: () => `
    <p class="px-hint">Tap the canvas where the text should go. Pick a pixel font (always sharp) or one of this device's fonts, then drag the text into place.</p>
    <button type="button" class="px-btn px-btn-ghost" data-text="open">Write text…</button>`,
  dropper: o => `
    ${seg('sample', o.sample, [['all', 'Everything visible'], ['layer', 'This layer']])}
    ${toggle('backToTool', o.backToTool, 'Go back to the last tool after picking')}
    <p class="px-hint">Right-click (or Alt) picks into the secondary colour. Long press on the canvas picks with any tool.</p>`,
};

export function openToolOptions(anchor) {
  const name = state.settings.tool, o = state.settings.tools[name];
  const el = document.createElement('div');
  el.className = 'px-opts';
  const presets = () => state.settings.presets[name] || [];
  const presetRow = () => `<div class="px-presets-row"><div class="px-mini-label">Presets</div><div class="px-chips">${presets().map((p, i) =>
    `<span class="px-chip"><button type="button" data-p="${i}">${esc(p.name)}</button><button type="button" class="px-chip-x" data-px="${i}" aria-label="Delete ${esc(p.name)}">×</button></span>`).join('') || '<span class="px-hint">None yet</span>'}</div>
    <button type="button" class="px-btn px-btn-ghost px-preset-save">Save these settings as a preset</button></div>`;
  const render = () => {
    const note = state.sprite?.colorMode === 'indexed' && ['brush', 'line', 'shape', 'bucket'].includes(name)
      ? `<p class="px-hint px-indexed-note">Indexed colour: paints whole palette colours only (no see-through blending)${name === 'bucket' ? ', and tolerance counts palette steps' : ''}.</p>` : '';
    el.innerHTML = `<div class="px-pop-title">${TOOL_INFO[name].label}</div>${OPTIONS[name](o)}${note}${['dropper', 'text'].includes(name) ? '' : presetRow()}`;
    bindControls(el, (k, v) => {
      o[k] = k === 'eight' ? !!v : v;
      if (k === 'type' && v !== 'solid' && !['round', 'square'].includes(o.tip)) o.tip = 'round';
      saveSettings(); emit('options');
      if (k === 'tip' || k === 'type') { render(); pop?.place(); }
    });
  };
  el.addEventListener('click', async e => {
    if (await brushClick(e, o, () => { render(); pop.place(); })) return;
    if (e.target.closest('[data-text]')) { pop.close(); openText(null); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p) { Object.assign(o, structuredClone(presets()[b.dataset.p].opts)); saveSettings(); emit('options'); render(); toast(`"${presets()[b.dataset.p].name}" applied`); }
    else if (b.dataset.px) { presets().splice(Number(b.dataset.px), 1); saveSettings(); render(); }
    else if (b.classList.contains('px-preset-save')) {
      pop.close();
      const nm = await promptBox('Save preset', `${TOOL_INFO[name].label} ${presets().length + 1}`, { ok: 'Save' });
      if (!nm) return;
      (state.settings.presets[name] ||= []).push({ name: nm, opts: structuredClone(o) });
      saveSettings(); toast(`Saved "${nm}"`);
    }
  });
  let pop = null;
  render();
  pop = popover(anchor, el, { side: phone() ? 'top' : 'right', className: 'px-opts-pop' });
}

// ── A vertical slider (built by hand: native vertical ranges are unreliable on iPad) ──
function vslider(el, { label, min, max, get, set, curve = 1, unit = '' }) {
  el.classList.add('px-vslider');
  el.setAttribute('role', 'slider');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max);
  el.innerHTML = '<span class="px-vtrack"><span class="px-vfill"></span></span><span class="px-vknob"></span><span class="px-vval"></span>';
  const toT = v => ((v - min) / (max - min)) ** (1 / curve);
  const toV = t => Math.round(min + (max - min) * t ** curve);
  const paint = () => {
    const v = get(), t = toT(v);
    el.style.setProperty('--t', t);
    el.querySelector('.px-vval').textContent = v + unit;
    el.setAttribute('aria-valuenow', v);
  };
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const go = ev => {
      const r = el.querySelector('.px-vtrack').getBoundingClientRect();
      set(toV(Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height)))); paint();
    };
    go(e);
    const mv = ev => go(ev);
    const up = () => { el.classList.remove('dragging'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', e => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    set(Math.max(min, Math.min(max, get() + d))); paint();
  });
  return paint;
}

export function initSliders(el, actions) {
  el.innerHTML = `
    <button type="button" class="px-icon-btn px-undo" aria-label="Undo" title="Undo (Ctrl+Z · two-finger tap)">${ICONS.undo}</button>
    <div class="px-size"></div>
    <button type="button" class="px-quick" aria-label="Hold for the eye dropper" title="Hold here, then tap the canvas to pick a colour">${ICONS.dropper}</button>
    <div class="px-opacity"></div>
    <button type="button" class="px-icon-btn px-redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z · three-finger tap)">${ICONS.redo}</button>`;
  el.querySelector('.px-undo').addEventListener('click', actions.undo);
  el.querySelector('.px-redo').addEventListener('click', actions.redo);
  const o = () => state.settings.tools[state.settings.tool];
  const paintSize = vslider(el.querySelector('.px-size'), { label: 'Brush size', min: 1, max: 64, curve: 2, get: () => o().size, set: v => { o().size = v; saveSettings(); emit('options'); } });
  const paintOp = vslider(el.querySelector('.px-opacity'), { label: 'Opacity', min: 1, max: 100, unit: '%', get: () => o().opacity, set: v => { o().opacity = v; saveSettings(); emit('options'); } });
  const paint = () => {
    paintSize(); paintOp();
    const t = state.settings.tool;
    el.querySelector('.px-size').classList.toggle('off', ['bucket', 'dropper', 'select', 'wand', 'move'].includes(t));
    el.querySelector('.px-opacity').classList.toggle('off', ['dropper', 'select', 'wand', 'move'].includes(t));
    el.querySelector('.px-opacity').hidden = state.settings.opacitySlider === false;
    el.querySelector('.px-undo').hidden = el.querySelector('.px-redo').hidden = state.settings.undoButtons === false;
  };
  on('tool', paint); on('options', paint); on('settings', paint); paint();

  // the quick square: hold it, tap the canvas with the other hand to pick a colour
  const q = el.querySelector('.px-quick');
  q.addEventListener('pointerdown', e => { e.preventDefault(); q.setPointerCapture(e.pointerId); q.classList.add('held'); state.tempTool = 'dropper'; emit('tool'); });
  const release = () => { if (!q.classList.contains('held')) return; q.classList.remove('held'); state.tempTool = null; emit('tool'); };
  q.addEventListener('pointerup', release); q.addEventListener('pointercancel', release);

  const history = () => {
    el.querySelector('.px-undo').disabled = !state.history.canUndo;
    el.querySelector('.px-redo').disabled = !state.history.canRedo;
  };
  on('history', history); history();
}

export function nudgeSize(d) {
  const o = state.settings.tools[state.settings.tool];
  o.size = Math.max(1, Math.min(64, o.size + d));
  saveSettings(); emit('options');
}

// ── Info bar: where the pointer is, canvas size, zoom ──
export function initInfo(el, view) {
  el.innerHTML = '<span class="px-xy">–</span><span class="px-dim"></span><button type="button" class="px-zoom" title="Zoom"></button>';
  const xy = el.querySelector('.px-xy'), dim = el.querySelector('.px-dim'), zb = el.querySelector('.px-zoom');
  on('cursor', p => {
    const sp = state.sprite;
    xy.textContent = p && sp && p.x >= 0 && p.y >= 0 && p.x < sp.width && p.y < sp.height ? `${p.x}, ${p.y}` : '–';
  });
  const paint = () => {
    if (!state.sprite) return;
    dim.textContent = `${state.sprite.width} × ${state.sprite.height}`;
    zb.textContent = Math.round(view.zoom * 100) + '%';
  };
  on('view', paint); on('sprite', paint);
  zb.addEventListener('click', () => {
    const m = document.createElement('div');
    m.className = 'px-menu';
    m.innerHTML = `<button type="button" data-z="fit">Fit to screen</button>` + [1, 2, 4, 8, 16, 32].map(z => `<button type="button" data-z="${z}">${z * 100}%</button>`).join('');
    const pop = popover(zb, m, { side: 'top' });
    m.addEventListener('click', e => {
      const z = e.target.closest('button')?.dataset.z; if (!z) return;
      pop.close();
      if (z === 'fit') view.fit(); else view.setZoom(Number(z));
    });
  });
}
