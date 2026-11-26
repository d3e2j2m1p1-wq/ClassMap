// ClassMap Pixel — Phase 4 browser tests (indexed colour, palette tools, shading, colour tools)
import { test, expect } from '@playwright/test';

async function newArt(page, { w = 8, h = 8, name = 'Colour', mode = 'rgba' } = {}) {
  await page.addInitScript(() => {
    window.__pxDownloads = [];
    window.__pxDownload = async (a, blob) => { window.__pxDownloads.push({ name: a.download, type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())], text: await blob.text() }); };
  });
  await page.goto('/pixel/');
  await page.click('.px-new');
  await page.fill('.px-na-name', name);
  await page.fill('.px-na-w', String(w));
  await page.fill('.px-na-h', String(h));
  if (mode === 'indexed') await page.click('.px-new-art .px-seg [data-v="indexed"]');
  await page.click('.px-dialog .px-btn-primary');
  await page.waitForFunction(() => window.__px?.state.sprite && window.__px.view.zoom > 0);
}
async function at(page, x, y) {
  const r = await page.locator('#stage canvas').boundingBox();
  const v = await page.evaluate(() => ({ z: __px.view.zoom, ox: __px.view.ox, oy: __px.view.oy }));
  return [r.x + v.ox + (x + 0.5) * v.z, r.y + v.oy + (y + 0.5) * v.z];
}
const click = async (page, x, y) => page.mouse.click(...await at(page, x, y));
const px = (page, x, y) => page.evaluate(([x, y]) => { const c = __px.state.cel; const o = (y * c.w + x) * 4; return [...c.pixels.slice(o, o + 4)]; }, [x, y]);
const palette = page => page.evaluate(() => __px.state.sprite.palette.map(c => [...c]));
const setPrimary = (page, c) => page.evaluate(c => { __px.state.settings.primary = c; }, c);
const ok = page => page.locator('.px-dialog .px-btn-primary').last().click();
const undo = page => page.evaluate(() => __px.actions.run('undo'));
const colorTool = async (page, a) => { await page.click('.px-color-tools'); await page.click(`.px-menu [data-a="${a}"]`); };
const palTool = async (page, a) => { await page.click('.px-pal-menu'); await page.click(`.px-pal-tools [data-a="${a}"]`); };

test('indexed: converts both ways with no colour loss, and editing a swatch recolours the art', async ({ page }) => {
  await newArt(page);
  const odd = [[200, 10, 10, 255], [10, 120, 200, 255], [90, 200, 90, 128]];
  for (const [i, c] of odd.entries()) { await setPrimary(page, c); await click(page, i, 0); }
  const before = await page.evaluate(() => [...__px.state.cel.pixels]);
  await colorTool(page, 'mode');
  await ok(page);
  expect(await page.evaluate(() => __px.state.sprite.colorMode)).toBe('indexed');
  expect(await page.evaluate(() => [...__px.state.cel.pixels])).toEqual(before);        // nothing moved
  const pal = await palette(page);
  for (const c of odd) expect(pal).toContainEqual(c);
  await expect(page.locator('.px-pal-mode')).toContainText('Indexed');
  // back to RGBA: lossless
  await colorTool(page, 'mode');
  await ok(page);
  expect(await page.evaluate(() => __px.state.sprite.colorMode)).toBe('rgba');
  expect(await page.evaluate(() => [...__px.state.cel.pixels])).toEqual(before);
  // indexed again: editing the swatch for [200,10,10] recolours that pixel, and undo puts it back
  await colorTool(page, 'mode');
  await ok(page);
  const k = (await palette(page)).findIndex(c => c.join() === '200,10,10,255');
  await page.click(`.px-swatches .px-sw[data-i="${k}"]`);
  await page.click(`.px-swatches .px-sw[data-i="${k}"]`);                                // tap again = edit
  await page.fill('.px-hex input', '#00ff00');
  await page.keyboard.press('Escape');
  expect(await px(page, 0, 0)).toEqual([0, 255, 0, 255]);
  expect((await palette(page))[k]).toEqual([0, 255, 0, 255]);
  await undo(page);
  expect(await px(page, 0, 0)).toEqual([200, 10, 10, 255]);
  expect((await palette(page))[k]).toEqual([200, 10, 10, 255]);
});

test('indexed: you can only paint palette colours, and pasted colours snap to the palette', async ({ page }) => {
  await newArt(page, { mode: 'indexed' });
  expect(await page.evaluate(() => __px.state.sprite.colorMode)).toBe('indexed');
  await setPrimary(page, [250, 3, 3, 128]);                     // not in the palette, see-through
  await click(page, 2, 2);
  const c = await px(page, 2, 2);
  expect(await palette(page)).toContainEqual(c);
  expect(c[3]).toBe(255);
  // sorting doesn't change the art
  const art = await page.evaluate(() => [...__px.state.cel.pixels]);
  await palTool(page, 'sort');
  await page.selectOption('.px-sort-by', 'lightness');
  await ok(page);
  expect(await page.evaluate(() => [...__px.state.cel.pixels])).toEqual(art);
  // deleting the colour in use moves those pixels to the nearest remaining colour
  const k = (await palette(page)).findIndex(x => x.join() === c.join());
  await page.locator(`.px-swatches .px-sw[data-i="${k}"]`).click({ delay: 600 });
  await page.click('.px-menu [data-a="delete"]');
  await ok(page);                                       // unlock
  const after = await px(page, 2, 2);
  expect(after).not.toEqual(c);
  expect(await palette(page)).toContainEqual(after);
});

