// Finding Send & receive: entry points, the More menu, the hint and the nudge
import { test, expect } from '@playwright/test';

async function start(page, { sample = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('cm-ai', JSON.stringify({ tipSeen: true })));
  await page.goto('/app/');
  await page.waitForFunction(() => window.__classmapStarted);
  if (sample) { await page.evaluate(() => window.__cm.createSampleClass()); await page.waitForTimeout(300); }
  return errors;
}
const dialogTitle = page => page.locator('#shareDialog h2');

test('a new device is offered Receive on the welcome screen and in "Got a code?"', async ({ page }) => {
  const errors = await start(page);
  await page.getByRole('button', { name: /Receive your classes/ }).click();
  await expect(dialogTitle(page)).toHaveText('Receive');
  await expect(page.locator('#shCode')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#shareDialog')).toHaveCount(0);
  await page.locator('#gotCodeInput').fill('abc234');
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(dialogTitle(page)).toHaveText('Receive');
  await expect(page.locator('#shCode')).toHaveValue('ABC-234');
  await expect(page.locator('#gotCodeInput')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('More menu holds backup, import and name list; Escape and outside clicks close it', async ({ page }) => {
  await start(page);
  const menu = page.locator('.home-more-menu');
  await expect(menu).toBeHidden();
  await page.locator('#homeMore [aria-haspopup]').click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(6);   // backup, import, name list + website, guides, contact
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.locator('#homeMore [aria-haspopup]').click();
  await page.mouse.click(700, 600);
  await expect(menu).toBeHidden();
  await page.locator('#homeMore [aria-haspopup]').click();
  await menu.getByRole('menuitem', { name: /Name list/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByText('Name list').first()).toBeVisible();
});

test('Send is offered for a class, a chart card and the open chart', async ({ page }) => {
  const errors = await start(page, { sample: true });
  await page.evaluate(() => window.__cm.goHome());
  await page.getByRole('button', { name: /Send class/ }).click();
  await expect(dialogTitle(page)).toContainText('Send');
  await page.keyboard.press('Escape');
  await page.locator('.chart-card-send').first().click();
  await expect(dialogTitle(page)).toContainText('Send');
  await page.keyboard.press('Escape');
  await page.locator('.chart-card').first().click();
  await page.getByRole('button', { name: 'Send this chart' }).click();
  await expect(dialogTitle(page)).toContainText('Send');
  expect(errors).toEqual([]);
});

test('second chart shows a one-time hint; a clean Auto-Assign nudges until something is sent', async ({ page }) => {
  await start(page, { sample: true });
  // the sample class already has one chart, so a new one is the second
  await page.evaluate(() => window.__cm.createNewChart());
  const card = page.locator('#shareCard');
  await expect(card).toContainText('Share this chart');
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toHaveCount(0);
  await page.evaluate(() => window.__cm.createNewChart());
  await page.waitForTimeout(1300);
  await expect(card).toHaveCount(0);                     // the hint only shows once
  await page.evaluate(() => window.__cm.autoAssign());
  await expect(card).toContainText('Every rule kept');
  await card.getByRole('button', { name: 'Send it' }).click();
  await expect(dialogTitle(page)).toContainText('Send');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__cm.createNewChart());
  await page.evaluate(() => window.__cm.autoAssign());
  await page.waitForTimeout(2300);
  await expect(card).toHaveCount(0);                     // sent once → no more nudges
});

test('the theme flips halfway through the slide, not at the end', async ({ page }) => {
  await start(page);
  // note how far the lens had travelled at the moment the page changed theme
  await page.evaluate(() => {
    const sw = document.getElementById('themeSwitchHome');
    new MutationObserver(() => { window.__flipT ??= Number(getComputedStyle(sw).getPropertyValue('--t')); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });
  await page.locator('#themeSwitchHome').click();
  await expect.poll(() => page.evaluate(() => window.__flipT ?? null), { timeout: 2000 }).not.toBeNull();
  const t = await page.evaluate(() => window.__flipT);
  expect(t).toBeGreaterThanOrEqual(0.5);
  expect(t).toBeLessThan(0.8);
});
