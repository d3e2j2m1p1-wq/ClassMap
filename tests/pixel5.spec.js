// ClassMap Pixel — Phase 5a browser tests (text, custom brushes, objects, modifiers, magic layers,
// picture effects)
import { test, expect } from '@playwright/test';

async function newArt(page, { w = 16, h = 16 } = {}) {
  await page.addInitScript(() => {
    window.__pxDownloads = [];
    window.__pxDownload = async (a, blob) => { window.__pxDownloads.push({ name: a.download, bytes: [...new Uint8Array(await blob.arrayBuffer())] }); };
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
const shown = (page, x, y) => page.evaluate(([x, y]) => { const c = __px.view.comp, W = __px.state.sprite.width, o = (y * W + x) * 4; return [...c.slice(o, o + 4)]; }, [x, y]);
const count = page => page.evaluate(() => { const p = __px.state.cel.pixels; let n = 0; for (let i = 3; i < p.length; i += 4) if (p[i]) n++; return n; });
const ok = page => page.locator('.px-dialog .px-btn-primary').last().click();
const undo = page => page.evaluate(() => __px.actions.run('undo'));
const setPrimary = (page, c) => page.evaluate(c => { __px.state.settings.primary = c; }, c);
const apply = page => page.evaluate(() => __px.actions.run('apply'));

test('text tool: type, pick a pixel font, place it where you tapped', async ({ page }) => {
  await newArt(page, { w: 32, h: 16 });
  await setPrimary(page, [10, 20, 30, 255]);
  await page.keyboard.press('t');
  await expect(page.locator('.px-tool[data-tool="text"]')).toHaveClass(/on/);
  await click(page, 2, 3);
  await page.fill('.px-text-in', 'Hi');
  await expect(page.locator('.px-text-preview')).toHaveAttribute('title', '9 × 7 pixels');
  await ok(page);
  await apply(page);
  expect(await px(page, 2, 3)).toEqual([10, 20, 30, 255]);           // top-left of the H
  expect(await count(page)).toBeGreaterThan(15);
  await undo(page);
  expect(await count(page)).toBe(0);
});

test('custom brush from a selection paints its shape; jumble and blur tips work', async ({ page }) => {
  await newArt(page);
  await setPrimary(page, [200, 0, 0, 255]);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) await click(page, x, y);
  await page.evaluate(() => __px.actions.run('selectAll'));
  await page.click('.px-context [data-a="saveBrush"]');
  await page.fill('.px-dialog input', 'Corner');
  await ok(page);
  await page.evaluate(() => __px.actions.run('deselect'));
  await page.evaluate(() => { const o = __px.state.settings.tools.brush; o.tip = 'custom'; o.brushColors = false; o.pixelPerfect = false; });
  await setPrimary(page, [0, 0, 200, 255]);
  await click(page, 10, 10);
  expect(await px(page, 10, 10)).toEqual([0, 0, 200, 255]);
  expect(await px(page, 11, 10)).toEqual([0, 0, 200, 255]);
  expect(await px(page, 10, 11)).toEqual([0, 0, 200, 255]);
  expect((await px(page, 11, 11))[3]).toBe(0);
  // own colours
  await page.evaluate(() => { __px.state.settings.tools.brush.brushColors = true; });
  await click(page, 5, 12);
  expect(await px(page, 5, 12)).toEqual([200, 0, 0, 255]);
  // blur softens an edge (an in-between colour appears)
  await page.evaluate(() => { const o = __px.state.settings.tools.brush; o.tip = 'blur'; o.size = 3; });
  await click(page, 11, 11);
  const c = await px(page, 11, 11);
  expect(c[2]).toBeGreaterThan(0); expect(c[3]).toBeLessThan(255);
  // the options show the brush library
  await page.evaluate(() => { __px.state.settings.tools.brush.tip = 'custom'; });
  await page.click('.px-tool[data-tool="brush"]');
  await expect(page.locator('.px-brushes .px-lib-item')).toHaveCount(1);
});

test('objects: save a selection, then stamp it from the objects panel', async ({ page }) => {
  await newArt(page);
  await setPrimary(page, [0, 150, 0, 255]);
  await click(page, 3, 3); await click(page, 4, 3);
  await page.evaluate(() => __px.actions.run('selectAll'));
  await page.click('.px-context [data-a="saveObject"]');
  await page.fill('.px-obj-name', 'Twig');
  await page.fill('.px-obj-col', 'Forest');
  await ok(page);
  await page.evaluate(() => __px.actions.run('deselect'));
  await page.click('.px-obj-btn');
  await expect(page.locator('.px-objects .px-mini-label')).toHaveText('Forest');
  await page.click('.px-objects [data-obj]');
  await expect(page.locator('.px-context [data-a="apply"]')).toBeVisible();
  await apply(page);
  expect(await count(page)).toBe(4);                                  // the original two + the stamp
});

test('modifiers: mirror and outline show live, cancel puts them back, bake makes pixels', async ({ page }) => {
  await newArt(page);
  await setPrimary(page, [50, 50, 50, 255]);
  await click(page, 2, 5);
  await page.evaluate(() => __px.state.sprite && document.querySelector('.px-lay-more, .px-lay-head [aria-label*="menu" i]'));
  await page.evaluate(() => import('/src/pixel/ui/effects.js').then(m => m.openModifiers()));
  await page.selectOption('.px-stack-type', 'mirror');
  await page.click('.px-stack-add [data-add]');
  await page.waitForTimeout(100);
  expect((await shown(page, 13, 5))[3]).toBe(255);                    // mirrored copy on screen
  expect((await px(page, 13, 5))[3]).toBe(0);                         // …not in the pixels
  await page.locator('.px-dialog .px-btn-ghost', { hasText: 'Cancel' }).click();
  await page.waitForTimeout(100);
  expect((await shown(page, 13, 5))[3]).toBe(0);
  await page.evaluate(() => import('/src/pixel/ui/effects.js').then(m => m.openModifiers()));
  await page.click('.px-stack-add [data-add]');
  await ok(page);                                                     // Done
  expect(await page.evaluate(() => __px.state.sprite.layers[0].modifiers.length)).toBe(1);
  await undo(page);
  expect(await page.evaluate(() => (__px.state.sprite.layers[0].modifiers || []).length)).toBe(0);
  await page.evaluate(() => import('/src/pixel/ui/effects.js').then(m => m.openModifiers()));
  await page.click('.px-stack-add [data-add]');
  await page.locator('.px-dialog .px-btn-ghost', { hasText: 'Bake into pixels' }).click();
  expect((await px(page, 13, 5))[3]).toBe(255);
  expect(await page.evaluate(() => __px.state.sprite.layers[0].modifiers)).toBeUndefined();
});

test('magic layer: draw once, bob makes the other frames; bake turns them into pixels', async ({ page }) => {
  await newArt(page);
  await setPrimary(page, [0, 0, 0, 255]);
  await click(page, 8, 8);
  await page.evaluate(() => import('/src/pixel/ui/effects.js').then(m => m.openMagic()));
  await page.locator('.px-range input[data-name="cycle"]').fill('4');
  await page.click('[data-m="frames"]');
  expect(await page.evaluate(() => __px.state.sprite.frames.length)).toBe(4);
  await ok(page);
  await page.evaluate(() => __px.anim.goToFrame(__px.state.sprite.frames[1].id));
  await page.waitForTimeout(100);
  expect((await shown(page, 8, 6))[3]).toBe(255);                     // lifted by 2 px on frame 2
  // drawing on a generated frame is blocked with a hint
  await click(page, 3, 3);
  await expect(page.locator('.px-toast')).toContainText('magic layer');
  await page.evaluate(() => import('/src/pixel/editor/live.js').then(m => m.bakeLayer(__px.state.layerId)));
  expect(await page.evaluate(() => __px.state.sprite.layers[0].kind)).toBe('regular');
  expect((await px(page, 8, 6))[3]).toBe(255);
});

test('picture effects show on screen and in exports, and can be applied', async ({ page }) => {
  await newArt(page, { w: 8, h: 8 });
  await setPrimary(page, [255, 255, 255, 255]);
  await click(page, 3, 3);
  await page.click('.px-color-tools');
  await page.click('.px-menu [data-a="post"]');
  await page.selectOption('.px-stack-type', 'shadow');
  await page.click('.px-stack-add [data-add]');
  await ok(page);
  const sheet = await page.evaluate(() => { const g = __px.view.sheet.getContext('2d'); return [...g.getImageData(4, 4, 1, 1).data]; });
  expect(sheet[3]).toBeGreaterThan(0);                                // the shadow at (4,4)
  await page.click('.px-export-btn');
  await page.click('.px-tabs [data-tab="png"]');
  await ok(page);
  await page.waitForFunction(() => window.__pxDownloads.length === 1);
  await page.click('.px-color-tools');
  await page.click('.px-menu [data-a="post"]');
  await page.locator('.px-dialog .px-btn-ghost', { hasText: 'Apply to the art' }).click();
  await ok(page);                                                     // confirm
  expect(await page.evaluate(() => __px.state.sprite.post.length)).toBe(0);
  expect((await px(page, 4, 4))[3]).toBeGreaterThan(0);
  await undo(page);
  expect(await page.evaluate(() => __px.state.sprite.post.length)).toBe(1);
});