test('gradient generator adds colours after the selected swatch; undo removes them', async ({ page }) => {
  await newArt(page);
  const n = (await palette(page)).length;
  await page.click('.px-swatches .px-sw[data-i="0"]');
  await palTool(page, 'gradient');
  await page.locator('.px-range input[data-name="steps"]').fill('5');
  await page.click('.px-seg [data-v="hsv"]');
  await page.click('.px-toggle:has(input[data-name="exclude"])');
  await expect(page.locator('.px-preview-strip .px-strip i')).toHaveCount(3);
  await ok(page);
  expect((await palette(page)).length).toBe(n + 3);
  await undo(page);
  expect((await palette(page)).length).toBe(n);
});

test('reduce the palette, and the lock stops colours being removed until you unlock it', async ({ page }) => {
  await newArt(page);
  await expect(page.locator('.px-badge-lock')).toBeVisible();               // opens locked
  await palTool(page, 'reduce');
  await page.locator('.px-range input[data-name="n"]').fill('4');
  await page.click('.px-seg [data-v="kmeans"]');
  await ok(page);                                       // Reduce
  await expect(page.locator('.px-dialog h2').last()).toHaveText('Unlock the palette?');
  await ok(page);
  expect((await palette(page)).length).toBe(4);
  await expect(page.locator('.px-badge-lock')).toHaveCount(0);
  await undo(page);
  expect((await palette(page)).length).toBeGreaterThan(4);
});

test('palette files: export .gpl / .hex, then paste hex codes in', async ({ page }) => {
  await newArt(page);
  await palTool(page, 'export');
  await page.click('.px-menu [data-f="gpl"]');
  await palTool(page, 'export');
  await page.click('.px-menu [data-f="hex"]');
  await page.waitForFunction(() => __px && window.__pxDownloads.length === 2);
  const files = await page.evaluate(() => window.__pxDownloads.map(d => ({ name: d.name, text: d.text })));
  expect(files[0].name).toMatch(/\.gpl$/);
  expect(files[0].text).toMatch(/^GIMP Palette\nName: Colour/);
  expect(files[1].text.trim().split('\n').length).toBe((await palette(page)).length);
  await palTool(page, 'lospec');
  await page.click('.px-paste summary');
  await page.fill('.px-paste-in', '#1a1c2c #5d275d #b13e53');
  await ok(page);                                       // Get palette
  await expect(page.locator('.px-imp-name')).toHaveText('Pasted palette');
  await ok(page);                                       // Use this palette
  await ok(page);                                       // Replace
  expect(await palette(page)).toEqual([[26, 28, 44, 255], [93, 39, 93, 255], [177, 62, 83, 255]]);
});

