// ═══════════════════════════════════════════════
//  Joystick: a small floating pad of up to six actions for the hand that isn't drawing
//  (web pages can't see Apple Pencil double-tap or squeeze, so this stands in for them).
//  Each action is "hold" (on while pressed, e.g. a temporary eraser) or "tap / toggle".
//  Hold the centre to drag the pad anywhere; where you leave it is remembered.
// ═══════════════════════════════════════════════
import { state, on, emit, saveSettings } from '../editor/state.js';
import { ICONS } from './icons.js';
import { esc, seg, toggle } from './dialogs.js';

// id → [label, icon, kinds it can be]
export const JOY_ACTIONS = {
  eraser: ['Eraser', 'eraser', ['hold', 'toggle']],
  dropper: ['Eye dropper', 'dropper', ['hold', 'toggle']],
  pan: ['Pan (move the canvas)', 'move', ['hold', 'toggle']],
  undo: ['Undo', 'undo', ['tap']],
  redo: ['Redo', 'redo', ['tap']],
  grid: ['Pixel grid on / off', 'grid', ['tap']],
  swap: ['Swap colours', 'swap', ['tap']],
  prevTool: ['Previous tool', 'back', ['tap']],
};
const DEFAULT = { on: false, x: null, y: null, slots: [['eraser', 'hold'], ['dropper', 'hold'], ['undo', 'tap'], ['redo', 'tap'], ['pan', 'hold'], ['grid', 'tap']] };
export const joy = () => (state.settings.joystick ||= structuredClone(DEFAULT));

let el = null, actions = null, prevTool = null, lastTool = null;

export function initJoystick(editor, acts) {
  actions = acts;
  el = document.createElement('div');
  el.className = 'px-joy paper';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Joystick');
  editor.append(el);
  on('settings', render); on('theme', place);
  on('tool', () => { if (!state.tempTool && state.settings.tool !== lastTool) { prevTool = lastTool; lastTool = state.settings.tool; } paint(); });
  lastTool = state.settings.tool;
  wire();
  render();
  addEventListener('resize', place);
}

export function render() {
  if (!el) return;
  const J = joy();
  el.hidden = !J.on;
  const slots = J.slots.slice(0, 6);
  el.innerHTML = slots.map(([id, kind], i) => {
    const [label, icon] = JOY_ACTIONS[id] || [];
    return label ? `<button type="button" class="px-joy-btn" data-i="${i}" data-kind="${kind}" style="--a:${(i / slots.length) * 360}deg" aria-label="${esc(label)}${kind === 'hold' ? ' (hold)' : ''}" title="${esc(label)}${kind === 'hold' ? ' — hold' : ''}">${ICONS[icon] || ''}</button>` : '';
  }).join('') + `<button type="button" class="px-joy-hub" aria-label="Move the joystick (hold and drag)" title="Hold and drag to move">${ICONS.more}</button>`;
  place(); paint();
}

function place() {
  if (!el || el.hidden) return;
  const J = joy(), r = el.parentElement.getBoundingClientRect(), s = el.offsetWidth || 132;
  const lefty = !!state.settings.lefty;
  let x = J.x, y = J.y;
  if (x == null) { const ph = matchMedia('(max-width: 700px)').matches; x = ph ? (lefty ? 0.2 : 0.8) : (lefty ? 0.8 : 0.2); y = ph ? 0.3 : 0.6; }
  el.style.left = Math.max(4, Math.min(r.width - s - 4, x * r.width - s / 2)) + 'px';
  el.style.top = Math.max(4, Math.min(r.height - s - 4, y * r.height - s / 2)) + 'px';
}

const active = new Set();
function paint() {
  el?.querySelectorAll('.px-joy-btn').forEach(b => {
    const [id] = joy().slots[b.dataset.i];
    b.classList.toggle('on', !!(active.has(id) || (id === 'grid' && state.settings.grid) || (id === 'pan' && state.panMode)));
  });
}

function start(id) {
  if (id === 'eraser' || id === 'dropper') { state.tempTool = id; emit('tool'); }
  if (id === 'pan') { state.panMode = true; document.querySelector('#stage')?.classList.add('panning'); }
  active.add(id); paint();
}
function stop(id) {
  if ((id === 'eraser' || id === 'dropper') && state.tempTool === id) { state.tempTool = null; emit('tool'); }
  if (id === 'pan') { state.panMode = false; document.querySelector('#stage')?.classList.remove('panning'); }
  active.delete(id); paint();
}
function tap(id) {
  if (id === 'undo') actions.undo();
  if (id === 'redo') actions.redo();
  if (id === 'swap') actions.swap();
  if (id === 'grid') { state.settings.grid = !state.settings.grid; saveSettings(); emit('settings'); }
  if (id === 'prevTool' && prevTool) actions.setTool(prevTool);
  paint();
}

function wire() {
  let drag = null;
  el.addEventListener('pointerdown', e => {
    const b = e.target.closest('button'); if (!b) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    if (b.classList.contains('px-joy-hub')) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, t: setTimeout(() => { if (drag) { drag.live = true; el.classList.add('moving'); } }, 250) };
      return;
    }
    const [id, kind] = joy().slots[b.dataset.i];
    if (kind === 'hold') { start(id); b.dataset.held = e.pointerId; }
    else if (kind === 'toggle') { if (active.has(id)) stop(id); else start(id); }
    else tap(id);
  });
  el.addEventListener('pointermove', e => {
    if (!drag?.live || e.pointerId !== drag.id) return;
    const r = el.parentElement.getBoundingClientRect();
    const J = joy();
    J.x = (e.clientX - r.left) / r.width; J.y = (e.clientY - r.top) / r.height;
    place();
  });
  const end = e => {
    if (drag && e.pointerId === drag.id) { clearTimeout(drag.t); if (drag.live) saveSettings(); el.classList.remove('moving'); drag = null; return; }
    el.querySelectorAll('[data-held]').forEach(b => { if (String(e.pointerId) === b.dataset.held) { delete b.dataset.held; stop(joy().slots[b.dataset.i][0]); } });
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

// Settings → Features: joystick on/off and what each of its six buttons does
export const joyPane = () => {
  const J = joy();
  return `${toggle('joy.on', J.on, 'Joystick (a floating pad for your other hand)')}
    <div class="px-joy-slots">${J.slots.map(([id, kind], i) => `<div class="px-joy-slot">
      <select data-slot="${i}">${Object.entries(JOY_ACTIONS).map(([k, [l]]) => `<option value="${k}" ${k === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      ${JOY_ACTIONS[id][2].length > 1 ? seg('joyKind' + i, kind, JOY_ACTIONS[id][2].map(k => [k, k === 'hold' ? 'While held' : 'Tap on / off'])) : '<span class="px-hint">Tap</span>'}</div>`).join('')}</div>
    <button type="button" class="px-btn px-btn-ghost" data-joy="reset">Put the joystick back in its corner</button>`;
};
export function wireJoy(root, redraw) {
  root.querySelectorAll('[data-slot]').forEach(s => s.addEventListener('change', () => {
    const id = s.value;
    joy().slots[s.dataset.slot] = [id, JOY_ACTIONS[id][2][0]];
    saveSettings(); render(); redraw();
  }));
  root.addEventListener('click', e => { if (e.target.closest('[data-joy="reset"]')) { const J = joy(); J.x = J.y = null; saveSettings(); render(); } });
}
export const setJoy = (k, v) => {
  const J = joy();
  if (k === 'joy.on') J.on = v;
  else if (k.startsWith('joyKind')) J.slots[Number(k.slice(7))][1] = v;
  saveSettings(); render();
};
