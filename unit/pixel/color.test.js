// Unit tests for Phase 4: colour (indexed mode, palette tools, palette files, colour tools)
import { describe, it, expect } from '../expect.js';
import {
  nearestColor, colorCounts, paletteFromArt, snapToPalette, fitsPalette, toIndexes, findColor,
  gradient, sortOrder, reducePalette, shadeMap, parsePalette, writeGPL, writeHEX, writePAL,
  lospecSlug, fromLospecJSON, replaceColor, adjustColors, applyLevels, levelsLUT, outlinePixels, antiAlias,
} from '../../src/pixel/core/colorops.js';
import { encodeIndexedPNG } from '../../src/pixel/core/png.js';
import { pngChunks } from '../../src/pixel/core/apng.js';
import { unzlib } from '../../src/pixel/core/format.js';
import { readAseprite, writeAseprite } from '../../src/pixel/core/aseprite.js';
import { createSprite } from '../../src/pixel/core/sprite.js';

const px = (...cols) => Uint8ClampedArray.from(cols.flat());
const R = [255, 0, 0, 255], G = [0, 200, 0, 255], B = [0, 0, 255, 255], T = [0, 0, 0, 0], K = [20, 20, 20, 255];
const at = (a, i) => [...a.subarray(i * 4, i * 4 + 4)];

// a 6×4 picture with 7 colours, some translucent
function art() {
  const W = 6, H = 4, p = new Uint8ClampedArray(W * H * 4);
  const cols = [R, G, B, [250, 240, 10, 255], [90, 30, 160, 128], [12, 34, 56, 255], [200, 200, 200, 64]];
  for (let i = 0; i < W * H; i++) if (i % 5) p.set(cols[i % cols.length], i * 4);
  return { W, H, p };
}

describe('indexed colour', () => {
  it('RGBA → indexed → RGBA keeps every colour when the palette is built from the art', () => {
    const { p } = art();
    const pal = paletteFromArt([p]);
    expect(pal.length).toBe(7);
    const indexed = snapToPalette(p, pal);
    expect([...indexed]).toEqual([...p]);              // nothing moved
    expect(fitsPalette([indexed], pal)).toBe(true);
    // the indexes describe the same picture
    const idx = toIndexes(indexed, [...pal, T], pal.length);
    const back = new Uint8ClampedArray(p.length);
    idx.forEach((k, i) => back.set(k === pal.length ? T : pal[k], i * 4));
    expect([...back]).toEqual([...p]);
  });

  it('snaps colours outside the palette to the nearest one and keeps transparency', () => {
    const out = snapToPalette(px([250, 10, 10, 255], [10, 190, 20, 255], T, [5, 5, 240, 255]), [R, G, B]);
    expect(at(out, 0)).toEqual(R); expect(at(out, 1)).toEqual(G); expect(at(out, 2)).toEqual(T); expect(at(out, 3)).toEqual(B);
    expect(fitsPalette([px([250, 10, 10, 255])], [R, G, B])).toBe(false);
  });

  it('ordered dither mixes the two nearest colours for an in-between shade', () => {
    const W = 8, src = new Uint8ClampedArray(W * W * 4);
    for (let i = 0; i < W * W; i++) src.set([128, 128, 128, 255], i * 4);
    const out = snapToPalette(src, [[0, 0, 0, 255], [255, 255, 255, 255]], { dither: true, width: W, spread: 255 });
    const whites = colorCounts([out]).find(c => c.color[0] === 255)?.count || 0;
    expect(whites).toBeGreaterThan(16); expect(whites).toBeLessThanOrEqual(48);
  });

  it('builds at most N colours from busy art and finds exact colours', () => {
    const p = new Uint8ClampedArray(300 * 4);
    for (let i = 0; i < 300; i++) p.set([i % 256, (i * 7) % 256, (i * 13) % 256, 255], i * 4);
    expect(paletteFromArt([p], 16).length).toBe(16);
    expect(findColor(px(R, G, R), R)).toEqual([0, 8]);
    expect(nearestColor([R, G, B], [0, 0, 200, 255])).toEqual(B);
  });
});

