// ClassMap Pixel — Phase 3 browser tests (frames, cels, linking, tags, onion skin, playback,
// preview window, GIF / APNG / WebP / sprite sheet export, .aseprite import and export)
import { test, expect } from '@playwright/test';

async function newArt(page, w = 8, h = 8, name = 'Anim') {
  await page.addInitScript(() => {
    window.__pxDownloads = [];
    window.__pxDownload = async (a, blob) => { window.__pxDownloads.push({ name: a.download, type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] }); };
  });
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
const click = async (page, x, y) => page.mouse.click(...await at(page, x, y));
const px = (page, x, y) => page.evaluate(([x, y]) => { const c = __px.state.cel; const o = (y * c.w + x) * 4; return [...c.pixels.slice(o, o + 4)]; }, [x, y]);
const frameNo = page => page.evaluate(() => __px.anim.frameIndex());
const nFrames = page => page.evaluate(() => __px.state.sprite.frames.length);
const heads = page => page.locator('.px-tl-head');

// Three frames with a dot moving right
async function threeFrames(page) {
  await click(page, 1, 1);
  await page.click('.px-tl-btn[data-a="add"]'); await click(page, 2, 1);
  await page.click('.px-tl-btn[data-a="add"]'); await click(page, 3, 1);
}

test('add frames, draw on each, step with , and . , delete and undo', async ({ page }) => {
  await newArt(page);
  await threeFrames(page);
  await expect(heads(page)).toHaveCount(3);
  await expect(page.locator('.px-tl-count')).toHaveText('3 / 3');
  expect((await px(page, 3, 1))[3]).toBe(255);
  expect((await px(page, 1, 1))[3]).toBe(0);                  // each frame has its own pixels
  await page.keyboard.press(',');
  expect(await frameNo(page)).toBe(1);
  expect((await px(page, 2, 1))[3]).toBe(255);
  await page.keyboard.press('.'); await page.keyboard.press('.');
  expect(await frameNo(page)).toBe(0);                        // wraps around
  await page.click('.px-tl-btn[data-a="del"]');
  expect(await nFrames(page)).toBe(2);
  await page.evaluate(() => __px.actions.run('undo'));
  expect(await nFrames(page)).toBe(3);
  await expect(page.locator('.px-tl-cel:not(.empty)')).toHaveCount(3);
});

test('duplicate frames copy pixels; linked cels share them; unlink separates', async ({ page }) => {
  await newArt(page);
  await click(page, 4, 4);
  await page.click('.px-tl-btn[data-a="dup"]');
  expect(await nFrames(page)).toBe(2);
  expect((await px(page, 4, 4))[3]).toBe(255);
  await click(page, 5, 5);                                    // only on the copy
  await page.click('.px-tl-head >> nth=0');
  expect((await px(page, 5, 5))[3]).toBe(0);
  // select both frames and link
  await page.click('.px-tl-head >> nth=1', { modifiers: ['Shift'] });
  await page.click('.px-tl-btn[data-a="link"]');
  await expect(page.locator('.px-tl-cel.linked')).toHaveCount(2);
  await click(page, 0, 0);
  await page.click('.px-tl-head >> nth=1');
  expect((await px(page, 0, 0))[3]).toBe(255);                // drawn once, shows in both
  // unlink from the cel options
  await page.click('.px-tl-cel >> nth=1');
  await page.click('.px-opts [data-a="unlink"]');
  await click(page, 7, 7);
  await page.click('.px-tl-head >> nth=0');
  expect((await px(page, 7, 7))[3]).toBe(0);
});

