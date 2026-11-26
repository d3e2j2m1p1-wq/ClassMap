// ═══════════════════════════════════════════════
//  Move / transform: lift the selection (or the whole layer) off the selected layers,
//  then drag it, scale it with the corner and edge handles, rotate it with the round handle,
//  skew, flip or nudge it. Apply (✓, Enter, or tap outside) puts it back down as one undo step.
//  Rotations other than right angles use RotSprite (in a worker) so edges stay crisp.
//  Pasting uses the same session, with the pasted pixels as the lifted block.
// ═══════════════════════════════════════════════
import { state, emit, setSelection } from './state.js';
import { lift, matrixOf, rasterize, rasterizeMask, corners, apply } from '../core/transform.js';
import { find, shown, locked } from '../core/layers.js';
import { contentBounds } from '../core/sprite.js';
import { makePatch } from '../core/history.js';
import { blendInto } from '../core/compose.js';
import { toast } from '../ui/dialogs.js';

let view = null, commit = null;
export function initMove(v, c) { view = v; commit = c; }

export const movable = id => {
  const sp = state.sprite, n = find(sp, id)?.node;
  return !!n && n.kind === 'regular' && shown(sp, id) && !locked(sp, id);
};
const celOf = id => state.sprite.cels.find(c => c.layerId === id && c.frameId === state.frameId);

// Begin a move. `paste` = { block, w, h, x, y } puts new pixels on the active layer instead.
export function startMove(paste) {
  if (state.transform) return state.transform;
  const sp = state.sprite, W = sp.width, H = sp.height;
  const ids = paste ? [state.layerId] : [...state.selectedLayers].filter(movable);
  if (!ids.length || (paste && !movable(state.layerId))) {
    toast(paste ? 'Pick a visible, unlocked regular layer to paste into' : 'Nothing to move: pick a visible, unlocked layer');
    return null;
  }
  const sel = paste ? null : state.selection;
  let rect;
  if (paste) rect = { x: paste.x, y: paste.y, w: paste.w, h: paste.h };
  else if (sel) rect = { ...sel.bounds };
  else {
    let b = null;
    for (const id of ids) {
      const r = contentBounds(celOf(id).pixels, W, H);
      if (r) b = b ? { x0: Math.min(b.x0, r.x), y0: Math.min(b.y0, r.y), x1: Math.max(b.x1, r.x + r.w - 1), y1: Math.max(b.y1, r.y + r.h - 1) } : { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 };
    }
    if (!b) { toast('This layer is empty'); return null; }
    rect = { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
  }
  const layers = ids.map(id => {
    const cel = celOf(id), base = cel.pixels.slice();
    let block;
    if (paste) block = paste.block;
    else {
      block = lift(cel.pixels, W, rect, sel?.mask);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = y * W + x;
        if (!sel || sel.mask[i]) cel.pixels.fill(0, i * 4, i * 4 + 4);
      }
    }
    return { id, cel, base, block };
  });
  const T = state.transform = {
    layers, rect, mask: sel?.mask || null, paste: !!paste, skew: false,
    p: { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, kx: 0, flipH: false, flipV: false },
  };
  // one picture of everything lifted, for the preview
  const c = document.createElement('canvas');
  c.width = rect.w; c.height = rect.h;
  const img = new ImageData(rect.w, rect.h);
  for (const L of layers) for (let i = 0; i < L.block.length; i += 4) if (L.block[i + 3]) blendInto(img.data, i, L.block[i], L.block[i + 1], L.block[i + 2], L.block[i + 3] / 255, 'normal');
  c.getContext('2d').putImageData(img, 0, 0);
  view.floating = { canvas: c, m: matrix(), w: rect.w, h: rect.h };
  view.invalidate(rect.x, rect.y, rect.x + rect.w - 1, rect.y + rect.h - 1);
  view.animateAnts();
  emit('transform');
  return T;
}

// Straight (0/90/180/270°) unskewed results are nudged onto whole pixels, so a block with an even
// side and an odd side doesn't land half a pixel off and grow a row when rotated.
export const matrix = () => {
  const T = state.transform, m = matrixOf({ ...T.rect, ...T.p });
  const q = T.p.rot / (Math.PI / 2);
  if (!T.p.kx && Math.abs(q - Math.round(q)) < 1e-6) {
    const cs = corners(m, T.rect.w, T.rect.h);
    const minX = Math.min(...cs.map(c => c[0])), minY = Math.min(...cs.map(c => c[1]));
    m[4] += Math.round(minX) - minX; m[5] += Math.round(minY) - minY;
  }
  return m;
};

