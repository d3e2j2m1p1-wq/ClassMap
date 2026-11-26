// Unit tests for Phase 2: layers, blend modes, selections, transforms
import { describe, it, expect } from '../expect.js';
import { createSprite, uid } from '../../src/pixel/core/sprite.js';
import { composeFrame, blendInto } from '../../src/pixel/core/compose.js';
import { find, leafLayers, displayRows, insert, remove, shown, locked, within } from '../../src/pixel/core/layers.js';
import { maskRect, maskEllipse, maskPolygon, combine, invert, bounds, outline } from '../../src/pixel/core/selection.js';
import { matrixOf, rasterize, scale2x, inverse, apply, lift, rasterizeMask } from '../../src/pixel/core/transform.js';

const sum = m => m.reduce((a, b) => a + b, 0);

function twoLayers() {
  const sp = createSprite({ width: 2, height: 1 });
  const top = { id: uid(), kind: 'regular', name: 'Top', visible: true, locked: false, opacity: 255, blend: 'normal' };
  sp.layers.push(top);
  sp.cels.push({ layerId: top.id, frameId: sp.frames[0].id, x: 0, y: 0, w: 2, h: 1, pixels: new Uint8ClampedArray(8) });
  return { sp, bottom: sp.cels[0].pixels, top: sp.cels[1].pixels, topLayer: top };
}

describe('blend modes and layers', () => {
  it('stacks layers bottom to top with opacity', () => {
    const { sp, bottom, top, topLayer } = twoLayers();
    bottom.set([0, 0, 255, 255, 0, 0, 255, 255]);
    top.set([255, 0, 0, 255]);
    let out = composeFrame(sp);
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...out.slice(4, 8)]).toEqual([0, 0, 255, 255]);
    topLayer.opacity = 128;
    out = composeFrame(sp);
    expect(out[0]).toBeGreaterThan(120); expect(out[2]).toBeGreaterThan(120);
    topLayer.visible = false;
    expect([...composeFrame(sp).slice(0, 4)]).toEqual([0, 0, 255, 255]);
  });
  it('applies multiply, screen, difference, addition, subtract', () => {
    const run = (mode, b, s) => { const d = new Uint8ClampedArray([...b, 255]); blendInto(d, 0, s[0], s[1], s[2], 1, mode); return [...d.slice(0, 3)]; };
    expect(run('multiply', [255, 128, 0], [128, 128, 128])).toEqual([128, 64, 0]);
    expect(run('screen', [0, 0, 0], [100, 50, 0])).toEqual([100, 50, 0]);
    expect(run('difference', [200, 50, 0], [50, 200, 0])).toEqual([150, 150, 0]);
    expect(run('addition', [200, 100, 0], [100, 100, 0])).toEqual([255, 200, 0]);
    expect(run('subtract', [200, 100, 0], [50, 150, 0])).toEqual([150, 0, 0]);
    const lumOnly = run('luminosity', [255, 0, 0], [128, 128, 128]);
    expect(lumOnly[0]).toBeGreaterThan(lumOnly[1]);      // keeps the backdrop's hue
  });
  it('shows the source as-is where nothing is underneath, whatever the mode', () => {
    const d = new Uint8ClampedArray(4);
    blendInto(d, 0, 10, 20, 30, 1, 'multiply');
    expect([...d]).toEqual([10, 20, 30, 255]);
  });
  it('composes groups, and hiding a group hides its children', () => {
    const { sp, bottom, top, topLayer } = twoLayers();
    top.set([255, 0, 0, 255]);
    const group = { id: uid(), kind: 'group', name: 'G', visible: true, locked: false, opacity: 255, blend: 'normal', collapsed: false, children: [] };
    remove(sp, topLayer.id);
    sp.layers.push(group);
    insert(sp, topLayer, group.id, 'into');
    expect(find(sp, topLayer.id).parent.id).toBe(group.id);
    expect(composeFrame(sp)[0]).toBe(255);
    group.visible = false;
    expect(shown(sp, topLayer.id)).toBe(false);
    expect(composeFrame(sp)[3]).toBe(0);
    group.locked = true;
    expect(locked(sp, topLayer.id)).toBe(true);
    expect(within(sp, topLayer.id, group.id)).toBe(true);
    expect(leafLayers(sp).length).toBe(2);
    expect(displayRows(sp).map(r => r.node.name)).toEqual(['G', 'Top', 'Layer 1']);
  });
});