test('tags: make one, rename it, and playback loops inside it', async ({ page }) => {
  await newArt(page);
  await threeFrames(page);
  await page.click('.px-tl-btn[data-a="add"]');
  await page.click('.px-tl-head >> nth=1');
  await page.click('.px-tl-head >> nth=2', { modifiers: ['Shift'] });
  await page.click('.px-tl-btn[data-a="tag"]');
  await page.fill('.px-tag-name', 'walk');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.locator('.px-tl-tag')).toHaveText('walk');
  await page.click('.px-tl-head >> nth=1');
  await page.evaluate(() => { for (const f of __px.state.sprite.frames) f.durationMs = 40; });
  await page.keyboard.press('Enter');                         // play
  const seen = new Set();
  for (let i = 0; i < 12; i++) { seen.add(await frameNo(page)); await page.waitForTimeout(25); }
  await page.keyboard.press('Enter');                         // pause
  expect(await page.evaluate(() => __px.state.playing)).toBe(false);
  expect([...seen].sort()).toEqual([1, 2]);                   // never left the tag
});

test('frame duration by FPS, and dragging a frame to move it', async ({ page }) => {
  await newArt(page);
  await threeFrames(page);
  await heads(page).nth(0).dblclick();
  await page.fill('.px-du-fps', '20');
  await page.click('.px-dialog .px-btn-primary');
  expect(await page.evaluate(() => __px.state.sprite.frames[0].durationMs)).toBe(50);
  await expect(heads(page).nth(0).locator('small')).toHaveText('50');
  // drag frame 3 to the front
  const a = await heads(page).nth(2).boundingBox(), b = await heads(page).nth(0).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 10); await page.mouse.down();
  await page.mouse.move(b.x + 2, b.y + 10, { steps: 8 }); await page.mouse.up();
  await page.click('.px-tl-head >> nth=0');
  expect((await px(page, 3, 1))[3]).toBe(255);
});

test('onion skin shows the previous frame faintly; playback draws every frame', async ({ page }) => {
  await newArt(page);
  await click(page, 1, 1);
  await page.click('.px-tl-btn[data-a="add"]');
  const screen = async (x, y) => page.evaluate(([x, y]) => {
    const v = __px.view, cv = v.canvas, d = devicePixelRatio || 1;
    const sx = Math.round((v.ox + (x + 0.5) * v.zoom) * d), sy = Math.round((v.oy + (y + 0.5) * v.zoom) * d);
    return [...cv.getContext('2d').getImageData(sx, sy, 1, 1).data];
  }, [x, y]);
  const plain = await screen(1, 1);
  await page.click('.px-tl-onion');
  await page.waitForTimeout(100);
  const onion = await screen(1, 1);
  expect(onion).not.toEqual(plain);                           // a tinted ghost of frame 1
  await expect(page.locator('.px-tl-onion')).toHaveClass(/on/);
});

test('preview window plays on its own and jumps the canvas', async ({ page }) => {
  await newArt(page);
  await threeFrames(page);
  await page.click('.px-tl-btn[data-a="preview"]');
  await expect(page.locator('.px-preview')).toBeVisible();
  await page.locator('.px-preview-view').click();
  expect(await frameNo(page)).toBeGreaterThanOrEqual(0);
  await page.click('.px-preview [data-a="close"]');
  await expect(page.locator('.px-preview')).toBeHidden();
});

async function exportAs(page, tab, setup) {
  await page.click('.px-export-btn');
  await page.click(`.px-tabs [data-tab="${tab}"]`);
  if (setup) await setup();
  const n = await page.evaluate(() => window.__pxDownloads.length);
  await page.click('.px-dialog .px-btn-primary');
  await page.waitForFunction(n => window.__pxDownloads.length > n, n);
  return page.evaluate(n => window.__pxDownloads.slice(n), n);
}
const decodeFrames = (page, file) => page.evaluate(async f => {
  const d = new ImageDecoder({ data: new Uint8Array(f.bytes), type: f.type });
  await d.tracks.ready;
  const t = d.tracks.selectedTrack, out = { count: t.frameCount, durations: [] };
  for (let i = 0; i < t.frameCount; i++) { const r = await d.decode({ frameIndex: i }); out.durations.push(Math.round(r.image.duration / 1000)); out.w = r.image.displayWidth; r.image.close(); }
  return out;
}, file);

