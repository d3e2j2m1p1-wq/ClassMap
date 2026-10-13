// Browser tests for ClassMap. Run: npm test
// Most tests drive the app through window.__cm (every module's exports, dev server only).
import { test, expect } from '@playwright/test';

const errorsOf = page => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  return errors;
};

async function open(page) {
  const errors = errorsOf(page);
  await page.goto('/app/');
  await page.waitForFunction(() => window.__cm && window.__classmapStarted);
  return errors;
}

// A class with 6 boys + 6 girls, sorted into Boys/Girls, and a new chart open
async function classWithChart(page, boys = 6, girls = 6) {
  await page.evaluate(([nb, ng]) => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Period 3';
    cm.addLandingClass();
    const cls = cm.store.landingData.classes[0];
    cls.genderMode = true;
    cm.ensureGenderGroups(cls);
    for (let i = 0; i < nb; i++) cls.students.push({ id: 'b' + i, name: 'Boy' + i + ' A', gender: 'g_boys' });
    for (let i = 0; i < ng; i++) cls.students.push({ id: 'g' + i, name: 'Girl' + i + ' B', gender: 'g_girls' });
    cm.saveLandingData();
    cm.createNewChart();
  }, [boys, girls]);
}

test('loads without errors and shows the home page', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#landing-page')).toBeVisible();
  await expect(page.getByText('Back up everything')).toBeVisible();
  expect(errors).toEqual([]);
});

test('roster paste: spreadsheet rows, headers, Last, First, numbering', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const p = window.__cm.parseRosterText;
    return [
      p('First Name\tLast Name\tID\nJohn\tSmith\t1234\nAna\tRuiz\t55'),
      p('Last\tFirst\nSmith\tJohn'),
      p('Maria\tLopez\t7\nSmith, John\n1. Ben Cole\nA, B, C'),
    ];
  });
  expect(r[0]).toEqual(['John Smith', 'Ana Ruiz']);
  expect(r[1]).toEqual(['John Smith']);
  expect(r[2]).toEqual(['Maria Lopez', 'Smith, John', 'Ben Cole', 'A', 'B', 'C']);
});

test('chart date survives autosave and uses local time', async ({ page }) => {
  await open(page);
  await classWithChart(page);
  const r = await page.evaluate(async () => {
    const cm = window.__cm;
    const late = cm.localDateStr(new Date(2026, 9, 9, 22, 30).getTime());
    cm.flushSave();
    cm.store.landingData.charts[0].date = '2026-09-01';
    cm.markDirty(); cm.flushSave();
    cm.goHome();
    return { late, stored: (await cm.readStored()).charts[0].date,
             shown: document.querySelector('.chart-date-input').value };
  });
  expect(r).toEqual({ late: '2026-10-09', stored: '2026-09-01', shown: '2026-09-01' });
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('tap a name, tap a seat; ✕ unseats; drag swaps', async ({ page }) => {
    await open(page);
    await classWithChart(page, 2, 1);
    await page.evaluate(() => {
      const cm = window.__cm;
      cm.state.layoutItems.push({ id: 'd1', type: 'seat', x: 700, y: 450, rotation: 0 },
                                { id: 'd2', type: 'seat', x: 900, y: 450, rotation: 0 });
      cm.switchPanel('assign', document.querySelector('[data-panel=assign]'));
    });
    await page.locator('#unplacedChips .chip-pill').first().tap();
    await page.locator('.seat-chip[data-seat-id="d1"]').tap();
    expect(await page.evaluate(() => Object.keys(window.__cm.state.assignments))).toEqual(['d1']);

    await page.locator('.seat-chip[data-seat-id="d1"]').tap();
    await page.locator('.seat-unseat-btn').tap();
    expect(await page.evaluate(() => Object.keys(window.__cm.state.assignments))).toEqual([]);

    // touch drag a name onto a seat (raw touch events, like a finger)
    const cdp = await page.context().newCDPSession(page);
    const a = await page.locator('#unplacedChips .chip-pill').first().boundingBox();
    const b = await page.locator('.seat-chip[data-seat-id="d2"]').boundingBox();
    const sx = a.x + a.width / 2, sy = a.y + a.height / 2, tx = b.x + b.width / 2, ty = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    for (let i = 1; i <= 15; i++)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + (tx - sx) * i / 15, y: sy + (ty - sy) * i / 15 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => Object.keys(window.__cm.state.assignments))).toEqual(['d2']);
  });
});

