// ═══════════════════════════════════════════════
//  Indexed (palette) PNG: 8-bit colour indexes plus a PLTE palette and a tRNS chunk for alpha.
//  Used for PNG export when the artwork is in indexed mode, so the file keeps the palette order.
// ═══════════════════════════════════════════════
import { zlib } from './format.js';
import { chunk, be } from './apng.js';
import { toIndexes } from './colorops.js';

// Returns null when the picture holds a colour that isn't in the palette (e.g. after a
// translucent layer blended two colours) or the palette has more than 256 entries.
export async function encodeIndexedPNG(px, w, h, palette) {
  let pal = palette.map(c => [...c]);
  let ti = pal.findIndex(c => c[3] === 0);
  if (ti < 0) { ti = pal.length; pal.push([0, 0, 0, 0]); }
  if (pal.length > 256) return null;
  const idx = toIndexes(px, pal, ti);
  if (!idx) return null;
  // Only the palette entries actually needed (up to the highest index used)
  let top = 0; for (const k of idx) if (k > top) top = k;
  pal = pal.slice(0, top + 1);
  const rows = new Uint8Array(h * (w + 1));
  for (let y = 0; y < h; y++) rows.set(idx.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const plte = new Uint8Array(pal.length * 3);
  pal.forEach((c, i) => plte.set(c.slice(0, 3), i * 3));
  let lastAlpha = -1; pal.forEach((c, i) => { if (c[3] !== 255) lastAlpha = i; });
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', be([w, 4], [h, 4], [8, 1], [3, 1], [0, 1], [0, 1], [0, 1])),
    chunk('PLTE', plte),
  ];
  if (lastAlpha >= 0) parts.push(chunk('tRNS', Uint8Array.from(pal.slice(0, lastAlpha + 1).map(c => c[3]))));
  parts.push(chunk('IDAT', await zlib(rows)), chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}
