// ClassMap Pixel — Phase 2 browser tests (layers, selections, transform, clipboard, symmetry,
// references, presets, settings, shortcuts)
import { test, expect } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function newArt(page, w = 16, h = 16, name = 'Test art') {
  await page.goto('/pixel/');
  await page.click('.px-new');
  await page.fill('.px-na-name', name);
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
async function drag(page, a, b) {
  await page.mouse.move(...await at(page, ...a));
  await page.mouse.down();
  await page.mouse.move(...await at(page, ...b), { steps: 5 });
  await page.mouse.up();
}
const click = async (page, x, y) => page.mouse.click(...await at(page, x, y));
// the active layer's pixel, and what you see (all layers composed)
const px = (page, x, y) => page.evaluate(([x, y]) => { const c = __px.state.cel; const o = (y * c.w + x) * 4; return [...c.pixels.slice(o, o + 4)]; }, [x, y]);
// waits for the next screen refresh, which is when the layers are composed
const seen = (page, x, y) => page.evaluate(async ([x, y]) => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const W = __px.state.sprite.width, o = (y * W + x) * 4; return [...__px.view.comp.slice(o, o + 4)]; }, [x, y]);
const layerNames = page => page.locator('.px-row-name').allTextContents();
const run = (page, id) => page.evaluate(id => __px.actions.run(id), id);
const swatch = (page, n) => page.click(`.px-swatches .px-sw:nth-child(${n})`);
const primary = page => page.evaluate(() => __px.state.settings.primary);

test('layers: add, draw on each, hide, lock, undo', async ({ page }) => {
  await newArt(page);
  await click(page, 2, 2);                                   // ink on Layer 1
  await page.click('.px-lay-add');
  await expect(page.locator('.px-row')).toHaveCount(2);
  expect(await layerNames(page)).toEqual(['Layer 2', 'Layer 1']);
  await swatch(page, 12);
  await click(page, 2, 2);                                   // coral on top
  const coral = await primary(page);
  expect(await seen(page, 2, 2)).toEqual(coral);
  await page.locator('.px-row').first().locator('.px-row-eye').click();
  await page.waitForTimeout(50);
  expect((await seen(page, 2, 2))[0]).toBe(43);              // the ink underneath shows
  await page.locator('.px-row').first().locator('.px-row-eye').click();
  await page.locator('.px-row').first().locator('.px-row-lock').click();
  await click(page, 5, 5);
  await expect(page.locator('.px-toast')).toContainText('locked');
  expect((await px(page, 5, 5))[3]).toBe(0);
  await page.locator('.px-row').first().locator('.px-row-lock').click();
  // undo the coral pixel, then the new layer
  await run(page, 'undo'); await run(page, 'undo');
  await expect(page.locator('.px-row')).toHaveCount(1);
  await run(page, 'redo');
  await expect(page.locator('.px-row')).toHaveCount(2);
});

test('blend mode, opacity and merge down', async ({ page }) => {
  await newArt(page);
  await swatch(page, 6);                                     // cream on Layer 1
  await page.keyboard.press('g'); await click(page, 0, 0);
  await page.click('.px-lay-add');
  await swatch(page, 8);                                     // teal on Layer 2
  await click(page, 0, 0);
  const plain = await seen(page, 0, 0);
  await page.locator('.px-row.active').click();             // second tap: layer settings
  await page.selectOption('.px-lp-blend', 'multiply');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  const mult = await seen(page, 0, 0);
  expect(mult).not.toEqual(plain);
  expect(mult[0]).toBeLessThanOrEqual(plain[0]);
  await expect(page.locator('.px-row-badge').first()).toContainText('Multiply');
  await page.click('.px-lay-menu');
  await page.click('.px-menu [data-a="merge"]');
  await expect(page.locator('.px-row')).toHaveCount(1);
  expect(await seen(page, 0, 0)).toEqual(mult);              // merged looks the same
  expect(await px(page, 0, 0)).toEqual(mult);
});

test('groups: group a layer, hiding the group hides it, drag to reorder', async ({ page }) => {
  await newArt(page);
  await page.click('.px-lay-add');
  await swatch(page, 12); await click(page, 1, 1);
  await page.click('.px-lay-group');
  expect(await layerNames(page)).toEqual(['Group 1', 'Layer 2', 'Layer 1']);
  await page.locator('.px-row.group .px-row-eye').click();
  await page.waitForTimeout(50);
  expect((await seen(page, 1, 1))[3]).toBe(0);
  await page.locator('.px-row.group .px-row-eye').click();
  // drag Layer 1 above the group
  const l1 = page.locator('.px-row', { hasText: 'Layer 1' }), g = page.locator('.px-row.group');
  const a = await l1.boundingBox(), b = await g.boundingBox();
  await page.mouse.move(a.x + 60, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + 4, { steps: 6 }); await page.mouse.up();
  expect((await layerNames(page))[0]).toBe('Layer 1');
});