test('mouse drag moves a seated student', async ({ page }) => {
  await open(page);
  await classWithChart(page, 1, 1);
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.state.layoutItems.push({ id: 'd1', type: 'seat', x: 700, y: 450, rotation: 0 },
                              { id: 'd2', type: 'seat', x: 900, y: 450, rotation: 0 });
    cm.state.assignments = { d1: 'b0' };
    cm.switchPanel('assign', document.querySelector('[data-panel=assign]'));
  });
  const a = await page.locator('.seat-chip[data-seat-id="d1"]').boundingBox();
  const b = await page.locator('.seat-chip[data-seat-id="d2"]').boundingBox();
  await page.mouse.move(a.x + 26, a.y + 26);
  await page.mouse.down();
  await page.mouse.move(b.x + 26, b.y + 26, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__cm.state.assignments)).toEqual({ d2: 'b0' });
});

test('auto-assign: checkerboard rows, front row measured from the board', async ({ page }) => {
  await open(page);
  await classWithChart(page);
  const r = await page.evaluate(() => {
    const cm = window.__cm;
    for (let row = 0; row < 2; row++) for (let c = 0; c < 6; c++)
      cm.state.layoutItems.push({ id: 's' + row + c, type: 'seat', x: 100 + c * 70, y: 100 + row * 70, rotation: 0 });
    cm.state.layoutItems.push({ id: 'bd', type: 'board', x: 250, y: 400, rotation: 0 });   // board at the bottom
    document.getElementById('assignGenderBal').value = 'mixed';
    cm.autoAssign();
    const grid = [0, 1].map(row => [0, 1, 2, 3, 4, 5].map(c => (cm.state.assignments['s' + row + c] || '.')[0]).join(''));
    cm.state.hardRules = [{ type: 'front', studentA: 'Boy0 A' }];
    cm.autoAssign();
    const boy0 = Object.keys(cm.state.assignments).find(k => cm.state.assignments[k] === 'b0');
    return { grid, boy0 };
  });
  for (let c = 0; c < 6; c++) expect(r.grid[0][c]).not.toBe(r.grid[1][c]);   // vertical neighbours differ
  expect(r.grid[0]).toMatch(/^(bg){3}$|^(gb){3}$/);
  expect(r.boy0.startsWith('s1')).toBe(true);                                  // bottom row = front
});

test('table groups: pairs come out mixed, rules hold, uneven split, menus', async ({ page }) => {
  await open(page);
  await classWithChart(page, 8, 8);
  await page.evaluate(() => window.__cm.switchPanel('layout', document.querySelector('[data-panel=layout]')));
  await page.hover('#tool-table');
  await page.locator('#tableToolMenu .tm-item', { hasText: '2 groups' }).click();
  await expect(page.locator('#tableToolBadge')).toHaveText('4 · 2 groups');

  const r = await page.evaluate(() => {
    const cm = window.__cm;
    for (let t = 0; t < 4; t++) cm.placeLayoutItem(150 + t * 200, 200);
    document.getElementById('assignGenderBal').value = 'mixed';
    let mixed = 0, total = 0;
    for (let run = 0; run < 10; run++) {
      cm.autoAssign();
      const pods = {};
      cm.getAllSeats().forEach(s => { const sid = cm.state.assignments[s.seatId]; if (sid) (pods[s.podKey] = pods[s.podKey] || []).push(sid[0]); });
      Object.values(pods).forEach(p => { total++; if (new Set(p).size === 2) mixed++; });
    }
    cm.state.hardRules = [{ type: 'partners', studentA: 'Boy1 A', studentB: 'Boy2 A' },
                          { type: 'separate', studentA: 'Girl1 B', studentB: 'Girl2 B' }];
    let rulesOk = 0;
    for (let run = 0; run < 10; run++) { cm.autoAssign(); if (!cm.evaluateRules(cm.state.assignments, cm.getAllSeats(), cm.getResolvedRules()).length) rulesOk++; }
    const t1 = cm.state.layoutItems[0];
    cm.removeSeatFromTable(t1.id, 3);
    cm.flushSave();
    return { mixed, total, rulesOk, uneven: cm.tableGroupsOf(t1),
             saved: cm.store.landingData.charts[0].data.tableDefaults };
  });
  expect(r.mixed).toBe(r.total);
  expect(r.rulesOk).toBe(10);
  expect(r.uneven).toEqual([[0, 1], [2]]);
  expect(r.saved).toEqual({ seats: 4, groups: 2 });

  await page.locator('.table-groups-btn').first().click();
  await page.locator('.float-menu .tm-item', { hasText: 'Solo' }).click();
  expect(await page.evaluate(() => window.__cm.store.landingData && window.__cm.state.layoutItems[0].groups)).toBe('solo');
});

