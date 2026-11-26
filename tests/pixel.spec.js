// ClassMap Pixel (classmap.dev/pixel) — Phase 1 browser tests
import { test, expect } from '@playwright/test';

const URL = '/pixel/';

async function newArt(page, w = 16, h = 16, name = 'Test art') {
  await page.goto(URL);
  await page.click('.px-new');
  await page.fill('.px-na-name', name);
  await page.fill('.px-na-w', String(w));
  await page.fill('.px-na-h', String(h));
  await page.click('.px-dialog .px-btn-primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.waitForFunction(() => window.__px?.state.sprite && window.__px.view.zoom > 0);
}

// screen point for the middle of sprite pixel (x, y)
async function at(page, x, y) {
  const r = await page.locator('#stage canvas').boundingBox();
  const v = await page.evaluate(() => ({ z: __px.view.zoom, ox: __px.view.ox, oy: __px.view.oy }));
  return [r.x + v.ox + (x + 0.5) * v.z, r.y + v.oy + (y + 0.5) * v.z];
}
const px = (page, x, y) => page.evaluate(([x, y]) => { const c = __px.state.cel; const o = (y * c.w + x) * 4; return [...c.pixels.slice(o, o + 4)]; }, [x, y]);
const primary = page => page.evaluate(() => __px.state.settings.primary);
async function stroke(page, pts) {
  await page.mouse.move(...await at(page, ...pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...await at(page, ...p), { steps: 4 });
  await page.mouse.up();
}

// Synthetic touch / pen pointers (several fingers at once)
async function pointers(page, type, steps) {
  await page.evaluate(([type, steps]) => {
    const cv = document.querySelector('#stage canvas'), r = cv.getBoundingClientRect();
    for (const [ev, id, x, y] of steps) {
      cv.dispatchEvent(new PointerEvent(ev, { pointerId: id, pointerType: type, clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, isPrimary: id === 1, button: 0, buttons: ev === 'pointerup' ? 0 : 1, pressure: ev === 'pointerup' ? 0 : 0.6 }));
    }
  }, [type, steps]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__pxDownloads = [];
    window.__pxDownload = async (a, blob) => { window.__pxDownloads.push({ name: a.download, bytes: [...new Uint8Array(await blob.arrayBuffer())] }); };
  });
});

test('gallery starts empty and New artwork opens the editor', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('.px-empty')).toBeVisible();
  await expect(page.locator('.px-brand em')).toHaveText('Pixel');
  await newArt(page, 24, 12);
  expect(page.url()).toMatch(/#\/art\//);
  await expect(page.locator('.px-name')).toHaveValue('Test art');
  await expect(page.locator('.px-dim')).toHaveText('24 × 12');
  await expect(page.locator('.px-tool[data-tool="brush"]')).toHaveClass(/on/);
});

test('brush draws, undo and redo restore it (buttons and keys)', async ({ page }) => {
  await newArt(page);
  const c = await primary(page);
  await stroke(page, [[2, 2], [8, 2]]);
  expect(await px(page, 2, 2)).toEqual(c);
  expect(await px(page, 8, 2)).toEqual(c);
  await page.click('.px-undo');
  expect(await px(page, 5, 2)).toEqual([0, 0, 0, 0]);
  await page.keyboard.press('Control+Shift+Z');
  expect(await px(page, 5, 2)).toEqual(c);
  await page.keyboard.press('Control+z');
  expect(await px(page, 5, 2)).toEqual([0, 0, 0, 0]);
  await expect(page.locator('.px-redo')).toBeEnabled();
});

test('pixel-perfect brush leaves no L corners', async ({ page }) => {
  await newArt(page);
  // a staircase drawn as right, down, right, down
  await stroke(page, [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4]]);
  expect((await px(page, 3, 2))[3]).toBe(0);
  expect((await px(page, 3, 3))[3]).toBe(255);
  expect((await px(page, 4, 4))[3]).toBe(255);
});

test('line, shape, bucket and eraser', async ({ page }) => {
  await newArt(page);
  const c = await primary(page);
  await page.keyboard.press('l');
  await stroke(page, [[1, 1], [10, 1]]);
  expect(await px(page, 6, 1)).toEqual(c);

  await page.keyboard.press('u');
  await stroke(page, [[2, 4], [12, 12]]);
  expect(await px(page, 2, 8)).toEqual(c);      // left edge of the rectangle
  expect((await px(page, 7, 8))[3]).toBe(0);    // hollow

  await page.keyboard.press('g');
  await page.click('.px-swatches .px-sw:nth-child(12)');
  const coral = await primary(page);
  await page.mouse.click(...await at(page, 7, 8));
  expect(await px(page, 7, 8)).toEqual(coral);
  expect((await px(page, 0, 15))[3]).toBe(0);   // outside the rectangle untouched

  await page.keyboard.press('e');
  await stroke(page, [[7, 8], [8, 8]]);
  expect((await px(page, 7, 8))[3]).toBe(0);
});

