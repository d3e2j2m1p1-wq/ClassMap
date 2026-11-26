// ═══════════════════════════════════════════════
//  Keyboard shortcuts. Every action has defaults; Settings → Shortcuts can change any of them
//  (only the changes are saved). "Ctrl" means Ctrl on Windows / Chromebook and ⌘ on a Mac.
//  Holding Space (pan) and Alt (eye dropper) and the arrow keys (nudge) are fixed.
// ═══════════════════════════════════════════════
import { state, saveSettings } from './state.js';

export const ACTIONS = [
  ['tool.brush', 'Brush', ['B']], ['tool.eraser', 'Eraser', ['E']], ['tool.line', 'Line', ['L']], ['tool.shape', 'Shape', ['U']],
  ['tool.select', 'Selection', ['M']], ['tool.wand', 'Magic wand', ['W']], ['tool.bucket', 'Color bucket', ['G']],
  ['tool.dropper', 'Eye dropper', ['I']], ['tool.move', 'Move', ['V']],
  ['swap', 'Swap colours', ['X']],
  ['undo', 'Undo', ['Ctrl+Z']], ['redo', 'Redo', ['Ctrl+Shift+Z', 'Ctrl+Y']],
  ['copy', 'Copy', ['Ctrl+C']], ['copyMerged', 'Copy everything visible', ['Ctrl+Shift+C']], ['cut', 'Cut', ['Ctrl+X']], ['paste', 'Paste', ['Ctrl+V']],
  ['selectAll', 'Select all', ['Ctrl+A']], ['deselect', 'Deselect', ['Ctrl+D']], ['invert', 'Invert selection', ['Ctrl+Shift+I']],
  ['clear', 'Clear selected pixels', ['Delete', 'Backspace']],
  ['apply', 'Apply move / finish polygon / play or pause', ['Enter']], ['cancel', 'Cancel', ['Escape']],
  ['prevFrame', 'Previous frame', [',']], ['nextFrame', 'Next frame', ['.']], ['newFrame', 'New frame', ['Alt+N']],
  ['onion', 'Onion skin on / off', []],
  ['sizeDown', 'Brush size down', ['[']], ['sizeUp', 'Brush size up', [']']],
  ['zoomIn', 'Zoom in', ['+', '=']], ['zoomOut', 'Zoom out', ['-']], ['fit', 'Fit to screen', ['Ctrl+0']], ['actual', '100% zoom', ['Ctrl+1']],
  ['toggleUI', 'Hide / show the panels', ['Tab']],
  ['newLayer', 'New layer', ['Ctrl+Shift+N']], ['symmetry', 'Symmetry on / off', []],
];

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// "Ctrl+Shift+Z" for a key event (letters upper-case; Shift kept only where it isn't the character itself)
export function comboOf(e) {
  let k = e.key;
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(k)) return null;
  if (k === ' ') k = 'Space';
  if (k.length === 1) k = k.toUpperCase();
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && (/^[A-Z0-9]$/.test(k) || k.length > 1)) parts.push('Shift');
  parts.push(k);
  return parts.join('+');
}

export const keysFor = id => state.settings.keymap?.[id] || ACTIONS.find(a => a[0] === id)?.[2] || [];

export function actionFor(e) {
  const c = comboOf(e);
  if (!c) return null;
  for (const [id] of ACTIONS) if (keysFor(id).includes(c)) return id;
  return null;
}

export function setKeys(id, keys) {
  state.settings.keymap = { ...(state.settings.keymap || {}), [id]: keys };
  // a key can only do one thing: take it off any other action
  for (const [other] of ACTIONS) {
    if (other === id) continue;
    const cur = keysFor(other), left = cur.filter(k => !keys.includes(k));
    if (left.length !== cur.length) state.settings.keymap[other] = left;
  }
  saveSettings();
}
export function resetKeys() { state.settings.keymap = {}; saveSettings(); }

export const pretty = c => (MAC ? c.replace('Ctrl+', '⌘').replace('Alt+', '⌥').replace('Shift+', '⇧') : c);
