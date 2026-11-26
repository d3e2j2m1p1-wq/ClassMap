// ═══════════════════════════════════════════════
//  Colour bucket: which pixels a fill at (x, y) reaches.
//  Returns a mask (1 = fill this pixel) the size of the sprite.
// ═══════════════════════════════════════════════
import { colorDistance } from './color.js';

// index (optional): each pixel's palette index (−1 = transparent); tolerance then counts palette steps
export function fillMask(pixels, w, h, x, y, { tolerance = 0, contiguous = true, eight = false, index = null } = {}) {
  const mask = new Uint8Array(w * h);
  if (x < 0 || y < 0 || x >= w || y >= h) return mask;
  const at = i => [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2], pixels[i * 4 + 3]];
  const target = at(y * w + x), ti = index ? index[y * w + x] : 0;
  const matches = index
    ? i => (ti < 0 || index[i] < 0 ? index[i] === ti : Math.abs(index[i] - ti) <= tolerance)
    : i => colorDistance(at(i), target) <= tolerance;

  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (matches(i)) mask[i] = 1;
    return mask;
  }

  // Scanline flood: fill a whole run, then look at the rows above and below it
  const seen = new Uint8Array(w * h);
  const stack = [x, y];
  while (stack.length) {
    const sy = stack.pop(), sx = stack.pop();
    let i = sy * w + sx;
    if (seen[i] || !matches(i)) continue;
    let l = sx, r = sx;
    while (l > 0 && !seen[sy * w + l - 1] && matches(sy * w + l - 1)) l--;
    while (r < w - 1 && !seen[sy * w + r + 1] && matches(sy * w + r + 1)) r++;
    for (let xx = l; xx <= r; xx++) { i = sy * w + xx; seen[i] = 1; mask[i] = 1; }
    // 8-way also reaches the pixels diagonally past each end of the run
    const a = eight ? Math.max(0, l - 1) : l, b = eight ? Math.min(w - 1, r + 1) : r;
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inRun = false;
      for (let xx = a; xx <= b; xx++) {
        const j = ny * w + xx;
        const ok = !seen[j] && matches(j);
        if (ok && !inRun) { stack.push(xx, ny); inRun = true; }
        else if (!ok) inRun = false;
      }
    }
  }
  return mask;
}