test('eye dropper picks a colour and goes back to the brush', async ({ page }) => {
  await newArt(page);
  await page.click('.px-swatches .px-sw:nth-child(8)');
  const teal = await primary(page);
  await page.mouse.click(...await at(page, 5, 5));
  await page.click('.px-swatches .px-sw:nth-child(1)');
  expect(await primary(page)).not.toEqual(teal);
  await page.keyboard.press('i');
  await expect(page.locator('.px-tool[data-tool="dropper"]')).toHaveClass(/on/);
  await page.mouse.click(...await at(page, 5, 5));
  expect(await primary(page)).toEqual(teal);
  await expect(page.locator('.px-tool[data-tool="brush"]')).toHaveClass(/on/);
});

test('fingers: two-finger tap undoes, three-finger tap redoes; after a pencil, a finger no longer draws', async ({ page }) => {
  await newArt(page);
  const [x, y] = await at(page, 4, 4);
  const r = await page.locator('#stage canvas').boundingBox();
  const lx = x - r.x, ly = y - r.y;
  // one finger draws (no pencil seen yet)
  await pointers(page, 'touch', [['pointerdown', 1, lx, ly], ['pointerup', 1, lx, ly]]);
  expect((await px(page, 4, 4))[3]).toBe(255);
  // two-finger tap = undo
  await pointers(page, 'touch', [['pointerdown', 2, 100, 100], ['pointerdown', 3, 160, 100], ['pointerup', 2, 100, 100], ['pointerup', 3, 160, 100]]);
  expect((await px(page, 4, 4))[3]).toBe(0);
  // three-finger tap = redo
  await pointers(page, 'touch', [['pointerdown', 4, 100, 100], ['pointerdown', 5, 160, 100], ['pointerdown', 6, 220, 100], ['pointerup', 4, 100, 100], ['pointerup', 5, 160, 100], ['pointerup', 6, 220, 100]]);
  expect((await px(page, 4, 4))[3]).toBe(255);
  // a pencil stroke…
  await pointers(page, 'pen', [['pointerdown', 7, lx + 40, ly], ['pointerup', 7, lx + 40, ly]]);
  // …then a finger on an empty pixel only pans
  const [x2, y2] = await at(page, 10, 10);
  await pointers(page, 'touch', [['pointerdown', 8, x2 - r.x, y2 - r.y], ['pointerup', 8, x2 - r.x, y2 - r.y]]);
  expect((await px(page, 10, 10))[3]).toBe(0);
});

test('pinch with two fingers zooms', async ({ page }) => {
  await newArt(page);
  const z0 = await page.evaluate(() => __px.view.zoom);
  await pointers(page, 'touch', [['pointerdown', 1, 300, 300], ['pointerdown', 2, 340, 300], ['pointermove', 1, 260, 300], ['pointermove', 2, 380, 300], ['pointermove', 1, 220, 300], ['pointermove', 2, 420, 300]]);
  await page.waitForTimeout(350);
  await pointers(page, 'touch', [['pointerup', 1, 220, 300], ['pointerup', 2, 420, 300]]);
  expect(await page.evaluate(() => __px.view.zoom)).toBeGreaterThan(z0 * 2);
});

test('artwork is saved and comes back after a reload', async ({ page }) => {
  await newArt(page, 16, 16, 'Keeper');
  const c = await primary(page);
  await stroke(page, [[3, 3], [6, 3]]);
  await page.fill('.px-name', 'Keeper 2');
  await expect(page.locator('.px-saved')).toHaveText('Saved', { timeout: 4000 });
  await page.reload();
  await page.waitForFunction(() => window.__px?.state.sprite);
  expect(await px(page, 4, 3)).toEqual(c);
  await expect(page.locator('.px-name')).toHaveValue('Keeper 2');
  await page.click('.px-back');
  await expect(page.locator('.px-card')).toHaveCount(1);
  await expect(page.locator('.px-card-name')).toHaveText('Keeper 2');
  await expect(page.locator('.px-thumb img')).toHaveAttribute('src', /^data:image\/png/);
});

test('gallery: rename, duplicate and delete', async ({ page }) => {
  await newArt(page, 8, 8, 'Alpha');
  await page.click('.px-back');
  await page.click('.px-card-more');
  await page.click('.px-menu [data-a="rename"]');
  await page.fill('.px-dialog input', 'Beta');
  await page.click('.px-dialog .px-btn-primary');
  await expect(page.locator('.px-card-name')).toHaveText('Beta');
  await page.click('.px-card-more');
  await page.click('.px-menu [data-a="dup"]');
  await expect(page.locator('.px-card')).toHaveCount(2);
  await page.locator('.px-card-more').first().click();
  await page.click('.px-menu [data-a="del"]');
  await page.click('.px-dialog .px-btn-danger');
  await expect(page.locator('.px-card')).toHaveCount(1);
});

