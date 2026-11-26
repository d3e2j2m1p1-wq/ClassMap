// ═══════════════════════════════════════════════
//  The canvas on screen: the artwork on a sheet of paper over the desk, zoomed and panned.
//  Pixels are drawn crisp (no smoothing); only the rectangle a stroke touched is re-uploaded.
// ═══════════════════════════════════════════════
import { state, on, emit } from './state.js';
import { tipOffsets } from '../core/raster.js';

export const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];

export class View {
  constructor(stage) {
    this.stage = stage;
    this.canvas = stage.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.zoom = 8; this.ox = 0; this.oy = 0;
    this.hover = null;             // sprite pixel under the pencil / mouse
    this.loupe = null;             // eye dropper magnifier
    this.insets = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    this.sheet = document.createElement('canvas');
    this.sheetCtx = this.sheet.getContext('2d');
    this.dirty = null;
    this.queued = false;
    this.readTheme();
    new ResizeObserver(() => this.resize()).observe(stage);
    new MutationObserver(() => { this.readTheme(); this.request(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    on('color', () => this.request());
    on('tool', () => this.request());
  }

  readTheme() {
    const cs = getComputedStyle(document.body);
    const v = n => cs.getPropertyValue(n).trim();
    this.colors = { pop: v('--pop') || '#2B1D1A', line: v('--line') || '#2B1D1A', paper: v('--surface') || '#fff' };
    const light = document.body.classList.contains('light');
    this.check = light ? ['#FFFDF7', '#EEE5D3'] : ['#21545E', '#1A4750'];
    this.gridColor = light ? 'rgba(43,29,26,0.16)' : 'rgba(246,239,223,0.16)';
  }

  // A new artwork (or a different cel) was opened
  setSprite() {
    const cel = state.cel;
    if (!cel) return;
    this.sheet.width = cel.w; this.sheet.height = cel.h;
    this.image = new ImageData(cel.pixels, cel.w, cel.h);   // shares the cel's pixels: no copying
    this.sheetCtx.putImageData(this.image, 0, 0);
    this.dirty = null;
    this.fit();
  }

  // Part of the artwork changed (sprite pixels, inclusive)
  invalidate(x0, y0, x1, y1) {
    const d = this.dirty;
    if (!d) this.dirty = { x0, y0, x1, y1 };
    else { d.x0 = Math.min(d.x0, x0); d.y0 = Math.min(d.y0, y0); d.x1 = Math.max(d.x1, x1); d.y1 = Math.max(d.y1, y1); }
    this.request();
  }
  invalidateAll() { const c = state.cel; if (c) this.invalidate(0, 0, c.w - 1, c.h - 1); }

  resize() {
    const r = this.stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const first = !this.cw;
    this.cw = r.width; this.ch = r.height;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
    if (first && state.sprite) this.fit();
    this.request();
  }

  // ── where things are ──
  toSprite(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return [(clientX - r.left - this.ox) / this.zoom, (clientY - r.top - this.oy) / this.zoom];
  }
  local(clientX, clientY) { const r = this.canvas.getBoundingClientRect(); return [clientX - r.left, clientY - r.top]; }

  // ── zoom and pan ──
  fit() {
    const sp = state.sprite;
    if (!sp || !this.cw) return;
    const ins = state.noUI ? { left: 0, right: 0, top: 0, bottom: 0 } : this.insets();
    const aw = Math.max(80, this.cw - ins.left - ins.right - 48), ah = Math.max(80, this.ch - ins.top - ins.bottom - 48);
    let z = Math.min(aw / sp.width, ah / sp.height);
    z = z >= 1 ? Math.min(64, Math.floor(z)) : z;
    this.zoom = z;
    this.ox = Math.round(ins.left + (this.cw - ins.left - ins.right - sp.width * z) / 2);
    this.oy = Math.round(ins.top + (this.ch - ins.top - ins.bottom - sp.height * z) / 2);
    this.changed();
  }

  setZoom(z, sx = this.cw / 2, sy = this.ch / 2) {
    const sp = state.sprite;
    const minZ = Math.min(1, 24 / Math.max(sp.width, sp.height)), maxZ = 128;
    z = Math.max(minZ, Math.min(maxZ, z));
    const k = z / this.zoom;
    this.ox = Math.round(sx - (sx - this.ox) * k);
    this.oy = Math.round(sy - (sy - this.oy) * k);
    this.zoom = z;
    this.changed();
  }

  step(dir, sx, sy) {
    const z = this.zoom;
    const next = dir > 0 ? ZOOMS.find(v => v > z + 1e-6) : [...ZOOMS].reverse().find(v => v < z - 1e-6);
    if (next) this.setZoom(next, sx, sy);
  }

  pan(dx, dy) {
    const sp = state.sprite;
    // keep at least a corner of the artwork on screen
    const w = sp.width * this.zoom, h = sp.height * this.zoom, m = 40;
    this.ox = Math.max(m - w, Math.min(this.cw - m, this.ox + dx));
    this.oy = Math.max(m - h, Math.min(this.ch - m, this.oy + dy));
    this.changed();
  }

  changed() { this.request(); emit('view'); }

  request() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.render(); });
  }