export function update(changes) {
  const T = state.transform;
  if (!T) return;
  Object.assign(T.p, changes);
  view.floating.m = matrix();
  view.request();
  emit('transform');
}

const QUARTER = Math.PI / 2;
const needsRotsprite = p => state.settings.tools.move.rotsprite && Math.abs(Math.round(p.rot / QUARTER) * QUARTER - p.rot) > 1e-6;

let worker = null, jobs = 0;
const waiting = new Map();
function rotspriteJob(src, w, h, m, W, H) {
  try {
    if (!worker) {
      worker = new Worker(new URL('../core/rotsprite.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => { waiting.get(e.data.id)?.(e.data.r); waiting.delete(e.data.id); };
    }
    const id = ++jobs;
    return new Promise(res => { waiting.set(id, res); worker.postMessage({ id, src: src.slice(), w, h, m, W, H }); });
  } catch { return Promise.resolve(rasterize(src, w, h, m, W, H, { rotsprite: true })); }
}

let applying = false;
export async function applyMove() {
  const T = state.transform;
  if (!T || applying) return;
  applying = true;
  try {
    const sp = state.sprite, W = sp.width, H = sp.height, m = matrix(), rs = needsRotsprite(T.p);
    const patches = [];
    let area = { x0: T.rect.x, y0: T.rect.y, x1: T.rect.x + T.rect.w - 1, y1: T.rect.y + T.rect.h - 1 };
    for (const L of T.layers) {
      const r = rs ? await rotspriteJob(L.block, T.rect.w, T.rect.h, m, W, H) : rasterize(L.block, T.rect.w, T.rect.h, m, W, H);
      if (r) {
        for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
          const s = (j * r.w + i) * 4;
          if (r.pixels[s + 3]) blendInto(L.cel.pixels, ((r.y + j) * W + r.x + i) * 4, r.pixels[s], r.pixels[s + 1], r.pixels[s + 2], r.pixels[s + 3] / 255, 'normal');
        }
        area = { x0: Math.min(area.x0, r.x), y0: Math.min(area.y0, r.y), x1: Math.max(area.x1, r.x + r.w - 1), y1: Math.max(area.y1, r.y + r.h - 1) };
      }
    }
    area = { x0: Math.max(0, area.x0), y0: Math.max(0, area.y0), x1: Math.min(W - 1, area.x1), y1: Math.min(H - 1, area.y1) };
    for (const L of T.layers) {
      const rect = { x: area.x0, y: area.y0, w: area.x1 - area.x0 + 1, h: area.y1 - area.y0 + 1 };
      const p = makePatch({ layerId: L.id, frameId: state.frameId }, L.base, L.cel.pixels, W, rect);
      if (p.before.some((v, i) => v !== p.after[i])) patches.push(p);
    }
    state.transform = null; view.floating = null;
    if (patches.length) commit(patches.length === 1 ? patches[0] : { kind: 'multi', steps: patches });
    setSelection(T.mask ? rasterizeMask(T.mask, W, H, T.rect, m) : null);
    view.invalidate(area.x0, area.y0, area.x1, area.y1);
    emit('transform');
  } finally { applying = false; }
}

export function cancelMove() {
  const T = state.transform;
  if (!T) return;
  for (const L of T.layers) L.cel.pixels.set(L.base);
  state.transform = null; view.floating = null;
  view.recompose();
  view.animateAnts();
  emit('transform');
}

// Delete what's being moved: the lifted pixels stay gone (one undo step)
export function discardMove() {
  const T = state.transform;
  if (!T) return;
  const W = state.sprite.width;
  const patches = T.paste ? [] : T.layers.map(L => makePatch({ layerId: L.id, frameId: state.frameId }, L.base, L.cel.pixels, W, T.rect));
  state.transform = null; view.floating = null;
  if (patches.length) commit(patches.length === 1 ? patches[0] : { kind: 'multi', steps: patches });
  setSelection(null);
  view.recompose();
  emit('transform');
}

// Move by whole pixels (arrow keys, the nudge buttons)
export function nudge(dx, dy) {
  if (!state.transform && !startMove()) return;
  const p = state.transform.p;
  update({ tx: p.tx + dx, ty: p.ty + dy });
}

// ── dragging on the canvas with the Move tool ──
const inside = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const near = (a, b, r) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= r;

export const moveTool = {
  down(p) {
    const fresh = !state.transform;
    if (fresh && !startMove()) return;
    const T = state.transform, H = view.handles(), s = [p.sx, p.sy];
    const touch = p.touch ? 8 : 0;
    let mode = null, idx = -1;
    if (near(s, H.rot, 12 + touch)) mode = 'rotate';
    else if ((idx = H.corners.findIndex(c => near(s, c, 10 + touch))) >= 0) mode = 'corner';
    else if ((idx = H.edges.findIndex(c => near(s, c, 9 + touch))) >= 0) mode = T.skew && (idx === 0 || idx === 2) ? 'skew' : 'edge';
    else if (fresh || inside(s, H.corners)) mode = 'move';
    if (!mode) { applyMove(); this.d = null; return; }
    const m = matrix(), w = T.rect.w, h = T.rect.h;
    const C = apply(m, w / 2, h / 2), r = T.p.rot, ux = [Math.cos(r), Math.sin(r)], uy = [-Math.sin(r), Math.cos(r)];
    const local = P => [(P[0] - C[0]) * ux[0] + (P[1] - C[1]) * ux[1], (P[0] - C[0]) * uy[0] + (P[1] - C[1]) * uy[1]];
    const cornersL = corners(m, w, h).map(local);
    const edgesL = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]].map(([a, b]) => local(apply(m, a, b)));
    const grab = mode === 'corner' ? cornersL[idx] : mode === 'edge' || mode === 'skew' ? edgesL[idx] : null;
    this.d = { mode, idx, p0: { ...T.p }, start: [p.fx, p.fy], C, ux, uy, local, grab, anchor: grab && [-grab[0], -grab[1]] };
  },
  move(p) {
    const d = this.d, T = state.transform;
    if (!d || !T) return;
    const P = [p.fx, p.fy];
    if (d.mode === 'move') {
      update({ tx: d.p0.tx + Math.round(P[0] - d.start[0]), ty: d.p0.ty + Math.round(P[1] - d.start[1]) });
    } else if (d.mode === 'rotate') {
      const a0 = Math.atan2(d.start[1] - d.C[1], d.start[0] - d.C[0]), a1 = Math.atan2(P[1] - d.C[1], P[0] - d.C[0]);
      let rot = d.p0.rot + a1 - a0;
      const step = p.shift ? Math.PI / 12 : QUARTER;
      const snapped = Math.round(rot / step) * step;
      if (p.shift || Math.abs(snapped - rot) < (4 * Math.PI) / 180) rot = snapped;
      update({ rot });
    } else if (d.mode === 'skew') {
      const L = d.local(P), dx = L[0] - d.grab[0];
      update({ kx: d.p0.kx + (d.idx === 0 ? -2 : 2) * dx / (T.rect.h * Math.abs(d.p0.sy)) });
    } else {
      const L = d.local(P);
      const axisX = d.mode === 'corner' || d.idx === 1 || d.idx === 3, axisY = d.mode === 'corner' || d.idx === 0 || d.idx === 2;
      let fx = axisX && d.grab[0] - d.anchor[0] ? (L[0] - d.anchor[0]) / (d.grab[0] - d.anchor[0]) : 1;
      let fy = axisY && d.grab[1] - d.anchor[1] ? (L[1] - d.anchor[1]) / (d.grab[1] - d.anchor[1]) : 1;
      if (p.shift && d.mode === 'corner') { const f = Math.max(Math.abs(fx), Math.abs(fy)); fx = Math.sign(fx || 1) * f; fy = Math.sign(fy || 1) * f; }
      const sx = d.p0.sx * fx, sy = d.p0.sy * fy;
      if (Math.abs(sx * T.rect.w) < 1 || Math.abs(sy * T.rect.h) < 1) return;
      // the opposite corner / edge stays put
      const nx = axisX ? (d.anchor[0] + d.anchor[0] + (d.grab[0] - d.anchor[0]) * fx) / 2 : 0;
      const ny = axisY ? (d.anchor[1] + d.anchor[1] + (d.grab[1] - d.anchor[1]) * fy) / 2 : 0;
      const cx = d.C[0] + d.ux[0] * nx + d.uy[0] * ny, cy = d.C[1] + d.ux[1] * nx + d.uy[1] * ny;
      update({ sx, sy, tx: cx - (T.rect.x + T.rect.w / 2), ty: cy - (T.rect.y + T.rect.h / 2) });
    }
  },
  up() { this.d = null; },
  cancel() { this.d = null; },
};
