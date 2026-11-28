// The home page: the hero, the seating story, Try it, little tools, and carrying names into the app
import { test, expect } from '@playwright/test';

function watch(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}
const scrollThrough = async (page, sel, f) => {
  await page.evaluate(([sel, f]) => {
    const el = document.querySelector(sel);
    scrollTo(0, el.offsetTop + (el.offsetHeight - innerHeight) * f);
  }, [sel, f]);
  await page.waitForTimeout(300);
};

test('home page loads with no errors and builds the room as you scroll', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('seating charts');
  await expect(page.locator('.room .name')).toHaveCount(16);
  await scrollThrough(page, '.builder', 0.05);
  await expect(page.locator('.steps li.on')).toHaveAttribute('data-step', '0');
  await scrollThrough(page, '.builder', 0.7);
  await expect(page.locator('.steps li.on')).toHaveAttribute('data-step', '2');
  await expect(page.locator('.name.clash')).toHaveCount(2);
  await scrollThrough(page, '.builder', 1);
  await expect(page.locator('.steps li.on')).toHaveAttribute('data-step', '3');
  await expect(page.locator('.name.clash')).toHaveCount(0);
  // Owen and Max swapped: Owen now sits at the last table
  const [owen, liam] = await Promise.all(['Owen', 'Liam'].map(n => page.locator('.room .name', { hasText: n }).boundingBox()));
  expect(Math.abs(owen.y - liam.y)).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test('hero: Notes and seating charts come first, and the things around the teacher drift as you scroll', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await expect(page.locator('.app-card a[href="notes/"]')).toBeVisible();
  await expect(page.locator('.app-card a[href="app/"]')).toBeVisible();
  await expect(page.locator('.hero-art [data-depth]')).toHaveCount(17);
  // every picture in the hero loads
  const broken = await page.evaluate(() => [...document.querySelectorAll('.hero-art img')].filter(i => !i.complete || !i.naturalWidth).map(i => i.src));
  expect(broken).toEqual([]);
  const cal = page.locator('.hl-calendar');
  const before = await cal.evaluate(el => el.style.transform);
  await page.evaluate(() => scrollTo(0, 300));
  await expect.poll(() => cal.evaluate(el => el.style.transform)).not.toBe(before);
  // the calendar sits on the right, so it drifts right and up
  const m = (await cal.evaluate(el => el.style.transform)).match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/);
  expect(+m[1]).toBeGreaterThan(0);
  expect(+m[2]).toBeLessThan(0);
  expect(errors).toEqual([]);
});

test('home page makes no requests to other sites', async ({ page }) => {
  const outside = [];
  page.on('request', r => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) outside.push(r.url()); });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(outside).toEqual([]);
});

test('little tools: name picker, timer, voice level', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const seen = new Set();
  for (let i = 0; i < 8; i++) { await page.click('#toyPick'); seen.add(await page.locator('#toyName').textContent()); }
  expect(seen.size).toBe(8);                         // everyone once before anyone repeats
  await page.click('#toyTimer');
  await expect(page.locator('#toyTime')).toHaveText('0:59', { timeout: 2500 });
  await page.click('#toyTimer');
  await expect(page.locator('#toyTimer')).toHaveText('Resume');
  await page.click('.toy-levels button[data-v="2"]');
  await expect(page.locator('#toyVoice')).toContainText('Table talk');
});

test('Try it seats the names and carries them into the app as a class', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await page.fill('#tryNames', 'Ava Lopez\nLiam Chen\nMia Patel\nChen, Noah\nZoe Rivera');
  await page.click('#tryMake');
  await expect(page.locator('.try-table')).toHaveCount(2);
  await expect(page.locator('.try-table i:not(.empty)')).toHaveCount(5);
  await expect(page.locator('#tryGo')).toBeVisible();
  await page.click('#tryGo');
  await page.waitForFunction(() => window.__classmapStarted);
  const cls = await page.evaluate(() => window.__cm.store.landingData.classes.at(-1));
  expect(cls.name).toBe('My class');
  expect(cls.students.map(s => s.name)).toEqual(['Ava Lopez', 'Liam Chen', 'Mia Patel', 'Noah Chen', 'Zoe Rivera']);
  await expect(page.locator('.ld-tab[data-tab="roster"]')).toHaveClass(/active/);
  expect(await page.evaluate(() => localStorage.getItem('cm-handoff'))).toBeNull();
  // opening the app again does not make a second class
  await page.reload();
  await page.waitForFunction(() => window.__classmapStarted);
  expect(await page.evaluate(() => window.__cm.store.landingData.classes.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('an old handoff is ignored', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('cm-handoff', JSON.stringify({ names: ['Old'], at: Date.now() - 3 * 3600e3 })); } });
  await page.goto('/app/');
  await page.waitForFunction(() => window.__classmapStarted);
  expect(await page.evaluate(() => window.__cm.store.landingData.classes.length)).toBe(0);
});

test('reduced motion shows the finished room without scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.done-note')).toHaveCSS('opacity', '1');
  await expect(page.locator('.steps li.on')).toHaveAttribute('data-step', '3');
});

test('phone: no sideways scrolling', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto('/');
  for (const f of [0, 0.3, 0.6, 1]) {
    await page.evaluate(f => scrollTo(0, document.body.scrollHeight * f), f);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  expect(errors).toEqual([]);
  await ctx.close();
});
