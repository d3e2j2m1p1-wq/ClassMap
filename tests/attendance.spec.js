// Attendance on the seating chart, and the name picker's skip list
import { test, expect } from '@playwright/test';

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('cm-ai', JSON.stringify({ tipSeen: true })); window.__cmNoSpin = true; });
  await page.goto('/app/');
  await page.waitForFunction(() => window.__cm && window.__classmapStarted);
  return errors;
}
// 9 students; the first 8 seated at two tables, Ivy unplaced
async function chart(page) {
  await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Period 4';
    cm.addLandingClass();
    const cls = cm.store.landingData.classes[0];
    'Ana,Ben,Cam,Dee,Eli,Fay,Gus,Hal,Ivy'.split(',').forEach((name, i) => cls.students.push({ id: 's' + i, name, gender: null }));
    cm.store.activeClassId = cls.id;
    cm.saveLandingData();
    cm.createNewChart();
    const T = (id, x, y) => ({ id, type: 'table', x, y, rotation: 0, groups: 1, groupShift: 0, seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }, { x: 14, y: 76 }, { x: 76, y: 76 }] });
    cm.state.layoutItems.push(T('ta', 420, 120), T('tb', 640, 120));
    const seats = cm.getAllSeats();
    cm.state.students.slice(0, 8).forEach((s, i) => { cm.state.assignments[seats[i].seatId] = s.id; });
    cm.renderLayoutCanvas();
    cm.switchPanel('assign', document.querySelector('.tab-btn[data-panel=assign]'));
  });
}
const seatOf = (page, id) => page.locator(`#assignCanvas .seat-chip[data-seat-id="${id}"]`);

test('name picker: students on the skip list are never picked, and the list is saved with the class', async ({ page }) => {
  const errors = await open(page);
  await chart(page);
  await page.evaluate(() => window.__cm.openTools('picker'));
  const V = page.locator('.tools-view');
  await V.locator('.picker-skip').click();
  await V.locator('.tools-chip', { hasText: 'Ben' }).click();
  await V.locator('.tools-chip', { hasText: 'Cam' }).click();
  await V.locator('.tools-skip-done').click();
  await expect(V.locator('.picker-skip')).toHaveText('Skip list (2)');
  await expect(V.locator('.picker-left')).toContainText('7 of 7 still to go this round · 2 skipped');
  const seen = [];
  for (let i = 0; i < 7; i++) { await V.locator('.picker-go').click(); seen.push(await V.locator('.picker-name').textContent()); }
  expect(seen.sort()).toEqual(['Ana', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy']);
  expect(await page.evaluate(() => window.__cm.store.landingData.classes[0].pickerSkip)).toEqual(['s1', 's2']);
  // skipped students still join groups
  await V.locator('.tools-tab[data-t=groups]').click();
  await V.locator('.groups-go').click();
  const names = await V.locator('.group-name').allTextContents();
  expect(names).toContain('Ben');
  expect(errors).toEqual([]);
});

test('attendance on the chart: tap → absent → late → here; copy; skipped by the tools; never on the projector', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await open(page);
  await chart(page);
  await page.locator('.att-toggle').click();
  const banner = page.locator('.att-banner:not(.pts-banner)');
  await expect(banner).toBeVisible();
  // Ana (seat ta_0): absent
  await seatOf(page, 'ta_0').click();
  await expect(seatOf(page, 'ta_0')).toHaveClass(/att-absent/);
  await expect(banner.locator('.att-n.absent')).toHaveText('1 absent');
  // a tap in attendance mode doesn't select the seat
  expect(await page.evaluate(() => window.__cm.store.selectedSeatId)).toBeFalsy();
  // Ben (ta_1): late (two taps)
  await seatOf(page, 'ta_1').click();
  await seatOf(page, 'ta_1').click();
  await expect(seatOf(page, 'ta_1')).toHaveClass(/att-late/);
  await expect(banner.locator('.att-n.late')).toHaveText('1 late');
  // Ivy has no seat: mark her from the Unplaced list
  await page.locator('#unplacedChips .chip-pill', { hasText: 'Ivy' }).click();
  await expect(banner.locator('.att-n.absent')).toHaveText('2 absent');
  // no seats changed
  expect(await page.evaluate(() => Object.keys(window.__cm.state.assignments).length)).toBe(8);
  await banner.locator('.att-copy').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Period 4 · /);
  expect(text).toContain('Absent (2): Ana, Ivy');
  expect(text).toContain('Late (1): Ben');
  // Done: the banner goes, today's marks stay (faintly) on the teacher's chart
  await banner.locator('.att-done').click();
  await expect(banner).toBeHidden();
  await expect(seatOf(page, 'ta_0')).toHaveClass(/att-absent/);
  // …but not on the projector
  await page.evaluate(() => window.__cm.openPresent());
  expect(await page.locator('.present-view .att-absent, .present-view .att-late').count()).toBe(0);
  await page.evaluate(() => window.__cm.closePresent());
  // the tools see the same attendance: Ana and Ivy are skipped, late Ben is here
  await page.evaluate(() => window.__cm.openTools('picker'));
  await expect(page.locator('.tools-here')).toHaveText('Here: 7/9');
  const seen = [];
  for (let i = 0; i < 7; i++) { await page.locator('.picker-go').click(); seen.push(await page.locator('.picker-name').textContent()); }
  expect(seen).not.toContain('Ana');
  expect(seen).not.toContain('Ivy');
  expect(seen).toContain('Ben');
  await page.keyboard.press('Escape');
  // back to "here" for Ana with a third tap
  await page.locator('.att-toggle').click();
  await seatOf(page, 'ta_0').click();
  await seatOf(page, 'ta_0').click();
  await expect(seatOf(page, 'ta_0')).not.toHaveClass(/att-absent|att-late/);
  expect(errors).toEqual([]);
});

test('attendance is per day: yesterday’s absences don’t carry over', async ({ page }) => {
  await open(page);
  await chart(page);
  await page.evaluate(() => {
    const id = window.__cm.store.landingData.classes[0].id;
    localStorage.setItem('cm-att-' + id, JSON.stringify({ '2020-01-02': { absent: ['s0'], tardy: [] } }));
    window.__cm.renderAssignPanel();
  });
  await expect(seatOf(page, 'ta_0')).not.toHaveClass(/att-absent/);
  const hist = await page.evaluate(() => window.__cm.history(window.__cm.store.landingData.classes[0].id));
  expect(hist[0]).toEqual({ day: '2020-01-02', absent: ['s0'], tardy: [] });
});

test('the helper marks attendance (with Apply and Undo) and answers who’s absent', async ({ page }) => {
  await open(page);
  await chart(page);
  await page.locator('.ai-bubble').click();
  const ask = async t => { await page.locator('.ai-ask-in').fill(t); await page.locator('.ai-send').click(); return page.locator('.ai-bot').last(); };
  let r = await ask('mark Dee and Eli absent');
  await expect(r.locator('.ai-plan')).toContainText('Mark Dee and Eli absent for today');
  await r.locator('.ai-apply').click();
  await expect(seatOf(page, 'ta_3')).toHaveClass(/att-absent/);
  r = await ask("who's absent?");
  await expect(r).toContainText('Absent: Dee and Eli.');
  r = await ask('Fay is late');
  await r.locator('.ai-apply').click();
  await r.locator('.ai-undo').click();
  r = await ask('who is late today');
  await expect(r).not.toContainText('Fay');
});