test('a failed save (storage full) never loses work; empty import keeps the roster', async ({ page }) => {
  await open(page);
  await classWithChart(page, 1, 0);
  const r = await page.evaluate(async () => {
    const cm = window.__cm;
    cm.state.layoutItems.push({ id: 's1', type: 'seat', x: 10, y: 10, rotation: 0 });
    cm._dbTest.failWrites = true;                 // the browser refuses to store more
    cm.markDirty(); cm.goHome();
    await cm.whenSaved();
    const kept = cm.store.landingData.charts[0].data.layoutItems.length;
    const toast = document.getElementById('toast').textContent;
    cm._dbTest.failWrites = false;
    cm.openChart(cm.store.landingData.charts[0]);
    cm.importChartText(JSON.stringify({ layoutItems: [], assignments: {} }));
    return { kept, warned: toast.includes('Not saved'), roster: cm.store.landingData.classes[0].students.length };
  });
  expect(r).toEqual({ kept: 1, warned: true, roster: 1 });
});

test('big photos are shrunk to 2000px wide (small ones are left alone)', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(3000, 2000);   // random pixels ≈ a photo (doesn't compress)
    for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : (Math.random() * 256) | 0;
    ctx.putImageData(img, 0, 0);
    const big = c.toDataURL('image/png');
    const small = await window.__cm.shrinkImage(big);
    const im = new Image();
    await new Promise(res => { im.onload = res; im.src = small; });
    return { smaller: small.length < big.length, width: im.naturalWidth };
  });
  expect(r).toEqual({ smaller: true, width: 2000 });
});

test('roster: drag a student into a group column (touch)', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await open(page);
  await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'P4';
    cm.addLandingClass();
    const c = cm.store.landingData.classes[0];
    c.students.push({ id: 'q1', name: 'Zed Quill', gender: null });
    c.genderMode = true; cm.ensureGenderGroups(c); cm.saveLandingData();
    cm.switchLandingTab('roster', document.querySelector('.ld-tab[data-tab="roster"]'));
  });
  const row = await page.locator('.ld-student-row[data-student-id="q1"]').boundingBox();
  const col = await page.locator('.ld-drop-col').first().boundingBox();
  const cdp = await context.newCDPSession(page);
  const sx = row.x + 60, sy = row.y + row.height / 2, tx = col.x + col.width / 2, ty = col.y + 80;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (let i = 1; i <= 15; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + (tx - sx) * i / 15, y: sy + (ty - sy) * i / 15 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__cm.store.landingData.classes[0].students[0].gender)).toBe('g_boys');
  await context.close();
});

