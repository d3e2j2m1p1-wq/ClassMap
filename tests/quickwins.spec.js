// Participation points, timer, voice level, name tents and desk labels
import { test, expect } from '@playwright/test';

async function open(page, { clock = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (clock) await page.clock.install();
  await page.addInitScript(() => { localStorage.setItem('cm-ai', JSON.stringify({ tipSeen: true })); window.__cmNoSpin = true; });
  await page.goto('/app/');
  await page.waitForFunction(() => window.__cm && window.__classmapStarted);
  return errors;
}
// 9 students; Ana…Hal seated at two tables ("Red" at the front, an unnamed one behind it), Ivy unplaced
async function chart(page) {
  await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Period 4';
    cm.addLandingClass();
    const cls = cm.store.landingData.classes[0];
    'Ana Diaz,Ben Ruiz,Cam Lee,Dee Park,Eli Moss,Fay Chen,Gus Hill,Hal Ford,Ivy Long'.split(',').forEach((name, i) => cls.students.push({ id: 's' + i, name, gender: null }));
    cm.store.activeClassId = cls.id;
    cm.saveLandingData();
    cm.createNewChart();
    const T = (id, x, y, label) => ({ id, type: 'table', x, y, rotation: 0, groups: 1, groupShift: 0, ...(label ? { label } : {}), seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }, { x: 14, y: 76 }, { x: 76, y: 76 }] });
    cm.state.layoutItems.push(T('tb', 420, 340), T('ta', 420, 100, 'Red'));      // added back-first on purpose
    const seats = cm.getAllSeats();
    const order = ['ta_0', 'ta_1', 'ta_2', 'ta_3', 'tb_0', 'tb_1', 'tb_2', 'tb_3'];
    cm.state.students.slice(0, 8).forEach((s, i) => { cm.state.assignments[order[i]] = s.id; });
    cm.renderLayoutCanvas();
    cm.switchPanel('assign', document.querySelector('.tab-btn[data-panel=assign]'));
  });
}
const seat = (page, id) => page.locator(`#assignCanvas .seat-chip[data-seat-id="${id}"]`);

test('participation points: tap to add, who hasn’t taken part, undo, never on the projector', async ({ page }) => {
  const errors = await open(page);
  await chart(page);
  await page.evaluate(() => window.__cm.setStatus(window.__cm.store.landingData.classes[0].id, 's7', 'absent'));   // Hal is absent
  await page.locator('.pts-toggle').click();
  const bar = page.locator('.pts-banner');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.pts-none')).toContainText('8 not yet');                 // 9 students, Hal absent
  await seat(page, 'ta_0').click();
  await seat(page, 'ta_0').click();
  await seat(page, 'ta_1').click();
  const badge = await page.locator('#assignCanvas .pts-badge:not(.zero)').allTextContents();
  expect(badge.sort()).toEqual(['1', '2']);
  await expect(bar.locator('.pts-none')).toContainText('6 not yet');
  await expect(bar.locator('.pts-none')).not.toContainText('Ana');
  expect(await page.evaluate(() => window.__cm.store.selectedSeatId)).toBeFalsy();     // taps don't select
  await bar.locator('.pts-undo').click();
  await expect(bar.locator('.pts-none')).toContainText('7 not yet');                 // Ben back to 0
  // attendance and points are one-at-a-time
  await page.locator('.att-toggle').click();
  await expect(bar).toBeHidden();
  await expect(page.locator('#assignCanvas .pts-badge')).toHaveCount(0);
  await page.locator('.att-banner:not(.pts-banner) .att-done').click();
  await page.locator('.pts-toggle').click();
  await page.evaluate(() => window.__cm.openPresent());
  expect(await page.locator('.present-view .pts-badge').count()).toBe(0);
  await page.evaluate(() => window.__cm.closePresent());
  expect(errors).toEqual([]);
});

test('name picker: “a pick earns a point” and “favor fewer points”', async ({ page }) => {
  await open(page);
  await chart(page);
  // everyone but Cam already has lots of points today
  await page.evaluate(() => { const cm = window.__cm; const id = cm.store.landingData.classes[0].id; cm.state.students.forEach(s => { if (s.id !== 's2') for (let i = 0; i < 50; i++) cm.addPoint(id, s.id, 1); }); });
  await page.evaluate(() => window.__cm.openTools('picker'));
  const V = page.locator('.tools-view');
  await V.locator('.picker-norep').uncheck();
  await V.locator('.picker-favor').check();
  let cam = 0;
  for (let i = 0; i < 12; i++) { await V.locator('.picker-go').click(); if ((await V.locator('.picker-name').textContent()) === 'Cam Lee') cam++; }
  expect(cam).toBeGreaterThanOrEqual(6);                 // ~85% likely each time
  await V.locator('.picker-favor').uncheck();
  await V.locator('.picker-award').check();
  await V.locator('.picker-go').click();
  const who = await V.locator('.picker-name').textContent();
  const pts = await page.evaluate(n => { const cm = window.__cm; const s = cm.state.students.find(x => x.name === n); return cm.dayPoints(cm.store.landingData.classes[0].id)[s.id]; }, who);
  expect(pts === 1 || pts === 51).toBe(true);
});

