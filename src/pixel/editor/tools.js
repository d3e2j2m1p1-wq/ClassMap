// ═══════════════════════════════════════════════
//  The tools. Each gets down / move / up with the pointer in sprite pixels:
//  p = { x, y (whole pixels), fx, fy (exact), sx, sy (screen), pressure, shift, alt, secondary }.
//  Drawing tools work on the active layer, stay inside the selection and follow symmetry.
// ═══════════════════════════════════════════════
import { state, emit, setColor, setSelection } from './state.js';
import { Stroke } from './stroke.js';
import { linePoints, snapLine, PixelPerfect, shapePoints, shapeBox } from '../core/raster.js';
import { fillMask } from '../core/fill.js';
import { find, shown, locked } from '../core/layers.js';
import { maskRect, maskEllipse, maskPolygon, combine } from '../core/selection.js';
import { symmetryFor } from './symmetry.js';
import { moveTool } from './move.js';
import { toast } from '../ui/dialogs.js';
import { indexed, paintColor, shadeTable } from './color.js';
import { nearestFinder } from '../core/colorops.js';
import { find as findItem, decode as decodeItem } from './library.js';

const magicSource = (sp, n) => (sp.frames.some(f => f.id === n.magic?.from) ? n.magic.from : sp.frames[0].id);

let view = null, commit = null;
export function initTools(v, onCommit) { view = v; commit = onCommit; }

const dirty = (x0, y0, x1, y1) => view.invalidate(x0, y0, x1, y1);
const colorFor = p => (p.secondary ? state.settings.secondary : state.settings.primary);

// Can the active layer be drawn on? Says why not, once per press.
export function drawable() {
  const sp = state.sprite, n = find(sp, state.layerId)?.node;
  let why = null;
  if (!n) why = 'Pick a layer first';
  else if (n.kind === 'group') why = 'Pick a layer inside the group to draw on';
  else if (n.kind === 'reference') why = 'Reference layers are for tracing. Rasterize it (layer menu) to draw on it';
  else if (n.kind === 'magic' && state.frameId !== magicSource(sp, n)) why = `This magic layer is drawn on frame ${sp.frames.findIndex(f => f.id === magicSource(sp, n)) + state.settings.numberFrom}; the other frames are made from it`;
  else if (!shown(sp, n.id)) why = 'This layer is hidden';
  else if (locked(sp, n.id)) why = 'This layer is locked';
  if (why) toast(why);
  return !why;
}

// The custom brush picked in the brush / eraser options (null if none)
function customBrush(o) {
  if (o.tip !== 'custom') return null;
  const b = decodeItem(findItem('brushes', o.customId));
  if (!b) { toast('Pick a custom brush in the tool options first'); return null; }
  return { ...b, own: !!o.brushColors };
}

function newStroke(p, extra = {}) {
  const o = state.opts, cel = state.cel;
  return new Stroke(cel, {
    color: paintColor(colorFor(p)), opacity: o.opacity, watercolor: o.watercolor !== false, mask: state.selection?.mask || null, sym: symmetryFor(cel.w, cel.h),
    indexed: indexed(), shade: shadeTable(), snap: indexed() ? c => paintColor(c) : null, ...extra,
  }, dirty);
}

function done(stroke) {
  const patch = stroke.finish({ layerId: state.layerId, frameId: state.frameId });
  if (patch) commit(patch);
}

// ── Brush and eraser ──
const brushLike = erase => ({
  down(p) {
    if (!drawable()) return;
    const o = state.opts;
    const custom = customBrush(o);
    this.s = newStroke(p, { erase, custom });
    this.tip = o.tip === 'custom' && !custom ? 'round' : o.tip;
    this.pp = o.pixelPerfect && o.type === 'solid' && o.size === 1 && !o.pressure && (o.tip === 'round' || o.tip === 'square') ? new PixelPerfect() : null;
    this.sm = [p.fx, p.fy];
    this.last = [p.x, p.y];
    this.paint(p.x, p.y, p.pressure);
  },
  move(p) {
    if (!this.s) return;
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
    this.s.stamp(x, y, size, this.tip);
  },
  up() { if (this.s) done(this.s); this.s = null; },
  cancel() { this.s?.cancel(); this.s = null; },
});

