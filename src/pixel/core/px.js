// ═══════════════════════════════════════════════
//  Opening .px files (Pixquare's format), written from the binary specification Pixquare
//  publishes in its documentation, for moving artwork across. Reads layers, groups, frames
//  (with durations and shared cels), the palette, tags and the colour mode. Reference
//  layers, symmetry lines, tilesets and the other extras are skipped with a note.
//  Everything is little-endian; most models start with a fixed-size header whose first field
//  is the size of what follows the header.
// ═══════════════════════════════════════════════
import { unzlib } from './format.js';
import { uid } from './sprite.js';
import { rgbaToHex } from './color.js';

const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const DIRS = ['forward', 'reverse', 'pingpong'];
const dec = new TextDecoder();

class Reader {
  constructor(bytes) { this.b = bytes; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.p = 0; }
  need(n) { if (this.p + n > this.b.length) throw new RangeError('past the end'); }
  u8() { this.need(1); return this.v.getUint8(this.p++); }
  bool() { return this.u8() !== 0; }
  u16() { this.need(2); const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  i16() { this.need(2); const x = this.v.getInt16(this.p, true); this.p += 2; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  u64() { const lo = this.u32(), hi = this.u32(); if (hi > 0x1fffff) throw new RangeError('size too big'); return hi * 2 ** 32 + lo; }
  f16() {             // IEEE half float
    const h = this.u16(), s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    if (e === 0) return s * 2 ** -14 * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * 2 ** (e - 15) * (1 + f / 1024);
  }
  bytes(n) { this.need(n); const out = this.b.subarray(this.p, this.p + n); this.p += n; return out; }
  str(n) { return dec.decode(this.bytes(n)); }
  rgba() { const [r, g, b, a] = this.bytes(4); return unpremultiply(r, g, b, a); }
  list(fn) { const n = this.u64(); if (n > 1e6) throw new RangeError('list too long'); const out = []; for (let i = 0; i < n; i++) out.push(fn()); return out; }
}
const unpremultiply = (r, g, b, a) => (a === 0 ? [0, 0, 0, 0] : a === 255 ? [r, g, b, a] : [r, g, b].map(c => Math.min(255, Math.round(c * 255 / a))).concat(a));

// A model: header of `head` bytes starting with its size (u32 or u64), then `size` bytes of content
function model(r, head, wide, readContent) {
  const start = r.p, size = wide ? r.u64() : r.u32();
  const hdr = new Reader(r.b.subarray(start, start + head));
  hdr.p = wide ? 8 : 4;
  r.p = start + head;
  const end = start + head + size;
  let out;
  try { out = readContent(r, hdr, end); } finally { r.p = Math.max(r.p, end); }
  return out;
}

export function readPx(bytes) {
  const r = new Reader(bytes), warnings = new Set();
  r.u64(); const idLen = r.u8(); r.u16();
  r.p = 64;
  r.str(idLen);
  const W = r.u32(), H = r.u32();
  if (!W || !H || W > 4096 || H > 4096) throw new Error("This doesn't look like a .px file ClassMap Pixel can read.");

  const entry = () => model(r, 16, false, (r, h) => { const type = h.u8(); const n = r.u8(); return { type, id: r.str(n) }; });
  const roots = r.list(entry);
  const frame = () => model(r, 32, false, (r, h, end) => {
    const idl = h.u8(), cl = h.u8();
    const f = { id: r.str(idl), duration: r.u32() };
    r.bool();
    f.content = r.str(cl);
    if (r.p + 2 <= end) { const o = r.f16(); if (o >= 0 && o <= 1) f.opacity = o; }
    return f;
  });
  const groups = r.list(() => model(r, 32, false, (r, h, end) => {
    const idl = h.u8(), nl = h.u8();
    const g = { id: r.str(idl), name: r.str(nl), children: r.list(entry) };
    g.opacity = r.f16(); g.visible = r.bool(); g.locked = r.bool(); r.bool(); r.bool();
    if (r.p < end) g.expanded = r.bool();
    return g;
  }));
  const layers = r.list(() => model(r, 32, false, (r, h, end) => {
    const idl = h.u8(), nl = h.u8();
    const l = { id: r.str(idl), name: r.str(nl), frames: r.list(frame) };
    l.opacity = r.f16(); l.visible = r.bool(); l.locked = r.bool(); r.bool(); r.bool();
    if (r.p + 2 <= end) l.blend = BLENDS[r.u16()] || 'normal';
    return l;
  }));
  const contents = new Map();
  for (const c of r.list(() => {
    const start = r.p, size = r.u64(), idl = r.u8(), raw = r.u32(), len = r.u32();
    r.p = start + 32;
    const id = r.str(idl), data = r.bytes(len);
    r.p = Math.max(r.p, Math.min(start + 32 + size, bytes.length));
    return { id, data, raw };
  })) contents.set(c.id, c);
  const palette = r.list(() => r.rgba());

  let tags = [], indexed = false;
  try {
    const refs = r.list(() => model(r, 32, false, () => null));
    if (refs.length) warnings.add('Reference layers were left out.');
    r.list(() => r.bytes(r.u64()));                         // their PNG data
    r.list(() => model(r, 16, false, () => null));          // symmetry lines
    tags = r.list(() => model(r, 16, false, (r, h) => {
      const idl = h.u8(), nl = h.u8();
      r.str(idl);
      const t = { name: r.str(nl), from: r.u16(), to: r.u16() };
      r.bool();
      t.color = rgbaToHex(r.rgba().slice(0, 3).concat(255), false);
      t.direction = DIRS[r.u8()] || 'forward';
      t.repeat = r.u16();
      return t;
    }));
    const sets = r.list(() => model(r, 32, false, () => null));
    const maps = r.list(() => model(r, 32, false, () => null));
    r.list(() => model(r, 32, true, () => null));
    if (sets.length || maps.length) warnings.add('Tilemap layers were left out.');
    indexed = r.u8() === 1;
  } catch { /* older or shorter files stop here: what's read so far is kept */ }

  return { W, H, roots, groups, layers, contents, palette, tags, indexed, warnings: [...warnings] };
}

// Turn what readPx found into a ClassMap Pixel sprite
export async function pxToSprite(bytes, name = 'Imported') {
  const px = await readPx(bytes);
  const { W, H, roots } = px;
  const nFrames = Math.max(1, ...px.layers.map(l => l.frames.length));
  const first = px.layers.find(l => l.frames.length === nFrames);
  const frames = Array.from({ length: nFrames }, (_, i) => ({ id: uid(), durationMs: Math.max(10, first?.frames[i]?.duration || 100) }));
  const cels = [], decoded = new Map();
  const pixelsOf = async id => {
    if (decoded.has(id)) return decoded.get(id);
    const c = px.contents.get(id);
    let out = new Uint8ClampedArray(W * H * 4);
    if (c) {
      try {
        const raw = await unzlib(c.data);
        if (raw.length >= W * H * 4) for (let i = 0; i < W * H; i++) out.set(unpremultiply(raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2], raw[i * 4 + 3]), i * 4);
        else if (raw.length >= W * H) for (let i = 0; i < W * H; i++) { const col = px.palette[raw[i]]; if (col) out.set(col, i * 4); }
      } catch { px.warnings.push('Some pixels could not be read.'); out = new Uint8ClampedArray(W * H * 4); }
    }
    decoded.set(id, out);
    return out;
  };
  const layerById = new Map(px.layers.map(l => [l.id, l])), groupById = new Map(px.groups.map(g => [g.id, g]));
  const build = async list => {
    const out = [];
    for (const e of list) {
      if (e.type === 1 && groupById.has(e.id)) {
        const g = groupById.get(e.id);
        out.push({ id: uid(), kind: 'group', name: g.name || 'Group', visible: g.visible !== false, locked: !!g.locked, opacity: Math.round((g.opacity ?? 1) * 255), blend: 'normal', collapsed: g.expanded === false, children: await build(g.children) });
      } else if (e.type === 0 && layerById.has(e.id)) {
        const l = layerById.get(e.id), id = uid();
        out.push({ id, kind: 'regular', name: l.name || 'Layer', visible: l.visible !== false, locked: !!l.locked, opacity: Math.round(Math.min(1, Math.max(0, l.opacity ?? 1)) * 255), blend: l.blend || 'normal', autoLinkOnDuplicate: false });
        for (let i = 0; i < nFrames; i++) {
          const f = l.frames[i];
          const cel = { layerId: id, frameId: frames[i].id, x: 0, y: 0, w: W, h: H, pixels: f ? await pixelsOf(f.content) : new Uint8ClampedArray(W * H * 4) };
          if (f?.opacity != null && f.opacity < 1) cel.opacity = Math.round(f.opacity * 255);
          cels.push(cel);
        }
      } else if (e.type >= 2) px.warnings.push(['', '', 'Reference', 'Tilemap', 'Magic'][e.type] + ' layers were left out.');
    }
    return out;
  };
  let layers = await build(roots);
  if (!layers.length) throw new Error('No layers found in that .px file.');
  const now = Date.now();
  return {
    sprite: {
      id: uid(), name, width: W, height: H, colorMode: px.indexed ? 'indexed' : 'rgba',
      palette: px.palette.filter(c => c[3] > 0).slice(0, 256), paletteBreaks: [], layers, frames,
      tags: px.tags.filter(t => t.from <= t.to && t.to < nFrames).map(t => ({ id: uid(), ...t })),
      tilesets: [], references: [], grid: { w: 16, h: 16, offsetX: 0, offsetY: 0 }, cels, createdAt: now, updatedAt: now,
    },
    warnings: [...new Set(px.warnings)],
  };
}
