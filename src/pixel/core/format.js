// ═══════════════════════════════════════════════
//  Saving artwork. A project is JSON (pixels as base64, cels trimmed to their content),
//  gzip-compressed with the browser's own CompressionStream. A backup file is the same thing
//  holding every project plus settings. Each file carries a version number; fields an older
//  version doesn't know are ignored, so newer files still open.
// ═══════════════════════════════════════════════
import { hexToRgba, rgbaToHex } from './color.js';
import { contentBounds } from './sprite.js';
import { readRect, writeRect } from './history.js';

export const FORMAT_VERSION = 1;
export const BACKUP_KIND = 'classmap-pixel-backup';

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}
export const gzip = bytes => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = bytes => pipe(bytes, new DecompressionStream('gzip'));

// In-memory sprite → plain object that JSON can hold
export function spriteToJSON(sp) {
  return {
    v: FORMAT_VERSION,
    id: sp.id, name: sp.name, width: sp.width, height: sp.height, colorMode: sp.colorMode,
    palette: sp.palette.map(c => rgbaToHex(c)),
    layers: sp.layers, frames: sp.frames, tags: sp.tags, tilesets: [], grid: sp.grid,
    references: (sp.references || []).map(({ id, name, src, x, y, w, h, zoom, px, py, opacity, min, hidden }) => ({ id, name, src, x, y, w, h, zoom, px, py, opacity, min, hidden })),
    cels: sp.cels.map(c => {
      const b = contentBounds(c.pixels, c.w, c.h);
      const base = { layerId: c.layerId, frameId: c.frameId };
      if (!b) return { ...base, x: c.x, y: c.y, w: 0, h: 0, pixels: '' };
      return { ...base, x: c.x + b.x, y: c.y + b.y, w: b.w, h: b.h, pixels: bytesToBase64(new Uint8Array(readRect(c.pixels, c.w, b.x, b.y, b.w, b.h).buffer)) };
    }),
    createdAt: sp.createdAt, updatedAt: sp.updatedAt,
  };
}

// …and back. Cels are expanded to the full canvas again (simplest for drawing).
export function spriteFromJSON(o) {
  if (!o || typeof o !== 'object' || !o.width || !o.height || !Array.isArray(o.cels)) throw new Error('This file is not ClassMap Pixel artwork.');
  const W = o.width, H = o.height;
  return {
    id: o.id, name: o.name || 'Untitled', width: W, height: H, colorMode: o.colorMode || 'rgba',
    palette: (o.palette || []).map(hexToRgba).filter(Boolean),
    layers: o.layers, frames: o.frames, tags: o.tags || [], tilesets: [], references: Array.isArray(o.references) ? o.references : [],
    grid: o.grid || { w: 16, h: 16, offsetX: 0, offsetY: 0 },
    cels: o.cels.map(c => {
      const pixels = new Uint8ClampedArray(W * H * 4);
      if (c.w && c.h && c.pixels) writeRect(pixels, W, c.x, c.y, c.w, c.h, new Uint8ClampedArray(base64ToBytes(c.pixels).buffer));
      return { layerId: c.layerId, frameId: c.frameId, x: 0, y: 0, w: W, h: H, pixels };
    }),
    createdAt: o.createdAt || Date.now(), updatedAt: o.updatedAt || Date.now(),
  };
}

const enc = new TextEncoder(), dec = new TextDecoder();

export const encodeProject = sp => gzip(enc.encode(JSON.stringify(spriteToJSON(sp))));
export const decodeProject = async bytes => spriteFromJSON(JSON.parse(dec.decode(await gunzip(bytes))));

// Backup: every project (already as JSON objects) + settings, in one file
export function encodeBackup(projects, settings = {}) {
  return gzip(enc.encode(JSON.stringify({ kind: BACKUP_KIND, v: FORMAT_VERSION, exportedAt: new Date().toISOString(), settings, projects })));
}

export async function decodeBackup(bytes) {
  let text;
  try { text = dec.decode(await gunzip(bytes)); } catch { throw new Error("This isn't a ClassMap Pixel backup file."); }
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('The backup file is damaged.'); }
  if (o?.kind !== BACKUP_KIND || !Array.isArray(o.projects)) throw new Error("This isn't a ClassMap Pixel backup file.");
  if (o.v > FORMAT_VERSION) console.warn('Backup is from a newer version; unknown parts are skipped.');
  return { settings: o.settings || {}, projects: o.projects.map(spriteFromJSON), exportedAt: o.exportedAt };
}
