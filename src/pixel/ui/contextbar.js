// ═══════════════════════════════════════════════
//  Context bar: the actions that make sense right now, along the bottom of the canvas.
//  A selection → copy, cut, paste, fill, outline, clear, move…  A move in progress → apply,
//  cancel, flip, rotate, skew, nudge.  A polygon being drawn → finish or cancel.
// ═══════════════════════════════════════════════
import { state, on, saveSettings, emit } from '../editor/state.js';
import { ICONS } from './icons.js';

let el, actions;
const b = (a, icon, label, extra = '') => `<button type="button" class="px-ctx-btn ${extra}" data-a="${a}" title="${label}" aria-label="${label}">${ICONS[icon] || ''}<span>${label}</span></button>`;
const nub = (a, ch, label) => `<button type="button" class="px-ctx-btn px-ctx-nudge" data-a="${a}" title="${label}" aria-label="${label}">${ch}</button>`;

export function initContextBar(node, acts) {
  el = node; actions = acts;
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) actions.context(a);
  });
  for (const ev of ['selection', 'transform', 'polygon', 'tool', 'settings']) on(ev, render);
  render();
}

export function render() {
  if (!el) return;
  const T = state.transform;
  let html = '';
  if (T) {
    const deg = Math.round((T.p.rot * 180) / Math.PI), pct = Math.round(Math.abs(T.p.sx) * 100) + '%';
    html = b('apply', 'check', 'Apply', 'primary') + b('cancel', 'close', 'Cancel')
      + '<span class="px-ctx-sep"></span>'
      + b('flipH', 'flipH', 'Flip ↔') + b('flipV', 'flipV', 'Flip ↕') + b('rotL', 'rotL', '90° left') + b('rotR', 'rotR', '90° right')
      + b('skew', 'skew', 'Skew', T.skew ? 'on' : '') + b('rotsprite', 'image', 'Crisp rotate', state.settings.tools.move.rotsprite ? 'on' : '')
      + '<span class="px-ctx-sep"></span>'
      + nub('left', '←', 'Nudge left') + nub('up', '↑', 'Nudge up') + nub('down', '↓', 'Nudge down') + nub('right', '→', 'Nudge right')
      + `<span class="px-ctx-info">${deg}° · ${pct}</span>`;
  } else if (actions.polyActive()) {
    html = b('polyDone', 'check', 'Finish shape', 'primary') + b('polyCancel', 'close', 'Cancel');
  } else if (state.selection) {
    html = b('deselect', 'close', 'Deselect') + b('invert', 'invert', 'Invert')
      + '<span class="px-ctx-sep"></span>'
      + b('copy', 'copy', 'Copy') + b('cut', 'cut', 'Cut') + b('paste', 'paste', 'Paste')
      + '<span class="px-ctx-sep"></span>'
      + b('fill', 'fill', 'Fill') + b('outline', 'outline', 'Outline') + b('clear', 'trash', 'Clear') + b('move', 'move', 'Move');
  }
  el.innerHTML = html;
  el.hidden = !html;
}

export { saveSettings, emit };