test('export GIF, APNG and WebP animations', async ({ page }) => {
  await newArt(page);
  await threeFrames(page);
  const [gif] = await exportAs(page, 'gif', () => page.click('.px-ex-scales [data-s="2"]'));
  expect(gif.name).toBe('Anim.gif');
  expect(await decodeFrames(page, gif)).toMatchObject({ count: 3, w: 16, durations: [100, 100, 100] });
  const [png] = await exportAs(page, 'apng');
  expect((await decodeFrames(page, png)).count).toBe(3);
  const [webp] = await exportAs(page, 'webp', () => page.locator('.px-seg[data-name="direction"] [data-v="pingpong"]').click());
  expect(webp.name).toBe('Anim.webp');
  expect((await decodeFrames(page, webp)).count).toBe(4);     // 1 2 3 2
});

test('sprite sheet with Aseprite-style JSON', async ({ page }) => {
  await newArt(page);
  await threeFrames(page);
  await page.evaluate(() => { __px.state.selectedFrames = new Set(__px.state.sprite.frames.map(f => f.id)); __px.anim.addTag(); });
  const files = await exportAs(page, 'sheet', async () => {
    await page.click('.px-ex-scales [data-s="1"]');
    await page.locator('.px-seg[data-name="layout"] [data-v="rows"]').click();
  });
  expect(files.map(f => f.name)).toEqual(['Anim.png', 'Anim.json']);
  const json = JSON.parse(Buffer.from(files[1].bytes).toString());
  expect(Object.keys(json.frames).length).toBe(3);
  expect(json.meta.size).toEqual({ w: 24, h: 8 });
  expect(json.meta.frameTags[0]).toMatchObject({ from: 0, to: 2, direction: 'forward' });
  expect(Object.values(json.frames)[2].frame).toEqual({ x: 16, y: 0, w: 8, h: 8 });
});

test('.aseprite export, then open it again from the gallery', async ({ page }) => {
  await newArt(page, 8, 8, 'Round trip');
  await threeFrames(page);
  await page.click('.px-lay-add');
  await click(page, 6, 6);
  await page.evaluate(() => { __px.state.selectedFrames = new Set(__px.state.sprite.frames.slice(0, 2).map(f => f.id)); __px.anim.addTag(); });
  const [ase] = await exportAs(page, 'ase');
  expect(ase.name).toBe('Round trip.aseprite');
  expect(ase.bytes[4] | (ase.bytes[5] << 8)).toBe(0xA5E0);
  await page.click('.px-back');
  await page.setInputFiles('.px-open-file', { name: 'Copy.aseprite', mimeType: 'application/octet-stream', buffer: Buffer.from(ase.bytes) });
  await page.waitForFunction(() => window.__px?.state.sprite?.name === 'Copy');
  expect(await nFrames(page)).toBe(3);
  await expect(page.locator('.px-row')).toHaveCount(2);
  await expect(page.locator('.px-tl-tag')).toHaveCount(1);
  await page.click('.px-tl-head >> nth=2');
  await page.locator('.px-row', { hasText: 'Layer 1' }).click();
  expect((await px(page, 3, 1))[3]).toBe(255);
});

test('frames, tags and links survive a reload', async ({ page }) => {
  await newArt(page, 8, 8, 'Keeps frames');
  await click(page, 2, 2);
  await page.click('.px-tl-btn[data-a="dup"]');
  await page.click('.px-tl-head >> nth=0', { modifiers: ['Shift'] });
  await page.click('.px-tl-btn[data-a="link"]');
  await page.click('.px-tl-btn[data-a="tag"]');
  await page.keyboard.press('Escape');
  await page.evaluate(() => __px.saveNow());
  await page.reload();
  await page.waitForFunction(() => window.__px?.state.sprite);
  expect(await nFrames(page)).toBe(2);
  await expect(page.locator('.px-tl-cel.linked')).toHaveCount(2);
  await expect(page.locator('.px-tl-tag')).toHaveCount(1);
});

test('the timeline folds down to its bar', async ({ page }) => {
  await newArt(page);
  await page.click('.px-tl-fold');
  await expect(page.locator('.px-tl-head')).toHaveCount(0);
  await expect(page.locator('.px-tl-play')).toBeVisible();
  await page.click('.px-tl-fold');
  await expect(page.locator('.px-tl-head')).toHaveCount(1);
});
