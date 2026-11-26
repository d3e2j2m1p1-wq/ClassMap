// ═══════════════════════════════════════════════
//  .aseprite / .ase files, written from Aseprite's published format notes
//  (docs/ase-file-specs.md in the Aseprite repository). Little-endian throughout.
//  Reading: RGBA, grayscale and indexed sprites; layers and groups (with blend modes and
//  opacity), cels (compressed, raw and linked), cel opacity and user-data text, frame
//  durations, tags (with colours, direction and repeats), the palette and the grid.
//  Tilemap layers are brought in as empty layers (tilemaps arrive in a later phase).
//  Writing: an RGBA sprite with all of the above.
// ═══════════════════════════════════════════════
import { zlib, unzlib } from './format.js';
import { uid } from './sprite.js';
import { isGroup, walk } from './layers.js';
import { contentBounds } from './sprite.js';
import { rgbaToHex, hexToRgba } from './color.js';

export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'addition', 'subtract', 'divide'];
export const DIRECTIONS = ['forward', 'reverse', 'pingpong', 'pingpong-reverse'];

// ── reading ──
class Reader {
  constructor(bytes) { this.b = bytes; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.p = 0; }
  u8() { return this.b[this.p++]; }
  u16() { const v = this.v.getUint16(this.p, true); this.p += 2; return v; }
  i16() { const v = this.v.getInt16(this.p, true); this.p += 2; return v; }
  u32() { const v = this.v.getUint32(this.p, true); this.p += 4; return v; }
  bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  str() { return new TextDecoder().decode(this.bytes(this.u16())); }
  skip(n) { this.p += n; }
}

