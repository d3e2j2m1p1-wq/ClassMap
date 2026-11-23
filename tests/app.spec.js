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

// ── Layout builder: select several, snap, duplicate, align, delete ──
async function layoutWithTables(page) {
  await classWithChart(page, 6, 6);
  await page.evaluate(() => {
    const cm = window.__cm;
    const T = (id, x, y) => ({ id, type: 'table', x, y, rotation: 0, groups: 1, groupShift: 0,
      seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }] });
    cm.state.layoutItems.push(T('ta', 56, 84), T('tb', 280, 140), T('tc', 560, 98));
    cm.renderLayoutCanvas();
    cm.switchPanel('layout', document.querySelector('[data-panel=layout]'));
  });
  await expect(page.locator('#layoutCanvas .canvas-item')).toHaveCount(3);
}
const pos = page => page.evaluate(() => Object.fromEntries(window.__cm.state.layoutItems.map(i => [i.id, [Math.round(i.x), Math.round(i.y)]])));
// A spot on the table's own surface (left padding), not on a seat or its ✕
const center = async loc => { const b = await loc.boundingBox(); return [b.x + 6, b.y + b.height / 2]; };

test('layout: seat count, shift-click select, move together, snap to a neighbour', async ({ page }) => {
  const errors = await open(page);
  await layoutWithTables(page);
  await expect(page.locator('#seatCount')).toHaveText('6 seats · 12 students · 6 more needed');
  await expect(page.locator('#seatCount')).toHaveClass(/short/);

  const item = id => page.locator(`#layoutCanvas .canvas-item[data-id="${id}"] .canvas-table-free`);
  // click A, shift-click B → 2 selected; the selection bar replaces the hint
  let [x, y] = await center(item('ta'));
  await page.mouse.click(x, y);
  [x, y] = await center(item('tb'));
  await page.keyboard.down('Shift'); await page.mouse.click(x, y); await page.keyboard.up('Shift');
  await expect(page.locator('#selCount')).toHaveText('2 selected');
  await expect(page.locator('#toolHint')).toBeHidden();

  // drag the pair with Alt (no snapping): both move by exactly the same amount
  const before = await pos(page);
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 20, y + 10); await page.mouse.move(x + 37, y + 23);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const after = await pos(page);
  expect([after.ta[0] - before.ta[0], after.ta[1] - before.ta[1]]).toEqual([37, 23]);
  expect([after.tb[0] - before.tb[0], after.tb[1] - before.tb[1]]).toEqual([37, 23]);
  expect(after.tc).toEqual(before.tc);

  // a plain click on B selects just B; dragging it near C's top edge snaps level with C and shows a guide
  [x, y] = await center(item('tb'));
  await page.mouse.click(x, y);
  await expect(page.locator('#selCount')).toHaveText('1 selected');
  const dy = before.tc[1] - after.tb[1] + 4;      // 4px short of C's top
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - 10, y + dy / 2); await page.mouse.move(x - 20, y + dy);
  await expect(page.locator('.layout-guide')).not.toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.layout-guide')).toHaveCount(0);
  const snapped = await pos(page);
  expect(snapped.tb[1]).toBe(snapped.tc[1]);
  expect(errors).toEqual([]);
});

test('layout: duplicate (Ctrl+D), box select, align, space evenly, Delete + Undo', async ({ page }) => {
  const errors = await open(page);
  await layoutWithTables(page);
  const item = id => page.locator(`#layoutCanvas .canvas-item[data-id="${id}"] .canvas-table-free`);
  let [x, y] = await center(item('ta'));
  await page.mouse.click(x, y);
  await page.keyboard.press('Control+d');
  await expect(page.locator('#layoutCanvas .canvas-item')).toHaveCount(4);
  await expect(page.locator('#seatCount')).toHaveText('8 seats · 12 students · 4 more needed');
  const dup = await page.evaluate(() => { const it = window.__cm.state.layoutItems; return [it[0], it[3]].map(i => [i.y, i.seatPositions.length, i.id]); });
  expect(dup[1][0]).toBe(dup[0][0]);              // same row
  expect(dup[1][1]).toBe(2);                      // same seats
  expect(dup[1][2]).not.toBe('ta');
  await expect(page.locator('#selCount')).toHaveText('1 selected');   // the copy is selected

  // box-select everything from an empty corner
  const c = await page.locator('#layoutCanvas').boundingBox();
  await page.mouse.move(c.x + 5, c.y + 5); await page.mouse.down();
  await page.mouse.move(c.x + 400, c.y + 300); await page.mouse.move(c.x + 899, c.y + 399);
  await page.mouse.up();
  await expect(page.locator('#selCount')).toHaveText('4 selected');

  await page.getByRole('button', { name: '⤒ Align top' }).click();
  const tops = await page.evaluate(() => window.__cm.state.layoutItems.map(i => Math.round(i.y)));
  expect(new Set(tops).size).toBe(1);
  await page.getByRole('button', { name: '↔ Space evenly' }).click();
  const gaps = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#layoutCanvas .canvas-item')].map(e => e.getBoundingClientRect()).sort((a, b) => a.left - b.left);
    return r.slice(1).map((b, i) => Math.round(b.left - r[i].right));
  });
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);

  // Delete key removes all 4 (and their seated students); Undo brings them back
  await page.evaluate(() => { window.__cm.state.assignments = { ta_0: 'b0' }; window.__cm.markDirty(); });
  await page.keyboard.press('Delete');
  await expect(page.locator('#layoutCanvas .canvas-item')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.__cm.state.assignments).length)).toBe(0);
  await page.locator('.cm-undo-btn').click();
  await expect(page.locator('#layoutCanvas .canvas-item')).toHaveCount(4);
  expect(await page.evaluate(() => window.__cm.state.assignments.ta_0)).toBe('b0');
  expect(errors).toEqual([]);
});

