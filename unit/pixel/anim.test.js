// Unit tests for Phase 3: file formats for animation (GIF, APNG, sprite sheets, .aseprite)
import { describe, it, expect } from '../expect.js';
import { createSprite, uid } from '../../src/pixel/core/sprite.js';
import { encodeGIF, decodeGIF, medianCut } from '../../src/pixel/core/gif.js';
import { encodeAPNG, pngChunks } from '../../src/pixel/core/apng.js';
import { sheetLayout, buildSheet, sheetJSON } from '../../src/pixel/core/sheet.js';
import { readAseprite, writeAseprite } from '../../src/pixel/core/aseprite.js';
import { encodeProject, decodeProject } from '../../src/pixel/core/format.js';
import { displayRows, leafLayers } from '../../src/pixel/core/layers.js';
import { imageChunks, muxWebP } from '../../src/pixel/core/webp.js';

const frame = (w, h, rgba, at = []) => { const p = new Uint8ClampedArray(w * h * 4); for (const [x, y] of at) p.set(rgba, (y * w + x) * 4); return p; };

// A sprite with 3 frames, a group, a blend mode, a tag and linked cels
function animated() {
  const sp = createSprite({ name: 'Bird', width: 8, height: 6, palette: ['#2b1d1a', '#f25f6b'] });
  sp.frames.push({ id: uid(), durationMs: 80 }, { id: uid(), durationMs: 250 });
  const base = sp.layers[0];
  const g = { id: uid(), kind: 'group', name: 'Wings', visible: true, locked: false, opacity: 200, blend: 'normal', collapsed: false, children: [] };
  const wing = { id: uid(), kind: 'regular', name: 'Wing', visible: true, locked: false, opacity: 255, blend: 'multiply', autoLinkOnDuplicate: false };
  g.children.push(wing); sp.layers.push(g);
  sp.cels = [];
  sp.frames.forEach((f, i) => sp.cels.push({ layerId: base.id, frameId: f.id, x: 0, y: 0, w: 8, h: 6, pixels: frame(8, 6, [43, 29, 26, 255], [[i, 1], [i + 1, 2]]) }));
  const shared = frame(8, 6, [242, 95, 107, 255], [[5, 5]]);
  sp.frames.forEach((f, i) => sp.cels.push({ layerId: wing.id, frameId: f.id, x: 0, y: 0, w: 8, h: 6, pixels: i < 2 ? shared : frame(8, 6, [0, 0, 255, 255], [[7, 0]]), ...(i < 2 ? { link: 'L1' } : {}), ...(i === 2 ? { opacity: 128, userData: 'hit' } : {}) }));
  sp.tags.push({ id: uid(), name: 'flap', from: 0, to: 1, direction: 'pingpong', repeat: 2, color: '#0e8a9e' });
  return sp;
}