test('Lospec: fetches the public palette JSON (through classmap.dev when needed)', async ({ page }) => {
  await page.route('https://lospec.com/**', r => r.abort());                            // blocked direct
  await page.route('**/api/lospec/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'Tiny 2', author: 'Someone', colors: ['000000', 'ffffff'] }) }));
  await newArt(page);
  await palTool(page, 'lospec');
  await page.fill('.px-lospec-in', 'https://lospec.com/palette-list/tiny-2');
  await ok(page);
  await expect(page.locator('.px-imp-name')).toHaveText('Tiny 2');
  await page.click('.px-toggle:has(input[data-name="save"])');
  await ok(page);
  await ok(page);
  expect(await palette(page)).toEqual([[0, 0, 0, 255], [255, 255, 255, 255]]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pixel:palettes')).at(-1).name)).toBe('Tiny 2');
});

test('shading steps ramp colours one at a time and leaves others alone', async ({ page }) => {
  await newArt(page);
  await page.evaluate(() => {
    const p = __px.state.sprite.palette;
    p.splice(0, p.length, [20, 20, 20, 255], [80, 80, 80, 255], [160, 160, 160, 255], [240, 240, 240, 255], [255, 0, 0, 255]);
    __px.state.settings.primary = [80, 80, 80, 255];
  });
  await click(page, 1, 1);
  await setPrimary(page, [255, 0, 0, 255]);
  await click(page, 2, 1);
  await colorTool(page, 'shading');
  await page.click('.px-shade-grid [data-i="0"]');
  await page.click('.px-shade-grid [data-i="3"]');
  await page.keyboard.press('Escape');
  await expect(page.locator('.px-badge-shade')).toContainText('lighten');
  await page.mouse.move(...await at(page, 0, 1));
  await page.mouse.down();
  await page.mouse.move(...await at(page, 1, 1), { steps: 3 });
  await page.mouse.move(...await at(page, 2, 1), { steps: 3 });
  await page.mouse.up();
  expect(await px(page, 1, 1)).toEqual([160, 160, 160, 255]);             // one step lighter
  expect(await px(page, 2, 1)).toEqual([255, 0, 0, 255]);                 // not in the ramp
  expect((await px(page, 0, 1))[3]).toBe(0);                              // empty stays empty
  await page.click('.px-swatches .px-sw[data-i="1"]');                    // tap the ramp: flip
  await expect(page.locator('.px-badge-shade')).toContainText('darken');
  await click(page, 1, 1);
  expect(await px(page, 1, 1)).toEqual([80, 80, 80, 255]);
});

test('colour tools preview live; Apply is one undo step and Cancel puts it back', async ({ page }) => {
  await newArt(page);
  await setPrimary(page, [255, 0, 0, 255]);
  await click(page, 3, 3);
  await page.evaluate(() => { __px.state.settings.secondary = [0, 0, 255, 255]; });
  await colorTool(page, 'replace');
  await page.waitForTimeout(80);
  expect(await px(page, 3, 3)).toEqual([0, 0, 255, 255]);                 // preview
  await page.locator('.px-dialog .px-btn-ghost').last().click();                           // Cancel
  expect(await px(page, 3, 3)).toEqual([255, 0, 0, 255]);
  // outline outside, 8-way
  await colorTool(page, 'outline');
  await page.click('.px-seg [data-v="eight"]');
  await ok(page);
  const ring = await page.evaluate(() => { const p = __px.state.cel.pixels; let n = 0; for (let i = 3; i < p.length; i += 4) if (p[i]) n++; return n; });
  expect(ring).toBe(9);
  await undo(page);
  expect((await px(page, 2, 2))[3]).toBe(0);
  // adjust hue by 120°: red → green
  await colorTool(page, 'adjust');
  await page.locator('.px-range input[data-name="h"]').fill('120');
  await ok(page);
  expect(await px(page, 3, 3)).toEqual([0, 255, 0, 255]);
  // levels: output brightest 127 halves it
  await colorTool(page, 'levels');
  await page.locator('.px-range input[data-name="outHi"]').fill('127');
  await ok(page);
  expect(await px(page, 3, 3)).toEqual([0, 127, 0, 255]);
});

test('anti-alias softens a stair step; remap moves art to another palette', async ({ page }) => {
  await newArt(page);
  await setPrimary(page, [20, 20, 20, 255]);
  for (const [x, y] of [[0, 3], [1, 3], [1, 2], [2, 2], [2, 1], [3, 1]]) await click(page, x, y);
  await colorTool(page, 'aa');
  await ok(page);
  expect(await px(page, 0, 2)).toEqual([20, 20, 20, 128]);
  expect((await px(page, 0, 0))[3]).toBe(0);
  await colorTool(page, 'remap');
  await page.selectOption('.px-remap-src', 'b4');                         // Grayscale 8
  await page.click('.px-seg [data-v="all"]');
  await ok(page);
  const gray = await page.evaluate(() => __px.state.sprite.palette);       // own palette unchanged (RGBA)
  expect(gray.length).toBeGreaterThan(8);
  const c = await px(page, 1, 3);
  expect(c[0] === c[1] && c[1] === c[2]).toBe(true);
});

test('indexed PNG export keeps the palette, and grid layout lines ramps up in rows', async ({ page }) => {
  await newArt(page, { mode: 'indexed' });
  await page.click('.px-swatches .px-sw[data-i="2"]');
  await click(page, 1, 1);
  await page.click('.px-export-btn');
  await page.click('.px-tabs [data-tab="png"]');
  await ok(page);
  await page.waitForFunction(() => window.__pxDownloads.length === 1);
  const bytes = await page.evaluate(() => window.__pxDownloads[0].bytes.slice(0, 40));
  expect(bytes[25]).toBe(3);                                              // PNG colour type 3 = palette
  // grid layout with a row break
  await page.click('.px-pal-menu');
  await page.click('.px-pal-tools [data-a="layout"]');
  await page.click('.px-opts .px-seg [data-v="grid"]');
  await page.keyboard.press('Escape');
  await page.locator('.px-swatches .px-sw[data-i="3"]').click({ delay: 600 });
  await page.click('.px-menu [data-a="row"]');
  await expect(page.locator('.px-swatches .px-sw-gap')).toHaveCount(5);
  const tops = await page.evaluate(() => ['2', '3'].map(i => document.querySelector(`.px-sw[data-i="${i}"]`).getBoundingClientRect().top));
  expect(tops[1]).toBeGreaterThan(tops[0]);
});