test('layout: plain click on empty canvas deselects; Esc deselects; new tables land on the grid', async ({ page }) => {
  await open(page);
  await layoutWithTables(page);
  await page.keyboard.press('Control+a');
  await expect(page.locator('#selCount')).toHaveText('3 selected');
  await page.keyboard.press('Escape');
  await expect(page.locator('#selTools')).toBeHidden();
  await page.evaluate(() => window.__cm.setTool('table'));
  const c = await page.locator('#layoutCanvas').boundingBox();
  await page.mouse.click(c.x + 503, c.y + 451);
  const last = await page.evaluate(() => { const it = window.__cm.state.layoutItems.at(-1); return [it.x % 14, it.y % 14]; });
  expect(last).toEqual([0, 0]);
});

test('room items: door, window, outlet and a "no seats" area; resize and rename the area', async ({ page }) => {
  const errors = await open(page);
  await layoutWithTables(page);
  const c = await page.locator('#layoutCanvas').boundingBox();
  for (const [tool, x, y] of [['door', 60, 380], ['window', 400, 380], ['outlet', 700, 380], ['zone', 760, 250]]) {
    await page.locator('#tool-' + tool).click();
    await page.mouse.click(c.x + x, c.y + y);
  }
  for (const cls of ['.canvas-door', '.canvas-window', '.canvas-outlet', '.canvas-zone'])
    await expect(page.locator('#layoutCanvas ' + cls)).toHaveCount(1);
  // seat count ignores room items
  await expect(page.locator('#seatCount')).toHaveText('6 seats · 12 students · 6 more needed');

  // resize the area by its corner (snaps to the 14px grid)
  await page.locator('#tool-pointer').click();
  const zone = page.locator('#layoutCanvas .canvas-zone');
  const zb = await zone.boundingBox();
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2); await page.mouse.down(); await page.mouse.up();   // select
  const grip = page.locator('#layoutCanvas .canvas-item:has(.canvas-zone) .item-resize');
  const gb = await grip.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down();
  await page.mouse.move(gb.x + 40, gb.y + 30); await page.mouse.move(gb.x + 59, gb.y + 41); await page.mouse.up();
  const size = await page.evaluate(() => { const z = window.__cm.state.layoutItems.find(i => i.type === 'zone'); return [z.w, z.h]; });
  expect(size).toEqual([224, 140]);   // 168+52 → 224, 112+34 → 140 (grid)

  // rename by double-click
  await zone.dblclick();
  await page.locator('.item-name-input').fill('Sink');
  await page.keyboard.press('Enter');
  await expect(page.locator('#layoutCanvas .zone-label')).toHaveText('Sink');

  // they show on the Assign chart and on the projector
  await page.evaluate(() => window.__cm.switchPanel('assign', document.querySelector('[data-panel=assign]')));
  for (const cls of ['.canvas-door', '.canvas-window', '.canvas-outlet', '.canvas-zone'])
    await expect(page.locator('#assignCanvas ' + cls)).toHaveCount(1);
  await expect(page.locator('#assignCanvas .zone-label')).toHaveText('Sink');
  expect(errors).toEqual([]);
});

