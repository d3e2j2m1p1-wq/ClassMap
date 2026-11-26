// Unit tests for Phase 5b: tilemaps (and their .aseprite round trip)
import { describe, it, expect } from '../expect.js';
import { readFileSync, existsSync } from 'node:fs';
import { newTileset, renderMap, sliceToTiles, tidyTiles, tilesheet, tilesFromSheet, tilePixelFor, FLIP_X, FLIP_Y, FLIP_D, gridSize } from '../../src/pixel/core/tiles.js';
import { readAseprite, writeAseprite } from '../../src/pixel/core/aseprite.js';
import { createSprite } from '../../src/pixel/core/sprite.js';

const R = [255, 0, 0, 255], B = [0, 0, 255, 255];
// a 2×2 tile: red top-left, blue top-right
const tile = () => { const t = new Uint8ClampedArray(16); t.set(R, 0); t.set(B, 4); return t; };
const at = (px, W, x, y) => [...px.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

describe('tilemaps', () => {
  it('draws tiles with flips', () => {
    const set = newTileset('t', 2, 2); set.tiles.push(tile());
    const map = Uint32Array.from([1, (1 | FLIP_X) >>> 0, (1 | FLIP_Y) >>> 0, (1 | FLIP_D) >>> 0]);
    const px = renderMap(4, 4, set, map);
    expect(at(px, 4, 0, 0)).toEqual(R); expect(at(px, 4, 1, 0)).toEqual(B);   // as drawn
    expect(at(px, 4, 2, 0)).toEqual(B); expect(at(px, 4, 3, 0)).toEqual(R);   // flipped ↔
    expect(at(px, 4, 0, 3)).toEqual(R); expect(at(px, 4, 0, 2)[3]).toBe(0);  // flipped ↕
    expect(at(px, 4, 2, 2)).toEqual(R); expect(at(px, 4, 2, 3)).toEqual(B);   // x / y swapped
    expect(tilePixelFor(1, 0, 2, 2, FLIP_X)).toEqual([0, 0]);
  });
  it('slices art into shared tiles and tidies them', () => {
    const W = 4, H = 2, px = new Uint8ClampedArray(W * H * 4);
    px.set(R, 0); px.set(R, 8);                                               // two identical 2×2 cells
    const set = newTileset('t', 2, 2);
    const [map] = sliceToTiles([px], W, H, set);
    expect(set.tiles.length).toBe(2);
    expect([...map]).toEqual([1, 1]);
    expect([...renderMap(W, H, set, map)]).toEqual([...px]);
    set.tiles.push(set.tiles[1].slice(), new Uint8ClampedArray(16).fill(9));
    const r = tidyTiles(set, [Uint32Array.from([1, 2])], { dropUnused: true });
    expect(r.tiles.length).toBe(2); expect([...r.maps[0]]).toEqual([1, 1]); expect(r.removed).toBe(2);
    expect(gridSize(5, 3, 2, 2)).toEqual({ cols: 3, rows: 2 });
  });
  it('tile sheets go out and come back', () => {
    const set = newTileset('t', 2, 2); set.tiles.push(tile(), tile().reverse());
    const s = tilesheet(set, 8);
    expect([s.w, s.h]).toEqual([4, 2]);
    expect(tilesFromSheet(s.pixels, s.w, s.h, 2, 2).map(t => [...t])).toEqual(set.tiles.slice(1).map(t => [...t]));
  });
  it('round-trips a tilemap layer through .aseprite', async () => {
    const sp = createSprite({ width: 4, height: 4 });
    const set = newTileset('Ground', 2, 2); set.tiles.push(tile());
    sp.tilesets = [set];
    const L = sp.layers[0]; L.kind = 'tilemap'; L.tilesetId = set.id;
    const map = Uint32Array.from([1, 0, 0, (1 | FLIP_X) >>> 0]);
    Object.assign(sp.cels[0], { map, pixels: renderMap(4, 4, set, map) });
    const { sprite } = await readAseprite(await writeAseprite(sp));
    expect(sprite.layers[0].kind).toBe('tilemap');
    expect(sprite.tilesets[0]).toMatchObject({ name: 'Ground', tw: 2, th: 2 });
    expect([...sprite.cels[0].map]).toEqual([...map]);
    expect([...sprite.cels[0].pixels]).toEqual([...sp.cels[0].pixels]);
  });
  it("reads Aseprite's own tilemap test sprites", async () => {
    const f = '/tmp/aserepo/tests/sprites/2x2tilemap2x2tile.aseprite';
    if (!existsSync(f)) return;                                              // only where Aseprite's repo is checked out
    const { sprite, warnings } = await readAseprite(new Uint8Array(readFileSync(f)));
    expect(warnings).toEqual([]);
    expect(sprite.tilesets[0].tiles.length).toBe(5);
    expect(sprite.cels.find(c => c.map).map.length).toBe(9);
  });
});
