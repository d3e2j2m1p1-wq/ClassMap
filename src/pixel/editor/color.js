// ═══════════════════════════════════════════════
//  Colour in the editor: indexed mode, palette changes (all undoable), live previews for the
//  colour tools, and shading. The maths lives in core/colorops.js; this file decides which
//  pixels it applies to and records undo steps.
//
//  Indexed artwork still keeps RGBA pixels, but every pixel is one of the palette's colours
//  (or transparent). So converting back to RGBA loses nothing, editing a palette colour
//  recolours the art, and reordering the palette never changes how the art looks.
// ═══════════════════════════════════════════════
import { state, emit, saveSettings } from './state.js';
import { structural, commitSince, snapshot, mapPixels, applyStruct } from './doc.js';
import { find, leafLayers, locked } from '../core/layers.js';
import * as C from '../core/colorops.js';
import { sameColor } from '../core/color.js';
import { toast } from '../ui/dialogs.js';

let view = null;
export function initColor(v) { view = v; }

export const MAX_INDEXED = 256;
export const indexed = () => state.sprite?.colorMode === 'indexed';
const pal = () => state.sprite.palette;

// The colour a tool will actually lay down (nearest palette colour in indexed mode)
export function paintColor(c) {
  if (!indexed() || !c[3] || !pal().some(p => p[3])) return c;
  return C.nearestColor(pal(), c);
}
// Pixels coming in from outside (paste, image import) are snapped in indexed mode
export const snapIncoming = px => (indexed() && pal().some(p => p[3]) ? C.snapToPalette(px, pal()) : px);

// Unique pixel arrays of regular layers (linked cels share one)
function arrays(filter = () => true) {
  const sp = state.sprite, regular = new Set(leafLayers(sp).filter(n => n.kind !== 'reference').map(n => n.id));
  return [...new Set(sp.cels.filter(c => regular.has(c.layerId) && filter(c)).map(c => c.pixels))];
}
// Every colour the art uses
export const artColors = () => C.colorCounts(arrays());

// ── which cels a colour tool works on ──
export const SCOPES = [
  ['cel', 'This layer, this frame'],
  ['layers', 'Selected layers, all frames'],
  ['all', 'Everything'],
];
function scopeArrays(scope) {
  const sp = state.sprite;
  const ok = id => { const n = find(sp, id)?.node; return n && n.kind !== 'reference' && n.kind !== 'group' && !locked(sp, id); };
  if (scope === 'cel') return arrays(c => c.layerId === state.layerId && c.frameId === state.frameId && ok(c.layerId));
  if (scope === 'layers') return arrays(c => state.selectedLayers.has(c.layerId) && ok(c.layerId));
  return arrays(c => ok(c.layerId));
}

// A colour tool with a live preview. run(fn) recomputes from the original pixels each time,
// fn(original, width, height, mask) → new pixels. apply() makes it one undo step.
export function previewOp(scope) {
  const sp = state.sprite;
  emit('before-change');
  const before = snapshot();
  const targets = new Set(scopeArrays(scope));
  const pairs = [];
  mapPixels(px => { if (!targets.has(px)) return px; const copy = px.slice(); pairs.push([px, copy]); return copy; });
  const mask = state.selection?.mask || null;
  let changed = false;
  return {
    count: pairs.length,
    run(fn) {
      changed = false;
      for (const [o, c] of pairs) {
        let out = fn(o, sp.width, sp.height, mask);
        if (indexed()) out = C.snapToPalette(out, pal(), { mask });
        c.set(out);
        if (!changed) for (let i = 0; i < o.length; i++) if (o[i] !== out[i]) { changed = true; break; }
      }
      view.recompose();
    },
    apply(label) {
      if (changed) commitSince(before, label);
      else { sp.cels = before.cels.slice(); view.recompose(); }
      return changed;
    },
    cancel() { applyStruct(before); },
  };
}

// ── palette changes (each one undo step) ──
export function editPalette(fn, label = 'Palette') {
  structural(() => {
    const sp = state.sprite;
    sp.paletteBreaks ||= [];
    const r = fn(sp.palette, sp);
    if (r !== false && indexed()) keepIndexed();
    return r;
  }, label);
}
// Indexed art only uses palette colours: after the palette loses or changes colours, pixels
// that no longer have theirs move to the nearest one left
function keepIndexed() {
  const sp = state.sprite, all = arrays();
  if (!sp.palette.some(c => c[3]) || C.fitsPalette(all, sp.palette)) return;
  const t = new Set(all);
  mapPixels(px => (t.has(px) && !C.fitsPalette([px], sp.palette) ? C.snapToPalette(px, sp.palette) : px));
}