test('PNG export scales with crisp pixels', async ({ page }) => {
  await newArt(page, 10, 6, 'Exported');
  await stroke(page, [[0, 0], [1, 0]]);
  await page.click('.px-export-btn');
  await page.click('.px-ex-scales [data-s="4"]');
  await expect(page.locator('.px-ex-size')).toHaveText('40 × 24 pixels');
  await page.click('.px-dialog .px-btn-primary');
  await page.waitForFunction(() => window.__pxDownloads.length === 1);
  const info = await page.evaluate(async () => {
    const d = window.__pxDownloads[0];
    const bmp = await createImageBitmap(new Blob([new Uint8Array(d.bytes)], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return { name: d.name, w: bmp.width, h: bmp.height, a: [...g.getImageData(3, 3, 1, 1).data], b: [...g.getImageData(9, 3, 1, 1).data] };
  });
  expect(info).toMatchObject({ name: 'Exported.png', w: 40, h: 24 });
  expect(info.a[3]).toBe(255);          // inside the first pixel, scaled ×4
  expect(info.b[3]).toBe(0);            // third pixel is empty
});

test('backup everything and restore it', async ({ page }) => {
  await newArt(page, 8, 8, 'Saved twice');
  await stroke(page, [[1, 1], [5, 1]]);
  await expect(page.locator('.px-saved')).toHaveText('Saved', { timeout: 4000 });
  await page.click('.px-back');
  await page.click('.px-backup');
  await page.waitForFunction(() => window.__pxDownloads.length === 1);
  const file = await page.evaluate(() => window.__pxDownloads[0]);
  expect(file.name).toMatch(/^classmap-pixel-backup-\d{4}-\d\d-\d\d\.cmpixel$/);
  // delete it, then bring it back
  await page.click('.px-card-more');
  await page.click('.px-menu [data-a="del"]');
  await page.click('.px-dialog .px-btn-danger');
  await expect(page.locator('.px-empty')).toBeVisible();
  await page.setInputFiles('.px-restore-file', { name: file.name, mimeType: 'application/octet-stream', buffer: Buffer.from(file.bytes) });
  await page.click('.px-dialog .px-btn-primary');
  await expect(page.locator('.px-card-name')).toHaveText('Saved twice');
  await page.click('.px-card-open');
  await page.waitForFunction(() => window.__px?.state.sprite);
  expect((await px(page, 3, 1))[3]).toBe(255);
});

test('restore rejects a file that is not a backup', async ({ page }) => {
  await page.goto(URL);
  await page.setInputFiles('.px-restore-file', { name: 'x.cmpixel', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('.px-toast')).toContainText("isn't a ClassMap Pixel backup");
});

test('palette: add a colour, load a palette, swap colours', async ({ page }) => {
  await newArt(page);
  const n = await page.locator('.px-swatches .px-sw').count();
  await page.evaluate(() => { __px.state.settings.primary = [1, 2, 3, 255]; });
  await page.click('.px-add');
  await expect(page.locator('.px-swatches .px-sw')).toHaveCount(n + 1);
  await page.click('.px-pal-menu');
  await page.click('.px-pal-lib [data-k="b4"]');           // Grayscale 8
  await page.click('.px-dialog .px-btn-primary');
  await expect(page.locator('.px-swatches .px-sw')).toHaveCount(8);
  const before = await page.evaluate(() => [__px.state.settings.primary, __px.state.settings.secondary]);
  await page.keyboard.press('x');
  const after = await page.evaluate(() => [__px.state.settings.primary, __px.state.settings.secondary]);
  expect(after).toEqual([before[1], before[0]]);
});

test('colour picker sets the primary colour from hex', async ({ page }) => {
  await newArt(page);
  await page.click('.px-well-1');
  await page.fill('.px-hex input', '#0e8a9e');
  expect(await primary(page)).toEqual([14, 138, 158, 255]);
  await expect(page.locator('.px-rgba input[data-i="1"]')).toHaveValue('138');
});

test('Tab hides the panels and brings them back', async ({ page }) => {
  await newArt(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('.px-toolbox')).toBeHidden();
  await expect(page.locator('.px-show-ui')).toBeVisible();
  await page.click('.px-show-ui');
  await expect(page.locator('.px-toolbox')).toBeVisible();
});

test('follows the ClassMap light / dark setting', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('t')) { sessionStorage.setItem('t', '1'); localStorage.setItem('classmap_theme', 'dark'); } });
  await page.goto(URL);
  await expect(page.locator('body')).not.toHaveClass(/light/);
  await page.evaluate(() => localStorage.setItem('classmap_theme', 'light'));
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/light/);
});

test('phone layout puts the tools along the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await newArt(page);
  const tb = await page.locator('.px-toolbox').boundingBox();
  expect(tb.y).toBeGreaterThan(650);
  expect(tb.width).toBeGreaterThan(300);
  const pal = await page.locator('.px-palette').boundingBox();
  expect(pal.y + pal.height).toBeLessThanOrEqual(tb.y);
});

test('the seating chart app does not load the Pixel code', async ({ page }) => {
  await page.goto('/app/');
  await page.waitForFunction(() => window.__classmapStarted);
  expect(await page.evaluate(() => !!window.__px)).toBe(false);
});
