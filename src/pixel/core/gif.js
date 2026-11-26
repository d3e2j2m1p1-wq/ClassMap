// ═══════════════════════════════════════════════
//  Animated GIF writer (GIF89a). Pixel art usually has few colours, so the palette is exact
//  when there are 255 or fewer; otherwise colours are reduced with median cut.
//  Pixels under half opacity become transparent (GIF has no partial transparency).
// ═══════════════════════════════════════════════

// frames: [{ pixels: RGBA (w*h*4), delayMs }]
export function encodeGIF(frames, w, h, { loop = 0 } = {}) {
  const { palette, index } = buildPalette(frames);
  const transparent = palette.length;                 // the extra slot after the colours
  const size = Math.max(2, Math.ceil(Math.log2(palette.length + 1)));
  const tableLen = 1 << size;
  const out = new ByteOut();
  out.str('GIF89a');
  out.u16(w); out.u16(h);
  out.u8(0x80 | 0x70 | (size - 1)); out.u8(0); out.u8(0);
  for (let i = 0; i < tableLen; i++) { const c = palette[i] || [0, 0, 0]; out.u8(c[0]); out.u8(c[1]); out.u8(c[2]); }
  // loop forever (0) or N times
  out.u8(0x21); out.u8(0xFF); out.u8(11); out.str('NETSCAPE2.0'); out.u8(3); out.u8(1); out.u16(loop); out.u8(0);
  for (const f of frames) {
    out.u8(0x21); out.u8(0xF9); out.u8(4);
    out.u8((2 << 2) | 1);                              // restore to background, transparent colour in use
    out.u16(Math.max(2, Math.round(f.delayMs / 10))); out.u8(transparent); out.u8(0);
    out.u8(0x2C); out.u16(0); out.u16(0); out.u16(w); out.u16(h); out.u8(0);
    const px = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      px[i] = f.pixels[o + 3] < 128 ? transparent : index(f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]);
    }
    const minCode = Math.max(2, size);
    out.u8(minCode);
    const data = lzw(px, minCode);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); out.u8(n); out.bytes(data.subarray(i, i + n)); }
    out.u8(0);
  }
  out.u8(0x3B);
  return out.done();
}

class ByteOut {
  constructor() { this.a = new Uint8Array(1 << 16); this.n = 0; }
  grow(k) { if (this.n + k > this.a.length) { const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } }
  u8(v) { this.grow(1); this.a[this.n++] = v & 255; }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  str(s) { for (const ch of s) this.u8(ch.charCodeAt(0)); }
  bytes(b) { this.grow(b.length); this.a.set(b, this.n); this.n += b.length; }
  done() { return this.a.slice(0, this.n); }
}

// Colours used across all frames → a palette of at most 255 (one slot is kept for transparency)
function buildPalette(frames) {
  const counts = new Map();
  for (const f of frames) for (let i = 0; i < f.pixels.length; i += 4) {
    if (f.pixels[i + 3] < 128) continue;
    const k = (f.pixels[i] << 16) | (f.pixels[i + 1] << 8) | f.pixels[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let palette = [...counts.keys()].map(k => [k >> 16, (k >> 8) & 255, k & 255]);
  if (!palette.length) palette = [[0, 0, 0]];
  if (palette.length > 255) palette = medianCut([...counts.entries()], 255);
  const exact = new Map(palette.map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i]));
  const memo = new Map();
  const index = (r, g, b) => {
    const k = (r << 16) | (g << 8) | b;
    let i = exact.get(k) ?? memo.get(k);
    if (i != null) return i;
    let best = 0, bd = Infinity;
    palette.forEach((c, j) => { const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = j; } });
    memo.set(k, best);
    return best;
  };
  return { palette, index };
}