// Row breaks ("start a new row here") follow their colours around
export function reorderPalette(order, label = 'Reorder palette') {
  editPalette((p, sp) => {
    const old = p.slice();
    p.splice(0, p.length, ...order.map(i => old[i]));
    const brk = new Set(sp.paletteBreaks);
    sp.paletteBreaks = order.map((o, j) => (brk.has(o) ? j : -1)).filter(j => j > 0);
  }, label);
}
export function deleteColors(indexes, label = 'Delete colour') {
  const del = new Set(indexes);
  editPalette((p, sp) => {
    const keep = p.map((c, i) => i).filter(i => !del.has(i));
    const brk = new Set(sp.paletteBreaks);
    sp.paletteBreaks = keep.map((o, j) => (brk.has(o) ? j : -1)).filter(j => j > 0);
    p.splice(0, p.length, ...keep.map(i => p[i]));
  }, label);
}
export function insertColors(colors, at, label = 'Add colours') {
  if (indexed() && pal().length + colors.length > MAX_INDEXED) { toast(`Indexed palettes hold up to ${MAX_INDEXED} colours`); return false; }
  editPalette((p, sp) => {
    at = Math.max(0, Math.min(p.length, at ?? p.length));
    p.splice(at, 0, ...colors.map(c => [...c]));
    sp.paletteBreaks = sp.paletteBreaks.map(b => (b > at ? b + colors.length : b));
  }, label);
  return true;
}
// Swap the whole palette (load from the library, Lospec, a file…)
export function setPalette(colors, label = 'Load palette') {
  editPalette((p, sp) => { p.splice(0, p.length, ...colors.slice(0, indexed() ? MAX_INDEXED : Infinity).map(c => [...c])); sp.paletteBreaks = []; }, label);
}
export function toggleBreak(i) {
  editPalette((p, sp) => {
    const s = new Set(sp.paletteBreaks);
    if (s.has(i)) s.delete(i); else s.add(i);
    sp.paletteBreaks = [...s].filter(b => b > 0 && b < p.length).sort((a, b) => a - b);
  }, 'Palette row');
}

// Editing palette colour i while the picker is open. In indexed mode the art follows along.
export function beginColorEdit(i) {
  const sp = state.sprite, from = [...sp.palette[i]];
  emit('before-change');
  const before = snapshot();
  const hits = [];
  if (indexed() && from[3]) {
    const targets = new Set(arrays());
    mapPixels(px => { if (!targets.has(px)) return px; const copy = px.slice(); hits.push([copy, C.findColor(px, from)]); return copy; });
  }
  return {
    set(c) {
      sp.palette[i] = [...c];
      for (const [px, list] of hits) for (const o of list) { px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3]; }
      if (hits.length) view.recompose();
      emit('palette');
    },
    done() {
      if (sameColor(sp.palette[i], from)) { sp.cels = before.cels.slice(); return; }
      commitSince(before, 'Edit colour');
      emit('palette');
    },
  };
}

// ── colour mode ──

// RGBA → indexed. buildFromArt: make sure the palette holds the art's colours first (lossless
// when the art has 256 colours or fewer); otherwise every pixel moves to its nearest colour.
export function convertToIndexed({ buildFromArt = true, dither = false } = {}) {
  const sp = state.sprite;
  structural(() => {
    let p = sp.palette.filter(c => c[3] > 0);
    if (buildFromArt || !p.length) {
      const used = C.colorCounts(arrays()).map(c => c.color);
      const have = new Set(p.map(c => c.join()));
      const missing = used.filter(c => !have.has(c.join()));
      if (p.length + missing.length <= MAX_INDEXED) p = [...p, ...missing];
      else p = C.paletteFromArt(arrays(), MAX_INDEXED);
    }
    if (p.length > MAX_INDEXED) p = C.reducePalette(p, MAX_INDEXED);
    const keepTransparent = sp.palette.find(c => c[3] === 0);
    sp.palette = keepTransparent && p.length < MAX_INDEXED ? [...p, keepTransparent] : p;
    sp.paletteBreaks = [];
    const targets = new Set(arrays());
    mapPixels(px => (targets.has(px) ? C.snapToPalette(px, sp.palette, { dither, width: sp.width }) : px));
    sp.colorMode = 'indexed';
  }, 'Convert to indexed');
  emit('palette');
}
export function convertToRGBA() {
  structural(() => { state.sprite.colorMode = 'rgba'; }, 'Convert to RGBA');
  emit('palette');
}

// Every colour in the art → the nearest colour of `palette` (optionally making it the palette)
export function remapArt(palette, { dither = false, replace = false, scope = 'all' } = {}) {
  const sp = state.sprite;
  if (!palette.some(c => c[3])) { toast('That palette has no colours'); return; }
  const mask = state.selection?.mask || null;
  structural(() => {
    if (replace) { sp.palette = palette.map(c => [...c]); sp.paletteBreaks = []; }
    const targets = new Set(scopeArrays(scope));
    mapPixels(px => (targets.has(px) ? C.snapToPalette(px, palette, { dither, width: sp.width, mask }) : px));
  }, 'Remap colours');
}

// ── shading ──
// Settings: { on, a, b, dir } — a ramp from swatch a to swatch b; dir 1 steps towards b.
export const shading = () => state.settings.shading;
export function shadeTable() {
  const s = shading();
  if (!s?.on || !state.sprite) return null;
  const p = pal();
  if (!p[s.a] || !p[s.b] || s.a === s.b) return null;
  return C.shadeMap(p, s.a, s.b, s.dir);
}
export function setShading(patch) {
  state.settings.shading = { ...state.settings.shading, ...patch };
  saveSettings();
  emit('shading');
}
// Which end of the ramp is lighter, so the UI can say "lighten" / "darken"
export function shadeLabel() {
  const s = shading(), p = pal();
  if (!p[s.a] || !p[s.b]) return '';
  const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const towardsB = lum(p[s.b]) >= lum(p[s.a]);
  return (s.dir === 1) === towardsB ? 'Lighten' : 'Darken';
}
