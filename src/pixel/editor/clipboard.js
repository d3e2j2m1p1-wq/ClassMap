// ═══════════════════════════════════════════════
//  Copy, cut and paste. One clipboard is shared by every artwork you open here, so art moves
//  between projects with its layers intact. Each copy also puts a PNG on the system
//  clipboard (when the browser allows), so it pastes into other apps; pasting an image copied
//  in another app works too.
// ═══════════════════════════════════════════════
import { state, emit, setSelection } from './state.js';
import { lift } from '../core/transform.js';
import { composeFrame } from '../core/compose.js';
import { contentBounds } from '../core/sprite.js';
import { find, isGroup, walk, within } from '../core/layers.js';
import { makePatch } from '../core/history.js';
import { startMove, applyMove, movable } from './move.js';
import { structural, deleteLayers } from './doc.js';
import { toast } from '../ui/dialogs.js';
import { snapIncoming } from './color.js';

let view = null, commit = null;
export function initClipboard(v, c) { view = v; commit = c; }

let clip = null;           // { kind: 'pixels', block, w, h, x, y, marker } | { kind: 'layers', nodes, cels, w, h }
const MARK = 'classmap-pixel:';
export const hasClip = () => !!clip;

function region(pixels) {
  const sp = state.sprite, sel = state.selection;
  if (sel) return { rect: sel.bounds, mask: sel.mask };
  const b = contentBounds(pixels, sp.width, sp.height);
  return b ? { rect: b, mask: null } : null;
}

const toast2 = m => { if (state.settings.toasts !== false) toast(m); };

// Copy the selection (or the whole layer). merged = everything visible, not just this layer.
export async function copy({ cut = false, merged = false } = {}) {
  const sp = state.sprite;
  if (state.transform) await applyMove();
  const cel = sp.cels.find(c => c.layerId === state.layerId && c.frameId === state.frameId);
  const src = merged ? composeFrame(sp, state.frameId) : cel?.pixels;
  if (!src) { toast2('Pick a layer with pixels to copy'); return; }
  const r = region(src);
  if (!r) { toast2('Nothing to copy here'); return; }
  const block = lift(src, sp.width, r.rect, r.mask);
  const marker = MARK + Date.now();
  clip = { kind: 'pixels', block, w: r.rect.w, h: r.rect.h, x: r.rect.x, y: r.rect.y, marker };
  if (cut && !merged) {
    if (!movable(state.layerId)) { toast2('This layer is locked or hidden'); return; }
    const before = cel.pixels.slice();
    for (let y = r.rect.y; y < r.rect.y + r.rect.h; y++) for (let x = r.rect.x; x < r.rect.x + r.rect.w; x++) {
      const i = y * sp.width + x;
      if (!r.mask || r.mask[i]) cel.pixels.fill(0, i * 4, i * 4 + 4);
    }
    commit(makePatch({ layerId: state.layerId, frameId: state.frameId }, before, cel.pixels, sp.width, r.rect));
    view.invalidate(r.rect.x, r.rect.y, r.rect.x + r.rect.w - 1, r.rect.y + r.rect.h - 1);
  }
  writeSystem(block, r.rect.w, r.rect.h, marker);
  toast2(cut ? 'Cut' : merged ? 'Copied everything visible' : 'Copied');
  emit('clipboard');
}

// Best effort: a PNG (for other apps) plus a marker (so pasting back here keeps full detail)
async function writeSystem(block, w, h, marker) {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(block.slice(), w, h), 0, 0);
    const png = new Promise(res => c.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([marker], { type: 'text/plain' }) })]);
  } catch { /* the browser said no (no permission / unsupported): the internal clipboard still works */ }
}

// Where pasted pixels land: where they came from, or the middle of what's on screen
function placeAt(w, h, x, y) {
  const sp = state.sprite;
  if (state.settings.pastePosition === 'original' && x != null && x + w > 0 && y + h > 0 && x < sp.width && y < sp.height) return [x, y];
  const [cx, cy] = view.toSprite(view.canvas.getBoundingClientRect().left + view.cw / 2, view.canvas.getBoundingClientRect().top + view.ch / 2);
  return [Math.round(Math.min(Math.max(cx, 0), sp.width) - w / 2), Math.round(Math.min(Math.max(cy, 0), sp.height) - h / 2)];
}

function pasteBlock(block, w, h, x, y) {
  if (state.transform) applyMove();
  if (!movable(state.layerId)) { toast2('Pick a visible, unlocked regular layer to paste into'); return; }
  setSelection(null);
  const [px, py] = placeAt(w, h, x, y);
  block = snapIncoming(block);                    // indexed: only palette colours come in
  if (startMove({ block, w, h, x: px, y: py })) { emit('set-tool', 'move'); toast2('Pasted — drag to place it, then ✓'); }
}

