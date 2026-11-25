// The light/dark switch: a scene with a sliding lens
import { test, expect } from '@playwright/test';

const start = async page => {
  await page.goto('/app/');
  await page.waitForFunction(() => window.__classmapStarted);
};
const isDark = page => page.evaluate(() => !document.body.classList.contains('light'));

test('light is the default; tapping the switch slides to night and remembers it', async ({ page }) => {
  await start(page);
  const sw = page.locator('#themeSwitchHome');
  expect(await isDark(page)).toBe(false);
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect.poll(() => isDark(page), { timeout: 4000 }).toBe(true);
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('classmap_theme'))).toBe('dark');
  await page.reload();
  await page.waitForFunction(() => window.__classmapStarted);
  expect(await isDark(page)).toBe(true);
  await expect(page.locator('#themeSwitchHome')).toHaveAttribute('aria-checked', 'true');
});

test('dragging the lens part way and letting go snaps back; past halfway switches', async ({ page }) => {
  await start(page);
  const sw = page.locator('#themeSwitchHome');
  const b = await sw.boundingBox();
  const y = b.y + b.height / 2, x = b.x + b.height / 2, span = b.width - b.height;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + span * 0.3, y, { steps: 5 });
  expect(Number(await sw.evaluate(el => getComputedStyle(el).getPropertyValue('--t')))).toBeGreaterThan(0.2);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  expect(await isDark(page)).toBe(false);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + span * 0.8, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => isDark(page), { timeout: 4000 }).toBe(true);
});

test('keyboard works, both switches stay in step, and reduced motion is instant', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  await page.locator('#themeSwitchHome').focus();
  await page.keyboard.press('Enter');
  expect(await isDark(page)).toBe(true);
  await page.evaluate(() => window.__cm.createSampleClass());
  await expect(page.locator('#themeBtn')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#themeBtn').click();
  expect(await isDark(page)).toBe(false);
});