export async function readAseprite(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const r = new Reader(bytes);
  r.skip(4);
  if (r.u16() !== 0xA5E0) throw new Error("This isn't an Aseprite file.");
  const nFrames = r.u16(), W = r.u16(), H = r.u16(), depth = r.u16(), flags = r.u32(), speed = r.u16();
  r.skip(8);
  const transparentIndex = r.u8();
  r.skip(3);
  r.u16();                                   // number of colours
  r.skip(2);                                 // pixel ratio
  const gridX = r.i16(), gridY = r.i16(), gridW = r.u16(), gridH = r.u16();
  r.p = 128;
  if (![8, 16, 32].includes(depth)) throw new Error('Unsupported colour depth in this Aseprite file.');
  const layerOpacityOk = (flags & 1) !== 0, groupOpacityOk = (flags & 2) !== 0;

  const palette = [];
  const layers = [];                         // in file order (= layer index)
  const frames = [], tags = [], rawCels = [], warnings = new Set();
  let lastObj = null, tagUserData = -1;

  for (let f = 0; f < nFrames; f++) {
    const start = r.p, size = r.u32();
    if (r.u16() !== 0xF1FA) throw new Error('The Aseprite file is damaged (frame header).');
    const oldChunks = r.u16(), dur = r.u16();
    r.skip(2);
    const newChunks = r.u32();
    frames.push({ id: uid(), durationMs: dur || speed || 100 });
    const chunks = newChunks || oldChunks;
    for (let c = 0; c < chunks; c++) {
      const cs = r.p, csize = r.u32(), type = r.u16(), end = cs + csize;
      if (type === 0x2004) {                 // layer
        const lf = r.u16(), lt = r.u16(), level = r.u16();
        r.skip(4);
        const blend = r.u16(), op = r.u8();
        r.skip(3);
        const name = r.str();
        const L = { id: uid(), name, level, type: lt, visible: !!(lf & 1), locked: !(lf & 2), collapsed: !!(lf & 32), reference: !!(lf & 64), background: !!(lf & 8),
          blend: BLENDS[blend] || 'normal', opacity: (lt === 1 ? groupOpacityOk : layerOpacityOk) ? op : 255 };
        if (lt === 2) warnings.add('Tilemap layers came in empty (tilemaps arrive in a later version).');
        layers.push(L); lastObj = { kind: 'layer', L }; tagUserData = -1;
      } else if (type === 0x2005) {          // cel
        const li = r.u16(), x = r.i16(), y = r.i16(), op = r.u8(), ct = r.u16();
        r.skip(7);
        const cel = { frame: f, layer: li, x, y, opacity: op, type: ct };
        if (ct === 0 || ct === 2) {
          cel.w = r.u16(); cel.h = r.u16();
          const data = r.bytes(end - r.p);
          cel.data = ct === 2 ? await unzlib(data) : data.slice();
        } else if (ct === 1) cel.link = r.u16();
        rawCels.push(cel); lastObj = { kind: 'cel', cel }; tagUserData = -1;
      } else if (type === 0x2018) {          // tags
        const n = r.u16(); r.skip(8);
        for (let i = 0; i < n; i++) {
          const from = r.u16(), to = r.u16(), dir = r.u8(), repeat = r.u16();
          r.skip(6);
          const rgb = [r.u8(), r.u8(), r.u8()]; r.skip(1);
          tags.push({ id: uid(), name: r.str(), from, to, direction: DIRECTIONS[dir] || 'forward', repeat, color: rgbaToHex([...rgb, 255]) });
        }
        lastObj = null; tagUserData = tags.length - n;
      } else if (type === 0x2019) {          // palette
        const n = r.u32(), first = r.u32(), last = r.u32(); r.skip(8);
        palette.length = Math.max(palette.length, n);
        for (let i = first; i <= last; i++) { const fl = r.u16(); palette[i] = [r.u8(), r.u8(), r.u8(), r.u8()]; if (fl & 1) r.str(); }
      } else if ((type === 0x0004 || type === 0x0011) && !palette.length) {   // old palettes
        const packets = r.u16(); let i = 0;
        for (let k = 0; k < packets; k++) {
          i += r.u8(); let n = r.u8() || 256;
          for (; n > 0; n--, i++) { const c = [r.u8(), r.u8(), r.u8()]; palette[i] = type === 0x0011 ? [...c.map(v => Math.round(v * 255 / 63)), 255] : [...c, 255]; }
        }
      } else if (type === 0x2020) {          // user data
        const fl = r.u32();
        const text = fl & 1 ? r.str() : null;
        const color = fl & 2 ? [r.u8(), r.u8(), r.u8(), r.u8()] : null;
        if (tagUserData >= 0 && tagUserData < tags.length) { if (color) tags[tagUserData].color = rgbaToHex([...color.slice(0, 3), 255]); tagUserData++; }
        else if (lastObj?.kind === 'cel' && text) lastObj.cel.userData = text;
      }
      r.p = end;
    }
    r.p = start + size;
  }

  // the layer tree: bottom → top, children after their group (by child level)
  const roots = [], stack = [];
  const nodes = layers.map(L => {
    const base = { id: L.id, name: L.name, visible: L.visible, locked: L.locked, opacity: L.opacity, blend: L.blend };
    return L.type === 1 ? { ...base, kind: 'group', collapsed: L.collapsed, children: [] } : { ...base, kind: L.reference ? 'reference' : 'regular', autoLinkOnDuplicate: false };
  });
  layers.forEach((L, i) => {
    stack.length = L.level;
    const parent = stack[L.level - 1];
    (parent ? parent.children : roots).push(nodes[i]);
    stack[L.level] = nodes[i];
  });

  // cels → full-canvas RGBA pixels
  const toRGBA = (cel, background) => {
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
      const tx = cel.x + x, ty = cel.y + y;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const i = y * cel.w + x, o = (ty * W + tx) * 4;
      if (depth === 32) out.set(cel.data.subarray(i * 4, i * 4 + 4), o);
      else if (depth === 16) { const v = cel.data[i * 2]; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = cel.data[i * 2 + 1]; }
      else {
        const k = cel.data[i];
        if (k === transparentIndex && !background) continue;
        const c = palette[k] || [0, 0, 0, 255];
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
      }
    }
    return out;
  };
  const cels = [];
  const byKey = new Map();
  for (const c of rawCels) {
    const L = layers[c.layer], node = nodes[c.layer];
    if (!L || L.type !== 0) continue;
    if (c.type === 1) continue;
    const pixels = toRGBA(c, L.background);
    const cel = { layerId: node.id, frameId: frames[c.frame].id, x: 0, y: 0, w: W, h: H, pixels };
    if (c.opacity !== 255) cel.opacity = c.opacity;
    if (c.userData) cel.userData = c.userData;
    cels.push(cel); byKey.set(c.layer + ':' + c.frame, cel);
  }
  for (const c of rawCels) {                 // linked cels share the pixels of the frame they point at
    if (c.type !== 1) continue;
    const src = byKey.get(c.layer + ':' + c.link), node = nodes[c.layer];
    if (!src || !node) continue;
    src.link ||= uid();
    const cel = { layerId: node.id, frameId: frames[c.frame].id, x: 0, y: 0, w: W, h: H, pixels: src.pixels, link: src.link };
    if (c.opacity !== 255) cel.opacity = c.opacity;
    cels.push(cel); byKey.set(c.layer + ':' + c.frame, cel);
  }
  // every drawable layer gets a cel in every frame (empty where the file had none)
  for (const node of nodes) {
    if (node.kind === 'group') continue;
    for (const fr of frames) if (!cels.some(c => c.layerId === node.id && c.frameId === fr.id)) cels.push({ layerId: node.id, frameId: fr.id, x: 0, y: 0, w: W, h: H, pixels: new Uint8ClampedArray(W * H * 4) });
  }
  if (!nodes.some(n => n.kind !== 'group')) {
    const l = { id: uid(), kind: 'regular', name: 'Layer 1', visible: true, locked: false, opacity: 255, blend: 'normal', autoLinkOnDuplicate: false };
    roots.push(l);
    for (const fr of frames) cels.push({ layerId: l.id, frameId: fr.id, x: 0, y: 0, w: W, h: H, pixels: new Uint8ClampedArray(W * H * 4) });
  }
  const now = Date.now();
  return {
    sprite: {
      id: uid(), name: 'Imported', width: W, height: H, colorMode: 'rgba',
      palette: palette.filter(Boolean).slice(0, 256).map(c => [...c]),
      layers: roots, frames, tags: tags.map(t => ({ ...t, from: Math.min(t.from, frames.length - 1), to: Math.min(t.to, frames.length - 1) })),
      tilesets: [], references: [],
      grid: { w: gridW || 16, h: gridH || 16, offsetX: gridX || 0, offsetY: gridY || 0 },
      cels, createdAt: now, updatedAt: now,
    },
    warnings: [...warnings],
  };
}

