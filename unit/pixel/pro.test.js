// Unit tests for Phase 5a: text, live effects (modifiers, magic layers, post-processing)
import { describe, it, expect } from '../expect.js';
import { pixelText, trim, PIXEL_FONTS } from '../../src/pixel/core/text.js';
import { mirror, shadow, tileRepeat, glow, scanlines, grade, magicFrame, runStack, MODIFIERS, POST } from '../../src/pixel/core/effects.js';
import { composeFrame, finalFrame, bakeSprite, hasLiveLayers } from '../../src/pixel/core/compose.js';
import { createSprite, contentBounds } from '../../src/pixel/core/sprite.js';

const K = [20, 20, 20, 255];
const solid = (px, W) => { const out = []; for (let i = 0; i < px.length / 4; i++) if (px[i * 4 + 3]) out.push([i % W, (i / W) | 0]); return out; };
const dot = (W, H, pts, c = K) => { const p = new Uint8ClampedArray(W * H * 4); for (const [x, y] of pts) p.set(c, (y * W + x) * 4); return p; };

describe('text', () => {
  it('draws pixel fonts crisply, proportional or tiny capitals', () => {
    const b = pixelText('Hi', 'wren5', K);
    expect(b.h).toBe(7);
    expect(b.w).toBe(5 + 1 + 3);                     // H is 5 wide, i trims to 3, 1 px between
    expect(new Set([...b.pixels].filter((v, i) => i % 4 === 3)).size).toBe(2);   // only on / off
    const t = pixelText('ab', 'wren3', K);
    expect([t.w, t.h]).toEqual([7, 5]);
    expect([...t.pixels]).toEqual([...pixelText('AB', 'wren3', K).pixels]);     // capitals only
    const two = pixelText('A\nB', 'wren5', K, { scale: 2 });
    expect(two.h).toBe((9 + 7) * 2);
    expect(Object.keys(PIXEL_FONTS.wren5.glyphs).length).toBe(95);              // every printable ASCII
  });
  it('trims empty edges', () => {
    const b = trim({ w: 4, h: 4, pixels: dot(4, 4, [[1, 2], [2, 2]]) });
    expect([b.w, b.h]).toEqual([2, 1]);
  });
});

describe('modifiers and post effects', () => {
  it('mirror, shadow and tile repeat', () => {
    const W = 6, H = 4, p = dot(W, H, [[0, 0]]);
    expect(solid(mirror(p, W, H, { axis: 'h' }), W)).toEqual([[0, 0], [5, 0]]);
    expect(solid(mirror(p, W, H, { axis: 'both' }), W).length).toBe(4);
    const sh = shadow(p, W, H, { dx: 1, dy: 1, color: '#ff0000', opacity: 100 });
    expect([...sh.subarray((1 * W + 1) * 4, (1 * W + 1) * 4 + 4)]).toEqual([255, 0, 0, 255]);
    expect([...sh.subarray(0, 4)]).toEqual(K);                                // the art stays on top
    expect(solid(tileRepeat(p, W, H, { gapX: 1, gapY: 1 }), W)).toEqual([[0, 0], [2, 0], [4, 0], [0, 2], [2, 2], [4, 2]]);
  });
  it('glow fades out in steps, scanlines darken alternate rows, grade tints', () => {
    const W = 9, H = 9, p = dot(W, H, [[4, 4]]);
    const g = glow(p, W, H, { color: '#ffffff', size: 2, opacity: 100 });
    const a = (x, y) => g[(y * W + x) * 4 + 3];
    expect(a(4, 4)).toBe(255); expect(a(5, 4)).toBeGreaterThan(a(6, 4)); expect(a(8, 4)).toBe(0);
    const full = new Uint8ClampedArray(2 * 2 * 4).fill(200);
    const s = scanlines(full, 2, 2, { amount: 50 });
    expect([s[0], s[8]]).toEqual([200, 100]);
    expect([...grade(dot(1, 1, [[0, 0]], [0, 0, 0, 255]), 1, 1, { tint: '#ffffff', tintAmount: 50 })]).toEqual([128, 128, 128, 255]);
  });
  it('runs a stack in order and skips switched-off effects', () => {
    const W = 5, H = 1, p = dot(W, H, [[0, 0]]);
    const out = runStack(p, W, H, [{ type: 'mirror', axis: 'h' }, { type: 'outline', color: '#ff0000', on: false }], MODIFIERS);
    expect(solid(out, W)).toEqual([[0, 0], [4, 0]]);
    expect(Object.keys(POST)).toEqual(['shadow', 'glow', 'outline', 'scanlines', 'grade']);
  });
});

describe('magic layers', () => {
  const W = 16, H = 16, src = dot(W, H, [[7, 8], [8, 8], [7, 9], [8, 9]]);
  it('bob moves the art up and down over a loop and comes back', () => {
    const ys = [0, 2, 4, 6].map(k => contentBounds(magicFrame(src, W, H, { motion: 'bob', amount: 2, cycle: 8 }, k), W, H).y);
    expect(ys).toEqual([8, 6, 8, 10]);
    expect([...magicFrame(src, W, H, { motion: 'bob', amount: 2, cycle: 8 }, 8)]).toEqual([...src]);
  });
  it('squash keeps the bottom, spin turns, blink closes once a loop', () => {
    const sq = contentBounds(magicFrame(src, W, H, { motion: 'squash', amount: 50, cycle: 4 }, 1), W, H);
    expect(sq.y + sq.h).toBe(10);
    expect(sq.h).toBe(3);
    const spun = magicFrame(src, W, H, { motion: 'spin', cycle: 4 }, 1);
    expect(solid(spun, W).length).toBe(4);
    const open = magicFrame(src, W, H, { motion: 'blink', cycle: 4 }, 1), shut = magicFrame(src, W, H, { motion: 'blink', cycle: 4 }, 3);
    expect([...open]).toEqual([...src]);
    expect(contentBounds(shut, W, H).h).toBe(1);
  });
  it('compositing, effects and baking all see the generated frames', () => {
    const sp = createSprite({ width: W, height: H });
    sp.frames.push({ id: 'f2', durationMs: 100 }, { id: 'f3', durationMs: 100 });
    const L = sp.layers[0];
    sp.cels[0].pixels.set(src);
    for (const f of ['f2', 'f3']) sp.cels.push({ layerId: L.id, frameId: f, x: 0, y: 0, w: W, h: H, pixels: new Uint8ClampedArray(W * H * 4) });
    L.kind = 'magic'; L.magic = { motion: 'bob', amount: 3, cycle: 4, from: sp.frames[0].id };
    expect(hasLiveLayers(sp)).toBe(true);
    expect(contentBounds(composeFrame(sp, 'f2'), W, H).y).toBe(5);
    L.modifiers = [{ type: 'mirror', axis: 'v' }];
    expect(solid(composeFrame(sp, sp.frames[0].id), W).length).toBe(8);
    sp.post = [{ type: 'scanlines', amount: 100, gap: 2 }];
    expect(finalFrame(sp, sp.frames[0].id)[(9 * W + 7) * 4]).toBe(0);
    const baked = bakeSprite(sp);
    expect(baked.layers[0].kind).toBe('regular');
    expect(baked.cels.filter(c => c.layerId === L.id).length).toBe(3);
    expect(sp.layers[0].kind).toBe('magic');                                    // original untouched
  });
});
