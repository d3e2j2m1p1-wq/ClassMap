// Classroom import stays hidden unless its own switch is on (the test server turns it on)
import { test, expect } from '@playwright/test';
test('Classroom import button shows only when VITE_CLASSROOM_IMPORT is on', async ({ page }) => {
  await page.goto('/app/');
  await page.waitForFunction(() => window.__classmapStarted);
  await expect(page.locator('.add-class-form + .gc-import-btn')).toBeVisible();
  const src = await (await page.request.get('/src/config.js')).text();
  expect(src).toContain('VITE_CLASSROOM_IMPORT');
});