test('table names: Number tables in reading order, rename one, shown on the Assign chart', async ({ page }) => {
  const errors = await open(page);
  await layoutWithTables(page);   // ta (56,84)  tb (280,140)  tc (560,98): one row, left to right
  await page.evaluate(() => {
    window.__cm.state.layoutItems.push({ id: 'td', type: 'table', x: 84, y: 336, rotation: 0, groups: 1, groupShift: 0, seatPositions: [{ x: 14, y: 14 }] });
    window.__cm.renderLayoutCanvas();
  });
  await page.keyboard.press('Control+a');
  await expect(page.locator('#selTools .sel-number')).toBeVisible();
  await page.getByRole('button', { name: '# Number tables' }).click();
  const names = await page.evaluate(() => Object.fromEntries(window.__cm.state.layoutItems.map(i => [i.id, i.label])));
  expect(names).toEqual({ ta: 'Table 1', tb: 'Table 2', tc: 'Table 3', td: 'Table 4' });
  await expect(page.locator('#layoutCanvas .table-name')).toHaveCount(4);

  // one table selected → ✎ Name
  await page.keyboard.press('Escape');
  const t = await page.locator('#layoutCanvas .canvas-item[data-id="tb"] .canvas-table-free').boundingBox();
  await page.mouse.click(t.x + 6, t.y + t.height / 2);
  await page.getByRole('button', { name: '✎ Name' }).click();
  await page.locator('.item-name-input').fill('Red table');
  await page.keyboard.press('Enter');
  await expect(page.locator('#layoutCanvas .canvas-item[data-id="tb"] .table-name')).toHaveText('Red table');
  // Esc cancels, empty name removes it
  await page.getByRole('button', { name: '✎ Name' }).click();
  await page.locator('.item-name-input').fill('Nope');
  await page.keyboard.press('Escape');
  await expect(page.locator('#layoutCanvas .canvas-item[data-id="tb"] .table-name')).toHaveText('Red table');

  await page.evaluate(() => window.__cm.switchPanel('assign', document.querySelector('[data-panel=assign]')));
  await expect(page.locator('#assignCanvas .table-name-pill')).toHaveText(['Table 1', 'Red table', 'Table 3', 'Table 4']);
  expect(errors).toEqual([]);
});

test('tags: "near the door" and "away from the window" seat tagged students accordingly', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Doors'; cm.addLandingClass();
    const c = cm.store.landingData.classes[0];
    for (let i = 0; i < 24; i++) c.students.push({ id: 's' + i, name: 'Kid' + i + ' Z', gender: null, tags: i < 3 ? ['Breaks'] : i < 6 ? ['Distracted'] : [] });
    c.tagSettings = { breaks: { place: 'door', spread: true }, distracted: { place: 'window' } };
    cm.saveLandingData();
    cm.createNewChart();
    // 3 columns × 2 rows of 4-seat tables; door at the bottom-left, window along the left wall
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++)
      cm.state.layoutItems.push({ id: `t${row}${col}`, type: 'table', x: 140 + col * 250, y: 100 + row * 250, rotation: 0, groups: 1, groupShift: 0,
        seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }, { x: 14, y: 76 }, { x: 76, y: 76 }] });
    cm.state.layoutItems.push({ id: 'door', type: 'door', x: 0, y: 520, rotation: 0 }, { id: 'win', type: 'window', x: 0, y: 200, rotation: 90 });
    const out = { breaksNear: 0, distractedFar: 0, sameTable: 0 };
    for (let i = 0; i < 10; i++) {
      cm.autoAssign();
      const seats = cm.getAllSeats();
      const seatOf = id => seats.find(s => s.seatId === Object.keys(cm.state.assignments).find(k => cm.state.assignments[k] === id));
      const breaks = ['s0', 's1', 's2'].map(seatOf), dist = ['s3', 's4', 's5'].map(seatOf);
      if (breaks.every(s => s.tableId === 't10' || s.tableId === 't11' || s.tableId === 't00')) out.breaksNear++;
      if (new Set(breaks.map(s => s.tableId)).size === 3) out.sameTable++;
      if (dist.every(s => s.tableId.endsWith('2') || s.tableId.endsWith('1'))) out.distractedFar++;
    }
    return out;
  });
  expect(r).toEqual({ breaksNear: 10, distractedFar: 10, sameTable: 10 });
});

test('resize: a window gets longer from its end (also when turned 90°); the board too', async ({ page }) => {
  const errors = await open(page);
  await layoutWithTables(page);
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.state.layoutItems.push({ id: 'w1', type: 'window', x: 98, y: 420, rotation: 0 }, { id: 'w2', type: 'window', x: 700, y: 420, rotation: 90 },
      { id: 'bd', type: 'board', x: 300, y: 14, rotation: 0 });
    cm.renderLayoutCanvas();
  });
  const drag = async (id, dx, dy) => {
    const box = await page.locator(`#layoutCanvas .canvas-item[data-id="${id}"] > div:first-child`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.up();  // select
    const g = await page.locator(`#layoutCanvas .canvas-item[data-id="${id}"] .item-resize`).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + dx / 2, g.y + g.height / 2 + dy / 2); await page.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2 + dy);
    await page.mouse.up();
  };
  const rectOf = id => page.locator(`#layoutCanvas .canvas-item[data-id="${id}"] > div:first-child`).boundingBox();
  const r0 = await rectOf('w1');
  await drag('w1', 56, 0);
  const r1 = await rectOf('w1');
  expect(Math.round(r1.width - r0.width)).toBe(56);
  expect(Math.round(r1.x)).toBe(Math.round(r0.x));            // left end stays put

  // turned 90°: its "end" is at the bottom — dragging down makes it taller, the top stays put
  const v0 = await rectOf('w2');
  await drag('w2', 0, 70);
  const v1 = await rectOf('w2');
  expect(Math.round(v1.height - v0.height)).toBe(70);
  expect(Math.abs(v1.y - v0.y)).toBeLessThan(1.5);

  await drag('bd', 84, 0);
  expect(await page.evaluate(() => window.__cm.state.layoutItems.find(i => i.id === 'bd').w)).toBe(238);   // 148 + 84 → nearest grid step
  expect(errors).toEqual([]);
});