// An Export JSON file from an older ClassMap: groups are only internal ids, no group list.
// (Made-up names — never commit real students' names to the repo.)
const OLD_CHART = {
  className: 'Old 6C',
  students: [
    { id: 'st1', name: 'James', gender: 'g_old_1' }, { id: 'st2', name: 'Michael', gender: 'g_old_1' },
    { id: 'st3', name: 'Daniel', gender: 'g_old_1' }, { id: 'st4', name: 'Emma', gender: 'g_old_2' },
    { id: 'st5', name: 'Olivia', gender: 'g_old_2' }, { id: 'st6', name: 'Sophia', gender: 'g_old_2' },
  ],
  hardRules: [{ id: 'r1', type: 'separate', studentA: 'James', studentB: 'Michael' }],
  tempRules: [], sessionNotes: '', genderMode: true,
  layoutItems: [{ id: '1', type: 'table', x: 100, y: 100, rotation: 0,
    seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }, { x: 14, y: 76 }, { x: 76, y: 76 }, { x: 138, y: 14 }, { x: 138, y: 76 }] }],
  assignments: { '1_0': 'st1', '1_1': 'st4', '1_2': 'st5', '1_3': 'st2', '1_4': 'st3', '1_5': 'st6' },
  layoutImg: null, nextId: 2,
};

test('home page Import file adds a chart file as a new class, fixing old group ids', async ({ page }) => {
  await open(page);
  await page.locator('#restoreFile').setInputFiles({
    name: 'old-6c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(OLD_CHART)),
  });
  await expect(page.locator('.cm-dialog h3')).toHaveText('Add “Old 6C” as a new class?');
  await page.locator('.cm-btn-confirm').click();
  await expect(page.locator('.cm-undo-toast')).toContainText('Added class “Old 6C”');
  const r = await page.evaluate(() => {
    const ld = window.__cm.store.landingData;
    const cls = ld.classes[0];
    const kindOf = id => (cls.genderGroups.find(g => g.id === id) || {}).kind;
    return {
      classes: ld.classes.length, charts: ld.charts.length, chartClass: ld.charts[0].classId === cls.id,
      kinds: cls.students.map(s => kindOf(s.gender)), rules: cls.hardRules.length,
      seated: Object.keys(ld.charts[0].data.assignments).length,
    };
  });
  expect(r).toEqual({ classes: 1, charts: 1, chartClass: true,
    kinds: ['boys', 'boys', 'boys', 'girls', 'girls', 'girls'], rules: 1, seated: 6 });
});

test('Import chart file (⋯ menu), old group ids fixed', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Target';
    cm.addLandingClass();
    cm.createNewChart();
  });
  await page.locator('#importDataFile').setInputFiles({
    name: 'old-6c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(OLD_CHART)),
  });
  await expect(page.locator('#toast')).toContainText('Chart loaded');
  const kinds = await page.evaluate(() => {
    const cls = window.__cm.store.landingData.classes[0];
    return cls.students.map(s => (cls.genderGroups.find(g => g.id === s.gender) || {}).kind);
  });
  expect(kinds).toEqual(['boys', 'boys', 'boys', 'girls', 'girls', 'girls']);
});

// ── In-app dialogs + Undo ──
async function homeWithChart(page) {
  await open(page);
  await classWithChart(page, 2, 2);
  await page.evaluate(() => { window.__cm.flushSave(); window.__cm.goHome(); });
}

test('delete chart: dialog (Cancel and Esc keep it), confirm deletes, Undo brings it back', async ({ page }) => {
  await homeWithChart(page);
  const charts = () => page.evaluate(() => window.__cm.store.landingData.charts.length);

  await page.locator('.chart-card-del').first().click();
  await expect(page.locator('.cm-dialog h3')).toContainText('Delete the chart');
  await expect(page.locator('.cm-btn-cancel')).toBeFocused();           // danger: Enter can't delete by reflex
  await page.locator('.cm-btn-cancel').click();
  expect(await charts()).toBe(1);

  await page.locator('.chart-card-del').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-dialog')).toHaveCount(0);
  expect(await charts()).toBe(1);

  await page.locator('.chart-card-del').first().click();
  await page.locator('.cm-btn-confirm').click();
  expect(await charts()).toBe(0);
  await expect(page.locator('.cm-undo-toast')).toContainText('deleted');
  await page.locator('.cm-undo-btn').click();
  expect(await charts()).toBe(1);
  await expect(page.locator('.chart-card-del')).toHaveCount(1);
  expect(await page.evaluate(async () => (await window.__cm.readStored()).charts.length)).toBe(1);
});

