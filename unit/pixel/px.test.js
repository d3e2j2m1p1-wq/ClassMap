// .px import: a small file laid out the way Pixquare's published binary spec describes
import { describe, it, expect } from '../expect.js';
import { pxToSprite } from '../../src/pixel/core/px.js';
import { zlib } from '../../src/pixel/core/format.js';

// tiny writer for the test file
class W {
  constructor() { this.a = []; }
  get n() { return this.a.length; }
  u8(x) { this.a.push(x & 255); return this; }
  u16(x) { return this.u8(x).u8(x >> 8); }
  u32(x) { return this.u16(x & 0xffff).u16(x >>> 16); }
  u64(x) { return this.u32(x).u32(0); }
  f16one() { return this.u16(0x3c00); }      // 1.0
  bytes(b) { for (const x of b) this.u8(x); return this; }
  str(s) { return this.bytes(new TextEncoder().encode(s)); }
  pad(to) { while (this.a.length < to) this.u8(0); return this; }
  out() { return Uint8Array.from(this.a); }
}
// header of `head` bytes (size first), then the content
function model(head, wide, fillHeader, content) {
  const c = new W(); content(c);
  const h = new W(); if (wide) h.u64(c.n); else h.u32(c.n); fillHeader(h); h.pad(head);
  return [...h.a, ...c.a];
}

async function sample() {
  const Wd = 2, Ht = 2;
  // two frame contents: red dot, and half-see-through blue (premultiplied)
  const raw1 = Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const raw2 = Uint8Array.from([0, 0, 0, 0, 0, 0, 64, 128, 0, 0, 0, 0, 0, 0, 0, 0]);
  const z1 = await zlib(raw1), z2 = await zlib(raw2);
  const fc = (id, raw, z) => { const c = new W(); c.str(id).bytes(z); const h = new W(); h.u64(c.n).u8(id.length).u32(raw.length).u32(z.length).u8(1).pad(32); return [...h.a, ...c.a]; };
  const frame = (id, dur, content) => model(32, false, h => h.u8(id.length).u8(content.length), c => { c.str(id).u32(dur).u8(0).str(content).f16one().u16(0).u64(0); });
  const entry = (type, id) => model(16, false, h => h.u8(type), c => { c.u8(id.length).str(id); });
  const layer = model(32, false, h => h.u8(2).u8(3).u8(15), c => {
    c.str('L1').str('Ink').u64(2).bytes(frame('F1', 120, 'C1')).bytes(frame('F2', 80, 'C2'));
    c.f16one().u8(1).u8(0).u8(0).u8(0).u16(2);                       // visible, blend = screen
    c.u8(0).u64(0).u64(0).u32(0).u64(0);
  });
  const group = model(32, false, h => h.u8(2).u8(5), c => { c.str('G1').str('Group').u64(1).bytes(entry(0, 'L1')).f16one().u8(1).u8(0).u8(0).u8(0).u8(1); });
  const tag = model(16, false, h => h.u8(2).u8(4), c => { c.str('T1').str('Walk').u16(0).u16(1).u8(0).bytes([10, 20, 30, 255]).u8(2).u16(0); });
  const body = new W();
  body.str('ART').u32(Wd).u32(Ht);
  body.u64(1).bytes(entry(1, 'G1'));                                  // root: the group
  body.u64(1).bytes(group);
  body.u64(1).bytes(layer);
  body.u64(2).bytes(fc('C1', raw1, z1)).bytes(fc('C2', raw2, z2));
  body.u64(2).bytes([255, 0, 0, 255]).bytes([0, 0, 64, 128]);         // palette
  body.u64(0).u64(0).u64(0);                                          // references, PNGs, symmetry
  body.u64(1).bytes(tag);
  body.u64(0).u64(0).u64(0).u8(0);                                    // tilesets, tilemaps, RGB
  const head = new W(); head.u64(64 + body.n).u8(3).u16(2).pad(64);
  return Uint8Array.from([...head.a, ...body.a]);
}

describe('.px import', () => {
  it('reads layers, groups, frames, durations, pixels, palette and tags', async () => {
    const { sprite, warnings } = await pxToSprite(await sample(), 'Test');
    expect(warnings).toEqual([]);
    expect([sprite.width, sprite.height]).toEqual([2, 2]);
    expect(sprite.layers[0]).toMatchObject({ kind: 'group', name: 'Group' });
    expect(sprite.layers[0].children[0]).toMatchObject({ kind: 'regular', name: 'Ink', blend: 'screen', opacity: 255 });
    expect(sprite.frames.map(f => f.durationMs)).toEqual([120, 80]);
    expect([...sprite.cels[0].pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...sprite.cels[1].pixels.slice(4, 8)]).toEqual([0, 0, 128, 128]);   // un-premultiplied
    expect(sprite.palette).toEqual([[255, 0, 0, 255], [0, 0, 128, 128]]);
    expect(sprite.tags).toMatchObject([{ name: 'Walk', from: 0, to: 1, direction: 'pingpong', color: '#0a141e' }]);
  });
  it('says so politely when it is not a .px file', async () => {
    let msg = '';
    try { await pxToSprite(new Uint8Array(100)); } catch (e) { msg = e.message; }
    expect(msg.length > 0).toBe(true);
  });
});