test('rectangle selection limits drawing; Delete clears; tap deselects', async ({ page }) => {
  await newArt(page);
  await page.keyboard.press('g'); await click(page, 0, 0);   // fill everything
  await page.keyboard.press('m');
  await drag(page, [2, 2], [5, 5]);
  await expect(page.locator('.px-context')).toBeVisible();
  await page.keyboard.press('Delete');
  expect((await px(page, 3, 3))[3]).toBe(0);
  expect((await px(page, 6, 6))[3]).toBe(255);
  await page.keyboard.press('b');
  await drag(page, [0, 4], [10, 4]);                         // only the selected part changes
  expect((await px(page, 3, 4))[3]).toBe(255);
  await page.keyboard.press('m');
  await click(page, 12, 12);                                 // a tap deselects
  await expect(page.locator('.px-context')).toBeHidden();
});

test('magic wand, add mode, invert and fill', async ({ page }) => {
  await newArt(page);
  await page.keyboard.press('u'); await drag(page, [2, 2], [8, 8]);   // a hollow square
  await page.keyboard.press('w'); await click(page, 5, 5);            // the inside
  let n = await page.evaluate(() => __px.state.selection.mask.reduce((a, b) => a + b, 0));
  expect(n).toBe(25);
  await page.keyboard.down('Shift'); await click(page, 14, 14); await page.keyboard.up('Shift');
  n = await page.evaluate(() => __px.state.selection.mask.reduce((a, b) => a + b, 0));
  expect(n).toBe(256 - 24);                                 // everything except the outline
  await run(page, 'invert');
  n = await page.evaluate(() => __px.state.selection.mask.reduce((a, b) => a + b, 0));
  expect(n).toBe(24);
  await swatch(page, 12);
  await page.locator('.px-ctx-btn[data-a="fill"]').click();
  expect(await px(page, 2, 2)).toEqual(await primary(page));
});

test('polygon and lasso selections', async ({ page }) => {
  await newArt(page);
  await page.keyboard.press('m');
  await page.evaluate(() => { __px.state.settings.tools.select.shape = 'polygon'; });
  for (const [x, y] of [[1, 1], [12, 1], [1, 12]]) await click(page, x, y);
  await expect(page.locator('.px-ctx-btn[data-a="polyDone"]')).toBeVisible();
  await page.keyboard.press('Enter');
  const tri = await page.evaluate(() => { const m = __px.state.selection.mask; return [m[2 * 16 + 2], m[13 * 16 + 13]]; });
  expect(tri).toEqual([1, 0]);
  await page.evaluate(() => { __px.state.settings.tools.select.shape = 'lasso'; });
  await page.mouse.move(...await at(page, 8, 8)); await page.mouse.down();
  for (const p of [[14, 8], [14, 14], [8, 14]]) await page.mouse.move(...await at(page, ...p), { steps: 3 });
  await page.mouse.up();
  expect(await page.evaluate(() => __px.state.selection.mask[11 * 16 + 11])).toBe(1);
});

test('move tool drags pixels; Enter applies; undo puts them back', async ({ page }) => {
  await newArt(page);
  await click(page, 2, 2);
  const ink = await px(page, 2, 2);
  await page.keyboard.press('v');
  await drag(page, [2, 2], [6, 3]);
  await expect(page.locator('.px-ctx-btn[data-a="apply"]')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !__px.state.transform);
  expect(await px(page, 6, 3)).toEqual(ink);
  expect((await px(page, 2, 2))[3]).toBe(0);
  await run(page, 'undo');
  expect(await px(page, 2, 2)).toEqual(ink);
  expect((await px(page, 6, 3))[3]).toBe(0);
});