test('delete class + Undo restores the class and its charts', async ({ page }) => {
  await homeWithChart(page);
  await page.locator('.class-item-del').first().click();
  await expect(page.locator('.cm-dialog-details')).toHaveText('4 students · 1 chart');
  await page.locator('.cm-btn-confirm').click();
  expect(await page.evaluate(() => window.__cm.store.landingData.classes.length)).toBe(0);
  await page.locator('.cm-undo-btn').click();
  const r = await page.evaluate(() => ({ classes: window.__cm.store.landingData.classes.length,
    charts: window.__cm.store.landingData.charts.length, students: window.__cm.store.landingData.classes[0].students.length }));
  expect(r).toEqual({ classes: 1, charts: 1, students: 4 });
});

test('clear layout + Undo restores items, photo and seats', async ({ page }) => {
  await open(page);
  await classWithChart(page, 1, 1);
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.state.layoutItems.push({ id: 'd1', type: 'seat', x: 700, y: 450, rotation: 0 });
    cm.state.assignments = { d1: 'b0' };
    cm.switchPanel('layout', document.querySelector('[data-panel=layout]'));
  });
  await page.getByRole('button', { name: /Clear/ }).first().click();
  await page.locator('.cm-btn-confirm').click();
  expect(await page.evaluate(() => window.__cm.state.layoutItems.length)).toBe(0);
  await page.locator('.cm-undo-btn').click();
  expect(await page.evaluate(() => [window.__cm.state.layoutItems.length, window.__cm.state.assignments.d1])).toEqual([1, 'b0']);
});

test('undo toast closes by itself', async ({ page }) => {
  await homeWithChart(page);
  await page.evaluate(() => window.__cm.undoToast('Test', () => {}, 400));
  await expect(page.locator('.cm-undo-toast')).toHaveCount(1);
  await expect(page.locator('.cm-undo-toast')).toHaveCount(0, { timeout: 2000 });
});

// ── Reuse the room, copy charts ──
test('a new chart starts from the last room, nobody seated; "Start empty" clears it', async ({ page }) => {
  await open(page);
  await classWithChart(page, 4, 4);
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.setTool('table');
    cm.placeLayoutItem(200, 200); cm.placeLayoutItem(450, 200);
    cm.autoAssign();
    cm.flushSave(); cm.goHome();
    cm.createNewChart();
  });
  const r = await page.evaluate(() => ({ items: window.__cm.state.layoutItems.length, seated: Object.keys(window.__cm.state.assignments).length,
    panel: document.querySelector('.panel.active').id }));
  expect(r).toEqual({ items: 2, seated: 0, panel: 'panel-assign' });
  await expect(page.locator('.cm-undo-toast')).toContainText('same room');
  await page.locator('.cm-undo-btn', { hasText: 'Start empty' }).click();
  expect(await page.evaluate(() => window.__cm.state.layoutItems.length)).toBe(0);
});

test('copy a chart to today, then Undo', async ({ page }) => {
  await homeWithChart(page);
  await page.locator('.chart-card-dup').first().click();
  const r = await page.evaluate(() => window.__cm.store.landingData.charts.map(c => c.date));
  expect(r.length).toBe(2);
  expect(r[1]).toBe(await page.evaluate(() => window.__cm.localDateStr(Date.now())));
  await page.locator('.cm-undo-btn').click();
  expect(await page.evaluate(() => window.__cm.store.landingData.charts.length)).toBe(1);
});

