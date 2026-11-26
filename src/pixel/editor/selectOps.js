// ═══════════════════════════════════════════════
//  Things to do with a selection: select all, deselect, invert, clear, fill, outline.
// ═══════════════════════════════════════════════
import { state, setSelection } from './state.js';
import { invert as invertMask } from '../core/selection.js';
import { Stroke } from './stroke.js';
import { drawable } from './tools.js';
import { applyMove, discardMove } from './move.js';

let view = null, commit = null;
export function initSelectOps(v, c) { view = v; commit = c; }

export function selectAll() {
  const sp = state.sprite;
  if (state.transform) applyMove();
  setSelection(new Uint8Array(sp.width * sp.height).fill(1));
}
export function deselect() {
  if (state.transform) { applyMove(); return; }
  setSelection(null);
}
export function invertSelection() {
  const sp = state.sprite;
  setSelection(state.selection ? invertMask(state.selection.mask) : new Uint8Array(sp.width * sp.height).fill(1));
}

// Paint (or clear) every selected pixel of the active layer as one undo step
function paintSelected(fn, { erase = false, color } = {}) {
  const sel = state.selection;
  if (!sel || !drawable()) return;
  const cel = state.cel;
  const s = new Stroke(cel, { color: color || state.settings.primary, opacity: 100, watercolor: false, erase, mask: sel.mask }, (a, b, c, d) => view.invalidate(a, b, c, d));
  const { x, y, w, h } = sel.bounds;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (fn(i, j)) s.plot(i, j);
  const p = s.finish({ layerId: state.layerId, frameId: state.frameId });
  if (p) commit(p);
}

export function clearSelected() {
  if (state.transform) { discardMove(); return; }
  paintSelected(() => true, { erase: true });
}
export const fillSelected = () => paintSelected(() => true);

// The selection's edge pixels (those touching something unselected)
export function outlineSelected() {
  const sel = state.selection, sp = state.sprite;
  if (!sel) return;
  const W = sp.width, H = sp.height, m = sel.mask;
  const inSel = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x];
  paintSelected((x, y) => inSel(x, y) && (!inSel(x - 1, y) || !inSel(x + 1, y) || !inSel(x, y - 1) || !inSel(x, y + 1)));
}