export function pasteInternal() {
  if (!clip) { toast2('The clipboard is empty'); return; }
  if (clip.kind === 'layers') { pasteLayers(); return; }
  pasteBlock(clip.block.slice(), clip.w, clip.h, clip.x, clip.y);
}

// An image from another app: shrink it to fit the canvas if it's bigger
export async function pasteImage(blob) {
  try {
    const bmp = await createImageBitmap(blob), sp = state.sprite;
    let w = bmp.width, h = bmp.height;
    const k = Math.min(1, sp.width / w, sp.height / h);
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = k < 1; g.drawImage(bmp, 0, 0, w, h);
    pasteBlock(g.getImageData(0, 0, w, h).data, w, h, null, null);
    if (k < 1) toast2('The image was shrunk to fit the canvas');
  } catch { toast2("Couldn't read that image"); }
}

// Ctrl+V / ⌘V: the paste event carries what's on the system clipboard
export function onPasteEvent(e) {
  if (!state.sprite || document.getElementById('editor').hidden || e.target.closest?.('input, textarea')) return;
  const dt = e.clipboardData;
  const text = dt?.getData('text/plain') || '';
  const img = [...(dt?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile();
  e.preventDefault();
  if (clip && (text === clip.marker || (!img && !text))) pasteInternal();
  else if (img) pasteImage(img);
  else if (clip) pasteInternal();
  else toast2('Nothing to paste');
}

// The Paste button: ask the system clipboard first (may show a permission prompt)
export async function pasteButton() {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (clip && it.types.includes('text/plain')) {
          const t = await (await it.getType('text/plain')).text();
          if (t === clip.marker) { pasteInternal(); return; }
        }
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) { pasteImage(await it.getType(type)); return; }
      }
    }
  } catch { /* fall back to our own clipboard */ }
  pasteInternal();
}

// ── whole layers (from the layers panel) ──
export function copyLayers(cut = false) {
  const sp = state.sprite, ids = [...state.selectedLayers].filter(id => find(sp, id));
  const order = []; walk(sp.layers, n => { if (ids.includes(n.id)) order.push(n); });
  const top = order.filter(n => !order.some(o => o !== n && within(sp, n.id, o.id)));
  const cels = [];
  walk(top, n => { if (!isGroup(n)) { const c = sp.cels.find(c => c.layerId === n.id && c.frameId === state.frameId); if (c) cels.push({ layerId: n.id, pixels: c.pixels.slice() }); } });
  clip = { kind: 'layers', nodes: JSON.parse(JSON.stringify(top)), cels, w: sp.width, h: sp.height };
  if (cut) deleteLayers();
  toast2(cut ? 'Layer cut' : top.length > 1 ? `${top.length} layers copied` : 'Layer copied');
  emit('clipboard');
}

export function pasteLayers() {
  if (clip?.kind !== 'layers') { toast2('Copy a layer first (layer menu → Copy layers)'); return; }
  const sp = state.sprite, W = sp.width, H = sp.height, src = clip;
  structural(() => {
    // fresh ids; pixels cropped / padded to this canvas, top-left aligned
    const tmpCels = src.cels.map(c => ({ layerId: c.layerId, frameId: state.frameId, pixels: fit(c.pixels, src.w, src.h, W, H) }));
    const holder = { cels: tmpCels };
    const fresh = node => {
      if (isGroup(node)) return { ...node, id: crypto.randomUUID?.() || String(Math.random()), children: node.children.map(fresh) };
      const id = crypto.randomUUID?.() || String(Math.random());
      const c = holder.cels.find(x => x.layerId === node.id);
      for (const f of sp.frames) sp.cels.push({ layerId: id, frameId: f.id, x: 0, y: 0, w: W, h: H, pixels: f.id === state.frameId && c ? c.pixels : new Uint8ClampedArray(W * H * 4) });
      return { ...node, id };
    };
    const made = src.nodes.map(fresh);
    const f = find(sp, state.layerId);
    const list = f ? f.list : sp.layers, at = f ? f.index + 1 : list.length;
    list.splice(at, 0, ...made);
    state.layerId = made.at(-1).id; state.selectedLayers = new Set(made.map(n => n.id));
  }, 'Paste layers');
  toast2('Layers pasted');
}

function fit(px, w, h, W, H) {
  if (w === W && h === H) return px.slice();
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < Math.min(h, H); y++) out.set(px.subarray(y * w * 4, (y * w + Math.min(w, W)) * 4), y * W * 4);
  return out;
}