// ── Line: press, drag, release ──
const line = {
  down(p) { if (!drawable()) return; this.s = newStroke(p); this.a = [p.x, p.y]; this.draw(p); },
  move(p) { if (this.s) this.draw(p); },
  draw(p) {
    const o = state.opts;
    let [x1, y1] = [p.x, p.y];
    if (o.perfectAngle || p.shift) [x1, y1] = snapLine(this.a[0], this.a[1], x1, y1);
    this.s.clear();
    for (const [x, y] of linePoints(this.a[0], this.a[1], x1, y1)) this.s.stamp(x, y, o.size, o.tip);
  },
  up() { if (this.s) done(this.s); this.s = null; },
  cancel() { this.s?.cancel(); this.s = null; },
};

// ── Shape: rectangle, ellipse or polygon ──
const shape = {
  down(p) { if (!drawable()) return; this.s = newStroke(p); this.a = [p.x, p.y]; this.draw(p); },
  move(p) { if (this.s) this.draw(p); },
  draw(p) {
    const o = state.opts;
    const [x0, y0, x1, y1] = shapeBox(this.a[0], this.a[1], p.x, p.y, o.perfectRatio || p.shift, o.fromCenter || p.alt);
    this.s.clear();
    const pts = shapePoints(o.kind, o.kind === 'polygon' ? o.sides : -1, x0, y0, x1, y1, o.filled);
    if (o.filled || o.size <= 1) for (const [x, y] of pts) this.s.plot(x, y);
    else for (const [x, y] of pts) this.s.stamp(x, y, o.size, o.tip);
  },
  up() { if (this.s) done(this.s); this.s = null; },
  cancel() { this.s?.cancel(); this.s = null; },
};

// What the bucket / wand / dropper look at: this layer, or everything visible
const sampleSource = which => (which === 'all' ? view.comp : state.cel?.pixels);

// In indexed mode the tolerance counts palette steps (how far apart two colours sit in the palette)
function indexMap(o) {
  if (!indexed() || !o.tolerance) return null;
  const src = sampleSource(o.sample), near = nearestFinder(state.sprite.palette), out = new Int16Array(src.length / 4);
  for (let i = 0, k = 0; k < src.length; i++, k += 4) out[i] = near(src[k], src[k + 1], src[k + 2], src[k + 3]);
  return out;
}

// ── Colour bucket ──
const bucket = {
  down(p) {
    const cel = state.cel, o = state.opts;
    if (!cel || p.x < 0 || p.y < 0 || p.x >= cel.w || p.y >= cel.h || !drawable()) return;
    const mask = fillMask(sampleSource(o.sample), cel.w, cel.h, p.x, p.y, { tolerance: o.tolerance, contiguous: o.contiguous, eight: o.eight, index: indexMap(o) });
    const s = newStroke(p);
    for (let i = 0; i < mask.length; i++) if (mask[i]) s.plot(i % cel.w, (i / cel.w) | 0);
    done(s);
  },
  move() {}, up() {}, cancel() {},
};

// ── Eye dropper ──
export function pickAt(x, y, which = state.settings.tools.dropper.sample) {
  const sp = state.sprite, src = sampleSource(which);
  if (!sp || !src || x < 0 || y < 0 || x >= sp.width || y >= sp.height) return null;
  const o = (y * sp.width + x) * 4;
  return [src[o], src[o + 1], src[o + 2], src[o + 3]];
}

const dropper = {
  down(p) { this.pick(p); },
  move(p) { this.pick(p); },
  pick(p) {
    const c = pickAt(p.x, p.y);
    view.loupe = { sx: p.sx, sy: p.sy, px: p.x, py: p.y, color: c };
    if (c && c[3]) setColor(p.secondary ? 'secondary' : 'primary', paintColor(c));
    view.request();
  },
  up() {
    view.loupe = null; view.request();
    if (!state.tempTool && state.opts.backToTool && this.prev) emit('back-to-tool', this.prev);
  },
  cancel() { view.loupe = null; view.request(); },
};

