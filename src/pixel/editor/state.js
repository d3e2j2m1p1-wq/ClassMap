// ═══════════════════════════════════════════════
//  Editor state shared by every part of the Pixel editor, plus a tiny event bus.
//  Settings live in localStorage under "pixel:…" keys (artwork lives in IndexedDB).
// ═══════════════════════════════════════════════
import { History } from '../core/history.js';

const listeners = new Map();
export const on = (ev, fn) => { (listeners.get(ev) || listeners.set(ev, new Set()).get(ev)).add(fn); return () => listeners.get(ev).delete(fn); };
export const emit = (ev, data) => listeners.get(ev)?.forEach(fn => fn(data));

export const TOOL_DEFAULTS = {
  brush: { size: 1, opacity: 100, tip: 'round', type: 'solid', pixelPerfect: true, watercolor: true, pressure: false, pressureMin: 30, stabilizer: 0 },
  eraser: { size: 3, opacity: 100, tip: 'square', type: 'solid', pixelPerfect: false, pressure: false, pressureMin: 30, stabilizer: 0 },
  line: { size: 1, opacity: 100, tip: 'round', perfectAngle: false, watercolor: true },
  shape: { size: 1, opacity: 100, tip: 'round', kind: 'rect', sides: 6, filled: false, perfectRatio: false, fromCenter: false, watercolor: true },
  bucket: { size: 1, opacity: 100, contiguous: true, eight: false, tolerance: 0, watercolor: true },
  dropper: { size: 1, opacity: 100, backToTool: true },
};

const SETTINGS_DEFAULTS = {
  fingers: 'auto',          // 'auto' (navigate once a pencil is seen) | 'draw' | 'navigate'
  grid: true, gridMin: 8,   // pixel grid from 800 % up
  checker: true,
  longPress: true,          // long press on the canvas = eye dropper
  primary: [43, 29, 26, 255], secondary: [255, 248, 236, 255],
  tool: 'brush',
  tools: TOOL_DEFAULTS,
};

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
export function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or full: settings just don't stick */ }
}

function loadSettings() {
  const s = { ...structuredClone(SETTINGS_DEFAULTS), ...load('pixel:settings', {}) };
  s.tools = Object.fromEntries(Object.entries(TOOL_DEFAULTS).map(([k, d]) => [k, { ...d, ...(s.tools?.[k] || {}) }]));
  return s;
}

export const state = {
  settings: loadSettings(),
  sprite: null, layerId: null, frameId: null,
  history: new History(100),
  tempTool: null,           // eye dropper while Alt / long press / the quick square is held
  sawPen: load('pixel:sawPen', false),   // once a pencil is used, fingers switch to navigating ("auto")
  noUI: false,
  get tool() { return this.tempTool || this.settings.tool; },
  get opts() { return this.settings.tools[this.tool]; },
  get cel() { return this.sprite?.cels.find(c => c.layerId === this.layerId && c.frameId === this.frameId) || null; },
};

let saveT = 0;
export function saveSettings() {
  clearTimeout(saveT);
  saveT = setTimeout(() => store('pixel:settings', state.settings), 250);
}

export function setTool(name) {
  if (!state.settings.tools[name]) return;
  state.tempTool = null;
  state.settings.tool = name;
  saveSettings();
  emit('tool');
}

export function setColor(which, c) {
  state.settings[which] = [...c];
  saveSettings();
  emit('color');
}

export function swapColors() {
  const s = state.settings;
  [s.primary, s.secondary] = [s.secondary, s.primary];
  saveSettings();
  emit('color');
}

// Fingers draw unless the person chose "navigate", or chose "auto" and has used a pencil
export const fingersDraw = () => state.settings.fingers === 'draw' || (state.settings.fingers === 'auto' && !state.sawPen);