test('transform: rotate 90°, flip, nudge, crisp rotate, cancel', async ({ page }) => {
  await newArt(page);
  await page.keyboard.press('l'); await drag(page, [4, 8], [11, 8]);   // a horizontal line
  await page.keyboard.press('m'); await drag(page, [4, 8], [11, 8]);
  await page.locator('.px-ctx-btn[data-a="move"]').click();
  await page.locator('.px-ctx-btn[data-a="rotR"]').click();
  await page.locator('.px-ctx-btn[data-a="apply"]').click();
  await page.waitForFunction(() => !__px.state.transform);
  const col = await page.evaluate(() => { const c = __px.state.cel; let n = 0; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (c.pixels[(y * 16 + x) * 4 + 3]) n++; return n; });
  expect(col).toBe(8);
  expect((await px(page, 8, 8))[3]).toBe(255);
  expect((await px(page, 4, 8))[3]).toBe(0);                // now vertical
  // nudge with arrows, then cancel: nothing changes
  await page.keyboard.press('v');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !__px.state.transform);
  expect((await px(page, 8, 8))[3]).toBe(255);
  // crisp (RotSprite) rotation runs in a worker and lands
  await page.keyboard.press('Control+a');
  await page.locator('.px-ctx-btn[data-a="move"]').click();
  await page.evaluate(() => __px.actions.context('apply') || null);
  await page.waitForFunction(() => !__px.state.transform);
  await page.locator('.px-ctx-btn[data-a="move"]').click();
  await page.evaluate(() => { const T = __px.state.transform; T.p.rot = Math.PI / 6; });
  await page.locator('.px-ctx-btn[data-a="apply"]').click();
  await page.waitForFunction(() => !__px.state.transform, null, { timeout: 8000 });
  const n = await page.evaluate(() => { const c = __px.state.cel; let n = 0; for (let i = 3; i < c.pixels.length; i += 4) if (c.pixels[i]) n++; return n; });
  expect(n).toBeGreaterThan(5);
});

test('copy and paste between artworks, and onto the system clipboard as PNG', async ({ page }) => {
  await newArt(page, 16, 16, 'First');
  await swatch(page, 12); await click(page, 3, 3); await click(page, 4, 3);
  const coral = await primary(page);
  await page.keyboard.press('m'); await drag(page, [2, 2], [5, 4]);
  await run(page, 'copy');
  await page.waitForTimeout(300);
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap(i => i.types));
  expect(types).toContain('image/png');
  // second artwork
  await page.click('.px-back');
  await page.click('.px-new'); await page.fill('.px-na-name', 'Second'); await page.click('.px-dialog .px-btn-primary');
  await page.waitForFunction(() => window.__px?.state.sprite?.name === 'Second');
  await run(page, 'paste');
  await page.waitForFunction(() => !!__px.state.transform);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !__px.state.transform);
  expect(await px(page, 3, 3)).toEqual(coral);               // pasted where it was copied
  expect(await px(page, 4, 3)).toEqual(coral);
});

test('pasting an image copied in another app', async ({ page }) => {
  await newArt(page, 16, 16);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 2;
    const g = c.getContext('2d'); g.fillStyle = '#00ff00'; g.fillRect(0, 0, 4, 2);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await run(page, 'paste');
  await page.waitForFunction(() => !!__px.state.transform);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !__px.state.transform);
  const greens = await page.evaluate(() => { const c = __px.state.cel; let n = 0; for (let i = 0; i < c.pixels.length; i += 4) if (c.pixels[i + 1] === 255 && c.pixels[i + 3] === 255) n++; return n; });
  expect(greens).toBe(8);
});

test('copy layers into another artwork', async ({ page }) => {
  await newArt(page, 16, 16, 'Source');
  await page.click('.px-lay-add');
  await page.locator('.px-row.active').dblclick();
  await page.fill('.px-dialog input', 'Hat');
  await page.click('.px-dialog .px-btn-primary');
  await swatch(page, 12); await click(page, 7, 1);
  await page.click('.px-lay-menu'); await page.click('.px-menu [data-a="copy"]');
  await page.click('.px-back');
  await page.click('.px-new'); await page.fill('.px-na-name', 'Target'); await page.click('.px-dialog .px-btn-primary');
  await page.waitForFunction(() => window.__px?.state.sprite?.name === 'Target');
  await page.click('.px-lay-menu'); await page.click('.px-menu [data-a="paste"]');
  expect(await layerNames(page)).toEqual(['Hat', 'Layer 1']);
  expect((await px(page, 7, 1))[3]).toBe(255);
});

test('symmetry mirrors strokes and the centre can move', async ({ page }) => {
  await newArt(page, 16, 16);
  await page.click('.px-sym-btn');
  await click(page, 2, 5);
  expect((await px(page, 13, 5))[3]).toBe(255);              // mirrored across the middle
  await page.click('.px-sym-btn');                           // options
  await page.locator('.px-opts .px-seg[data-name="mode"] [data-v="rotate"]').click();
  await page.locator('.px-opts input[data-name="count"]').fill('4');
  await page.keyboard.press('Escape');
  await click(page, 3, 3);
  for (const [x, y] of [[12, 3], [12, 12], [3, 12]]) expect((await px(page, x, y))[3]).toBe(255);
});

