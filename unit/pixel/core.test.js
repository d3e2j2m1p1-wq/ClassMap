// Unit tests for the Pixel editor's drawing core (run with: npm run test:unit)
import { describe, it, expect } from '../expect.js';
import { hexToRgba, rgbaToHex, rgbToHsv, hsvToRgb, blendOver, colorDistance } from '../../src/pixel/core/color.js';
import { linePoints, snapLine, tipOffsets, pixelPerfectPath, ellipsePoints, rectPoints, shapePoints, shapeBox, polygonVertices } from '../../src/pixel/core/raster.js';
import { fillMask } from '../../src/pixel/core/fill.js';
import { History, makePatch, writeRect } from '../../src/pixel/core/history.js';
import { createSprite, contentBounds, compositeFrame } from '../../src/pixel/core/sprite.js';
import { encodeProject, decodeProject, encodeBackup, decodeBackup, spriteToJSON } from '../../src/pixel/core/format.js';

const key = pts => pts.map(p => p.join(',')).sort().join(' ');

describe('colour', () => {
  it('converts hex both ways', () => {
    expect(hexToRgba('#0e8a9e')).toEqual([14, 138, 158, 255]);
    expect(hexToRgba('f00')).toEqual([255, 0, 0, 255]);
    expect(hexToRgba('#11223344')).toEqual([17, 34, 51, 68]);
    expect(hexToRgba('nope')).toBeNull();
    expect(rgbaToHex([14, 138, 158, 255])).toBe('#0e8a9e');
    expect(rgbaToHex([17, 34, 51, 68])).toBe('#11223344');
  });
  it('round-trips HSV for every primary and a few mixes', () => {
    for (const c of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [14, 138, 158], [242, 95, 107], [43, 29, 26], [128, 128, 128]]) {
      const [h, s, v] = rgbToHsv(c);
      const back = hsvToRgb(h, s, v);
      back.forEach((x, i) => expect(Math.abs(x - c[i])).toBeLessThanOrEqual(1));
    }
  });
  it('blends with source-over', () => {
    expect(blendOver([0, 0, 0, 0], [255, 0, 0, 128])).toEqual([255, 0, 0, 128]);
    expect(blendOver([0, 0, 255, 255], [255, 0, 0, 255])).toEqual([255, 0, 0, 255]);
    const half = blendOver([0, 0, 255, 255], [255, 0, 0, 128]);
    expect(half[3]).toBe(255);
    expect(half[0]).toBeGreaterThan(120); expect(half[2]).toBeGreaterThan(120);
  });
  it('treats all transparent pixels as the same colour', () => {
    expect(colorDistance([10, 20, 30, 0], [200, 0, 0, 0])).toBe(0);
    expect(colorDistance([0, 0, 0, 255], [255, 255, 255, 255])).toBeGreaterThan(80);
  });
});

describe('lines and shapes', () => {
  it('draws a one-pixel line with no doubled corners', () => {
    const pts = linePoints(0, 0, 5, 2);
    expect(pts[0]).toEqual([0, 0]); expect(pts.at(-1)).toEqual([5, 2]);
    expect(pts.length).toBe(6);                       // one pixel per column on a shallow line
    expect(linePoints(3, 3, 3, 3)).toEqual([[3, 3]]);
  });
  it('snaps lines to clean pixel angles', () => {
    expect(snapLine(0, 0, 10, 1)).toEqual([10, 0]);
    expect(snapLine(0, 0, 1, 10)).toEqual([0, 10]);
    expect(snapLine(0, 0, 9, 8)).toEqual([9, 9]);
    const [x, y] = snapLine(0, 0, 10, 5);             // 2:1 isometric
    expect(x).toBe(2 * y);
  });
  it('removes L corners from freehand one-pixel paths', () => {
    const path = pixelPerfectPath([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]]);
    expect(path).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(pixelPerfectPath([[0, 0], [1, 0], [2, 0]])).toEqual([[0, 0], [1, 0], [2, 0]]);
  });
  it('makes round and square brush tips', () => {
    expect(tipOffsets(1)).toEqual([[0, 0]]);
    expect(tipOffsets(3, 'square').length).toBe(9);
    expect(tipOffsets(3, 'round').length).toBe(5);    // a plus sign
    expect(tipOffsets(5, 'round').length).toBe(21);
  });
  it('draws rectangles and ellipses that fill their box', () => {
    expect(rectPoints(0, 0, 3, 2, false).length).toBe(10);
    expect(rectPoints(3, 2, 0, 0, true).length).toBe(12);
    for (const [w, h] of [[8, 8], [7, 5], [2, 9], [16, 3]]) {
      const pts = ellipsePoints(0, 0, w - 1, h - 1, false);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, w - 1, 0, h - 1]);
    }
    const filled = ellipsePoints(0, 0, 9, 9, true);
    expect(filled.length).toBeGreaterThan(60);
    expect(filled.some(([x, y]) => x === 5 && y === 5)).toBe(true);
  });
  it('maps shape kinds and drag modes', () => {
    expect(key(shapePoints('polygon', 4, 0, 0, 3, 3, false))).toBe(key(rectPoints(0, 0, 3, 3, false)));
    expect(polygonVertices(0, 0, 10, 10, 3).length).toBe(3);
    const tri = shapePoints('polygon', 3, 0, 0, 10, 10, true);
    expect(tri.some(([x, y]) => x === 5 && y === 6)).toBe(true);
    expect(shapeBox(5, 5, 8, 6, true, false)).toEqual([5, 5, 8, 8]);
    expect(shapeBox(5, 5, 7, 6, false, true)).toEqual([3, 4, 7, 6]);
  });
});

