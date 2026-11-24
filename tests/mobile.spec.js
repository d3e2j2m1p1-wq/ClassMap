// Phone-size checks: nothing spills sideways, the room fits the screen, and dragging/tapping
// still lands in the right place when the room is zoomed.
import { test, expect } from '@playwright/test';

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('cm-ai', JSON.stringify({ tipSeen: true })));
  await page.goto('/app/');
  await page.waitForFunction(() => window.__cm && window.__classmapStarted);
  return errors;
}
// A class of 14 and a chart with six tables of four (the room is ~640 wide: too wide for a phone at 100%)
async function chart(page, { seat = 12 } = {}) {
  await page.evaluate(n => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Period 3';
    cm.addLandingClass();
    const cls = cm.store.landingData.classes[0];
    'Liam,Owen,Ana,Sofia,Jayden,Mia,Noah,Emma,Lucas,Ava,Ethan,Zoe,Leo,Ivy'.split(',').forEach((name, i) => cls.students.push({ id: 's' + i, name, gender: 'none' }));
    cm.store.activeClassId = cls.id;
    cm.saveLandingData();
    cm.createNewChart();
    const T = (id, x, y) => ({ id, type: 'table', x, y, rotation: 0, groups: 1, groupShift: 0, seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }, { x: 14, y: 76 }, { x: 76, y: 76 }] });
    cm.state.layoutItems.push(T('a', 80, 120), T('b', 300, 120), T('c', 520, 120), T('d', 80, 330), T('e', 300, 330), T('f', 520, 330));
    const seats = cm.getAllSeats();
    cm.state.students.slice(0, n).forEach((s, i) => { cm.state.assignments[seats[i].seatId] = s.id; });
    cm.renderLayoutCanvas();
  }, seat);
}
const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);

test.describe('on a phone', () => {
  test.use(PHONE);

  test('nothing spills sideways; tabs and buttons fit; the room fits the width', async ({ page }) => {
    const errors = await open(page);
    expect(await noSideways(page)).toBe(true);
    await chart(page);
    for (const tab of ['roster', 'rules', 'layout', 'assign']) {
      await page.locator(`.tab-btn[data-panel=${tab}]`).click();
      expect(await noSideways(page), tab).toBe(true);
      const b = await page.locator(`.tab-btn[data-panel=${tab}]`).boundingBox();
      expect(b.x + b.width).toBeLessThanOrEqual(390);
      expect(b.height).toBeGreaterThanOrEqual(34);        // big enough to tap
    }
    // header buttons all on screen
    for (const el of await page.locator('header .header-actions > .hbtn:visible, header .header-actions .tool-dd > .hbtn').all()) {
      const b = await el.boundingBox();
      expect(b.x + b.width).toBeLessThanOrEqual(391);
    }
    // the Assign room is zoomed out so the last table's right edge is on screen
    const z = await page.evaluate(() => window.__cm.zoomOf('assign'));
    expect(z).toBeLessThan(0.75);
    const lastTable = await page.locator('#assignCanvas .seat-chip').last().boundingBox();
    expect(lastTable.x + lastTable.width).toBeLessThanOrEqual(390);
    await expect(page.locator('#panel-assign .zoom-bar .zoom-pct')).toHaveText(`${Math.round(z * 100)}%`);
    // Present and theme move into ⋯ on phones
    await page.locator('[aria-label="More options"]').click();
    await expect(page.locator('.more-menu .tm-item', { hasText: 'Present' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('zoomed room: tap a name, tap a seat; + and Fit buttons', async ({ page }) => {
    await open(page);
    await chart(page);
    await page.locator('.tab-btn[data-panel=assign]').click();
    const z0 = await page.evaluate(() => window.__cm.zoomOf('assign'));
    await expect(page.locator('#assignFloatPanel')).toHaveClass(/collapsed/);   // phones start with the room in view
    await expect(page.locator('#classSidePanel')).toHaveClass(/collapsed/);
    await page.locator('#assignFloatPanel .assign-float-header').tap();          // open Auto-Assign
    await page.locator('.chip-pill', { hasText: 'Leo' }).tap();
    await page.locator('#assignFloatPanel .assign-float-header').tap();          // fold it away again
    const empty = page.locator('#assignCanvas .seat-chip.empty').first();
    const id = await empty.getAttribute('data-seat-id');
    await empty.tap();
    expect(await page.evaluate(s => window.__cm.state.assignments[s], id)).toBe('s12');
    await page.locator('#panel-assign .zoom-bar [aria-label="Zoom in"]').tap();
    expect(await page.evaluate(() => window.__cm.zoomOf('assign'))).toBeCloseTo(z0 * 1.2, 1);
    await page.locator('#panel-assign .zoom-bar .zoom-pct').tap();
    expect(await page.evaluate(() => window.__cm.zoomOf('assign'))).toBeCloseTo(z0, 1);
  });

  test('class sheet opens at the top; opening it folds Auto-Assign', async ({ page }) => {
    await open(page);
    await chart(page);
    await page.locator('.tab-btn[data-panel=assign]').click();
    await page.locator('#assignFloatPanel .assign-float-header').tap();
    await page.locator('#classSidePanel .assign-float-header').tap();
    await expect(page.locator('#assignFloatPanel')).toHaveClass(/collapsed/);
    await expect(page.locator('#classSidePanel .csp-row')).toHaveCount(14);
    const box = await page.locator('#classSidePanel').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.locator('#classSidePanel .assign-float-header').tap();
    await expect.poll(async () => (await page.locator('#classSidePanel').boundingBox()).height).toBeLessThan(60);   // folded to its bar
  });

  test('toasts sit above the helper button', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__cm.showToast('Saved'));
    const t = await page.locator('.toast.show').boundingBox();
    const b = await page.locator('.ai-bubble').boundingBox();
    expect(t.y + t.height).toBeLessThanOrEqual(b.y + 2);
  });
});

test('dragging a table in a zoomed room moves it the right distance', async ({ page }) => {
  await open(page);
  await chart(page);
  await page.locator('.tab-btn[data-panel=layout]').click();
  await page.evaluate(() => window.__cm.setZoom('layout', 0.5));
  const t = page.locator('#layoutCanvas .canvas-item[data-id="e"] .canvas-table-free');
  const b = await t.boundingBox();
  const x0 = await page.evaluate(() => window.__cm.state.layoutItems.find(i => i.id === 'e').x);
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 54, b.y + b.height / 2, { steps: 5 });
  await page.mouse.move(b.x + 104, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  const x1 = await page.evaluate(() => window.__cm.state.layoutItems.find(i => i.id === 'e').x);
  expect(Math.abs((x1 - x0) - 200)).toBeLessThanOrEqual(28);   // 100 screen px at 50% = 200 in the room (± snapping)
  await page.evaluate(() => window.__cm.setZoom('layout', 1));
});

test.describe('phone sideways', () => {
  test.use({ ...PHONE, viewport: { width: 844, height: 390 } });
  test('home page scrolls so the new-class box can be reached', async ({ page }) => {
    await open(page);
    await page.locator('#newClassInput').scrollIntoViewIfNeeded();
    await expect(page.locator('#newClassInput')).toBeInViewport();
    await page.locator('#newClassInput').fill('Period 5');
    await page.locator('#newClassInput').press('Enter');
    expect(await page.evaluate(() => window.__cm.store.landingData.classes.map(c => c.name))).toEqual(['Period 5']);
  });
});
