// ═══════════════════════════════════════════════
//  The drawing tools. Each gets down / move / up with the pointer in sprite pixels:
//  p = { x, y (whole pixels), fx, fy (exact), pressure, shift, alt, secondary }.
// ═══════════════════════════════════════════════
import { state, emit, setColor } from './state.js';
import { Stroke } from './stroke.js';
import { linePoints, snapLine, PixelPerfect, shapePoints, shapeBox } from '../core/raster.js';
import { fillMask } from '../core/fill.js';

let view = null, commit = null;
export function initTools(v, onCommit) { view = v; commit = onCommit; }

const dirty = (x0, y0, x1, y1) => view.invalidate(x0, y0, x1, y1);
const colorFor = p => (p.secondary ? state.settings.secondary : state.settings.primary);

function newStroke(p, extra = {}) {
  const o = state.opts;
  return new Stroke(state.cel, { color: colorFor(p), opacity: o.opacity, watercolor: o.watercolor !== false, ...extra }, dirty);
}

function done(stroke) {
  const patch = stroke.finish({ layerId: state.layerId, frameId: state.frameId });
  if (patch) commit(patch);
}

// ── Brush and eraser ──
const brushLike = erase => ({
  down(p) {
    const o = state.opts;
    this.s = newStroke(p, { erase });
    this.pp = o.pixelPerfect && o.type === 'solid' && o.size === 1 && !o.pressure ? new PixelPerfect() : null;
    this.sm = [p.fx, p.fy];                 // stabilizer position
    this.last = [p.x, p.y];
    this.paint(p.x, p.y, p.pressure);
  },
  move(p) {
    const o = state.opts;
    let fx = p.fx, fy = p.fy;
    if (o.stabilizer > 0) {
      const k = 1 - Math.min(10, o.stabilizer) * 0.085;
      this.sm = [this.sm[0] + (fx - this.sm[0]) * k, this.sm[1] + (fy - this.sm[1]) * k];
      [fx, fy] = this.sm;
    }
    const x = Math.floor(fx), y = Math.floor(fy);
    if (x === this.last[0] && y === this.last[1] && o.type === 'solid') return;
    const pts = linePoints(this.last[0], this.last[1], x, y);
    for (let i = 1; i < pts.length; i++) this.paint(pts[i][0], pts[i][1], p.pressure);
    if (o.type !== 'solid' && pts.length === 1) this.paint(x, y, p.pressure);
    this.last = [x, y];
  },
  paint(x, y, pressure) {
    const o = state.opts;
    let size = o.size;
    if (o.pressure && pressure != null) size = Math.max(1, Math.round(size * (o.pressureMin / 100 + (1 - o.pressureMin / 100) * pressure)));
    if (o.type === 'spray' || o.type === 'spray-soft') {
      const r = Math.max(1, size / 2), n = Math.max(1, Math.round(r * r * 0.35 * (pressure ?? 1)));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        this.s.plot(Math.floor(x + 0.5 + Math.cos(a) * d), Math.floor(y + 0.5 + Math.sin(a) * d), o.type === 'spray-soft' ? 0.25 + Math.random() * 0.75 : 1);
      }
      return;
    }
    if (this.pp) {
      const r = this.pp.push(x, y);
      if (r.remove) this.s.unplot(r.remove[0], r.remove[1]);
      if (r.add) this.s.plot(x, y);
      return;
    }
    this.s.stamp(x, y, size, o.tip);
  },
  up() { done(this.s); this.s = null; },
  cancel() { this.s?.cancel(); this.s = null; },
});

// ── Line: press, drag, release ──
const line = {
  down(p) { this.s = newStroke(p); this.a = [p.x, p.y]; this.draw(p); },
  move(p) { this.draw(p); },
  draw(p) {
    const o = state.opts;
    let [x1, y1] = [p.x, p.y];
    if (o.perfectAngle || p.shift) [x1, y1] = snapLine(this.a[0], this.a[1], x1, y1);
    this.s.clear();
    for (const [x, y] of linePoints(this.a[0], this.a[1], x1, y1)) this.s.stamp(x, y, o.size, o.tip);
    this.end = [x1, y1];
  },
  up() { done(this.s); this.s = null; },
  cancel() { this.s?.cancel(); this.s = null; },
};

// ── Shape: rectangle, ellipse or polygon ──
const shape = {
  down(p) { this.s = newStroke(p); this.a = [p.x, p.y]; this.draw(p); },
  move(p) { this.draw(p); },
  draw(p) {
    const o = state.opts;
    const [x0, y0, x1, y1] = shapeBox(this.a[0], this.a[1], p.x, p.y, o.perfectRatio || p.shift, o.fromCenter || p.alt);
    this.s.clear();
    const pts = shapePoints(o.kind, o.kind === 'polygon' ? o.sides : -1, x0, y0, x1, y1, o.filled);
    if (o.filled || o.size <= 1) for (const [x, y] of pts) this.s.plot(x, y);
    else for (const [x, y] of pts) this.s.stamp(x, y, o.size, o.tip);
  },
  up() { done(this.s); this.s = null; },
  cancel() { this.s?.cancel(); this.s = null; },
};

// ── Colour bucket ──
const bucket = {
  down(p) {
    const cel = state.cel, o = state.opts;
    if (p.x < 0 || p.y < 0 || p.x >= cel.w || p.y >= cel.h) return;
    const mask = fillMask(cel.pixels, cel.w, cel.h, p.x, p.y, { tolerance: o.tolerance, contiguous: o.contiguous, eight: o.eight });
    const s = newStroke(p);
    for (let i = 0; i < mask.length; i++) if (mask[i]) s.plot(i % cel.w, (i / cel.w) | 0);
    done(s);
  },
  move() {}, up() {}, cancel() {},
};

// ── Eye dropper ──
export function pickAt(x, y) {
  const cel = state.cel;
  if (!cel || x < 0 || y < 0 || x >= cel.w || y >= cel.h) return null;
  const o = (y * cel.w + x) * 4;
  return [cel.pixels[o], cel.pixels[o + 1], cel.pixels[o + 2], cel.pixels[o + 3]];
}

const dropper = {
  down(p) { this.pick(p); },
  move(p) { this.pick(p); },
  pick(p) {
    const c = pickAt(p.x, p.y);
    view.loupe = { sx: p.sx, sy: p.sy, px: p.x, py: p.y, color: c };
    if (c && c[3]) setColor(p.secondary ? 'secondary' : 'primary', c);
    view.request();
  },
  up() {
    view.loupe = null; view.request();
    if (!state.tempTool && state.opts.backToTool && this.prev) { emit('back-to-tool', this.prev); }
  },
  cancel() { view.loupe = null; view.request(); },
};

export const TOOLS = { brush: brushLike(false), eraser: brushLike(true), line, shape, bucket, dropper };
