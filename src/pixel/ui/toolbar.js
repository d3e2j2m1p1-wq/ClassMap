// ═══════════════════════════════════════════════
//  Toolbox, the size / opacity sliders (with undo, redo and the quick eye-dropper square),
//  each tool's options, the settings pop-over and the info bar.
// ═══════════════════════════════════════════════
import { state, on, emit, setTool, saveSettings } from '../editor/state.js';
import { ICONS, TOOL_INFO } from './icons.js';
import { popover, seg, toggle, range, bindControls } from './dialogs.js';

const phone = () => matchMedia('(max-width: 700px)').matches;

// ── Toolbox ──
export function initToolbox(el) {
  el.innerHTML = Object.entries(TOOL_INFO).map(([k, t]) =>
    `<button type="button" class="px-tool" data-tool="${k}" aria-label="${t.label} (${t.key})" title="${t.label} (${t.key}) — tap again for options">${ICONS[k]}</button>`).join('');
  el.addEventListener('click', e => {
    const b = e.target.closest('.px-tool'); if (!b) return;
    if (state.settings.tool === b.dataset.tool && !state.tempTool) openToolOptions(b);
    else setTool(b.dataset.tool);
  });
  const paint = () => el.querySelectorAll('.px-tool').forEach(b => {
    const on_ = b.dataset.tool === state.tool;
    b.classList.toggle('on', on_); b.setAttribute('aria-pressed', String(on_));
    b.classList.toggle('temp', on_ && !!state.tempTool);
  });
  on('tool', paint); paint();
}

// ── Tool options ──
const OPTIONS = {
  brush: o => `
    ${seg('type', o.type, [['solid', 'Solid'], ['spray', 'Spray'], ['spray-soft', 'Soft spray']])}
    ${seg('tip', o.tip, [['round', 'Round'], ['square', 'Square']])}
    ${toggle('pixelPerfect', o.pixelPerfect, 'Pixel perfect (clean 1 px curves)')}
    ${toggle('watercolor', o.watercolor, 'Blend see-through colour with what\'s under it')}
    ${toggle('pressure', o.pressure, 'Pencil pressure changes size')}
    ${range('pressureMin', o.pressureMin, 5, 100, 'Lightest press', '%')}
    ${range('stabilizer', o.stabilizer, 0, 10, 'Steady hand (smoothing)')}`,
  eraser: o => `
    ${seg('tip', o.tip, [['round', 'Round'], ['square', 'Square']])}
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
    ${toggle('watercolor', o.watercolor, 'Blend see-through colour')}`,
  dropper: o => `
    ${toggle('backToTool', o.backToTool, 'Go back to the last tool after picking')}
    <p class="px-hint">Right-click (or Alt) picks into the secondary colour. Long press on the canvas picks with any tool.</p>`,
};

export function openToolOptions(anchor) {
  const name = state.settings.tool, o = state.settings.tools[name];
  const el = document.createElement('div');
  el.className = 'px-opts';
  el.innerHTML = `<div class="px-pop-title">${TOOL_INFO[name].label}</div>${OPTIONS[name](o)}`;
  bindControls(el, (k, v) => { o[k] = k === 'eight' ? !!v : v; saveSettings(); emit('options'); });
  popover(anchor, el, { side: phone() ? 'top' : 'right', className: 'px-opts-pop' });
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
    const noSize = ['bucket', 'dropper'].includes(state.settings.tool);
    el.querySelector('.px-size').classList.toggle('off', noSize);
    el.querySelector('.px-opacity').classList.toggle('off', state.settings.tool === 'dropper');
  };
  on('tool', paint); on('options', paint); paint();

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

// ── Settings (gear) ──
export function openSettings(anchor, view) {
  const s = state.settings;
  const el = document.createElement('div');
  el.className = 'px-opts';
  el.innerHTML = `<div class="px-pop-title">Settings</div>
    <div class="px-mini-label">Fingers on the canvas</div>
    ${seg('fingers', s.fingers, [['auto', 'Auto'], ['draw', 'Draw'], ['navigate', 'Only move']])}
    <p class="px-hint">Auto: fingers draw until you use a pencil, then they only pan, zoom and undo.</p>
    ${toggle('grid', s.grid, 'Pixel grid when zoomed in')}
    ${seg('gridMin', s.gridMin, [[4, 'From 400%'], [8, 'From 800%'], [16, 'From 1600%']])}
    ${toggle('checker', s.checker, 'Checkerboard behind see-through pixels')}
    ${toggle('longPress', s.longPress, 'Long press on the canvas picks a colour')}
    <details class="px-keys"><summary>Gestures and shortcuts</summary>
      <ul>
        <li><b>Two fingers</b> drag / pinch: move and zoom</li>
        <li><b>Two-finger tap</b>: undo · hold to keep undoing</li>
        <li><b>Three-finger tap</b>: redo · <b>four</b>: hide the panels</li>
        <li><b>Quick pinch in</b>: fit the canvas</li>
        <li><b>B E L U G I</b>: brush, eraser, line, shape, bucket, eye dropper</li>
        <li><b>X</b> swap colours · <b>[ ]</b> size · <b>Space</b> pan · <b>Alt</b> pick colour</li>
        <li><b>Ctrl+Z / Ctrl+Shift+Z</b> undo / redo · <b>Ctrl+0</b> fit · <b>Ctrl+1</b> 100% · <b>Tab</b> hide panels</li>
      </ul>
    </details>`;
  bindControls(el, (k, v) => { s[k] = v; saveSettings(); view.request(); });
  popover(anchor, el, { side: 'below', className: 'px-opts-pop' });
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