describe('colour bucket', () => {
  const W = 6, H = 4;
  const img = () => {
    const p = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) { const i = (y * W + 3) * 4; p[i] = 0; p[i + 3] = 255; }   // a black wall at x = 3
    return p;
  };
  it('stops at a wall when contiguous', () => {
    const m = fillMask(img(), W, H, 0, 0);
    expect(m.reduce((a, b) => a + b, 0)).toBe(12);
    expect(m[5]).toBe(0);
  });
  it('fills every matching pixel when not contiguous', () => {
    expect(fillMask(img(), W, H, 0, 0, { contiguous: false }).reduce((a, b) => a + b, 0)).toBe(20);
  });
  it('goes through diagonal gaps only in 8-way mode', () => {
    const p = new Uint8ClampedArray(3 * 3 * 4);
    for (const [x, y] of [[1, 0], [0, 1], [2, 1], [1, 2]]) p[(y * 3 + x) * 4 + 3] = 255;    // a diamond
    expect(fillMask(p, 3, 3, 0, 0).reduce((a, b) => a + b, 0)).toBe(1);
    expect(fillMask(p, 3, 3, 0, 0, { eight: true }).reduce((a, b) => a + b, 0)).toBe(5);
  });
  it('uses tolerance', () => {
    const p = new Uint8ClampedArray(2 * 1 * 4);
    p.set([100, 100, 100, 255, 110, 100, 100, 255]);
    expect(fillMask(p, 2, 1, 0, 0, { tolerance: 0 }).reduce((a, b) => a + b, 0)).toBe(1);
    expect(fillMask(p, 2, 1, 0, 0, { tolerance: 5 }).reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe('undo', () => {
  it('stores only the changed rectangle and restores it', () => {
    const W = 4, before = new Uint8ClampedArray(W * W * 4), after = before.slice();
    writeRect(after, W, 1, 1, 2, 1, new Uint8ClampedArray([9, 9, 9, 255, 8, 8, 8, 255]));
    const patch = makePatch('cel', before, after, W, { x: 1, y: 1, w: 2, h: 1 });
    expect(patch.before.length).toBe(8);
    const live = after.slice(), h = new History(2);
    const apply = (s, which) => writeRect(live, W, s.rect.x, s.rect.y, s.rect.w, s.rect.h, s[which]);
    h.push(patch);
    h.undo(apply); expect([...live]).toEqual([...before]);
    h.redo(apply); expect([...live]).toEqual([...after]);
    h.push({}); h.push({}); h.push({});
    expect(h.done.length).toBe(2);                    // depth limit
    expect(h.canRedo).toBe(false);
  });
});

describe('files', () => {
  const sample = () => {
    const sp = createSprite({ name: 'Wren', width: 20, height: 10, palette: ['#0e8a9e', '#f25f6b80'] });
    const px = sp.cels[0].pixels;
    for (const [x, y] of [[3, 2], [4, 2], [10, 7]]) px.set([242, 95, 107, 255], (y * 20 + x) * 4);
    return sp;
  };
  it('trims cels to their content when saving', () => {
    const o = spriteToJSON(sample());
    expect(o.cels[0]).toMatchObject({ x: 3, y: 2, w: 8, h: 6 });
    expect(contentBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
  it('round-trips a project through the compressed format', async () => {
    const sp = sample();
    const back = await decodeProject(await encodeProject(sp));
    expect(back.name).toBe('Wren');
    expect(back.palette).toEqual([[14, 138, 158, 255], [242, 95, 107, 128]]);
    expect([...back.cels[0].pixels]).toEqual([...sp.cels[0].pixels]);
    expect([...compositeFrame(back)]).toEqual([...sp.cels[0].pixels]);
  });
  it('round-trips a backup with several projects and settings', async () => {
    const a = sample(), b = createSprite({ name: 'Empty', width: 8, height: 8 });
    const bytes = await encodeBackup([spriteToJSON(a), spriteToJSON(b)], { palettes: [{ name: 'Mine', colors: ['#000000'] }] });
    const out = await decodeBackup(bytes);
    expect(out.projects.map(p => p.name)).toEqual(['Wren', 'Empty']);
    expect(out.settings.palettes[0].name).toBe('Mine');
    expect([...out.projects[0].cels[0].pixels]).toEqual([...a.cels[0].pixels]);
  });
  it('rejects files that are not backups', async () => {
    await expect(decodeBackup(new TextEncoder().encode('hello'))).rejects.toThrow(/backup/);
  });
});
