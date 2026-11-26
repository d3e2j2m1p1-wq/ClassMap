// ═══════════════════════════════════════════════
//  Settings: General, Canvas, Drawing, Features and Shortcuts. Everything here is saved on this
//  device; the guide grid is saved with each artwork.
// ═══════════════════════════════════════════════
import { state, emit, saveSettings, SETTINGS } from '../editor/state.js';
import { ACTIONS, keysFor, setKeys, resetKeys, comboOf, pretty } from '../editor/keymap.js';
import * as doc from '../editor/doc.js';
import { MAX_SIDE } from '../core/sprite.js';
import { openDialog, seg, toggle, range, bindControls, confirmBox, toast, esc } from './dialogs.js';
import { openColorMode } from './colortools.js';

const TABS = [['general', 'General'], ['canvas', 'Canvas'], ['drawing', 'Drawing'], ['features', 'Features'], ['keys', 'Shortcuts']];

export function openSettings(view, tab = 'general') {
  const s = state.settings;
  const body = document.createElement('div');
  body.className = 'px-settings';
  const panes = {
    general: () => `
      ${toggle('autosave', s.autosave, 'Save automatically after every change')}
      <p class="px-hint">Off: a Save button appears at the top and changes are kept only when you press it.</p>
      ${toggle('toasts', s.toasts, 'Show little messages (Copied, Saved…)')}
      ${toggle('undoButtons', s.undoButtons, 'Undo / redo buttons beside the canvas')}
      ${toggle('opacitySlider', s.opacitySlider, 'Opacity slider beside the canvas')}
      ${toggle('undoGestures', s.undoGestures, 'Two- and three-finger taps undo and redo')}
      ${range('historyDepth', s.historyDepth, 20, 300, 'Undo steps kept')}
      <div class="px-set-row"><button type="button" class="px-btn px-btn-ghost" data-a="clearHistory">Clear undo history</button>
      <button type="button" class="px-btn px-btn-ghost" data-a="reset">Reset all settings</button></div>`,
    canvas: () => `
      ${toggle('grid', s.grid, 'Pixel grid when zoomed in')}
      ${seg('gridMin', s.gridMin, [[4, 'From 400%'], [8, 'From 800%'], [16, 'From 1600%']])}
      ${toggle('checker', s.checker, 'Checkerboard behind see-through pixels')}
      ${toggle('border', s.border, 'Outline around the canvas')}
      <div class="px-mini-label">Tiled mode (for seamless patterns)</div>
      ${seg('tiled', s.tiled, [['off', 'Off'], ['both', 'Both ways'], ['x', 'Sideways'], ['y', 'Up / down']])}
      ${toggle('guides', s.guides, 'Guide grid (saved with this artwork)')}
      <div class="px-guide-grid">${['w', 'h', 'offsetX', 'offsetY'].map(k => `<label class="px-field"><span>${{ w: 'Width', h: 'Height', offsetX: 'Offset X', offsetY: 'Offset Y' }[k]}</span><input type="number" data-grid="${k}" min="${k.startsWith('offset') ? 0 : 2}" max="${MAX_SIDE}" value="${state.sprite?.grid?.[k] ?? (k.startsWith('offset') ? 0 : 16)}"></label>`).join('')}</div>
      ${toggle('snapZoom', s.snapZoom, 'Pinch zoom settles on 100%, 200%, 300%…')}
      ${toggle('hoverPreview', s.hoverPreview, 'Show where the brush will land (pencil hover / mouse)')}
      ${range('antsOpacity', s.antsOpacity, 20, 100, 'Selection outline strength', '%')}
      ${state.sprite ? `<div class="px-mini-label">This canvas</div><div class="px-set-row">
        <button type="button" class="px-btn px-btn-ghost" data-a="resize">Resize canvas…</button>
        <button type="button" class="px-btn px-btn-ghost" data-a="crop">Crop to the art</button>
        <button type="button" class="px-btn px-btn-ghost" data-a="flipH">Flip ↔</button>
        <button type="button" class="px-btn px-btn-ghost" data-a="flipV">Flip ↕</button></div>
      <div class="px-mini-label">Colour mode: ${state.sprite.colorMode === 'indexed' ? 'Indexed' : 'RGBA'}</div>
      <div class="px-set-row"><button type="button" class="px-btn px-btn-ghost" data-a="colorMode">${state.sprite.colorMode === 'indexed' ? 'Convert to RGBA…' : 'Convert to indexed…'}</button></div>` : ''}`,
    drawing: () => `
      <div class="px-mini-label">Fingers on the canvas</div>
      ${seg('fingers', s.fingers, [['auto', 'Auto'], ['draw', 'Draw'], ['navigate', 'Only move']])}
      <p class="px-hint">Auto: fingers draw until you use a pencil, then they only pan, zoom and undo (so a resting palm never draws).</p>
      ${toggle('longPress', s.longPress, 'Long press on the canvas picks a colour')}
      ${range('longPressMs', s.longPressMs, 250, 1000, 'Long press time', ' ms')}
      <div class="px-mini-label">Paste lands</div>
      ${seg('pastePosition', s.pastePosition, [['original', 'Where it was copied'], ['center', 'In the middle of the screen']])}`,
    features: () => `
      <p class="px-hint">Switch off what you don't use to keep the screen simple.</p>
      ${toggle('f.symmetry', s.features?.symmetry !== false, 'Symmetry button')}
      ${toggle('f.references', s.features?.references !== false, 'Reference images button')}`,
    keys: () => `
      <p class="px-hint">Tap a shortcut, then press the new keys. Space (pan), Alt (pick a colour) and the arrow keys (nudge) stay as they are.</p>
      <div class="px-keylist">${ACTIONS.map(([id, label]) => `<div class="px-keyrow"><span>${esc(label)}</span><button type="button" class="px-key" data-key="${id}">${keysFor(id).map(pretty).map(esc).join(' · ') || '—'}</button></div>`).join('')}</div>
      <button type="button" class="px-btn px-btn-ghost" data-a="resetKeys">Reset all shortcuts</button>`,
  };
  let current = tab;
  const draw = () => {
    body.innerHTML = `<div class="px-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === current}" data-tab="${k}">${l}</button>`).join('')}</div><div class="px-tabpane">${panes[current]()}</div>`;
    bindControls(body, (k, v) => {
      if (k.startsWith('f.')) { s.features = { ...(s.features || {}), [k.slice(2)]: v }; }
      else s[k] = v;
      if (k === 'historyDepth') state.history.depth = v;
      saveSettings(); emit('settings'); view.request();
      if (k === 'autosave') emit('autosave');
    });
  };
  body.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]');
    if (t) { current = t.dataset.tab; draw(); return; }
    const key = e.target.closest('[data-key]');
    if (key) { capture(key); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'clearHistory' && await confirmBox('Clear undo history?', 'You won\'t be able to undo what you\'ve done so far.', { ok: 'Clear', danger: true })) { state.history.clear(); emit('history'); toast('Undo history cleared'); }
    if (a === 'reset' && await confirmBox('Reset all settings?', 'Tool options, presets and shortcuts go back to how they started. Your artwork is not touched.', { ok: 'Reset', danger: true })) {
      Object.assign(state.settings, structuredClone(SETTINGS)); saveSettings(); emit('settings'); emit('tool'); emit('options'); view.request(); draw();
    }
    if (a === 'resetKeys') { resetKeys(); draw(); emit('settings'); }
    if (a === 'resize') { ov().remove(); openResize(); }
    if (a === 'colorMode') { ov().remove(); openColorMode(); }
    if (a === 'crop') doc.cropToContent();
    if (a === 'flipH') doc.flipCanvas('h');
    if (a === 'flipV') doc.flipCanvas('v');
  });
  body.addEventListener('change', e => {
    const k = e.target.dataset.grid;
    if (!k || !state.sprite) return;
    state.sprite.grid = { ...(state.sprite.grid || {}), [k]: Math.max(0, Number(e.target.value) || 0) };
    emit('dirty'); view.request();
  });
  const ov = () => body.closest('.px-overlay');
  // press the new keys for an action
  function capture(btn) {
    btn.textContent = 'Press keys…'; btn.classList.add('listening');
    const onKey = ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.key === 'Escape') { done(); return; }
      const c = comboOf(ev); if (!c) return;
      setKeys(btn.dataset.key, [c]); done(); emit('settings');
    };
    const done = () => { removeEventListener('keydown', onKey, true); draw(); };
    addEventListener('keydown', onKey, true);
  }
  draw();
  return openDialog({ title: 'Settings', body, actions: [{ label: 'Done', kind: 'primary' }], className: 'px-settings-dialog' });
}

// Resize the canvas, choosing which side the art stays on
export function openResize() {
  const sp = state.sprite;
  let ax = 0.5, ay = 0.5;
  const body = document.createElement('div');
  body.innerHTML = `<div class="px-wh">
      <label class="px-field"><span>Width</span><input type="number" class="px-rs-w" min="1" max="${MAX_SIDE}" value="${sp.width}"></label>
      <span class="px-wh-x">×</span>
      <label class="px-field"><span>Height</span><input type="number" class="px-rs-h" min="1" max="${MAX_SIDE}" value="${sp.height}"></label></div>
    <div class="px-mini-label">Keep the art at</div>
    <div class="px-anchor">${[0, 0.5, 1].flatMap(y => [0, 0.5, 1].map(x => `<button type="button" data-x="${x}" data-y="${y}" aria-label="Anchor ${y === 0 ? 'top' : y === 1 ? 'bottom' : 'middle'} ${x === 0 ? 'left' : x === 1 ? 'right' : 'centre'}"></button>`)).join('')}</div>`;
  const paint = () => body.querySelectorAll('.px-anchor button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.x === ax && +b.dataset.y === ay)));
  body.querySelector('.px-anchor').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ax = +b.dataset.x; ay = +b.dataset.y; paint(); } });
  paint();
  return openDialog({
    title: 'Resize canvas', body,
    actions: [{ label: 'Cancel' }, { label: 'Resize', kind: 'primary', onClick: () => {
      const w = Number(body.querySelector('.px-rs-w').value), h = Number(body.querySelector('.px-rs-h').value);
      if (!(Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE)) { toast(`Use whole numbers from 1 to ${MAX_SIDE}`); return false; }
      doc.resizeCanvas(w, h, ax, ay);
    } }],
  });
}