describe('palette tools', () => {
  it('makes gradients in RGB and HSV, the short or long way round', () => {
    const g = gradient([0, 0, 0, 255], [255, 255, 255, 255], 5);
    expect(g.length).toBe(5);
    expect(g[2]).toEqual([128, 128, 128, 255]);
    expect(gradient(R, B, 5, { exclude: true }).length).toBe(3);
    // red → blue short way goes through magenta; long way through green
    const short = gradient(R, B, 3, { space: 'hsv' })[1], long = gradient(R, B, 3, { space: 'hsv', long: true })[1];
    expect(short[0] > 0 && short[2] > 0 && short[1] === 0).toBe(true);
    expect(long[1]).toBeGreaterThan(200);
  });

  it('sorts by hue, lightness or a channel, either way, and stays stable', () => {
    const pal = [B, R, G, [128, 128, 128, 255]];
    expect(sortOrder(pal, 'hue')).toEqual([3, 1, 2, 0]);
    expect(sortOrder(pal, 'red', true)[0]).toBe(1);
    expect(sortOrder([R, R, G], 'red')).toEqual([2, 0, 1]);
    expect(sortOrder(pal, 'lightness')[0]).toBe(2);          // the green is the darkest
  });

  it('reduces a palette by merging similar colours (median cut and k-means)', () => {
    const pal = [[250, 0, 0, 255], [255, 5, 5, 255], [0, 0, 250, 255], [5, 5, 255, 255], [0, 255, 0, 255]];
    for (const method of ['median', 'kmeans']) {
      const out = reducePalette(pal, 3, { method });
      expect(out.length).toBe(3);
      expect(out.some(c => c[0] > 240 && c[2] < 10)).toBe(true);
      expect(out.some(c => c[2] > 240 && c[0] < 10)).toBe(true);
    }
    expect(reducePalette(pal, 9).length).toBe(5);
  });

  it('shading steps along a ramp and leaves other colours alone', () => {
    const pal = [K, [60, 60, 60, 255], [120, 120, 120, 255], [200, 200, 200, 255], R];
    const up = shadeMap(pal, 0, 3, 1), down = shadeMap(pal, 0, 3, -1);
    expect(up.get(((20 << 24) | (20 << 16) | (20 << 8) | 255) >>> 0)).toEqual([60, 60, 60, 255]);
    expect(down.size).toBe(3);
    expect(up.size).toBe(3);                               // the light end has nowhere to go
    expect([...up.values()].some(c => c === R)).toBe(false);
    expect(shadeMap(pal, 3, 0, 1).get(((200 << 24) | (200 << 16) | (200 << 8) | 255) >>> 0)).toEqual([120, 120, 120, 255]);
  });
});

describe('palette files', () => {
  const pal = [R, G, [1, 2, 3, 255]];
  it('reads back what it writes (.gpl, .hex, .pal)', () => {
    const g = parsePalette(writeGPL('Test pal', pal), 'x.gpl');
    expect(g).toEqual({ name: 'Test pal', colors: pal });
    expect(parsePalette(writeHEX(pal), 'mine.hex')).toEqual({ name: 'mine', colors: pal });
    expect(parsePalette(writePAL(pal), 'p.pal').colors).toEqual(pal);
  });
  it('reads GIMP files written by other apps and pasted hex codes', () => {
    const gimp = 'GIMP Palette\nName: Sweet\nColumns: 4\n# comment\n 26  28  44\tUntitled\n 93  39  93 Plum\n';
    expect(parsePalette(gimp)).toEqual({ name: 'Sweet', colors: [[26, 28, 44, 255], [93, 39, 93, 255]] });
    expect(parsePalette('#1a1c2c, #5d275d; 3e8948 and #ff000080', 'pasted').colors).toEqual([[26, 28, 44, 255], [93, 39, 93, 255], [62, 137, 72, 255], [255, 0, 0, 128]]);
    expect(parsePalette('just words').colors).toEqual([]);
  });
  it('understands Lospec slugs and URLs', () => {
    expect(lospecSlug('https://lospec.com/palette-list/sweetie-16')).toBe('sweetie-16');
    expect(lospecSlug('lospec.com/palette-list/Endesga-32.json')).toBe('endesga-32');
    expect(lospecSlug('pico-8')).toBe('pico-8');
    expect(lospecSlug('../etc/passwd')).toBeNull();
    expect(fromLospecJSON({ name: 'Sweetie 16', author: 'GrafxKid', colors: ['1a1c2c', 'ffcd75'] })).toEqual({ name: 'Sweetie 16', author: 'GrafxKid', colors: [[26, 28, 44, 255], [255, 205, 117, 255]] });
  });
});

