import { store } from '../core/store.js';
import { saveChartToClass } from '../landing/chartOpen.js';
import { recordChange } from '../editor/undo.js';

// ═══════════════════════════════════════════════
//  AUTOSAVE  (charts save themselves — no Save click needed)
// ═══════════════════════════════════════════════
export let _saveTimer = null;
store._dirty = false;

export function editorOpen() {
  return !!window._currentChartClassId &&
    document.getElementById('landing-page').classList.contains('hidden');
}

export function markDirty() {
  recordChange();
  if (!editorOpen()) return;
  store._dirty = true;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSave, 500);
}

export function flushSave() {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  if (store._dirty && editorOpen()) saveChartToClass(true);
}

export function manualSave() {
  store._dirty = true;
  clearTimeout(_saveTimer);
  saveChartToClass(false);
}