// ── writing ──
class Writer {
  constructor() { this.parts = []; this.n = 0; }
  push(a) { this.parts.push(a); this.n += a.length; }
  u8(v) { this.push(Uint8Array.of(v & 255)); }
  u16(v) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, v, true); this.push(a); }
  i16(v) { const a = new Uint8Array(2); new DataView(a.buffer).setInt16(0, v, true); this.push(a); }
  u32(v) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v >>> 0, true); this.push(a); }
  zeros(n) { this.push(new Uint8Array(n)); }
  str(s) { const b = new TextEncoder().encode(s); this.u16(b.length); this.push(b); }
  bytes() { const out = new Uint8Array(this.n); let p = 0; for (const a of this.parts) { out.set(a, p); p += a.length; } return out; }
}
const chunk = (type, fill) => { const w = new Writer(); fill(w); const body = w.bytes(); const c = new Writer(); c.u32(body.length + 6); c.u16(type); c.push(body); return c.bytes(); };

export async function writeAseprite(sp) {
  const W = sp.width, H = sp.height;
  // layers in file order: bottom → top, each group followed by its children
  const order = [];
  const visit = (list, level) => { for (const n of list) { order.push({ n, level }); if (isGroup(n)) visit(n.children, level + 1); } };
  visit(sp.layers, 0);
  const indexOf = new Map(order.map((o, i) => [o.n.id, i]));
  const frames = [];
  for (let f = 0; f < sp.frames.length; f++) {
    const fr = sp.frames[f], chunks = [];
    if (f === 0) {
      chunks.push(chunk(0x2007, w => { w.u16(1); w.u16(0); w.u32(0); w.zeros(8); }));          // sRGB
      if (sp.palette.length) chunks.push(chunk(0x2019, w => {
        w.u32(sp.palette.length); w.u32(0); w.u32(sp.palette.length - 1); w.zeros(8);
        for (const c of sp.palette) { w.u16(0); w.u8(c[0]); w.u8(c[1]); w.u8(c[2]); w.u8(c[3]); }
      }));
      for (const { n, level } of order) chunks.push(chunk(0x2004, w => {
        const g = isGroup(n);
        w.u16((n.visible ? 1 : 0) | (n.locked ? 0 : 2) | (g && n.collapsed ? 32 : 0) | (n.kind === 'reference' ? 64 : 0));
        w.u16(g ? 1 : 0); w.u16(level); w.u16(0); w.u16(0);
        w.u16(Math.max(0, BLENDS.indexOf(n.blend || 'normal'))); w.u8(n.opacity ?? 255); w.zeros(3);
        w.str(n.name || 'Layer');
      }));
      if (sp.tags?.length) {
        chunks.push(chunk(0x2018, w => {
          w.u16(sp.tags.length); w.zeros(8);
          for (const t of sp.tags) {
            const c = hexToRgba(t.color || '#000000') || [0, 0, 0, 255];
            w.u16(t.from); w.u16(t.to); w.u8(Math.max(0, DIRECTIONS.indexOf(t.direction))); w.u16(t.repeat || 0); w.zeros(6);
            w.u8(c[0]); w.u8(c[1]); w.u8(c[2]); w.u8(0); w.str(t.name || 'Tag');
          }
        }));
        for (const t of sp.tags) {
          const c = hexToRgba(t.color || '#000000') || [0, 0, 0, 255];
          chunks.push(chunk(0x2020, w => { w.u32(2); w.u8(c[0]); w.u8(c[1]); w.u8(c[2]); w.u8(255); }));
        }
      }
    }
    for (const { n } of order) {
      if (isGroup(n)) continue;
      const cel = sp.cels.find(c => c.layerId === n.id && c.frameId === fr.id);
      if (!cel) continue;
      const li = indexOf.get(n.id), op = cel.opacity ?? 255;
      // linked to an earlier frame of the same layer?
      const firstShare = sp.frames.slice(0, f).findIndex(o => sp.cels.find(c => c.layerId === n.id && c.frameId === o.id)?.pixels === cel.pixels);
      if (firstShare >= 0 && contentBounds(cel.pixels, W, H)) {
        chunks.push(chunk(0x2005, w => { w.u16(li); w.i16(0); w.i16(0); w.u8(op); w.u16(1); w.i16(0); w.zeros(5); w.u16(firstShare); }));
        continue;
      }
      if (firstShare >= 0) continue;                // linked to an empty cel: nothing to write
      const b = contentBounds(cel.pixels, W, H);
      if (!b) continue;
      const raw = new Uint8Array(b.w * b.h * 4);
      for (let y = 0; y < b.h; y++) raw.set(cel.pixels.subarray(((b.y + y) * W + b.x) * 4, ((b.y + y) * W + b.x + b.w) * 4), y * b.w * 4);
      const data = await zlib(raw);
      chunks.push(chunk(0x2005, w => { w.u16(li); w.i16(b.x); w.i16(b.y); w.u8(op); w.u16(2); w.i16(0); w.zeros(5); w.u16(b.w); w.u16(b.h); w.push(data); }));
      if (cel.userData) chunks.push(chunk(0x2020, w => { w.u32(1); w.str(cel.userData); }));
    }
    const fw = new Writer();
    const body = chunks.reduce((a, c) => a + c.length, 0);
    fw.u32(16 + body); fw.u16(0xF1FA); fw.u16(Math.min(chunks.length, 0xFFFF)); fw.u16(fr.durationMs); fw.zeros(2); fw.u32(chunks.length);
    chunks.forEach(c => fw.push(c));
    frames.push(fw.bytes());
  }
  const h = new Writer();
  const total = 128 + frames.reduce((a, f) => a + f.length, 0);
  h.u32(total); h.u16(0xA5E0); h.u16(sp.frames.length); h.u16(W); h.u16(H); h.u16(32); h.u32(3);
  h.u16(sp.frames[0]?.durationMs || 100); h.u32(0); h.u32(0); h.u8(0); h.zeros(3);
  h.u16(sp.palette.length || 0); h.u8(1); h.u8(1);
  h.i16(sp.grid?.offsetX || 0); h.i16(sp.grid?.offsetY || 0); h.u16(sp.grid?.w || 16); h.u16(sp.grid?.h || 16);
  h.zeros(84);
  const out = new Writer();
  out.push(h.bytes()); frames.forEach(f => out.push(f));
  return out.bytes();
}

export { walk };