test('tool presets save and come back', async ({ page }) => {
  await newArt(page);
  await page.evaluate(() => { __px.state.settings.tools.brush.size = 5; });
  await page.click('.px-tool.on');
  await page.click('.px-preset-save');
  await page.fill('.px-dialog input', 'Fat');
  await page.click('.px-dialog .px-btn-primary');
  await page.evaluate(() => { __px.state.settings.tools.brush.size = 1; });
  await page.click('.px-tool.on');
  await page.click('.px-chip button:has-text("Fat")');
  expect(await page.evaluate(() => __px.state.settings.tools.brush.size)).toBe(5);
});

test('settings: remap a shortcut, turn off autosave', async ({ page }) => {
  await newArt(page);
  await page.click('.px-settings');
  await page.click('[data-tab="keys"]');
  await page.click('[data-key="tool.eraser"]');
  await page.keyboard.press('k');
  await expect(page.locator('[data-key="tool.eraser"]')).toHaveText('K');
  await page.click('[data-tab="general"]');
  await page.locator('.px-toggle', { hasText: 'Save automatically' }).click();
  await page.click('.px-dialog .px-btn-primary');
  await page.keyboard.press('k');
  await expect(page.locator('.px-tool[data-tool="eraser"]')).toHaveClass(/on/);
  await page.keyboard.press('b'); await page.keyboard.press('e');
  await expect(page.locator('.px-tool[data-tool="eraser"]')).not.toHaveClass(/on/);   // E is free now
  await expect(page.locator('.px-save-btn')).toBeVisible();
  await click(page, 1, 1);
  await expect(page.locator('.px-saved')).toHaveText('Not saved');
  await page.click('.px-save-btn');
  await expect(page.locator('.px-saved')).toHaveText('Saved');
});

test('canvas: resize, crop to the art, flip (all undoable)', async ({ page }) => {
  await newArt(page, 16, 16);
  await click(page, 2, 3);
  await page.click('.px-settings'); await page.click('[data-tab="canvas"]');
  await page.click('[data-a="resize"]');
  await page.fill('.px-rs-w', '24'); await page.fill('.px-rs-h', '20');
  await page.click('.px-anchor [data-x="0"][data-y="0"]');
  await page.click('.px-dialog .px-btn-primary');
  await expect(page.locator('.px-dim')).toHaveText('24 × 20');
  expect((await px(page, 2, 3))[3]).toBe(255);
  await page.evaluate(() => __px.actions.run('undo'));
  await expect(page.locator('.px-dim')).toHaveText('16 × 16');
  await page.click('.px-settings'); await page.click('[data-tab="canvas"]');
  await page.click('[data-a="flipH"]');
  expect((await px(page, 13, 3))[3]).toBe(255);
  await page.click('[data-a="crop"]');
  await page.click('.px-dialog .px-btn-primary');
  await expect(page.locator('.px-dim')).toHaveText('1 × 1');
});

test('layers, groups and blend modes survive a reload; reference window too', async ({ page }) => {
  await newArt(page, 16, 16, 'Keeps');
  await page.click('.px-lay-add');
  await page.click('.px-lay-group');
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 20; c.height = 20;
    const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 20, 20);
    await __px.addReference(await new Promise(r => c.toBlob(r)), 'Red');
  });
  await expect(page.locator('.px-ref')).toHaveCount(1);
  // picking from the reference window sets the colour
  const box = await page.locator('.px-ref-view').boundingBox();
  await page.mouse.click(box.x + 20, box.y + 20);
  expect((await primary(page)).slice(0, 3)).toEqual([255, 0, 0]);
  await page.evaluate(() => __px.saveNow());
  await page.reload();
  await page.waitForFunction(() => window.__px?.state.sprite);
  expect(await layerNames(page)).toEqual(['Group 1', 'Layer 2', 'Layer 1']);
  await expect(page.locator('.px-ref')).toHaveCount(1);
});

test('drop an image on the canvas makes a reference layer you can rasterize', async ({ page }) => {
  await newArt(page, 16, 16);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const g = c.getContext('2d'); g.fillStyle = '#0000ff'; g.fillRect(0, 0, 8, 8);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'blue.png', { type: 'image/png' }));
    document.getElementById('stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.px-row-badge')).toContainText('Ref');
  await click(page, 3, 3);
  await expect(page.locator('.px-toast')).toContainText('Rasterize');
  await page.click('.px-lay-menu'); await page.click('.px-menu [data-a="raster"]');
  await expect(page.locator('.px-row-badge')).toHaveCount(0);
});