describe('GIF', () => {
  it('writes frames, timing, looping and transparency that read back the same', () => {
    const a = frame(4, 3, [255, 0, 0, 255], [[0, 0], [3, 2]]), b = frame(4, 3, [0, 128, 255, 255], [[1, 1]]);
    const bytes = encodeGIF([{ pixels: a, delayMs: 100 }, { pixels: b, delayMs: 250 }], 4, 3, { loop: 0 });
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    const g = decodeGIF(bytes);
    expect([g.width, g.height, g.frames.length, g.loop]).toEqual([4, 3, 2, 0]);
    expect(g.frames.map(f => f.delayMs)).toEqual([100, 250]);
    expect([...g.frames[0].pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(g.frames[0].pixels[7]).toBe(0);                     // transparent pixel stays clear
    expect([...g.frames[1].pixels.slice(20, 24)]).toEqual([0, 128, 255, 255]);
  });
  it('reduces more than 255 colours with median cut', () => {
    const entries = Array.from({ length: 600 }, (_, i) => [((i * 7) % 256 << 16) | ((i * 3) % 256 << 8) | (i % 256), 1]);
    expect(medianCut(entries, 255).length).toBe(255);
  });
});

describe('APNG', () => {
  it('has the animation chunks in order with valid checksums', async () => {
    const f = { pixels: frame(2, 2, [1, 2, 3, 255], [[0, 0]]), delayMs: 120 };
    const chunks = pngChunks(await encodeAPNG([f, f, f], 2, 2, { loop: 0 }));
    expect(chunks.map(c => c.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'fcTL', 'fdAT', 'IEND']);
    expect(chunks.every(c => c.crcOk)).toBe(true);
    const ac = new DataView(chunks[1].data.buffer, chunks[1].data.byteOffset);
    expect([ac.getUint32(0), ac.getUint32(4)]).toEqual([3, 0]);
    const fc = new DataView(chunks[2].data.buffer, chunks[2].data.byteOffset);
    expect([fc.getUint16(20), fc.getUint16(22)]).toEqual([120, 1000]);
  });
  it('is a plain PNG with one frame', async () => {
    const chunks = pngChunks(await encodeAPNG([{ pixels: frame(1, 1, [0, 0, 0, 255], [[0, 0]]), delayMs: 100 }], 1, 1));
    expect(chunks.map(c => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });
});

describe('sprite sheets', () => {
  it('lays frames out square, in a row, a column or N columns, with spacing', () => {
    expect(sheetLayout(5, 4, 4)).toMatchObject({ cols: 3, rows: 2, width: 12, height: 8 });
    expect(sheetLayout(5, 4, 4, { layout: 'rows' })).toMatchObject({ width: 20, height: 4 });
    expect(sheetLayout(5, 4, 4, { layout: 'columns' })).toMatchObject({ width: 4, height: 20 });
    const L = sheetLayout(4, 4, 4, { layout: 'custom', cols: 2, border: 1, spacing: 2, padding: 1 });
    expect([L.width, L.height]).toEqual([1 + 6 + 2 + 6 + 1, 16]);
    expect(L.pos[3]).toEqual({ x: 1 + 6 + 2 + 1, y: 1 + 6 + 2 + 1 });
  });
  it('writes the frames into the sheet and Aseprite-style JSON', () => {
    const f = [{ pixels: frame(2, 2, [9, 9, 9, 255], [[0, 0]]), delayMs: 100, name: 'a 0' }, { pixels: frame(2, 2, [8, 8, 8, 255], [[1, 1]]), delayMs: 200, name: 'a 1' }];
    const sh = buildSheet(f, 2, 2, { layout: 'rows' });
    expect([sh.width, sh.height]).toEqual([4, 2]);
    expect([...sh.pixels.slice(0, 4)]).toEqual([9, 9, 9, 255]);
    expect([...sh.pixels.slice((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 4)]).toEqual([8, 8, 8, 255]);
    const hash = sheetJSON(f, sh.pos, 2, 2, 4, 2, { tags: [{ name: 'run', from: 0, to: 1, direction: 'forward', color: '#f00' }] });
    expect(hash.frames['a 1']).toMatchObject({ frame: { x: 2, y: 0, w: 2, h: 2 }, duration: 200 });
    expect(hash.meta.frameTags[0]).toMatchObject({ name: 'run', from: 0, to: 1, direction: 'forward' });
    const arr = sheetJSON(f, sh.pos, 2, 2, 4, 2, { format: 'array' });
    expect(arr.frames[1].filename).toBe('a 1');
  });
});

describe('.aseprite', () => {
  it('round-trips layers, groups, blend modes, frames, timings, tags, linked cels and cel data', async () => {
    const sp = animated();
    const back = (await readAseprite(await writeAseprite(sp))).sprite;
    expect(displayRows(back).map(r => [r.node.name, r.depth, r.node.kind, r.node.blend, r.node.opacity])).toEqual(displayRows(sp).map(r => [r.node.name, r.depth, r.node.kind, r.node.blend, r.node.opacity]));
    expect(back.frames.map(f => f.durationMs)).toEqual([100, 80, 250]);
    expect(back.tags.map(t => [t.name, t.from, t.to, t.direction, t.repeat, t.color])).toEqual([['flap', 0, 1, 'pingpong', 2, '#0e8a9e']]);
    const [b0, w0] = leafLayers(back);
    const cel = (l, i) => back.cels.find(c => c.layerId === l.id && c.frameId === back.frames[i].id);
    expect(cel(w0, 0).pixels).toBe(cel(w0, 1).pixels);        // still linked
    expect(cel(w0, 2).opacity).toBe(128);
    expect(cel(w0, 2).userData).toBe('hit');
    for (let i = 0; i < 3; i++) expect([...cel(b0, i).pixels]).toEqual([...sp.cels.find(c => c.layerId === sp.layers[0].id && c.frameId === sp.frames[i].id).pixels]);
    expect(back.palette.length).toBe(2);
  });
  it('rejects files that are not Aseprite files', async () => {
    await expect(readAseprite(new Uint8Array(200))).rejects.toThrow(/Aseprite/);
  });
});

describe('saving animations', () => {
  it('keeps frames, tags, linked cels, cel opacity and notes', async () => {
    const sp = animated();
    const back = await decodeProject(await encodeProject(sp));
    const w = leafLayers(back)[1];
    const cels = back.frames.map(f => back.cels.find(c => c.layerId === w.id && c.frameId === f.id));
    expect(cels[0].pixels).toBe(cels[1].pixels);
    expect(cels[0].link).toBe('L1');
    expect(cels[2].opacity).toBe(128);
    expect(cels[2].userData).toBe('hit');
    expect(back.tags[0].name).toBe('flap');
    expect(back.frames.map(f => f.durationMs)).toEqual([100, 80, 250]);
  });
});

describe('WebP container', () => {
  it('wraps still frames into an animation', () => {
    // a fake still: RIFF....WEBP + one VP8L chunk of 3 bytes (padded to 4)
    const still = Uint8Array.from([82, 73, 70, 70, 16, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 3, 0, 0, 0, 1, 2, 3, 0]);
    expect(imageChunks(still).length).toBe(1);
    const out = muxWebP([{ webp: still, delayMs: 90 }, { webp: still, delayMs: 90 }], 4, 4);
    const s = String.fromCharCode(...out);
    expect(s.slice(0, 4)).toBe('RIFF'); expect(s.slice(8, 12)).toBe('WEBP');
    expect(s.indexOf('VP8X')).toBe(12);
    expect(s.split('ANMF').length - 1).toBe(2);
    expect(out[4] | (out[5] << 8) | (out[6] << 16)).toBe(out.length - 8);
  });
});
