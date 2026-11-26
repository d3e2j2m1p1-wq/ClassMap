// ═══════════════════════════════════════════════
//  Editor state shared by every part of the Pixel editor, plus a tiny event bus.
//  Settings live in localStorage under "pixel:…" keys (artwork lives in IndexedDB).
// ═══════════════════════════════════════════════
import { History } from '../core/history.js';
import { bounds as maskBounds, outline } from '../core/selection.js';

const listeners = new Map();
export const on = (ev, fn) => { (listeners.get(ev) || listeners.set(ev, new Set()).get(ev)).add(fn); return () => listeners.get(ev).delete(fn); };
export const emit = (ev, data) => listeners.get(ev)?.forEach(fn => fn(data));

export const TOOL_DEFAULTS = {
  brush: { size: 1, opacity: 100, tip: 'round', type: 'solid', pixelPerfect: true, watercolor: true, pressure: false, pressureMin: 30, stabilizer: 0 },
  eraser: { size: 3, opacity: 100, tip: 'square', type: 'solid', pixelPerfect: false, pressure: false, pressureMin: 30, stabilizer: 0 },
  line: { size: 1, opacity: 100, tip: 'round', perfectAngle: false, watercolor: true },
  shape: { size: 1, opacity: 100, tip: 'round', kind: 'rect', sides: 6, filled: false, perfectRatio: false, fromCenter: false, watercolor: true },
  bucket: { size: 1, opacity: 100, contiguous: true, eight: false, tolerance: 0, watercolor: true, sample: 'layer' },
  dropper: { size: 1, opacity: 100, backToTool: true, sample: 'all' },
  select: { size: 1, opacity: 100, shape: 'rect', mode: 'replace' },
  wand: { size: 1, opacity: 100, mode: 'replace', contiguous: true, eight: false, tolerance: 0, sample: 'layer' },
  move: { size: 1, opacity: 100, rotsprite: true },
  text: { size: 1, opacity: 100 },
};
export const DRAW_TOOLS = ['brush', 'eraser', 'line', 'shape', 'bucket'];

const SETTINGS_DEFAULTS = {
  fingers: 'auto',          // 'auto' (navigate once a pencil is seen) | 'draw' | 'navigate'
  grid: true, gridMin: 8,   // pixel grid from 800 % up
  checker: true,
  longPress: true,          // long press on the canvas = eye dropper
  primary: [43, 29, 26, 255], secondary: [255, 248, 236, 255],
  tool: 'brush',
  tools: TOOL_DEFAULTS,
  presets: {},              // tool → [{ name, opts }]
  symmetry: { on: false, mode: 'mirror', count: 1, angle: 90, cx: 0.5, cy: 0.5 },
  // General
  autosave: true, toasts: true, undoButtons: true, opacitySlider: true, undoGestures: true, historyDepth: 100,
  // Canvas
  border: true, tiled: 'off', snapZoom: true, hoverPreview: true, antsOpacity: 100, guides: false,
  // Drawing
  longPressMs: 480, pastePosition: 'original',
  keymap: {},               // action → ['Ctrl+Z', …] (only the ones you changed)
  // Animation
  onion: { on: false, before: 1, after: 1, opacity: 45, falloff: 60, tintBefore: '#F25F6B', tintAfter: '#0E8A9E', tagOnly: false, wrap: false },
  wrapFrames: true, numberFrom: 1,
  timeline: true,           // the timeline panel is open (not just its bar)
  preview: { open: false, x: 0, y: 0, w: 220, h: 220 },
  // Colour
  shading: { on: false, a: 0, b: 3, dir: 1 },   // ramp from swatch a to swatch b; dir 1 = towards b
  placement: 'packed', paletteCols: 8,          // palette panel: 'packed' or 'grid' (fixed columns)
  // Files
  versionKeep: 5, versionMinutes: 10,           // automatic version backups
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
  s.symmetry = { ...SETTINGS_DEFAULTS.symmetry, ...(s.symmetry || {}) };
  s.onion = { ...SETTINGS_DEFAULTS.onion, ...(s.onion || {}) };
  s.preview = { ...SETTINGS_DEFAULTS.preview, ...(s.preview || {}) };
  s.shading = { ...SETTINGS_DEFAULTS.shading, ...(s.shading || {}), on: false };
  return s;
}

export const SETTINGS = SETTINGS_DEFAULTS;
export const state = {
  settings: loadSettings(),
  sprite: null, layerId: null, frameId: null,
  history: new History(100),
  tempTool: null,
  selection: null,          // { mask, bounds, segs } — what's selected on the canvas
  selectedLayers: new Set(),
  selectedFrames: new Set(),
  playing: false,
  playTag: null,            // tag id to loop, or null for the tag around the current frame
  transform: null,          // a move / paste in progress (see transform.js)           // eye dropper while Alt / long press / the quick square is held
  sawPen: load('pixel:sawPen', false),   // once a pencil is used, fingers switch to navigating ("auto")
  noUI: false,
  paletteLocked: false,     // a locked palette can't lose colours (artworks with colours open locked)
  get tool() { return this.tempTool || this.settings.tool; },
  get opts() { return this.settings.tools[this.tool]; },
  get cel() { return this.sprite?.cels.find(c => c.layerId === this.layerId && c.frameId === this.frameId) || null; },
};

// The selection (a mask), or null for none
export function setSelection(mask) {
  const W = state.sprite?.width;
  const b = mask && W ? maskBounds(mask, W) : null;
  state.selection = b ? { mask, bounds: b, segs: outline(mask, W, state.sprite.height) } : null;
  emit('selection');
}

state.history.depth = state.settings.historyDepth;

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