test('timer: counts down, pauses, +1 min, chimes and shows “Time’s up!”', async ({ page }) => {
  await open(page, { clock: true });
  await chart(page);
  await page.evaluate(() => window.__cm.openTools('timer', { minutes: 2 }));
  const V = page.locator('.tools-view');
  await expect(V.locator('.timer-digits')).toHaveText('2:00');
  await page.keyboard.press('Space');                    // start
  await page.clock.fastForward(30_000);
  await expect(V.locator('.timer-digits')).toHaveText('1:30');
  await expect(V.locator('.tools-tab[data-t=timer]')).toContainText('1:30');
  await page.keyboard.press('Space');                    // pause
  await page.clock.fastForward(20_000);
  await expect(V.locator('.timer-digits')).toHaveText('1:30');
  await V.locator('.timer-plus').click();
  await expect(V.locator('.timer-digits')).toHaveText('2:30');
  await V.locator('.timer-go').click();                  // resume
  // switching tools doesn't stop it
  await V.locator('.tools-tab[data-t=voice]').click();
  await page.clock.fastForward(151_000);
  await V.locator('.tools-tab[data-t=timer]').click();
  await expect(V.locator('.timer-digits')).toHaveText('Time’s up!');
  await V.locator('.timer-set[data-m="5"]').click();
  await expect(V.locator('.timer-digits')).toHaveText('5:00');
});

test('voice level: keys 0–3 and buttons; remembered', async ({ page }) => {
  await open(page);
  await chart(page);
  await page.evaluate(() => window.__cm.openTools('voice'));
  const V = page.locator('.tools-view');
  await page.keyboard.press('3');
  await expect(V.locator('.voice')).toHaveClass(/lv3/);
  await expect(V.locator('.voice-name')).toHaveText('Presenting');
  await V.locator('.voice-btn', { hasText: 'Whisper' }).click();
  await expect(V.locator('.voice-name')).toHaveText('Whisper');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__cm.openTools('voice'));
  await expect(page.locator('.tools-view .voice-name')).toHaveText('Whisper');
});

test('name tents and desk labels: pages, seat order with table names, print', async ({ page }) => {
  await open(page);
  await chart(page);
  await page.evaluate(() => { window.print = () => { window.__printed = document.getElementById('printView')?.querySelectorAll('.tp-page').length; }; window.__cm.openTools('print'); });
  const V = page.locator('.tools-view');
  // tents: 9 students → 5 pages, first names, each name twice (one upside down)
  await expect(V.locator('.pt-preview .tp-page')).toHaveCount(5);
  await expect(V.locator('.pt-preview .tent')).toHaveCount(9);
  await expect(V.locator('.pt-preview .tent').first().locator('.tent-half span')).toHaveText(['Ana', 'Ana']);
  await expect(V.locator('.pt-print')).toHaveText('🖨 Print 5 pages');
  // labels: front table (Red) first, in seat order; Ivy (no seat) last
  await V.locator('.pt-kind[data-k=labels]').click();
  await V.locator('.pt-names').selectOption('full');
  const names = await V.locator('.pt-preview .label-name').allTextContents();
  expect(names).toEqual(['Ana Diaz', 'Ben Ruiz', 'Cam Lee', 'Dee Park', 'Eli Moss', 'Fay Chen', 'Gus Hill', 'Hal Ford', 'Ivy Long']);
  const where = await V.locator('.pt-preview .label').evaluateAll(els => els.map(e => e.querySelector('.label-where')?.textContent || ''));
  expect(where.slice(0, 5)).toEqual(['Red', 'Red', 'Red', 'Red', 'Table 1']);
  expect(where[8]).toBe('');
  await V.locator('.pt-print').click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
});

test('the helper: “5 minute timer”, “voice level 0”, “print name tents”', async ({ page }) => {
  await open(page);
  await chart(page);
  const ask = async t => { await page.locator('.ai-bubble').click(); await page.locator('.ai-ask-in').fill(t); await page.locator('.ai-send').click(); };
  await ask('start a 5 minute timer');
  await expect(page.locator('.tools-view .timer-go')).toHaveText('Pause');
  await page.keyboard.press('Escape');
  await ask('voice level 0 please');
  await expect(page.locator('.tools-view .voice-name')).toHaveText('Silent');
  await page.keyboard.press('Escape');
  await ask('print name tents');
  await expect(page.locator('.tools-view .pt-print')).toBeVisible();
});