test('rotate: 45° steps by default, free when switched; tapping ↻ turns 45°', async ({ page }) => {
  await open(page);
  await layoutWithTables(page);
  await page.evaluate(() => { try { localStorage.removeItem('cm-rotate-free'); } catch {} });
  const rot = () => page.evaluate(() => window.__cm.state.layoutItems.find(i => i.id === 'tc').rotation || 0);
  const t = await page.locator('#layoutCanvas .canvas-item[data-id="tc"] .canvas-table-free').boundingBox();
  await page.mouse.click(t.x + 6, t.y + t.height / 2);
  const turn = async deg => {
    const h = await page.locator('#layoutCanvas .canvas-item[data-id="tc"] .rotate-handle').boundingBox();
    const wb = await page.locator('#layoutCanvas .canvas-item[data-id="tc"]').boundingBox();
    const cx = wb.x + wb.width / 2, cy = wb.y + wb.height / 2;
    const hx = h.x + h.width / 2, hy = h.y + h.height / 2;
    const a0 = Math.atan2(hy - cy, hx - cx), r = Math.hypot(hx - cx, hy - cy);
    await page.mouse.move(hx, hy); await page.mouse.down();
    for (let k = 1; k <= 6; k++) {
      const a = a0 + (deg * Math.PI / 180) * k / 6;
      await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    await page.mouse.up();
  };
  await turn(30);
  expect(await rot()).toBe(45);              // 30° rounds to the 45° step
  await turn(-60);
  expect(await rot()).toBe(0);               // back to straight
  await page.locator('#rotSnapBtn').click();
  await expect(page.locator('#rotSnapBtn')).toHaveText('↻ Free turn');
  await turn(30);
  expect(Math.abs(await rot() - 30)).toBeLessThan(4);
  // a tap on ↻ goes to the next 45° step
  const h = await page.locator('#layoutCanvas .canvas-item[data-id="tc"] .rotate-handle').boundingBox();
  await page.mouse.click(h.x + h.width / 2, h.y + h.height / 2);
  expect(await rot()).toBe(45);
});

test('templates: optional, sized to the class, replacing a room asks first and can be undone', async ({ page }) => {
  const errors = await open(page);
  await classWithChart(page, 6, 7);   // 13 students
  await page.evaluate(() => { window.__cm.state.layoutItems = []; window.__cm.switchPanel('layout', document.querySelector('[data-panel=layout]')); window.__cm.renderLayoutCanvas(); });
  // the empty room offers it, but nothing is placed until you pick
  await expect(page.locator('#layoutCanvas .hint-link')).toBeVisible();
  await page.locator('#layoutCanvas .hint-link').click();
  await page.getByRole('button', { name: /Groups of 4/ }).click();
  const kinds = await page.evaluate(() => window.__cm.state.layoutItems.map(i => i.type).join(','));
  expect(kinds).toBe('room,table,table,table,table,board,teacher');
  await expect(page.locator('#seatCount')).toHaveText('16 seats · 13 students');

  for (const [name, seats] of [['Rows', 13], ['Pairs', 14], ['Groups of 6', 18], ['U-shape', 13]]) {
    await page.getByRole('button', { name: 'Template ▾' }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.locator('.cm-btn-confirm').click();
    await expect(page.locator('#seatCount')).toHaveText(`${seats} seats · 13 students`);
  }
  // nothing overlaps in the U
  const overlaps = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#layoutCanvas .canvas-seat')].map(e => e.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++)
      if (r[i].left < r[j].right && r[j].left < r[i].right && r[i].top < r[j].bottom && r[j].top < r[i].bottom) n++;
    return n;
  });
  expect(overlaps).toBe(0);
  // Cancel keeps the room; Undo after replacing brings the U back
  await page.getByRole('button', { name: 'Template ▾' }).click();
  await page.getByRole('button', { name: /Rows/ }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#seatCount')).toHaveText('13 seats · 13 students');
  await page.getByRole('button', { name: 'Template ▾' }).click();
  await page.getByRole('button', { name: /Pairs/ }).click();
  await page.locator('.cm-btn-confirm').click();
  await page.locator('.cm-undo-btn').last().click();
  await expect(page.locator('#layoutCanvas .canvas-seat')).toHaveCount(13);
  expect(errors).toEqual([]);
});

test('walls: drawn round the room, box select inside does not grab them, clicks inside still place tables', async ({ page }) => {
  await open(page);
  await layoutWithTables(page);
  await page.getByRole('button', { name: '▢ Walls' }).click();
  const room = await page.evaluate(() => window.__cm.state.layoutItems.find(i => i.type === 'room'));
  expect(room.x).toBeLessThanOrEqual(56); expect(room.w).toBeGreaterThan(600);
  await page.keyboard.press('Escape');
  const c = await page.locator('#layoutCanvas').boundingBox();
  // box round just the first two tables (starting outside the walls)
  await page.mouse.move(c.x + 12, c.y + 12); await page.mouse.down();
  await page.mouse.move(c.x + 300, c.y + 200); await page.mouse.move(c.x + 450, c.y + 260); await page.mouse.up();
  const sel = await page.evaluate(() => [...window.__cm.store.selectedIds].sort().join(','));
  expect(sel).toBe('ta,tb');
  // placing a table inside the walls still works
  await page.evaluate(() => window.__cm.setTool('table'));
  await page.mouse.click(c.x + 300, c.y + 330);
  expect(await page.evaluate(() => window.__cm.state.layoutItems.filter(i => i.type === 'table').length)).toBe(4);
  // a second click on Walls selects them instead of adding more
  await page.evaluate(() => window.__cm.setTool('pointer'));
  await page.getByRole('button', { name: '▢ Walls' }).click();
  expect(await page.evaluate(() => window.__cm.state.layoutItems.filter(i => i.type === 'room').length)).toBe(1);
  await expect(page.locator('#selCount')).toHaveText('1 selected');
});

// ── Smart room: Room check, Tidy up, Arrange for me ──
// A 26 × 20 ft room (26 px = 1 ft): walls, board on the top wall, door bottom right
async function smartRoom(page, students = 20) {
  await classWithChart(page, Math.ceil(students / 2), Math.floor(students / 2));
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.state.layoutItems = [
      { id: 'room', type: 'room', x: 28, y: 28, w: 676, h: 520, rotation: 0 },
      { id: 'board', type: 'board', x: 290, y: 42, w: 150, rotation: 0 },
      { id: 'door', type: 'door', x: 560, y: 532, rotation: 0 },
    ];
    cm.switchPanel('layout', document.querySelector('[data-panel=layout]'));
    cm.renderLayoutCanvas();
  });
}
const issueKeys = page => page.evaluate(() => window.__cm.analyzeRoom().issues.map(i => i.key));