// ── Pins ──
test('a pinned student keeps their seat through auto-assign and Clear', async ({ page }) => {
  await open(page);
  await classWithChart(page, 4, 4);
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.setTool('table');
    cm.placeLayoutItem(500, 300); cm.placeLayoutItem(750, 300);
    cm.state.assignments = {};
    const seat = cm.getAllSeats()[3].seatId;
    cm.state.assignments[seat] = 'b0';
    cm.switchPanel('assign', document.querySelector('[data-panel=assign]'));
  });
  const seat = await page.evaluate(() => window.__cm.getAllSeats()[3].seatId);
  await page.locator(`.seat-chip[data-seat-id="${seat}"]`).click();
  await page.locator('.seat-pin-btn').click();
  await expect(page.locator('.seat-pin-badge')).toHaveCount(1);
  const r = await page.evaluate(seat => {
    const cm = window.__cm;
    const out = [];
    for (let i = 0; i < 5; i++) { cm.autoAssign(); out.push(cm.state.assignments[seat]); }
    cm.clearAssignments();
    out.push(JSON.stringify(cm.state.assignments));
    return out;
  }, seat);
  expect(r.slice(0, 5)).toEqual(['b0', 'b0', 'b0', 'b0', 'b0']);
  expect(r[5]).toBe(JSON.stringify({ [seat]: 'b0' }));
});

// ── Avoid repeat partners ──
test('auto-assign avoids partners from the previous chart', async ({ page }) => {
  await open(page);
  await classWithChart(page, 4, 4);
  const repeats = await page.evaluate(() => {
    const cm = window.__cm;
    for (let t = 0; t < 4; t++) cm.state.layoutItems.push({ id: 't' + t, type: 'table', x: 100 + t * 180, y: 200, rotation: 0,
      seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }], groups: 1, groupShift: 0 });
    document.getElementById('assignGenderBal').value = 'mixed';
    cm.autoAssign();
    cm.flushSave(); cm.goHome();
    const out = [];
    for (let run = 0; run < 5; run++) {
      cm.createNewChart();                       // same room, a day "later"
      cm.autoAssign();
      const hist = cm.recentPartnerPairs(1);
      out.push(cm.countRepeats(cm.state.assignments, cm.partnerSeatPairs(cm.getAllSeats()), hist));
      cm.flushSave(); cm.goHome();
    }
    return out;
  });
  expect(repeats).toEqual([0, 0, 0, 0, 0]);
});

// ── Undo / redo ──
test('undo and redo in the editor (buttons and Ctrl+Z)', async ({ page }) => {
  await open(page);
  await classWithChart(page, 1, 1);
  await page.evaluate(() => { const cm = window.__cm; cm.setTool('table'); cm.placeLayoutItem(300, 300); cm.setTool('pointer'); });
  const n = () => page.evaluate(() => window.__cm.state.layoutItems.length);
  expect(await n()).toBe(1);
  await page.locator('#undoBtn').click();
  expect(await n()).toBe(0);
  await page.locator('#redoBtn').click();
  expect(await n()).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await n()).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  expect(await n()).toBe(1);
});

// ── Present & Print ──
test('present shows the chart full screen; Esc closes', async ({ page }) => {
  await open(page);
  await classWithChart(page, 2, 2);
  await page.evaluate(() => { const cm = window.__cm; cm.setTool('table'); cm.placeLayoutItem(300, 300); cm.autoAssign(); });
  await page.getByRole('button', { name: /Present/ }).click();
  await expect(page.locator('.present-view .seat-chip.grouped')).toHaveCount(4);
  await expect(page.locator('.present-view .seat-unseat-btn')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.present-view')).toHaveCount(0);
});

test('print: chart only, and the substitute version with rules', async ({ page }) => {
  await open(page);
  await classWithChart(page, 2, 2);
  await page.evaluate(() => {
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    const cm = window.__cm;
    cm.state.hardRules = [{ type: 'separate', studentA: 'Boy0 A', studentB: 'Boy1 A' }];
    cm.setTool('table'); cm.placeLayoutItem(300, 300); cm.autoAssign();
  });
  await page.getByRole('button', { name: /Print/ }).click();
  await page.locator('.cm-btn', { hasText: 'Chart only' }).click();
  await expect(page.locator('#printView .seat-chip.grouped')).toHaveCount(4);
  await expect(page.locator('#printView .print-sub')).toHaveCount(0);
  await page.getByRole('button', { name: /Print/ }).click();
  await page.locator('.cm-btn', { hasText: 'For a substitute' }).click();
  await expect(page.locator('#printView .print-sub')).toContainText('Keep Boy0 A and Boy1 A apart');
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(2);
});

// ── First run, backup reminder, error banner ──
test('first run: welcome card, then "Try a sample class" opens a seated chart', async ({ page }) => {
  await open(page);
  await expect(page.locator('.welcome')).toBeVisible();
  await page.getByRole('button', { name: 'Try a sample class' }).click();
  await expect(page.locator('#panel-assign')).toHaveClass(/active/);
  expect(await page.evaluate(() => Object.keys(window.__cm.state.assignments).length)).toBe(20);
});

test('backup reminder shows until you back up or snooze', async ({ page }) => {
  await homeWithChart(page);
  await page.evaluate(() => window.__cm.showLanding());
  await expect(page.locator('#backupReminder')).toBeVisible();
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.locator('#backupReminder')).toBeHidden();
});