  // ── drawing the screen ──
  render() {
    const sp = state.sprite, ctx = this.ctx;
    if (!sp || !this.cw) return;
    if (this.dirty) {
      const d = this.dirty;
      this.sheetCtx.putImageData(this.image, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
      this.dirty = null;
    }
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    const z = this.zoom, x = this.ox, y = this.oy, w = sp.width * z, h = sp.height * z;

    // the sheet's offset "paper" shadow
    ctx.fillStyle = this.colors.pop;
    ctx.fillRect(x + 5, y + 5, w, h);

    // transparency: a soft checkerboard anchored to the sheet
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (state.settings.checker) {
      const s = 8, [a, b] = this.check;
      ctx.fillStyle = a; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = b;
      const c0 = Math.max(0, Math.floor(-x / s)), c1 = Math.ceil((Math.min(this.cw, x + w) - x) / s);
      const r0 = Math.max(0, Math.floor(-y / s)), r1 = Math.ceil((Math.min(this.ch, y + h) - y) / s);
      for (let r = r0; r < r1; r++) for (let c = c0 + ((r + c0) & 1); c < c1; c += 2) ctx.fillRect(x + c * s, y + r * s, s, s);
    } else { ctx.fillStyle = this.colors.paper; ctx.fillRect(x, y, w, h); }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sheet, x, y, w, h);

    // pixel grid when zoomed in
    if (state.settings.grid && z >= state.settings.gridMin) {
      ctx.strokeStyle = this.gridColor; ctx.lineWidth = 1;
      ctx.beginPath();
      const i0 = Math.max(1, Math.ceil(-x / z)), i1 = Math.min(sp.width - 1, Math.floor((this.cw - x) / z));
      for (let i = i0; i <= i1; i++) { const gx = Math.round(x + i * z) + 0.5; ctx.moveTo(gx, Math.max(0, y)); ctx.lineTo(gx, Math.min(this.ch, y + h)); }
      const j0 = Math.max(1, Math.ceil(-y / z)), j1 = Math.min(sp.height - 1, Math.floor((this.ch - y) / z));
      for (let j = j0; j <= j1; j++) { const gy = Math.round(y + j * z) + 0.5; ctx.moveTo(Math.max(0, x), gy); ctx.lineTo(Math.min(this.cw, x + w), gy); }
      ctx.stroke();
    }

    this.drawHover(ctx);
    ctx.restore();

    // the sheet's ink outline
    ctx.strokeStyle = this.colors.line; ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);

    this.drawLoupe(ctx);
  }

  // Where the brush will land: its footprint, lightly tinted
  drawHover(ctx) {
    const hv = this.hover, t = state.tool;
    if (!hv || this.loupe || !['brush', 'eraser', 'line', 'shape'].includes(t)) return;
    const o = state.opts, z = this.zoom;
    const size = t === 'shape' && o.filled ? 1 : o.size;
    const tip = tipOffsets(size, o.tip);
    const c = t === 'eraser' ? [242, 95, 107] : state.settings.primary;
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.55)`;
    for (const [dx, dy] of tip) ctx.fillRect(this.ox + (hv[0] + dx) * z, this.oy + (hv[1] + dy) * z, z, z);
    if (z >= 4) {
      ctx.strokeStyle = this.colors.line; ctx.lineWidth = 1;
      if (tip.length === 1) ctx.strokeRect(this.ox + hv[0] * z + 0.5, this.oy + hv[1] * z + 0.5, z - 1, z - 1);
    }
  }

  // Eye dropper magnifier: 9×9 pixels around the pointer, the picked one outlined
  drawLoupe(ctx) {
    const L = this.loupe, cel = state.cel;
    if (!L || !cel) return;
    const R = 46, n = 9, cell = (R * 2) / n;
    const cx = Math.min(this.cw - R - 8, Math.max(R + 8, L.sx - 64)), cy = Math.max(R + 8, L.sy - 70);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = this.check[0]; ctx.fill();
    ctx.clip();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const px = L.px + i - 4, py = L.py + j - 4;
      if (px < 0 || py < 0 || px >= cel.w || py >= cel.h) continue;
      const o = (py * cel.w + px) * 4, a = cel.pixels[o + 3];
      if (!a) continue;
      ctx.fillStyle = `rgba(${cel.pixels[o]},${cel.pixels[o + 1]},${cel.pixels[o + 2]},${a / 255})`;
      ctx.fillRect(cx - R + i * cell, cy - R + j * cell, cell + 0.5, cell + 0.5);
    }
    ctx.restore();
    ctx.lineWidth = 2; ctx.strokeStyle = this.colors.line;
    ctx.strokeRect(cx - cell / 2, cy - cell / 2, cell, cell);
    const c = L.color || [0, 0, 0, 0];
    ctx.lineWidth = 6; ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.15, c[3] / 255)})`;
    ctx.beginPath(); ctx.arc(cx, cy, R + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = this.colors.line;
    ctx.beginPath(); ctx.arc(cx, cy, R + 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  }
}