describe('colour tools', () => {
  it('replaces a colour (exactly, or within a tolerance) inside the selection only', () => {
    const src = px(R, [250, 0, 0, 255], G, R);
    expect(at(replaceColor(src, R, B), 1)).toEqual([250, 0, 0, 255]);
    expect(at(replaceColor(src, R, B, { tolerance: 3 }), 1)).toEqual(B);
    const masked = replaceColor(src, R, B, { mask: Uint8Array.of(0, 0, 0, 1) });
    expect(at(masked, 0)).toEqual(R); expect(at(masked, 3)).toEqual(B);
    expect(at(src, 0)).toEqual(R);                                         // input untouched
  });
  it('adjusts hue, saturation, value and channels, skipping empty pixels', () => {
    const out = adjustColors(px(R, T), { h: 120 });
    expect(at(out, 0)).toEqual([0, 255, 0, 255]); expect(at(out, 1)).toEqual(T);
    expect(at(adjustColors(px(R), { s: -100 }), 0)).toEqual([255, 255, 255, 255]);
    expect(at(adjustColors(px(R), { v: -100 }), 0)).toEqual([0, 0, 0, 255]);
    expect(at(adjustColors(px(R), { g: 40, a: -55 }), 0)).toEqual([255, 40, 0, 200]);
  });
  it('levels remap brightness per channel or together', () => {
    const lut = levelsLUT({ inLo: 50, inHi: 200 });
    expect(lut[50]).toBe(0); expect(lut[200]).toBe(255); expect(lut[125]).toBe(128);
    expect(at(applyLevels(px([100, 100, 100, 255]), { outLo: 0, outHi: 127 }), 0)).toEqual([50, 50, 50, 255]);
    expect(at(applyLevels(px([100, 100, 100, 255]), { channel: 'r', inHi: 100 }), 0)).toEqual([255, 100, 100, 255]);
  });
  it('outlines outside or inside, 4-way or 8-way', () => {
    const W = 5, H = 5, src = new Uint8ClampedArray(W * H * 4);
    src.set(R, (2 * W + 2) * 4);
    const four = outlinePixels(src, W, H, K), eight = outlinePixels(src, W, H, K, { eight: true });
    expect(colorCounts([four]).find(c => c.color[0] === 20).count).toBe(4);
    expect(colorCounts([eight]).find(c => c.color[0] === 20).count).toBe(8);
    const sq = new Uint8ClampedArray(W * H * 4);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) sq.set(R, (y * W + x) * 4);
    const inside = outlinePixels(sq, W, H, K, { inside: true });
    expect(at(inside, 2 * W + 2)).toEqual(R);                               // the middle stays
    expect(colorCounts([inside]).find(c => c.color[0] === 20).count).toBe(8);
  });
  it('anti-aliases stair steps but leaves straight edges and squares alone', () => {
    const W = 4, H = 4, src = new Uint8ClampedArray(W * H * 4);
    // a staircase: (0,3) (1,3) (1,2) (2,2) (2,1) (3,1)
    for (const [x, y] of [[0, 3], [1, 3], [1, 2], [2, 2], [2, 1], [3, 1]]) src.set(K, (y * W + x) * 4);
    const out = antiAlias(src, W, H, { strength: 0.5 });
    expect(at(out, 2 * W + 0)).toEqual([20, 20, 20, 128]);                  // inside corner above (0,3)
    expect(at(out, 0)).toEqual(T);                                          // far away: untouched
    const sq = new Uint8ClampedArray(W * H * 4);
    for (let y = 1; y < 3; y++) for (let x = 1; x < 3; x++) sq.set(K, (y * W + x) * 4);
    expect([...antiAlias(sq, W, H)]).toEqual([...sq]);
    expect([...antiAlias(src, W, H, { overEmpty: false })]).toEqual([...src]);
  });
});

describe('indexed files', () => {
  it('writes an indexed PNG that keeps the palette order', async () => {
    const pal = [K, R, G];
    const bytes = await encodeIndexedPNG(px(G, T, R, K), 2, 2, pal);
    const ch = pngChunks(bytes);
    expect(ch.map(c => c.type)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
    expect(ch.every(c => c.crcOk)).toBe(true);
    expect(ch[0].data[9]).toBe(3);                                          // colour type 3 = palette
    expect([...ch[1].data.subarray(0, 9)]).toEqual([20, 20, 20, 255, 0, 0, 0, 200, 0]);
    const rows = await unzlib(ch[3].data);
    expect([...rows]).toEqual([0, 2, 3, 0, 1, 0]);                          // filter byte + indexes
    expect(await encodeIndexedPNG(px([1, 2, 3, 255]), 1, 1, pal)).toBeNull();
  });
  it('round-trips indexed artwork through .aseprite as an 8-bit file', async () => {
    const sp = createSprite({ width: 3, height: 2, palette: ['#141414', '#ff0000', '#00c800'] });
    sp.colorMode = 'indexed';
    sp.cels[0].pixels.set([...R, ...T, ...G, ...K, ...R, ...T]);
    const bytes = await writeAseprite(sp);
    expect(new DataView(bytes.buffer).getUint16(12, true)).toBe(8);         // colour depth
    const { sprite } = await readAseprite(bytes);
    expect(sprite.colorMode).toBe('indexed');
    expect(sprite.palette.slice(0, 3)).toEqual(sp.palette);
    expect([...sprite.cels[0].pixels]).toEqual([...sp.cels[0].pixels]);
    // a colour outside the palette falls back to a 32-bit file
    sp.cels[0].pixels.set([1, 2, 3, 255], 0);
    expect(new DataView((await writeAseprite(sp)).buffer).getUint16(12, true)).toBe(32);
  });
});