test('an unexpected error shows a calm banner instead of a broken page', async ({ page }) => {
  await open(page);
  await page.evaluate(() => setTimeout(() => { throw new Error('test failure'); }, 0));
  await expect(page.locator('.error-banner')).toContainText('Your classes are still saved');
});

// ── Tags ──
test('tags: add from the roster menu; spread-out and helper rules are followed', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Tags'; cm.addLandingClass();
    const c = cm.store.landingData.classes[0];
    for (let i = 0; i < 8; i++) c.students.push({ id: 's' + i, name: 'Kid' + i + ' Z', gender: null });
    cm.saveLandingData();
    cm.switchLandingTab('roster', document.querySelector('.ld-tab[data-tab="roster"]'));
  });
  // tag one student through the UI
  await page.locator('.ld-student-row[data-student-id="s0"] .ld-tag-btn').click();
  await page.locator('.tag-menu .tm-item', { hasText: 'Needs support' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ld-student-row[data-student-id="s0"] .ld-tag-chip')).toHaveText('Needs support');

  const r = await page.evaluate(() => {
    const cm = window.__cm;
    const c = cm.store.landingData.classes[0];
    ['s1', 's2'].forEach(id => { c.students.find(s => s.id === id).tags = ['Needs support']; });
    ['s3', 's4', 's5'].forEach(id => { c.students.find(s => s.id === id).tags = ['Strong reader']; });
    c.hardRules = [{ type: 'spread', tag: 'Needs support' }, { type: 'helper', tag: 'Needs support', helperTag: 'Strong reader' }];
    cm.saveLandingData();
    cm.createNewChart();
    for (let t = 0; t < 4; t++) cm.state.layoutItems.push({ id: 't' + t, type: 'table', x: 100 + t * 180, y: 200, rotation: 0,
      seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }], groups: 1, groupShift: 0 });
    let ok = 0;
    for (let i = 0; i < 10; i++) { cm.autoAssign(); if (!cm.evaluateRules(cm.state.assignments, cm.getAllSeats(), cm.getResolvedRules()).length) ok++; }
    return { ok, summary: cm.ruleSummary(c.hardRules[1]).text };
  });
  expect(r.ok).toBe(10);
  expect(r.summary).toBe('Each “Needs support” student sits with a “Strong reader” student');
});

// ── Storage ──
test('data from the old version (localStorage) moves to IndexedDB', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('classmap_data', JSON.stringify({ classes: [{ id: 'c1', name: 'Old class', students: [], hardRules: [] }], charts: [] }));
  });
  await open(page);
  const r = await page.evaluate(async () => ({
    shown: window.__cm.store.landingData.classes.map(c => c.name),
    stored: (await window.__cm.readStored()).classes.map(c => c.name),
    left: localStorage.getItem('classmap_data'),
  }));
  expect(r).toEqual({ shown: ['Old class'], stored: ['Old class'], left: null });
  await page.reload();
  await page.waitForFunction(() => window.__classmapStarted);
  expect(await page.evaluate(() => window.__cm.store.landingData.classes.map(c => c.name))).toEqual(['Old class']);
});

