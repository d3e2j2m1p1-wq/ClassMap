// Classroom tools: name picker and group maker
import { test, expect } from '@playwright/test';

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('cm-ai', JSON.stringify({ tipSeen: true })); window.__cmNoSpin = true; });
  await page.goto('/app/');
  await page.waitForFunction(() => window.__cm && window.__classmapStarted);
  return errors;
}
// 12 students: 3 tagged IEP, 3 tagged Strong reader; Ana and Ben must be kept apart
async function classOnHome(page) {
  await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Period 2';
    cm.addLandingClass();
    const cls = cm.store.landingData.classes[0];
    'Ana,Ben,Cam,Dee,Eli,Fay,Gus,Hal,Ivy,Jo,Kai,Lu'.split(',').forEach((name, i) =>
      cls.students.push({ id: 's' + i, name, gender: null, tags: i < 3 ? ['IEP'] : i < 6 ? ['Strong reader'] : [] }));
    cls.hardRules.push({ type: 'separate', studentA: 'Ana', studentB: 'Ben' }, { type: 'spread', tag: 'IEP' }, { type: 'helper', tag: 'IEP', helperTag: 'Strong reader' });
    cm.store.activeClassId = cls.id;
    cm.saveLandingData();
    cm.showLanding();
  });
}

test('group sizes split evenly', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => [window.__cm.groupSizes(14, { size: 4 }), window.__cm.groupSizes(13, { count: 3 }), window.__cm.groupSizes(5, { size: 6 }), window.__cm.groupSizes(0, {})]);
  expect(r).toEqual([[4, 4, 3, 3], [5, 4, 4], [5], []]);
});

test('group maker follows keep-apart, spread-out and helper rules, every time', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  const bad = await page.evaluate(() => {
    const cm = window.__cm;
    const cls = cm.store.landingData.classes[0];
    let problems = 0;
    for (let k = 0; k < 30; k++) {
      const { groups } = cm.makeGroups(cls.students, { size: 4, rules: cls.hardRules });
      groups.forEach(g => {
        const names = g.map(s => s.name);
        if (names.includes('Ana') && names.includes('Ben')) problems++;
        const iep = g.filter(s => (s.tags || []).includes('IEP'));
        if (iep.length > 1) problems++;
        if (iep.length && !g.some(s => (s.tags || []).includes('Strong reader'))) problems++;
      });
      if (groups.flat().length !== 12) problems += 100;
    }
    return problems;
  });
  expect(bad).toBe(0);
});

test('Tools tab → name picker: no repeats until everyone has had a turn; absent students are skipped', async ({ page }) => {
  const errors = await open(page);
  await classOnHome(page);
  await page.locator('.ld-tab[data-tab=tools]').click();
  await page.locator('.ld-tool-card', { hasText: 'Name picker' }).click();
  const V = page.locator('.tools-view');
  await expect(V).toBeVisible();
  await expect(page.locator('.ai-bubble')).toBeHidden();          // nothing else on the projector
  // mark Lu absent
  await V.locator('.tools-here').click();
  await V.locator('.tools-chip', { hasText: 'Lu' }).click();
  await V.locator('.tools-here-done').click();
  await expect(V.locator('.tools-here')).toHaveText('Here: 11/12');
  const seen = [];
  for (let i = 0; i < 11; i++) {
    await V.locator('.picker-go').click();
    seen.push(await V.locator('.picker-name').textContent());
  }
  expect(new Set(seen).size).toBe(11);
  expect(seen).not.toContain('Lu');
  await expect(V.locator('.picker-name')).not.toHaveText('Everyone’s had a turn');
  await expect(V.locator('.picker-new')).toBeVisible();
  await expect(V.locator('.picker-left')).toContainText('0 of 11 still to go');
  // Space picks; a new round starts automatically from the keyboard
  await page.keyboard.press('Space');
  await expect(V.locator('.picker-left')).toContainText('10 of 11 still to go');
  // put it back
  await V.locator('.picker-undo').click();
  await expect(V.locator('.picker-left')).toContainText('11 of 11 still to go');
  await page.keyboard.press('Escape');
  await expect(V).toHaveCount(0);
  await expect(page.locator('.ai-bubble')).toBeVisible();
  expect(errors).toEqual([]);
});

test('group maker on screen: groups of 3, rules kept, copy, nobody absent included', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await classOnHome(page);
  await page.locator('.ld-tab[data-tab=tools]').click();
  await page.locator('.ld-tool-card', { hasText: 'Group maker' }).click();
  const V = page.locator('.tools-view');
  await V.locator('.tools-here').click();
  await V.locator('.tools-chip', { hasText: 'Kai' }).click();
  await V.locator('.tools-here-done').click();
  await V.locator('.groups-n').selectOption('3');
  await V.locator('.groups-go').click();
  await expect(V.locator('.group-card')).toHaveCount(4);          // 11 here → 4 groups: 3, 3, 3, 2
  const groups = await V.locator('.group-card').evaluateAll(els => els.map(e => [...e.querySelectorAll('.group-name')].map(n => n.textContent)));
  expect(groups.flat()).toHaveLength(11);
  expect(groups.flat()).not.toContain('Kai');
  expect(groups.some(g => g.includes('Ana') && g.includes('Ben'))).toBe(false);
  await V.locator('.groups-copy').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Group 1: /);
  // number of groups instead
  await V.locator('.groups-mode').selectOption('count');
  await V.locator('.groups-n').selectOption('2');
  await V.locator('.groups-go').click();
  await expect(V.locator('.group-card')).toHaveCount(2);
});

test('the helper opens the tools: “make groups of 3”, “pick a name”', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await page.locator('.ai-bubble').click();
  await page.locator('.ai-ask-in').fill('make groups of 3');
  await page.locator('.ai-send').click();
  await expect(page.locator('.tools-view .group-card')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await page.locator('.ai-bubble').click();
  await page.locator('.ai-ask-in').fill('pick a random student');
  await page.locator('.ai-send').click();
  await expect(page.locator('.tools-view .picker-go')).toBeVisible();
});

test('tools from a chart (⋯ menu) use that chart’s class', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await page.evaluate(() => window.__cm.createNewChart());
  await page.locator('[aria-label="More options"]').click();
  await page.locator('.more-menu .tm-item', { hasText: 'Name picker' }).click();
  await expect(page.locator('.tools-view .tools-title')).toHaveText('Period 2');
});
