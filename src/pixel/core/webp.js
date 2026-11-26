// ═══════════════════════════════════════════════
//  Animated WebP: each frame is encoded by the browser (lossless where it can), then the
//  frames are wrapped in WebP's animation container (VP8X + ANIM + ANMF).
//  Only offered where the browser can encode WebP (Chrome, Edge, Firefox, not Safari).
// ═══════════════════════════════════════════════

export const canEncodeWebP = () => {
  try { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; }
};

const fourcc = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
const u24 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
const u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

// The image chunks of a still WebP (ALPH + VP8, or VP8L), without its container
export function imageChunks(webp) {
  const out = [];
  for (let p = 12; p + 8 <= webp.length;) {
    const id = fourcc(webp, p), n = webp[p + 4] | (webp[p + 5] << 8) | (webp[p + 6] << 16) | (webp[p + 7] << 24);
    const total = 8 + n + (n & 1);
    if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') out.push(webp.subarray(p, p + total));
    p += total;
  }
  return out;
}

function riffChunk(id, body) {
  const out = new Uint8Array(8 + body.length + (body.length & 1));
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  out.set(u32(body.length), 4); out.set(body, 8);
  return out;
}
const cat = parts => { const o = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let q = 0; for (const p of parts) { o.set(p, q); q += p.length; } return o; };

// stills: [{ webp: Uint8Array, delayMs }]
export function muxWebP(stills, w, h, { loop = 0 } = {}) {
  const vp8x = riffChunk('VP8X', Uint8Array.from([0x10 | 0x02, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]));
  const anim = riffChunk('ANIM', Uint8Array.from([0, 0, 0, 0, loop & 255, (loop >> 8) & 255]));
  const frames = stills.map(s => riffChunk('ANMF', cat([Uint8Array.from([...u24(0), ...u24(0), ...u24(w - 1), ...u24(h - 1), ...u24(Math.max(1, Math.round(s.delayMs))), 0b10]), ...imageChunks(s.webp)])));
  const body = cat([Uint8Array.from([87, 69, 66, 80]), vp8x, anim, ...frames]);
  return cat([Uint8Array.from([82, 73, 70, 70, ...u32(body.length)]), body]);
}

// Encode RGBA frames with the browser, then mux
export async function encodeWebP(frames, w, h, opts) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const stills = [];
  for (const f of frames) {
    g.clearRect(0, 0, w, h);
    g.putImageData(new ImageData(new Uint8ClampedArray(f.pixels), w, h), 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 1));
    stills.push({ webp: new Uint8Array(await blob.arrayBuffer()), delayMs: f.delayMs });
  }
  return muxWebP(stills, w, h, opts);
}