// ── Sync merge (two devices) ──
test('merge: newest chart wins, deletions stick, Undo beats an old deletion', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const { mergeData } = window.__cm;
    const local = { updatedAt: 200, classes: [{ id: 'A', name: 'A-local' }, { id: 'B', name: 'B' }],
      charts: [{ id: 'x', classId: 'A', savedAt: 150, name: 'x-local' }, { id: 'y', classId: 'B', savedAt: 100 }],
      deleted: [{ id: 'z', at: 120 }] };
    const remote = { updatedAt: 180, classes: [{ id: 'A', name: 'A-remote' }, { id: 'C', name: 'C' }],
      charts: [{ id: 'x', classId: 'A', savedAt: 170, name: 'x-remote' }, { id: 'z', classId: 'C', savedAt: 90 },
               { id: 'w', classId: 'C', savedAt: 300 }],
      deleted: [{ id: 'y', at: 50 }] };
    const m = mergeData(local, remote);
    return { classes: m.classes.map(c => c.name), charts: m.charts.map(c => c.name || c.id).sort() };
  });
  // class A: local side changed last → A-local; chart x: remote saved later → x-remote;
  // z deleted locally after its last save → gone; y saved after its deletion (Undo) → stays
  expect(r).toEqual({ classes: ['A-local', 'B', 'C'], charts: ['w', 'x-remote', 'y'] });
});

// ── Google sign-in + Drive (Google is faked: no network) ──
test('Google Drive: sign in uploads; a change from another device comes back merged', async ({ page }) => {
  const drive = { file: null, modified: 0, uploads: 0 };
  await page.addInitScript(() => {
    window.google = { accounts: { oauth2: {
      initTokenClient: cfg => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'tok', expires_in: 3600 }), 10) }),
      revoke: (t, cb) => cb && cb(),
    } } };
  });
  await page.route('https://www.googleapis.com/**', async route => {
    const req = route.request(), url = req.url(), m = req.method();
    const meta = () => ({ id: 'f1', modifiedTime: 't' + drive.modified });
    if (url.includes('/oauth2/v3/userinfo')) return route.fulfill({ json: { email: 'teacher@example.com' } });
    if (url.includes('/upload/drive/v3/files') && (m === 'POST' || m === 'PATCH')) {
      const body = req.postData();
      drive.file = m === 'POST' ? JSON.parse(body.split('\r\n\r\n')[2].split('\r\n--')[0]) : JSON.parse(body);
      drive.modified++; drive.uploads++;
      return route.fulfill({ json: meta() });
    }
    if (url.includes('alt=media')) return route.fulfill({ json: drive.file });
    if (url.includes('/drive/v3/files?q=')) return route.fulfill({ json: { files: drive.file ? [meta()] : [] } });
    if (url.includes('/drive/v3/files/f1')) return route.fulfill({ json: drive.file ? meta() : {} });
    return route.fulfill({ status: 404, body: '' });
  });
  await open(page);
  await page.evaluate(() => { document.getElementById('newClassInput').value = 'Laptop class'; window.__cm.addLandingClass(); });

  await page.getByRole('button', { name: /Sign in with Google/ }).click();
  await expect(page.locator('.sync-pill')).toContainText('Saved to Drive');
  expect(drive.uploads).toBe(1);
  expect(drive.file.classes.map(c => c.name)).toEqual(['Laptop class']);

  // another device adds a class
  drive.file = { ...drive.file, updatedAt: Date.now() + 1000,
    classes: [...drive.file.classes, { id: 'ipad', name: 'iPad class', students: [], hardRules: [] }] };
  drive.modified++;
  await page.evaluate(() => window.__cm.syncNow());
  await expect.poll(() => page.evaluate(() => window.__cm.store.landingData.classes.map(c => c.name).sort()))
    .toEqual(['Laptop class', 'iPad class']);
  await expect(page.locator('.class-list')).toContainText('iPad class');
});