test('room check: door, "no seats" area, behind the board; Move fixes them; walkways show', async ({ page }) => {
  const errors = await open(page);
  await smartRoom(page);
  await page.evaluate(() => {
    const cm = window.__cm;
    const T = (id, x, y) => ({ id, type: 'table', x, y, rotation: 0, groups: 1, groupShift: 0, seatPositions: cm.defaultSeatPositions(4) });
    cm.state.layoutItems.push(
      { id: 'sink', type: 'zone', x: 56, y: 380, w: 140, h: 140, label: 'Sink', rotation: 0 },
      T('ok', 280, 220), T('inDoor', 540, 400), T('inSink', 70, 390), { id: 'behind', type: 'seat', x: 340, y: 30, rotation: 0 });
    cm.renderLayoutCanvas();
  });
  await page.locator('#roomCheckBtn').click();
  await expect(page.locator('#roomCheckBtn .rc-badge')).not.toHaveText('✓');
  const keys = await issueKeys(page);
  expect(keys).toEqual(expect.arrayContaining(['door', 'zone', 'view-behind']));
  await expect(page.locator('#roomCheckPanel')).toContainText('in the door\'s way');
  await expect(page.locator('#roomCheckPanel')).toContainText('in a “no seats” area');
  await expect(page.locator('#layoutCanvas .canvas-item.has-issue')).not.toHaveCount(0);

  // Move fixes the door and the sink
  await page.locator('.rc-issue', { hasText: "door's way" }).getByRole('button', { name: 'Move' }).click();
  await page.locator('.rc-issue', { hasText: 'no seats' }).getByRole('button', { name: 'Move' }).click();
  await expect.poll(() => issueKeys(page)).not.toContain('door');
  await expect.poll(() => issueKeys(page)).not.toContain('zone');

  // walkways overlay
  await page.locator('#rcWalk').click();
  await expect(page.locator('#layoutCanvas .walk-overlay')).toHaveCount(1);
  // room width in feet changes the scale
  await page.locator('#rcFeetW').fill('52');
  await page.locator('#rcFeetW').dispatchEvent('change');
  expect(await page.evaluate(() => window.__cm.pxPerFt())).toBe(13);
  expect(errors).toEqual([]);
});

