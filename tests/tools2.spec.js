// Name picker: skip by tag (tags hidden until asked). Timer: sound choice and how many times it plays.
import { test, expect } from '@playwright/test';

async function start(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('cm-ai', JSON.stringify({ tipSeen: true })); window.__cmNoSpin = true; });
  await page.goto('/app/');
  await page.waitForFunction(() => window.__classmapStarted);
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.createSampleClass();
    const c = cm.store.landingData.classes[0];
    c.students[0].tags = ['IEP']; c.students[3].tags = ['iep', 'ELL']; c.students[7].tags = ['504'];
    cm.saveLandingData();
    cm.goHome();
  });
  return errors;
}

test('skip everyone with a tag: tags hidden until shown, those students never picked, new ones too', async ({ page }) => {
  const errors = await start(page);
  await page.evaluate(() => window.__cm.openTools('picker'));
  await page.click('.picker-skip');
  await expect(page.locator('.skip-tag')).toHaveCount(0);          // hidden on the projector by default
  await expect(page.locator('.skip-chip-tag')).toHaveCount(0);
  await page.click('.skip-tags-toggle');
  await expect(page.locator('.skip-tag')).toHaveCount(3);          // 504, ELL, IEP (iep counts as IEP)
  await page.locator('.skip-tag', { hasText: 'IEP' }).click();
  await expect(page.locator('.tools-chip.skip[data-id]')).toHaveCount(2);
  // a tag-skipped student can't be un-skipped by name, only by turning the tag off
  await page.locator('.tools-chip.by-tag').first().click();
  await expect(page.locator('.tools-chip.skip[data-id]')).toHaveCount(2);
  await page.click('.tools-skip-done');
  await expect(page.locator('.picker-skip')).toHaveText('Skip list (2)');
  await expect(page.locator('.picker-left')).toContainText('18 still to go');
  const tagged = await page.evaluate(() => window.__cm.store.landingData.classes[0].students.filter(s => (s.tags || []).some(t => t.toLowerCase() === 'iep')).map(s => s.name));
  const seen = new Set();
  for (let i = 0; i < 18; i++) { await page.click('.picker-go'); seen.add(await page.locator('.picker-name').textContent()); }
  expect(seen.size).toBe(18);
  for (const n of tagged) expect(seen.has(n)).toBe(false);
  // a student who gets the tag later is skipped too
  await page.evaluate(() => { const c = window.__cm.store.landingData.classes[0]; c.students[10].tags = ['IEP']; window.__cm.saveLandingData(); });
  await page.click('.tools-tab[data-t=groups]'); await page.click('.tools-tab[data-t=picker]');
  await expect(page.locator('.picker-skip')).toHaveText('Skip list (3)');
  expect(await page.evaluate(() => window.__cm.store.landingData.classes[0].pickerSkipTags)).toEqual(['iep']);
  expect(errors).toEqual([]);
});

test('timer sound: 5 times by default, pick another sound and count, Stop cuts it off', async ({ page }) => {
  const errors = await start(page);
  await page.evaluate(() => window.__cm.openTools('timer'));
  await expect(page.locator('.timer-sound-btn')).toHaveText('🔔 Chimes · 5×');
  await page.click('.timer-sound-btn');
  await expect(page.locator('.snd-opt')).toHaveCount(5);
  await page.locator('.snd-pick', { hasText: 'Marimba' }).click();
  await page.click('.snd-less'); await page.click('.snd-less'); await page.click('.snd-less');
  await expect(page.locator('.snd-count')).toHaveText('2');
  await page.click('.tools-sound-done');
  await expect(page.locator('.timer-sound-btn')).toHaveText('🔔 Marimba · 2×');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cm-chime')))).toMatchObject({ sound: 'marimba', loops: 2, on: true });

  // a 2-second timer: it rings, then stops by itself after 2 plays (~3s)
  await page.evaluate(() => window.__cm.closeTools());
  await page.evaluate(() => window.__cm.openTools('timer', { minutes: 2 / 60, start: true }));
  await expect(page.locator('.timer-digits')).toHaveText('Time’s up!', { timeout: 4000 });
  expect(await page.evaluate(() => window.__cm.isRinging())).toBe(true);
  await expect(page.locator('.timer-stop')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__cm.isRinging()), { timeout: 5000 }).toBe(false);
  await expect(page.locator('.timer-stop')).toHaveCount(0);

  // 10 plays: Stop (or Space) silences it at once
  await page.evaluate(() => localStorage.setItem('cm-chime', JSON.stringify({ sound: 'bell', loops: 10, on: true })));
  await page.evaluate(() => window.__cm.closeTools());
  await page.evaluate(() => window.__cm.openTools('timer', { minutes: 1 / 60, start: true }));
  await expect.poll(() => page.evaluate(() => window.__cm.isRinging()), { timeout: 3000 }).toBe(true);
  await page.click('.timer-stop');
  expect(await page.evaluate(() => window.__cm.isRinging())).toBe(false);
  expect(errors).toEqual([]);
});

test('timer sound can be turned off', async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__cm.openTools('timer'));
  await page.click('.timer-sound-btn');
  await page.locator('.snd-on').uncheck();
  await page.click('.tools-sound-done');
  await expect(page.locator('.timer-sound-btn')).toHaveText('🔕 Sound off');
  await page.evaluate(() => { window.__cm.closeTools(); window.__cm.openTools('timer', { minutes: 1 / 60, start: true }); });
  await expect(page.locator('.timer-digits')).toHaveText('Time’s up!', { timeout: 3000 });
  expect(await page.evaluate(() => window.__cm.isRinging())).toBe(false);
});
