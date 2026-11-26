// ═══════════════════════════════════════════════
//  One stroke (or line, shape, fill) on the current cel.
//  It remembers the picture as it was when the stroke began, so:
//   • translucent colour is laid down once per pixel per stroke (no darker blotches where
//     the stroke crosses itself),
//   • line and shape previews can be wiped and redrawn on every move,
//   • the finished stroke becomes one undo step holding only the rectangle it touched.
//  It also keeps inside the selection, and copies each pixel through symmetry when that's on.
// ═══════════════════════════════════════════════
import { blendOver } from '../core/color.js';
import { makePatch } from '../core/history.js';
import { tipOffsets } from '../core/raster.js';

export class Stroke {
  constructor(cel, { color, opacity = 100, watercolor = true, erase = false, mask = null, sym = null, indexed = false, shade = null, custom = null, snap = null }, onDirty) {
    this.cel = cel;
    this.W = cel.w; this.H = cel.h;
    this.px = cel.pixels;
    this.base = cel.pixels.slice();
    this.mask = new Uint8Array(this.W * this.H);
    this.sel = mask;             // selection: only these pixels may change
    this.sym = sym;
    this.color = color; this.opacity = opacity / 100; this.watercolor = watercolor; this.erase = erase;
    // indexed: only whole palette colours go down (no see-through blending)
    this.indexed = indexed;
    if (indexed) { this.opacity = 1; this.watercolor = false; }
    // shading: each pixel of the ramp moves one step along it; everything else stays
    this.shade = erase ? null : shade;
    // custom brush: { w, h, pixels, own } (own = keep the brush's colours instead of tinting)
    this.custom = custom;
    this.snap = snap;                // indexed: colours that aren't the brush colour go to the palette
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
  // color (optional): lay this exact colour instead of the stroke's (custom brush / jumble / blur)
  plot(x, y, alphaMul = 1, color = null) {
    if (this.sym) { for (const [a, b] of this.sym(x, y)) this.#plot(a, b, alphaMul, color); return; }
    this.#plot(x, y, alphaMul, color);
  }
  #plot(x, y, alphaMul, color) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    if (this.mask[i] || (this.sel && !this.sel[i])) return;
    this.mask[i] = 1;
    const o = i * 4, b = this.base;
    const k = this.indexed ? 1 : this.opacity * alphaMul;
    let out;
    if (color && !this.erase && !this.shade) {
      const c = this.snap ? this.snap(color) : color;
      out = c[3] ? [c[0], c[1], c[2], this.indexed ? c[3] : Math.round(c[3] * k)] : [0, 0, 0, 0];
      if (this.watercolor && !this.indexed && out[3] < 255) out = blendOver([b[o], b[o + 1], b[o + 2], b[o + 3]], out);
    } else if (this.shade) {
      out = this.shade.get(((b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0));
      if (!out) return;                       // not in the ramp: untouched
    } else if (this.erase) {
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
    const pts = this.sym ? this.sym(x, y) : [[x, y]];
    for (const [a, b] of pts) {
      if (a < 0 || b < 0 || a >= this.W || b >= this.H) continue;
      const i = b * this.W + a;
      if (!this.mask[i]) continue;
      this.mask[i] = 0;
      this.px.set(this.base.subarray(i * 4, i * 4 + 4), i * 4);
      this.onDirty?.(a, b, a, b);
    }
  }

  stamp(x, y, size, tip, alphaMul) {
    if (tip === 'custom' && this.custom) { this.#stampCustom(x, y, alphaMul); return; }
    if (tip === 'jumble' || tip === 'blur') { this.#stampMix(x, y, Math.max(2, size), tip, alphaMul); return; }
    if (size <= 1) { this.plot(x, y, alphaMul); return; }
    for (const [dx, dy] of tipOffsets(size, tip)) this.plot(x + dx, y + dy, alphaMul);
  }

  // A custom brush, centred on (x, y): its own colours, or its shape in the stroke's colour
  #stampCustom(x, y, alphaMul = 1) {
    const B = this.custom, ox = x - Math.floor((B.w - 1) / 2), oy = y - Math.floor((B.h - 1) / 2), p = B.pixels;
    for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) {
      const o = (j * B.w + i) * 4, a = p[o + 3];
      if (!a) continue;
      if (this.erase) { this.plot(ox + i, oy + j, alphaMul * a / 255); continue; }
      const c = B.own ? [p[o], p[o + 1], p[o + 2], a] : [this.color[0], this.color[1], this.color[2], Math.round(this.color[3] * a / 255)];
      this.plot(ox + i, oy + j, alphaMul, c);
    }
  }

  // Jumble: shuffle the pixels under the tip. Blur: each pixel becomes the average of its 3 × 3.
  #stampMix(x, y, size, tip, alphaMul) {
    const pts = tipOffsets(size, 'round').map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => a >= 0 && b >= 0 && a < this.W && b < this.H);
    const at = (a, b) => { const o = (b * this.W + a) * 4; return [this.base[o], this.base[o + 1], this.base[o + 2], this.base[o + 3]]; };
    const saved = this.watercolor; this.watercolor = false;
    if (tip === 'jumble') {
      const cols = pts.map(([a, b]) => at(a, b));
      for (let i = cols.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cols[i], cols[j]] = [cols[j], cols[i]]; }
      pts.forEach(([a, b], i) => this.plot(a, b, 1, cols[i]));
    } else {
      for (const [a, b] of pts) {
        let r = 0, g = 0, bl = 0, al = 0, n = 0;
        for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) {
          const X = a + u, Y = b + v;
          if (X < 0 || Y < 0 || X >= this.W || Y >= this.H) continue;
          const c = at(X, Y);
          r += c[0] * c[3]; g += c[1] * c[3]; bl += c[2] * c[3]; al += c[3]; n++;
        }
        const c = al ? [r / al, g / al, bl / al, al / n].map(Math.round) : [0, 0, 0, 0];
        this.plot(a, b, alphaMul, c);
      }
    }
    this.watercolor = saved;
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
