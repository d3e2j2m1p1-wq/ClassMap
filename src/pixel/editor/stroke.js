// ═══════════════════════════════════════════════
//  One stroke (or line, shape, fill) on the current cel.
//  It remembers the picture as it was when the stroke began, so:
//   • translucent colour is laid down once per pixel per stroke (no darker blotches where
//     the stroke crosses itself),
//   • line and shape previews can be wiped and redrawn on every move,
//   • the finished stroke becomes one undo step holding only the rectangle it touched.
// ═══════════════════════════════════════════════
import { blendOver } from '../core/color.js';
import { makePatch } from '../core/history.js';
import { tipOffsets } from '../core/raster.js';

export class Stroke {
  constructor(cel, { color, opacity = 100, watercolor = true, erase = false }, onDirty) {
    this.cel = cel;
    this.W = cel.w; this.H = cel.h;
    this.px = cel.pixels;
    this.base = cel.pixels.slice();
    this.mask = new Uint8Array(this.W * this.H);
    this.color = color; this.opacity = opacity / 100; this.watercolor = watercolor; this.erase = erase;
    this.rect = null;            // what the stroke covers right now
    this.onDirty = onDirty;
  }

  #grow(x, y) {
    const r = this.rect;
    if (!r) this.rect = { x0: x, y0: y, x1: x, y1: y };
    else { if (x < r.x0) r.x0 = x; if (x > r.x1) r.x1 = x; if (y < r.y0) r.y0 = y; if (y > r.y1) r.y1 = y; }
    this.onDirty?.(x, y, x, y);
  }

  // Lay this stroke's colour on one pixel (once). alphaMul < 1 is used by the textured spray.
  plot(x, y, alphaMul = 1) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    if (this.mask[i]) return;
    this.mask[i] = 1;
    const o = i * 4, b = this.base;
    const k = this.opacity * alphaMul;
    let out;
    if (this.erase) {
      out = k >= 1 ? [0, 0, 0, 0] : [b[o], b[o + 1], b[o + 2], Math.round(b[o + 3] * (1 - k))];
    } else {
      const c = [this.color[0], this.color[1], this.color[2], Math.round(this.color[3] * k)];
      out = this.watercolor ? blendOver([b[o], b[o + 1], b[o + 2], b[o + 3]], c) : (c[3] ? c : [0, 0, 0, 0]);
    }
    this.px[o] = out[0]; this.px[o + 1] = out[1]; this.px[o + 2] = out[2]; this.px[o + 3] = out[3];
    this.#grow(x, y);
  }

  // Take one pixel back to how it was before the stroke (pixel-perfect corners)
  unplot(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    if (!this.mask[i]) return;
    this.mask[i] = 0;
    this.px.set(this.base.subarray(i * 4, i * 4 + 4), i * 4);
    this.onDirty?.(x, y, x, y);
  }

  stamp(x, y, size, tip, alphaMul) {
    if (size <= 1) { this.plot(x, y, alphaMul); return; }
    for (const [dx, dy] of tipOffsets(size, tip)) this.plot(x + dx, y + dy, alphaMul);
  }

  // Wipe everything this stroke drew (line/shape previews redraw from scratch on each move)
  clear() {
    const r = this.rect;
    if (!r) return;
    for (let y = r.y0; y <= r.y1; y++) {
      const a = (y * this.W + r.x0) * 4, b = (y * this.W + r.x1 + 1) * 4;
      this.px.set(this.base.subarray(a, b), a);
      this.mask.fill(0, y * this.W + r.x0, y * this.W + r.x1 + 1);
    }
    this.onDirty?.(r.x0, r.y0, r.x1, r.y1);
    this.rect = null;
  }

  cancel() { this.clear(); }

  // Done: an undo step for the touched rectangle, or null if nothing actually changed
  finish(target) {
    const r = this.rect;
    if (!r) return null;
    let changed = false;
    for (let y = r.y0; y <= r.y1 && !changed; y++) {
      for (let i = (y * this.W + r.x0) * 4, e = (y * this.W + r.x1 + 1) * 4; i < e; i++) {
        if (this.px[i] !== this.base[i]) { changed = true; break; }
      }
    }
    if (!changed) return null;
    return makePatch(target, this.base, this.px, this.W, { x: r.x0, y: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 });
  }
}