// Split the colour box with the widest channel in two, again and again, then average each box
export function medianCut(entries, n) {
  let boxes = [entries.map(([k, c]) => [k >> 16, (k >> 8) & 255, k & 255, c])];
  while (boxes.length < n) {
    let bi = -1, bc = 0, br = -1;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) { let lo = 255, hi = 0; for (const p of b) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; } if (hi - lo > br) { br = hi - lo; bi = i; bc = ch; } }
    });
    if (bi < 0 || br <= 0) break;
    const b = boxes[bi].sort((p, q) => p[bc] - q[bc]);
    const total = b.reduce((a, p) => a + p[3], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i][3]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map(b => { const t = b.reduce((a, p) => a + p[3], 0); return [0, 1, 2].map(ch => Math.round(b.reduce((a, p) => a + p[ch] * p[3], 0) / t)); });
}

// GIF's variable-length LZW
function lzw(px, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = [];
  let cur = 0, bits = 0;
  const emit = (code, size) => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map();
  emit(clear, size);
  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i], key = prefix * 4096 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      emit(clear, size);
      dict = new Map(); size = minCode + 1; next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix, size);
  emit(eoi, size);
  if (bits > 0) out.push(cur & 255);
  return Uint8Array.from(out);
}

// A small GIF reader (for tests, and to bring GIFs in later): frames as full RGBA images
export function decodeGIF(bytes) {
  let p = 6;
  const u8 = () => bytes[p++], u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const w = u16(), h = u16(), flags = u8(); u8(); u8();
  let gct = [];
  if (flags & 0x80) { const n = 2 << (flags & 7); for (let i = 0; i < n; i++) gct.push([u8(), u8(), u8()]); }
  const frames = [];
  let delay = 0, trans = -1, loop = null;
  const canvas = new Uint8ClampedArray(w * h * 4);
  for (;;) {
    const b = u8();
    if (b === 0x3B || b === undefined) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xF9) { u8(); const f = u8(); delay = u16() * 10; const t = u8(); trans = f & 1 ? t : -1; u8(); continue; }
      if (label === 0xFF) { const n = u8(); const id = String.fromCharCode(...bytes.subarray(p, p + n)); p += n; if (id === 'NETSCAPE2.0') { u8(); u8(); loop = u16(); u8(); continue; } }
      for (let n = u8(); n; n = u8()) p += n;
      continue;
    }
    if (b === 0x2C) {
      const x = u16(), y = u16(), fw = u16(), fh = u16(), f = u8();
      let table = gct;
      if (f & 0x80) { table = []; const n = 2 << (f & 7); for (let i = 0; i < n; i++) table.push([u8(), u8(), u8()]); }
      const minCode = u8(), data = [];
      for (let n = u8(); n; n = u8()) { data.push(...bytes.subarray(p, p + n)); p += n; }
      const idx = unlzw(Uint8Array.from(data), minCode, fw * fh);
      const img = canvas.slice();
      for (let i = 0; i < idx.length; i++) {
        if (idx[i] === trans) continue;
        const o = ((y + ((i / fw) | 0)) * w + x + (i % fw)) * 4, c = table[idx[i]] || [0, 0, 0];
        img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
      }
      frames.push({ pixels: img, delayMs: delay });
    }
  }
  return { width: w, height: h, frames, loop };
}

function unlzw(data, minCode, count) {
  const clear = 1 << minCode, eoi = clear + 1, out = new Uint8Array(count);
  let size = minCode + 1, next = eoi + 1, prev = null, n = 0, bit = 0;
  let dict = [];
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; size = minCode + 1; next = eoi + 1; prev = null; };
  reset();
  while (n < count) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (bit > data.length * 8) break;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry = dict[code] || (prev && code === next ? [...prev, prev[0]] : null);
    if (!entry) break;
    for (const v of entry) if (n < count) out[n++] = v;
    if (prev && next < 4096) { dict[next++] = [...prev, entry[0]]; if (next === (1 << size) && size < 12) size++; }
    prev = entry;
  }
  return out;
}