// ── Selection: rectangle, ellipse, lasso, polygon ──
// Mode from the options, or Shift = add, Alt = subtract, Shift+Alt = intersect
const modeFor = p => (p.shift && p.alt ? 'intersect' : p.shift ? 'add' : p.alt ? 'subtract' : state.opts.mode);
function applySelection(mask, mode) {
  setSelection(combine(state.selection?.mask, mask, mode));
}

const select = {
  down(p) {
    const o = state.opts;
    if (o.shape === 'polygon') { this.polyTap(p); return; }
    this.d = { a: [p.x, p.y], mode: modeFor(p), path: [[p.x, p.y]], moved: false, s0: [p.sx, p.sy] };
    view.selPreview = { kind: o.shape === 'lasso' ? 'lasso' : o.shape, pts: o.shape === 'lasso' ? this.d.path : [[p.x, p.y], [p.x, p.y]] };
    view.request();
  },
  move(p) {
    const d = this.d;
    if (state.opts.shape === 'polygon') { if (this.poly) { view.selPreview.hover = [p.x, p.y]; view.request(); } return; }
    if (!d) return;
    if (Math.hypot(p.sx - d.s0[0], p.sy - d.s0[1]) > 3) d.moved = true;
    if (state.opts.shape === 'lasso') { const l = d.path.at(-1); if (l[0] !== p.x || l[1] !== p.y) d.path.push([p.x, p.y]); }
    else view.selPreview.pts = [d.a, [p.x, p.y]];
    view.request();
  },
  up(p) {
    const d = this.d, sp = state.sprite;
    if (!d) return;
    this.d = null; view.selPreview = null;
    if (!d.moved) { if (d.mode === 'replace') setSelection(null); view.request(); return; }    // a tap deselects
    const W = sp.width, H = sp.height, sh = state.opts.shape;
    const mask = sh === 'lasso' ? maskPolygon(W, H, d.path) : sh === 'ellipse' ? maskEllipse(W, H, d.a[0], d.a[1], p.x, p.y) : maskRect(W, H, d.a[0], d.a[1], p.x, p.y);
    applySelection(mask, d.mode);
  },
  cancel() { this.d = null; this.poly = null; view.selPreview = null; view.request(); emit('polygon'); },
  // polygon: tap each corner; tap the first one again, double-tap, or press Enter to finish
  polyTap(p) {
    const now = performance.now();
    if (!this.poly) {
      this.poly = { pts: [[p.x, p.y]], mode: modeFor(p), t: now };
      view.selPreview = { kind: 'polygon', pts: this.poly.pts };
    } else {
      const f = this.poly.pts[0], l = this.poly.pts.at(-1);
      const [fx, fy] = view.toScreen(f[0] + 0.5, f[1] + 0.5);
      const closeToFirst = Math.hypot(fx - p.sx, fy - p.sy) < 14;
      if ((closeToFirst && this.poly.pts.length > 2) || (now - this.poly.t < 320 && l[0] === p.x && l[1] === p.y)) { this.finishPolygon(); return; }
      this.poly.pts.push([p.x, p.y]); this.poly.t = now;
    }
    view.request(); emit('polygon');
  },
  finishPolygon() {
    const P = this.poly;
    this.poly = null; view.selPreview = null;
    if (P && P.pts.length > 2) applySelection(maskPolygon(state.sprite.width, state.sprite.height, P.pts), P.mode);
    view.request(); emit('polygon');
  },
};

// ── Magic wand: select by colour ──
const wand = {
  down(p) {
    const sp = state.sprite, o = state.opts;
    if (p.x < 0 || p.y < 0 || p.x >= sp.width || p.y >= sp.height) { if (modeFor(p) === 'replace') setSelection(null); return; }
    const mask = fillMask(sampleSource(o.sample), sp.width, sp.height, p.x, p.y, { tolerance: o.tolerance, contiguous: o.contiguous, eight: o.eight, index: indexMap(o) });
    applySelection(mask, modeFor(p));
  },
  move() {}, up() {}, cancel() {},
};

// ── Text: tap where it should start; the text dialog opens and the text lands there to place ──
const text = {
  down(p) { if (drawable()) emit('open-text', { x: p.x, y: p.y }); },
  move() {}, up() {}, cancel() {},
};

export const TOOLS = { brush: brushLike(false), eraser: brushLike(true), line, shape, bucket, dropper, select, wand, move: moveTool, text };