test('room check: a table walled in by others cannot be reached with a 3-ft walkway', async ({ page }) => {
  await open(page);
  await smartRoom(page);
  const keys = await page.evaluate(() => {
    const cm = window.__cm;
    // a wall-to-wall row of 2-seat tables, touching, with one more table behind it
    for (let i = 0; i < 5; i++) cm.state.layoutItems.push({ id: 'r' + i, type: 'table', x: 28 + i * 136, y: 300, rotation: 0, groups: 1, groupShift: 0, seatPositions: [{ x: 4, y: 14 }, { x: 70, y: 14 }] });
    cm.state.layoutItems.push({ id: 'back', type: 'table', x: 300, y: 120, rotation: 0, groups: 1, groupShift: 0, seatPositions: cm.defaultSeatPositions(2) });
    // door is below the row; the board side is cut off
    return cm.analyzeRoom().issues.map(i => [i.key, i.ids]);
  });
  const walk = keys.find(k => k[0] === 'walk');
  expect(walk).toBeTruthy();
  expect(walk[1]).toContain('back');
});

test('tidy up straightens and lines up tables, and Undo puts them back', async ({ page }) => {
  await open(page);
  await smartRoom(page);
  await page.evaluate(() => {
    const cm = window.__cm;
    const T = (id, x, y, r) => ({ id, type: 'table', x, y, rotation: r, groups: 1, groupShift: 0, seatPositions: cm.defaultSeatPositions(4) });
    cm.state.layoutItems.push(T('a', 70, 200, 7), T('b', 300, 212, -4), T('c', 500, 194, 0));
    cm.renderLayoutCanvas();
    cm.markDirty();
  });
  await page.locator('#roomCheckBtn').click();
  await page.locator('#rcTidy').click();
  const after = await page.evaluate(() => window.__cm.state.layoutItems.filter(i => i.type === 'table').map(t => [t.rotation, Math.round(t.y)]));
  expect(after.map(a => a[0])).toEqual([0, 0, 0]);
  expect(new Set(after.map(a => a[1])).size).toBe(1);          // one straight row
  await page.locator('.cm-undo-btn').last().click();
  const back = await page.evaluate(() => window.__cm.state.layoutItems.filter(i => i.type === 'table').map(t => t.rotation));
  expect(back).toEqual([7, -4, 0]);
});

test('arrange for me: options fit the class around the door and desk, rules are checked, Use this + Undo', async ({ page }) => {
  const errors = await open(page);
  await smartRoom(page, 20);
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.state.layoutItems.push({ id: 'desk', type: 'teacher', x: 600, y: 60, rotation: 0 }, { id: 'sink', type: 'zone', x: 42, y: 420, w: 112, h: 112, rotation: 0, label: 'Sink' });
    cm.state.hardRules = [{ type: 'separate', studentA: 'b0', studentB: 'g0' }];
    cm.renderLayoutCanvas();
  });
  await page.getByRole('button', { name: '✦ Arrange for me' }).click();
  await expect(page.locator('.ar-card').first()).toBeVisible();
  const cards = page.locator('.ar-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  await expect(cards.first()).toContainText('walkways to every table');
  await expect(cards.first()).toContainText('seating rule');
  // every style tab renders
  for (const tab of ['Rows', 'Pairs', 'Groups of 4', 'Groups of 6']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.locator('.ar-card').first()).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Best for this class' }).click();
  await page.locator('.ar-card').first().getByRole('button', { name: 'Use this' }).click();
  await expect(page.locator('#arrangeDialog')).toHaveCount(0);
  const result = await page.evaluate(() => {
    const cm = window.__cm;
    const a = cm.analyzeRoom();
    return { seats: a.stats.seats, problems: a.issues.filter(i => i.level === 'problem').map(i => i.key), kept: ['room', 'board', 'door', 'desk', 'sink'].every(id => cm.state.layoutItems.some(i => i.id === id)) };
  });
  expect(result.seats).toBeGreaterThanOrEqual(20);
  expect(result.problems).toEqual([]);
  expect(result.kept).toBe(true);
  await page.locator('.cm-undo-btn').last().click();
  expect(await page.evaluate(() => window.__cm.state.layoutItems.filter(i => i.type === 'table' || i.type === 'seat').length)).toBe(0);
  expect(errors).toEqual([]);
});

test('arrange for me works with the board on a side wall, and asks for walls first', async ({ page }) => {
  await open(page);
  await smartRoom(page, 16);
  const r = await page.evaluate(() => {
    const cm = window.__cm;
    const board = cm.state.layoutItems.find(i => i.id === 'board');
    board.x = -20; board.y = 250; board.rotation = 90;     // on the left wall
    const res = cm.arrangeOptions();
    const top = res.best[0];
    const a = cm.analyzeRoom(top.items);
    return { style: top.style.id, seats: top.stats.seats, view: top.stats.viewProblems, problems: a.issues.filter(i => i.level === 'problem').map(i => i.key) };
  });
  expect(r.seats).toBeGreaterThanOrEqual(16);
  expect(r.view).toBe(0);
  expect(r.problems).toEqual([]);
  // without walls: a prompt to add them
  await page.evaluate(() => { const cm = window.__cm; cm.state.layoutItems = cm.state.layoutItems.filter(i => i.type !== 'room'); cm.renderLayoutCanvas(); });
  await page.getByRole('button', { name: '✦ Arrange for me' }).click();
  await expect(page.locator('#arrangeDialog')).toContainText('Add the room\'s walls first');
  await page.locator('#arWalls').click();
  expect(await page.evaluate(() => window.__cm.state.layoutItems.some(i => i.type === 'room'))).toBe(true);
});