describe('selections', () => {
  it('builds rectangle, ellipse and polygon masks', () => {
    expect(sum(maskRect(10, 10, 2, 2, 4, 5))).toBe(12);
    expect(sum(maskRect(10, 10, -5, -5, 1, 1))).toBe(4);     // clipped to the canvas
    const e = maskEllipse(10, 10, 0, 0, 9, 9);
    expect(e[5 * 10 + 5]).toBe(1); expect(e[0]).toBe(0);
    const tri = maskPolygon(10, 10, [[0, 0], [9, 0], [0, 9]]);
    expect(tri[1 * 10 + 1]).toBe(1); expect(tri[9 * 10 + 9]).toBe(0);
  });
  it('combines with every mode', () => {
    const a = maskRect(4, 1, 0, 0, 1, 0), b = maskRect(4, 1, 1, 0, 2, 0);
    expect([...combine(a, b, 'add')]).toEqual([1, 1, 1, 0]);
    expect([...combine(a, b, 'subtract')]).toEqual([1, 0, 0, 0]);
    expect([...combine(a, b, 'intersect')]).toEqual([0, 1, 0, 0]);
    expect([...combine(a, b, 'xor')]).toEqual([1, 0, 1, 0]);
    expect([...combine(a, b, 'replace')]).toEqual([...b]);
    expect([...invert(a)]).toEqual([0, 0, 1, 1]);
  });
  it('finds bounds and outlines', () => {
    const m = maskRect(6, 6, 1, 2, 3, 3);
    expect(bounds(m, 6)).toEqual({ x: 1, y: 2, w: 3, h: 2 });
    expect(bounds(new Uint8Array(4), 2)).toBeNull();
    const segs = outline(m, 6, 6);
    expect(segs.length).toBe(4);                              // a rectangle = 4 joined edges
    expect(segs).toContainEqual([1, 2, 4, 2]);
  });
});

describe('transforms', () => {
  const block = () => {           // 2×2: red, green / blue, white
    const p = new Uint8ClampedArray(16);
    p.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    return p;
  };
  it('moves a block', () => {
    const m = matrixOf({ x: 1, y: 1, w: 2, h: 2, tx: 3, ty: 0 });
    const r = rasterize(block(), 2, 2, m, 10, 10);
    expect([r.x, r.y, r.w, r.h]).toEqual([4, 1, 2, 2]);
    expect([...r.pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });
  it('flips and rotates by 90° exactly', () => {
    const flip = rasterize(block(), 2, 2, matrixOf({ x: 0, y: 0, w: 2, h: 2, flipH: true }), 4, 4);
    expect([...flip.pixels.slice(0, 4)]).toEqual([0, 255, 0, 255]);
    const rot = rasterize(block(), 2, 2, matrixOf({ x: 0, y: 0, w: 2, h: 2, rot: Math.PI / 2 }), 4, 4);
    expect([rot.w, rot.h]).toEqual([2, 2]);
    expect([...rot.pixels.slice(0, 4)]).toEqual([0, 0, 255, 255]);   // bottom-left comes to the top-left
  });
  it('scales up with crisp pixels', () => {
    const r = rasterize(block(), 2, 2, matrixOf({ x: 0, y: 0, w: 2, h: 2, sx: 2, sy: 2, tx: 1, ty: 1 }), 8, 8);
    expect([r.w, r.h]).toEqual([4, 4]);
    expect([...r.pixels.slice(4, 8)]).toEqual([255, 0, 0, 255]);
  });
  it('inverts matrices', () => {
    const m = matrixOf({ x: 2, y: 3, w: 4, h: 4, rot: 0.7, sx: 1.5, kx: 0.2 });
    const [x, y] = apply(inverse(m), ...apply(m, 1.25, 3.5));
    expect(x).toBeCloseTo(1.25); expect(y).toBeCloseTo(3.5);
  });
  it('Scale2x keeps hard edges and RotSprite rotates without gaps', () => {
    const s = scale2x(block(), 2, 2);
    expect(s.length).toBe(4 * 4 * 4);
    const img = new Uint8ClampedArray(8 * 8 * 4).fill(255);
    const r = rasterize(img, 8, 8, matrixOf({ x: 4, y: 4, w: 8, h: 8, rot: Math.PI / 6 }), 20, 20, { rotsprite: true });
    // the middle of a rotated solid square is fully covered
    const mid = ((10 - r.y) * r.w + (10 - r.x)) * 4;
    expect(r.pixels[mid + 3]).toBe(255);
  });
  it('lifts only selected pixels and moves the selection with them', () => {
    const W = 4, px = new Uint8ClampedArray(W * W * 4).fill(200);
    const mask = maskRect(W, W, 0, 0, 0, 3);
    const out = lift(px, W, { x: 0, y: 0, w: 2, h: 4 }, mask);
    expect(out[3]).toBe(200); expect(out[7]).toBe(0);
    const moved = rasterizeMask(mask, W, W, { x: 0, y: 0, w: 1, h: 4 }, matrixOf({ x: 0, y: 0, w: 1, h: 4, tx: 2 }));
    expect(bounds(moved, W)).toEqual({ x: 2, y: 0, w: 1, h: 4 });
  });
});
