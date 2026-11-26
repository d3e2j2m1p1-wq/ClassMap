// ═══════════════════════════════════════════════
//  Animated PNG (APNG): full colour and full transparency, plays in every current browser.
//  Also used for a plain PNG when there's one frame.
// ═══════════════════════════════════════════════
import { zlib } from './format.js';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes, crc = 0xFFFFFFFF) { for (let i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 255] ^ (crc >>> 8); return crc; }

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xFFFFFFFF) >>> 0);
  return out;
}
const be = (...vals) => { const out = new Uint8Array(vals.reduce((a, [, n]) => a + n, 0)), v = new DataView(out.buffer); let p = 0; for (const [x, n] of vals) { if (n === 4) v.setUint32(p, x); else if (n === 2) v.setUint16(p, x); else v.setUint8(p, x); p += n; } return out; };

// Rows, each starting with filter type 0 (none) — pixel art compresses well like this
function scanlines(px, w, h) {
  const out = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) out.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  return out;
}

// frames: [{ pixels, delayMs }]; loop: 0 = forever
export async function encodeAPNG(frames, w, h, { loop = 0 } = {}) {
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)];
  parts.push(chunk('IHDR', be([w, 4], [h, 4], [8, 1], [6, 1], [0, 1], [0, 1], [0, 1])));
  const anim = frames.length > 1;
  if (anim) parts.push(chunk('acTL', be([frames.length, 4], [loop, 4])));
  let seq = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (anim) parts.push(chunk('fcTL', be([seq++, 4], [w, 4], [h, 4], [0, 4], [0, 4], [Math.max(1, Math.round(f.delayMs)), 2], [1000, 2], [0, 1], [0, 1])));
    const data = await zlib(scanlines(f.pixels, w, h));
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const d = new Uint8Array(4 + data.length); new DataView(d.buffer).setUint32(0, seq++); d.set(data, 4); parts.push(chunk('fdAT', d)); }
  }
  parts.push(chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

// Chunk list of a PNG (for tests)
export function pngChunks(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
  for (let p = 8; p < bytes.length;) {
    const n = v.getUint32(p), type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    out.push({ type, data: bytes.subarray(p + 8, p + 8 + n), crcOk: ((crc32(bytes.subarray(p + 4, p + 8 + n)) ^ 0xFFFFFFFF) >>> 0) === v.getUint32(p + 8 + n) });
    p += 12 + n;
  }
  return out;
}