// ── Send & receive (two separate browsers = two devices; relay = the local Worker) ──
async function deviceWithClass(browser, name = 'Period 3') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = await open(page);
  await page.evaluate(n => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = n; cm.addLandingClass();
    const c = cm.store.landingData.classes[0];
    ['Zoraida Quintero', 'Bartholomew Ng', 'Ana Ruiz'].forEach((nm, i) => c.students.push({ id: 's' + i, name: nm, gender: null, tags: i === 0 ? ['IEP'] : [] }));
    c.hardRules = [{ type: 'separate', studentA: 's0', studentB: 's1' }];
    cm.store.landingData.charts.push({ id: 'ch1', classId: c.id, name: n, savedAt: Date.now(), date: '2026-11-20',
      data: { className: n, layoutItems: [{ id: 'seat1', type: 'seat', x: 100, y: 100, rotation: 0 }], assignments: { seat1: 's0' }, tempRules: [], sessionNotes: '' } });
    cm.saveLandingData(); cm.showLanding();
  }, name);
  return { ctx, page, errors };
}
async function emptyDevice(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = await open(page);
  return { ctx, page, errors };
}

test('send & receive: a class goes to another device, locked, with matching check words', async ({ browser }) => {
  const A = await deviceWithClass(browser), B = await emptyDevice(browser);
  // everything that goes over the wire from A, to prove the relay only sees locked data
  const wire = [];
  A.page.on('websocket', ws => ws.on('framesent', f => wire.push(String(f.payload))));

  await A.page.getByRole('button', { name: /Send & receive/ }).click();
  await A.page.locator('#shPickSend').click();
  await A.page.locator('#shGo').click();
  const code = (await A.page.locator('.sh-code').textContent()).trim();
  expect(code).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);
  await expect(A.page.locator('.sh-qr svg')).toHaveCount(1);

  await B.page.getByRole('button', { name: /Send & receive/ }).click();
  await B.page.locator('#shPickRecv').click();
  await B.page.locator('#shCode').fill(code.toLowerCase().replace('-', ''));   // typing is forgiving
  await B.page.getByRole('button', { name: 'Connect' }).click();
  await expect(A.page.locator('.sh-words')).toBeVisible();
  await expect(B.page.locator('.sh-words')).toBeVisible();
  expect(await A.page.locator('.sh-words').textContent()).toBe(await B.page.locator('.sh-words').textContent());

  await A.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(B.page.locator('.cm-btn-confirm')).toBeVisible();
  await expect(B.page.locator('.cm-dialog, [role=dialog]').last()).toContainText('Add “Period 3” as a new class?');
  await B.page.locator('.cm-btn-confirm').click();
  await expect(A.page.locator('.sh-ok')).toContainText('Sent');

  const got = await B.page.evaluate(() => {
    const L = window.__cm.store.landingData;
    return { classes: L.classes.map(c => [c.name, c.students.length, c.hardRules.length, c.students[0].tags]), charts: L.charts.map(ch => [ch.id, ch.data.assignments.seat1]) };
  });
  expect(got).toEqual({ classes: [['Period 3', 3, 1, ['IEP']]], charts: [['ch1', 's0']] });
  // the relay never saw a student's name
  expect(wire.length).toBeGreaterThan(2);
  expect(wire.join('\n')).not.toContain('Zoraida');
  expect(wire.join('\n')).not.toContain('Bartholomew');
  expect([...A.errors, ...B.errors]).toEqual([]);
  await A.ctx.close(); await B.ctx.close();
});

test('send & receive: the same class from your other device is updated, newest chart wins; Undo', async ({ browser }) => {
  const A = await deviceWithClass(browser);
  const B = await emptyDevice(browser);
  // B already has this class (same ids) with an older copy of the chart and another chart of its own
  await B.page.evaluate(snapshot => {
    const cm = window.__cm;
    const s = JSON.parse(snapshot);
    s.charts[0].savedAt -= 60000; s.charts[0].data.assignments = {};
    s.charts.push({ ...s.charts[0], id: 'chB', savedAt: Date.now() });
    cm.store.landingData.classes = s.classes; cm.store.landingData.charts = s.charts;
    cm.saveLandingData(); cm.showLanding();
  }, await A.page.evaluate(() => JSON.stringify(window.__cm.store.landingData)));

  await A.page.evaluate(() => window.__cm.startSendFlow(window.__cm.everythingPayload()));
  const code = (await A.page.locator('.sh-code').textContent()).trim();
  await B.page.evaluate(c => window.__cm.openReceive(c), code);
  await A.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(B.page.locator('.cm-btn-confirm')).toBeVisible();
  await B.page.locator('.cm-btn-confirm').click();
  const after = await B.page.evaluate(() => window.__cm.store.landingData.charts.map(ch => [ch.id, ch.data.assignments.seat1 || null]).sort());
  expect(after).toEqual([['ch1', 's0'], ['chB', null]]);   // newer ch1 came over; chB stayed
  expect(await B.page.evaluate(() => window.__cm.store.landingData.classes.length)).toBe(1);
  await B.page.locator('.cm-undo-btn').last().click();
  expect(await B.page.evaluate(() => window.__cm.store.landingData.charts.find(c => c.id === 'ch1').data.assignments.seat1 || null)).toBe(null);
  await A.ctx.close(); await B.ctx.close();
});

