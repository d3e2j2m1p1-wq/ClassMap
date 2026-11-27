// ClassMap Pixel — Phase 5b browser tests (tilemaps, links, version backups, timelapse, video,
// themes, left-hand mode, joystick, .px)
import { test, expect } from '@playwright/test';

async function newArt(page, { w = 16, h = 16 } = {}) {
  await page.addInitScript(() => {
    window.__pxDownloads = [];
    window.__pxDownload = async (a, blob) => { window.__pxDownloads.push({ name: a.download, type: blob.type, size: blob.size }); };
  });
  await page.goto('/pixel/');
  await page.click('.px-new');
  await page.fill('.px-na-w', String(w));
  await page.fill('.px-na-h', String(h));
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
const ok = page => page.locator('.px-dialog .px-btn-primary').last().click();
const undo = page => page.evaluate(() => __px.actions.run('undo'));
const setPrimary = (page, c) => page.evaluate(c => { __px.state.settings.primary = c; }, c);
const layerMenu = page => page.click('.px-lay-head .px-icon-btn:last-child');

test('tilemap: place tiles, draw on one and every copy changes, new tiles from empty cells', async ({ page }) => {
  await newArt(page, { w: 8, h: 8 });
  await layerMenu(page);
  await page.click('.px-menu [data-a="tilemap"]');
  await page.click('.px-dialog .px-seg [data-v="0"]');
  await page.fill('.px-tm-w', '4'); await page.fill('.px-tm-h', '4');
  await ok(page);
  await expect(page.locator('.px-tiles')).toBeVisible();
  // pixels mode: drawing in an empty cell makes tile 1
  await page.click('.px-tiles-mode [data-v="pixels"]');
  await setPrimary(page, [200, 30, 30, 255]);
  await click(page, 0, 0);
  await expect(page.locator('.px-tile:not(.empty)')).toHaveCount(1);
  // tiles mode: stamp tile 1 into the other three cells
  await page.click('.px-tiles-mode [data-v="tiles"]');
  await page.click('.px-tile[data-i="1"]');
  await click(page, 5, 1); await click(page, 1, 5);
  await page.click('.px-tiles-flips [aria-label="Flip left-right"]');
  await click(page, 5, 5);
  expect(await px(page, 4, 0)).toEqual([200, 30, 30, 255]);
  expect(await px(page, 7, 4)).toEqual([200, 30, 30, 255]);             // flipped copy: top-right
  // draw on a copy in pixels mode: the tile (and every copy) changes
  await page.click('.px-tiles-mode [data-v="pixels"]');
  await setPrimary(page, [0, 0, 200, 255]);
  await click(page, 5, 4);                                               // on the flipped copy: tile pixel (2,0)
  expect(await px(page, 5, 4)).toEqual([0, 0, 200, 255]);
  expect(await px(page, 2, 0)).toEqual([0, 0, 200, 255]);                // the first cell changed too
  expect(await px(page, 6, 0)).toEqual([0, 0, 200, 255]);                // and the other unflipped copy
  await expect(page.locator('.px-tile:not(.empty)')).toHaveCount(1);
  await undo(page);
  expect((await px(page, 2, 0))[3]).toBe(0);
  // eraser in tiles mode empties a cell
  await page.click('.px-tiles-mode [data-v="tiles"]');
  await page.keyboard.press('e');
  await click(page, 1, 5);
  expect((await px(page, 0, 4))[3]).toBe(0);
});

test('turn a regular layer into tiles (identical pieces share one tile)', async ({ page }) => {
  await newArt(page, { w: 8, h: 4 });
  await setPrimary(page, [10, 120, 10, 255]);
  await click(page, 0, 0); await click(page, 4, 0);
  await layerMenu(page);
  await page.click('.px-menu [data-a="toTiles"]');
  await page.click('.px-dialog .px-seg [data-v="0"]');
  await page.fill('.px-tm-w', '4'); await page.fill('.px-tm-h', '4');
  await ok(page);
  expect(await page.evaluate(() => __px.state.sprite.layers[0].kind)).toBe('tilemap');
  await expect(page.locator('.px-tile:not(.empty)')).toHaveCount(1);
  expect(await page.evaluate(() => [...__px.state.cel.map])).toEqual([1, 1]);
  // saved and opened again, the tiles are still there
  await page.evaluate(() => __px.saveNow());
  const id = await page.evaluate(() => __px.state.sprite.id);
  await page.evaluate(() => __px.showGallery());
  await page.evaluate(id => __px.openArt(id), id);
  await page.waitForFunction(() => __px.state.sprite?.tilesets?.length === 1);
  expect(await page.evaluate(() => [...__px.state.cel.map])).toEqual([1, 1]);
});

test('a link makes a ready canvas: size, colour mode and name', async ({ page }) => {
  await page.goto('/pixel/?new=1&w=24&h=12&mode=indexed&name=Robot');
  await page.waitForFunction(() => window.__px?.state.sprite?.name === 'Robot');
  expect(await page.evaluate(() => { const s = __px.state.sprite; return [s.width, s.height, s.colorMode]; })).toEqual([24, 12, 'indexed']);
  expect(await page.evaluate(() => location.search)).toBe('');
});

test('version backups: a snapshot on opening, restored as a copy from the info sheet', async ({ page }) => {
  await newArt(page);
  await page.waitForTimeout(400);
  await click(page, 3, 3);
  await page.evaluate(() => __px.saveNow());
  await page.evaluate(() => __px.showGallery());
  await page.click('.px-card-more');
  await page.click('.px-menu [data-a="info"]');
  await expect(page.locator('.px-version')).toHaveCount(1);
  await page.click('.px-version [data-v]');
  await expect(page.locator('.px-card')).toHaveCount(2);
});

test('timelapse records a picture per change; video export makes a file', async ({ page }) => {
  await newArt(page, { w: 8, h: 8 });
  await page.click('.px-export-btn');
  await page.click('.px-tabs [data-tab="lapse"]');
  await page.click('.px-toggle:has(input[data-name="record"])');
  await page.locator('.px-dialog .px-dialog-x').click();
  for (const x of [1, 2, 3]) { await click(page, x, 1); await page.waitForTimeout(350); }
  await page.click('.px-export-btn');
  await page.click('.px-tabs [data-tab="lapse"]');
  await expect(page.locator('.px-tabpane')).toContainText(/[34] pictures recorded/);
  await page.click('.px-tabs [data-tab="video"]');
  await ok(page);
  await page.waitForFunction(() => window.__pxDownloads.length === 1, null, { timeout: 15000 });
  const f = await page.evaluate(() => window.__pxDownloads[0]);
  expect(f.name).toMatch(/\.(webm|mp4)$/);
  expect(f.size).toBeGreaterThan(100);
});

test('themes, left-hand mode and the joystick', async ({ page }) => {
  await newArt(page);
  await page.click('.px-settings');
  await page.click('.px-tabs [data-tab="look"]');
  await page.click('.px-seg[data-name="preset"] [data-v="contrast"]');
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--bg').trim().toLowerCase())).toBe('#000000');
  await page.locator('[data-var="--coral"]').fill('#123456');
  await expect(page.locator('.px-seg[data-name="preset"] [data-v="custom"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('.px-toggle:has(input[data-name="lefty"])');
  const tb = await page.locator('.px-toolbox').boundingBox();
  expect(tb.x).toBeGreaterThan(600);                                    // tools moved to the right
  await page.click('.px-tabs [data-tab="features"]');
  await page.click('.px-toggle:has(input[data-name="joy.on"])');
  await ok(page);
  await expect(page.locator('.px-joy')).toBeVisible();
  // hold the joystick eraser while drawing
  await setPrimary(page, [9, 9, 9, 255]);
  await click(page, 4, 4);
  const er = page.locator('.px-joy-btn[aria-label^="Eraser"]');
  const b = await er.boundingBox();
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  expect(await page.evaluate(() => __px.state.tool)).toBe('eraser');
  await page.mouse.up();
  expect(await page.evaluate(() => __px.state.tool)).toBe('brush');
  await page.click('.px-joy-btn[aria-label="Undo"]');
  expect((await px(page, 4, 4))[3]).toBe(0);
});

test('a broken .px file gets a polite message', async ({ page }) => {
  await page.goto('/pixel/');
  await page.setInputFiles('.px-open-file', { name: 'thing.px', mimeType: 'application/octet-stream', buffer: Buffer.alloc(80) });
  await expect(page.locator('.px-toast')).toContainText(/\.px/);
});

test('the play button pauses playback on a click (desktop and phone)', async ({ page }) => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
    await page.setViewportSize(vp);
    await newArt(page, { w: 8, h: 8 });
    await page.evaluate(() => { __px.anim.addFrame(); __px.anim.addFrame(); for (const f of __px.state.sprite.frames) f.durationMs = 60; });
    if (vp.width < 700 && !(await page.locator('.px-tl-play').isVisible())) await page.click('.px-timeline-btn');
    await page.click('.px-tl-play');
    expect(await page.evaluate(() => __px.state.playing)).toBe(true);
    await page.waitForTimeout(300);                                       // several frames go by
    await page.click('.px-tl-play', { delay: 150 });                      // a real press lasts a moment
    expect(await page.evaluate(() => __px.state.playing)).toBe(false);
    await expect(page.locator('.px-tl-play')).toHaveAttribute('aria-label', 'Play');
  }
});

test('the sliders never overlap the toolbox, at any window height', async ({ page }) => {
  for (const h of [1070, 900, 800, 640]) {
    await page.setViewportSize({ width: 1280, height: h });
    if (h === 1070) await newArt(page);
    await page.waitForTimeout(150);
    const a = await page.locator('.px-toolbox').boundingBox(), b = await page.locator('.px-sliders').boundingBox();
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap, `height ${h}`).toBe(false);
    expect(b.y + b.height).toBeLessThanOrEqual(h);
  }
  // a new artwork in a narrow, tall window: the canvas starts clear of the sliders
  await page.setViewportSize({ width: 1000, height: 1070 });
  await newArt(page);
  const s = await page.locator('.px-sliders').boundingBox(), st = await page.locator('#stage').boundingBox();
  expect(st.x + await page.evaluate(() => __px.view.ox)).toBeGreaterThanOrEqual(s.x + s.width);
});
