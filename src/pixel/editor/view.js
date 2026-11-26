// ═══════════════════════════════════════════════
//  The canvas on screen: the artwork on a sheet of paper over the desk, zoomed and panned.
//  Pixels are drawn crisp (no smoothing). The layers are composed in software (so blend modes
//  look exactly like the export), but only for the rectangle that changed.
//  On top: the selection's marching ants, a move in progress with its handles, symmetry lines.
// ═══════════════════════════════════════════════
import { state, on, emit } from './state.js';
import { tipOffsets } from '../core/raster.js';
import { composeRect, composeFrame } from '../core/compose.js';
import { corners } from '../core/transform.js';
import { symCenter, symLines } from './symmetry.js';

export const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];

export class View {
  constructor(stage) {
    this.stage = stage;
    this.canvas = stage.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.zoom = 8; this.ox = 0; this.oy = 0;
    this.hover = null;             // sprite pixel under the pencil / mouse
    this.loupe = null;             // eye dropper magnifier
    this.selPreview = null;        // selection being drawn: { kind, pts }
    this.floating = null;          // a move in progress: { canvas, m, w, h }
    this.insets = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    this.sheet = document.createElement('canvas');
    this.sheetCtx = this.sheet.getContext('2d');
    this.dirty = null;
    this.queued = false;
    this.ants = 0;
    this.readTheme();
    new ResizeObserver(() => this.resize()).observe(stage);
    new MutationObserver(() => { this.readTheme(); this.request(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    for (const ev of ['color', 'tool', 'selection', 'options']) on(ev, () => this.request());
    on('selection', () => this.animateAnts());
  }

  readTheme() {
    const cs = getComputedStyle(document.body);
    const v = n => cs.getPropertyValue(n).trim();
    this.colors = { pop: v('--pop') || '#2B1D1A', line: v('--line') || '#2B1D1A', paper: v('--surface') || '#fff' };
    const light = document.body.classList.contains('light');
    this.check = light ? ['#FFFDF7', '#EEE5D3'] : ['#21545E', '#1A4750'];
    this.gridColor = light ? 'rgba(43,29,26,0.16)' : 'rgba(246,239,223,0.16)';
  }

  // A new artwork (or a different size) was opened
  setSprite() {
    const sp = state.sprite;
    if (!sp) return;
    this.sheet.width = sp.width; this.sheet.height = sp.height;
    this.comp = composeFrame(sp, state.frameId);
    this.image = new ImageData(this.comp, sp.width, sp.height);
    this.sheetCtx.putImageData(this.image, 0, 0);
    this.dirty = null;
    this.fit();
  }

  // Layers changed in a way that can touch every pixel (visibility, blend, order…)
  recompose() { const sp = state.sprite; if (sp) this.invalidate(0, 0, sp.width - 1, sp.height - 1); }

  // Part of the artwork changed (sprite pixels, inclusive)
  invalidate(x0, y0, x1, y1) {
    const d = this.dirty;
    if (!d) this.dirty = { x0, y0, x1, y1 };
    else { d.x0 = Math.min(d.x0, x0); d.y0 = Math.min(d.y0, y0); d.x1 = Math.max(d.x1, x1); d.y1 = Math.max(d.y1, y1); }
    this.request();
  }
  invalidateAll() { this.recompose(); }

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
  toScreen(x, y) { return [this.ox + x * this.zoom, this.oy + y * this.zoom]; }

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

  // Pinch ends on a whole zoom step (100 %, 200 % …) when "snap zoom" is on
  settleZoom(sx, sy) {
    if (!state.settings.snapZoom || this.zoom < 1) return;
    const z = Math.max(1, Math.round(this.zoom));
    if (z !== this.zoom) this.setZoom(z, sx, sy);
  }

  step(dir, sx, sy) {
    const z = this.zoom;
    const next = dir > 0 ? ZOOMS.find(v => v > z + 1e-6) : [...ZOOMS].reverse().find(v => v < z - 1e-6);
    if (next) this.setZoom(next, sx, sy);
  }

  pan(dx, dy) {
    const sp = state.sprite;
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

  animateAnts() {
    clearInterval(this.antsT);
    if (!state.selection && !this.floating) return;
    this.antsT = setInterval(() => { if (!document.hidden) { this.ants = (this.ants + 1) % 8; this.request(); } }, 140);
  }

  // ── drawing the screen ──
  render() {
    const sp = state.sprite, ctx = this.ctx;
    if (!sp || !this.cw || !this.comp) return;
    if (this.dirty) {
      const d = this.dirty;
      composeRect(sp, state.frameId, this.comp, d);
      const x0 = Math.max(0, d.x0), y0 = Math.max(0, d.y0);
      this.sheetCtx.putImageData(this.image, 0, 0, x0, y0, Math.min(sp.width - 1, d.x1) - x0 + 1, Math.min(sp.height - 1, d.y1) - y0 + 1);
      this.dirty = null;
    }
    const dpr = devicePixelRatio || 1, S = state.settings;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    const z = this.zoom, x = this.ox, y = this.oy, w = sp.width * z, h = sp.height * z;
    ctx.imageSmoothingEnabled = false;

    // tiled mode: the picture repeated around itself, faded, for seamless patterns
    if (S.tiled && S.tiled !== 'off') {
      ctx.globalAlpha = 0.55;
      for (const [i, j] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        if (S.tiled === 'x' && j) continue;
        if (S.tiled === 'y' && i) continue;
        ctx.drawImage(this.sheet, x + i * w, y + j * h, w, h);
      }
      ctx.globalAlpha = 1;
    }

    // the sheet's offset "paper" shadow
    ctx.fillStyle = this.colors.pop;
    ctx.fillRect(x + 5, y + 5, w, h);

    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (S.checker) {
      const s = 8, [a, b] = this.check;
      ctx.fillStyle = a; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = b;
      const c0 = Math.max(0, Math.floor(-x / s)), c1 = Math.ceil((Math.min(this.cw, x + w) - x) / s);
      const r0 = Math.max(0, Math.floor(-y / s)), r1 = Math.ceil((Math.min(this.ch, y + h) - y) / s);
      for (let r = r0; r < r1; r++) for (let c = c0 + ((r + c0) & 1); c < c1; c += 2) ctx.fillRect(x + c * s, y + r * s, s, s);
    } else { ctx.fillStyle = this.colors.paper; ctx.fillRect(x, y, w, h); }

    ctx.drawImage(this.sheet, x, y, w, h);

    // a move in progress floats above the layers
    const F = this.floating;
    if (F) {
      const m = F.m;
      ctx.setTransform(dpr * z * m[0], dpr * z * m[1], dpr * z * m[2], dpr * z * m[3], dpr * (z * m[4] + x), dpr * (z * m[5] + y));
      ctx.drawImage(F.canvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (S.grid && z >= S.gridMin) this.lines(1, 1, 0, 0, this.gridColor);
    const G = sp.grid;
    if (S.guides && G && G.w > 1 && G.h > 1) this.lines(G.w, G.h, G.offsetX || 0, G.offsetY || 0, 'rgba(14,138,158,0.55)');

    this.drawHover(ctx);
    ctx.restore();

    if (S.border !== false) {
      ctx.strokeStyle = this.colors.line; ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    }

    this.drawSymmetry(ctx);
    this.drawSelection(ctx);
    this.drawSelPreview(ctx);
    this.drawHandles(ctx);
    this.drawLoupe(ctx);
  }

  // grid lines every (sx, sy) sprite pixels
  lines(sx, sy, offX, offY, color) {
    const ctx = this.ctx, sp = state.sprite, z = this.zoom, x = this.ox, y = this.oy;
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = ((offX % sx) + sx) % sx || sx; i < sp.width; i += sx) {
      const gx = Math.round(x + i * z) + 0.5; if (gx < 0 || gx > this.cw) continue;
      ctx.moveTo(gx, Math.max(0, y)); ctx.lineTo(gx, Math.min(this.ch, y + sp.height * z));
    }
    for (let j = ((offY % sy) + sy) % sy || sy; j < sp.height; j += sy) {
      const gy = Math.round(y + j * z) + 0.5; if (gy < 0 || gy > this.ch) continue;
      ctx.moveTo(Math.max(0, x), gy); ctx.lineTo(Math.min(this.cw, x + sp.width * z), gy);
    }
    ctx.stroke();
  }

  // Where the brush will land: its footprint, lightly tinted
  drawHover(ctx) {
    const hv = this.hover, t = state.tool;
    if (!hv || this.loupe || state.settings.hoverPreview === false || !['brush', 'eraser', 'line', 'shape'].includes(t)) return;
    const o = state.opts, z = this.zoom;
    const size = t === 'shape' && o.filled ? 1 : o.size;
    const tip = tipOffsets(size, o.tip);
    const c = t === 'eraser' ? [242, 95, 107] : state.settings.primary;
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.55)`;
    for (const [dx, dy] of tip) ctx.fillRect(this.ox + (hv[0] + dx) * z, this.oy + (hv[1] + dy) * z, z, z);
    if (z >= 4 && tip.length === 1) { ctx.strokeStyle = this.colors.line; ctx.lineWidth = 1; ctx.strokeRect(this.ox + hv[0] * z + 0.5, this.oy + hv[1] * z + 0.5, z - 1, z - 1); }
  }

  // Marching ants around the selection
  drawSelection(ctx) {
    const sel = state.selection;
    if (!sel || this.floating) return;
    const z = this.zoom, x = this.ox, y = this.oy;
    ctx.save();
    ctx.globalAlpha = (state.settings.antsOpacity ?? 100) / 100;
    ctx.beginPath();
    for (const [a, b, c, d] of sel.segs) { ctx.moveTo(Math.round(x + a * z) + 0.5, Math.round(y + b * z) + 0.5); ctx.lineTo(Math.round(x + c * z) + 0.5, Math.round(y + d * z) + 0.5); }
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.setLineDash([]); ctx.stroke();
    ctx.strokeStyle = '#2B1D1A'; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -this.ants; ctx.stroke();
    ctx.restore();
  }

  // The shape of a selection still being dragged out
  drawSelPreview(ctx) {
    const P = this.selPreview;
    if (!P) return;
    const z = this.zoom, x = this.ox, y = this.oy;
    ctx.save();
    ctx.beginPath();
    if (P.kind === 'rect' || P.kind === 'ellipse') {
      const [[a, b], [c, d]] = P.pts;
      const x0 = x + Math.min(a, c) * z, y0 = y + Math.min(b, d) * z, x1 = x + (Math.max(a, c) + 1) * z, y1 = y + (Math.max(b, d) + 1) * z;
      if (P.kind === 'rect') ctx.rect(x0, y0, x1 - x0, y1 - y0);
      else ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, Math.PI * 2);
    } else {
      P.pts.forEach(([a, b], i) => ctx[i ? 'lineTo' : 'moveTo'](x + (a + 0.5) * z, y + (b + 0.5) * z));
      if (P.hover) ctx.lineTo(x + (P.hover[0] + 0.5) * z, y + (P.hover[1] + 0.5) * z);
      if (P.kind === 'lasso') ctx.closePath();
    }
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.strokeStyle = '#2B1D1A'; ctx.setLineDash([4, 4]); ctx.stroke();
    if (P.kind === 'polygon') {
      ctx.setLineDash([]);
      P.pts.forEach(([a, b], i) => { ctx.beginPath(); ctx.arc(x + (a + 0.5) * z, y + (b + 0.5) * z, i ? 3 : 5, 0, Math.PI * 2); ctx.fillStyle = i ? '#fff' : '#F25F6B'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#2B1D1A'; ctx.stroke(); });
    }
    ctx.restore();
  }

  // Handles around a move in progress (screen positions are also used for hit-testing)
  handles() {
    const F = this.floating;
    if (!F) return null;
    const pts = corners(F.m, F.w, F.h).map(([a, b]) => this.toScreen(a, b));
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const edges = [mid(pts[0], pts[1]), mid(pts[1], pts[2]), mid(pts[2], pts[3]), mid(pts[3], pts[0])];
    const c = mid(pts[0], pts[2]);
    const top = edges[0], len = Math.hypot(top[0] - c[0], top[1] - c[1]) || 1;
    const rot = [top[0] + (top[0] - c[0]) / len * 30, top[1] + (top[1] - c[1]) / len * 30];
    return { corners: pts, edges, center: c, rot };
  }
  drawHandles(ctx) {
    const H = this.handles();
    if (!H) return;
    ctx.save();
    ctx.beginPath(); H.corners.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](...p)); ctx.closePath();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.setLineDash([5, 4]); ctx.lineDashOffset = -this.ants; ctx.strokeStyle = '#2B1D1A'; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(...H.edges[0]); ctx.lineTo(...H.rot); ctx.strokeStyle = this.colors.line; ctx.lineWidth = 1.5; ctx.stroke();
    const sq = (p, s) => { ctx.fillStyle = '#FFF8EC'; ctx.strokeStyle = '#2B1D1A'; ctx.lineWidth = 2; ctx.fillRect(p[0] - s, p[1] - s, s * 2, s * 2); ctx.strokeRect(p[0] - s, p[1] - s, s * 2, s * 2); };
    H.corners.forEach(p => sq(p, 5.5));
    H.edges.forEach(p => sq(p, 4));
    ctx.beginPath(); ctx.arc(...H.rot, 7, 0, Math.PI * 2); ctx.fillStyle = '#F25F6B'; ctx.fill(); ctx.strokeStyle = '#2B1D1A'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  // Symmetry lines and the centre handle (drag it to move the centre)
  symHandle() {
    const S = state.settings.symmetry, sp = state.sprite;
    if (!S.on || state.settings.features?.symmetry === false || !sp) return null;
    const [cx, cy] = symCenter(S, sp.width, sp.height);
    return this.toScreen(cx, cy);
  }
  drawSymmetry(ctx) {
    const c = this.symHandle();
    if (!c) return;
    const { angles, rays } = symLines(state.settings.symmetry);
    const sp = state.sprite, R = Math.hypot(sp.width, sp.height) * this.zoom;
    ctx.save();
    ctx.beginPath(); ctx.rect(this.ox, this.oy, sp.width * this.zoom, sp.height * this.zoom); ctx.clip();
    ctx.beginPath();
    for (const a of angles) {
      const dx = Math.cos(a) * R, dy = Math.sin(a) * R;
      ctx.moveTo(rays ? c[0] : c[0] - dx, rays ? c[1] : c[1] - dy); ctx.lineTo(c[0] + dx, c[1] + dy);
    }
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#D93F4C'; ctx.setLineDash([6, 5]); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.arc(c[0], c[1], 7, 0, Math.PI * 2); ctx.fillStyle = '#F25F6B'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#2B1D1A'; ctx.stroke();
  }

  // Eye dropper magnifier: 9×9 pixels around the pointer, the picked one outlined
  drawLoupe(ctx) {
    const L = this.loupe, sp = state.sprite;
    if (!L || !sp || !this.comp) return;
    const src = this.comp, W = sp.width;
    const R = 46, n = 9, cell = (R * 2) / n;
    const cx = Math.min(this.cw - R - 8, Math.max(R + 8, L.sx - 64)), cy = Math.max(R + 8, L.sy - 70);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = this.check[0]; ctx.fill();
    ctx.clip();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const px = L.px + i - 4, py = L.py + j - 4;
      if (px < 0 || py < 0 || px >= W || py >= sp.height) continue;
      const o = (py * W + px) * 4, a = src[o + 3];
      if (!a) continue;
      ctx.fillStyle = `rgba(${src[o]},${src[o + 1]},${src[o + 2]},${a / 255})`;
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
