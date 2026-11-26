// ═══════════════════════════════════════════════
//  Your custom brushes and objects (stamps), kept on this device and shared by every artwork.
//  Each item is small RGBA pixels (stored as base64 in localStorage under pixel:brushes /
//  pixel:objects). Objects can be sorted into named collections.
// ═══════════════════════════════════════════════
import { state } from './state.js';
import { bytesToBase64, base64ToBytes } from '../core/format.js';
import { contentBounds, uid } from '../core/sprite.js';
import { lift } from '../core/transform.js';
import { trim } from '../core/text.js';

export const MAX_ITEM = 128;          // biggest side of a brush or object
const KEYS = { brushes: 'pixel:brushes', objects: 'pixel:objects' };

export function list(kind) {
  try { return JSON.parse(localStorage.getItem(KEYS[kind])) || []; } catch { return []; }
}
function write(kind, items) {
  try { localStorage.setItem(KEYS[kind], JSON.stringify(items)); return true; } catch { return false; }
}

// Save a block ({ w, h, pixels }); returns the new item, or null if it didn't fit in storage
export function add(kind, block, name, collection = '') {
  const b = trim(block);
  const item = { id: uid(), name: name || 'Untitled', collection, w: b.w, h: b.h, data: bytesToBase64(new Uint8Array(b.pixels.buffer, b.pixels.byteOffset, b.pixels.length)), at: Date.now() };
  const items = list(kind);
  items.push(item);
  return write(kind, items) ? item : null;
}
export function remove(kind, id) { write(kind, list(kind).filter(i => i.id !== id)); }
export function rename(kind, id, patch) { write(kind, list(kind).map(i => (i.id === id ? { ...i, ...patch } : i))); }
export const decode = item => item && { w: item.w, h: item.h, pixels: new Uint8ClampedArray(base64ToBytes(item.data).buffer) };
export const find = (kind, id) => list(kind).find(i => i.id === id) || null;

// A small picture of an item, as a data URL (for the pickers)
export function thumb(item, size = 40) {
  const b = decode(item), k = Math.max(1, Math.floor(size / Math.max(b.w, b.h)));
  const c = document.createElement('canvas'); c.width = b.w; c.height = b.h;
  c.getContext('2d').putImageData(new ImageData(b.pixels, b.w, b.h), 0, 0);
  const o = document.createElement('canvas'); o.width = b.w * k; o.height = b.h * k;
  const g = o.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, o.width, o.height);
  return o.toDataURL();
}

// What's selected on the current layer (or the whole layer's art), as a block; null if empty / too big
export function blockFromCanvas() {
  const sp = state.sprite, cel = state.cel;
  if (!sp || !cel) return { error: 'Pick a layer with pixels first' };
  const sel = state.selection;
  const rect = sel ? sel.bounds : contentBounds(cel.pixels, sp.width, sp.height);
  if (!rect) return { error: 'Nothing drawn on this layer yet' };
  const b = trim({ w: rect.w, h: rect.h, pixels: lift(cel.pixels, sp.width, rect, sel?.mask || null) });
  if (b.w === 1 && b.h === 1 && !b.pixels[3]) return { error: 'Nothing drawn there' };
  if (b.w > MAX_ITEM || b.h > MAX_ITEM) return { error: `Select something up to ${MAX_ITEM} × ${MAX_ITEM} pixels` };
  return b;
}

// An image file → block (shrunk to fit MAX_ITEM, crisp)
export async function blockFromFile(file, max = MAX_ITEM) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(bmp, 0, 0, w, h);
  return trim({ w, h, pixels: g.getImageData(0, 0, w, h).data });
}