test('send & receive: a big chart (room photo) arrives in pieces', async ({ browser }) => {
  const A = await deviceWithClass(browser), B = await emptyDevice(browser);
  const size = await A.page.evaluate(() => {
    const ch = window.__cm.store.landingData.charts[0];
    const r = new Uint8Array(900000); for (let i = 0; i < r.length; i += 65536) crypto.getRandomValues(r.subarray(i, i + 65536));
    let s = ''; for (let i = 0; i < r.length; i += 0x8000) s += String.fromCharCode(...r.subarray(i, i + 0x8000));
    ch.data.layoutImg = 'data:image/jpeg;base64,' + btoa(s);    // ~1.2 MB that doesn't compress
    window.__cm.startSendFlow(window.__cm.classPayload(ch.classId));
    return ch.data.layoutImg.length;
  });
  const code = (await A.page.locator('.sh-code').textContent()).trim();
  await B.page.evaluate(c => window.__cm.openReceive(c), code);
  await A.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(B.page.locator('.cm-btn-confirm')).toBeVisible({ timeout: 15000 });
  await B.page.locator('.cm-btn-confirm').click();
  expect(await B.page.evaluate(() => (window.__cm.store.landingData.charts[0].data.layoutImg || '').length)).toBe(size);
  await A.ctx.close(); await B.ctx.close();
});

test('send & receive: a link opens straight to receiving; wrong or used codes say so', async ({ browser }) => {
  const A = await deviceWithClass(browser), B = await emptyDevice(browser), C = await emptyDevice(browser);
  await A.page.evaluate(() => { const L = window.__cm.store.landingData; window.__cm.startSendFlow(window.__cm.classPayload(L.classes[0].id)); });
  const code = (await A.page.locator('.sh-code').textContent()).trim().replace('-', '');
  // B opens the link from the QR code
  await B.page.goto('/app/#receive=' + code);
  await B.page.waitForFunction(() => window.__classmapStarted);
  await expect(B.page.locator('.sh-words')).toBeVisible();
  expect(await B.page.evaluate(() => location.hash)).toBe('');
  // C tries the same code while B is connected
  await C.page.evaluate(c => window.__cm.openReceive(c), code);
  await expect(C.page.locator('.sh-err')).toContainText('already connected');
  // a code nobody is sharing
  await C.page.evaluate(() => window.__cm.openReceive('ZZZZZZ'));
  await expect(C.page.locator('.sh-err')).toContainText("isn't active");
  // the sender cancels: the receiver is told
  await A.page.locator('#shareDialog .ar-x').click();
  await expect(B.page.locator('.sh-err')).toContainText('stopped sharing');
  await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
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

test('tags: "toward the front" + spread out puts tagged students up front at different tables', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Tag seats'; cm.addLandingClass();
    const c = cm.store.landingData.classes[0];
    for (let i = 0; i < 24; i++) c.students.push({ id: 's' + i, name: 'Kid' + i + ' Z', gender: null, tags: i < 4 ? ['IEP'] : [] });
    c.tagSettings = { iep: { place: 'front', spread: true } };
    cm.saveLandingData();
    cm.createNewChart();
    cm.state.layoutItems.push({ id: 'b', type: 'board', x: 300, y: 0, rotation: 0 });
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++)
      cm.state.layoutItems.push({ id: `t${row}${col}`, type: 'table', x: 100 + col * 250, y: 100 + row * 300, rotation: 0, groups: 1, groupShift: 0,
        seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }, { x: 14, y: 76 }, { x: 76, y: 76 }] });
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      cm.autoAssign();
      const seats = cm.getAllSeats();
      const tables = Object.entries(cm.state.assignments).filter(([, id]) => +id.slice(1) < 4)
        .map(([seat]) => seats.find(s => s.seatId === seat).tableId);
      if (new Set(tables).size === 4 && tables.filter(t => t.startsWith('t0')).length === 3) ok++;
    }
    cm.renderAssignPanel();
    return { ok, badges: document.querySelectorAll('#assignCanvas .seat-tag-badge').length, privateByDefault: cm.tagSetting(c, 'IEP').private };
  });
  // 3 front tables for 4 students: spreading out wins, so one sits in the second row
  expect(r).toEqual({ ok: 10, badges: 4, privateByDefault: true });
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
