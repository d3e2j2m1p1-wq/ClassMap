// Guides, privacy and contact pages in the new look; back to top; app ↔ website links
import { test, expect } from '@playwright/test';

const PAGES = ['/guides/', '/guides/how-to-make-a-seating-chart/', '/guides/separating-students/', '/privacy/', '/contact/'];

test('subpages use the new look, load nothing from other sites, and link to contact', async ({ page }) => {
  const outside = [], errors = [];
  page.on('request', r => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) outside.push(r.url()); });
  page.on('pageerror', e => errors.push(String(e)));
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('.site-top .brand img')).toBeVisible();
    await expect(page.locator('.page-head h1')).toBeVisible();
    await expect(page.locator('main .sheet')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Nunito');
    await expect(page.locator('.footer a[href="/contact/"]')).toHaveCount(1);
  }
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test('back to top: appears after scrolling, and takes you up (home page and a guide)', async ({ page }) => {
  for (const path of ['/', '/guides/how-to-make-a-seating-chart/']) {
    await page.goto(path);
    const btn = page.locator('.to-top');
    await expect(btn).not.toHaveClass(/show/);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await expect(btn).toHaveClass(/show/);
    await btn.click();
    await expect.poll(() => page.evaluate(() => scrollY), { timeout: 4000 }).toBe(0);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.locator('.to-top-link').click();
    await expect.poll(() => page.evaluate(() => scrollY), { timeout: 4000 }).toBe(0);
  }
});

test('contact form writes an email in the teacher’s own email app', async ({ page }) => {
  await page.addInitScript(() => { window.__cmOpenMail = u => { window.__mail = u; }; });
  await page.goto('/contact/');
  await page.getByRole('button', { name: /Write the email/ }).click();
  expect(await page.evaluate(() => window.__mail ?? null)).toBeNull();          // empty message: nothing opens
  await page.getByText('Feature idea').click();
  await page.fill('input[name=name]', 'Ms. Rivera');
  await page.fill('textarea[name=message]', 'Could the timer show seconds bigger?');
  await page.getByRole('button', { name: /Write the email/ }).click();
  const mail = decodeURIComponent(await page.evaluate(() => window.__mail));
  expect(mail).toContain('mailto:MiguelDavila94@gmail.com');
  expect(mail).toContain('subject=ClassMap: Feature idea');
  expect(mail).toContain('Could the timer show seconds bigger?');
  expect(mail).toContain('From: Ms. Rivera');
  await expect(page.locator('#contactSent')).toBeVisible();
});

test('the home page links to contact, and the app links back to the website', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.footer a[href="contact/"]')).toHaveCount(1);
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  await page.goto('/app/');
  await page.waitForFunction(() => window.__classmapStarted);
  await expect(page.locator('a.landing-logo')).toHaveAttribute('href', '/');
  await page.locator('#homeMore [aria-haspopup]').click();
  await page.getByRole('menuitem', { name: /ClassMap website/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('h1')).toContainText('seating charts');
});
