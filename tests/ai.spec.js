// Browser tests for Ask ClassMap (the helper). There is no AI: a pattern reader, typo fixes,
// common rephrasings, the help search, and real class data.
import { test, expect } from '@playwright/test';

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/app/');
  await page.waitForFunction(() => window.__cm && window.__classmapStarted);
  return errors;
}

// A class with real-looking names, on the home page
async function classOnHome(page) {
  await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'Period 3';
    cm.addLandingClass();
    const cls = cm.store.landingData.classes[0];
    [['s1', 'Liam Johnson'], ['s2', 'Owen Park', ['IEP']], ['s3', 'Ana Ruiz', ['ELL']], ['s4', 'Ana Lopez', ['Strong reader']],
     ['s5', 'Sofia Kim', ['IEP']], ['s6', 'Jayden Smith'], ['s7', 'Mia Chen', ['ELL']]]
      .forEach(([id, name, tags]) => cls.students.push({ id, name, gender: 'none', tags: tags || [] }));
    cm.store.activeClassId = cls.id;
    cm.saveLandingData();
    cm.showLanding();
  });
}
const panel = page => page.locator('.ai-panel');
const bubble = page => page.locator('.ai-bubble');

// Type into the helper and send
async function ask(page, text) {
  await page.locator('.ai-ask-in').fill(text);
  await page.locator('.ai-send').click();
  return page.locator('.ai-bot').last();
}
// A chart for the class on screen: two tables of four, everyone seated in order
async function chartWithSeats(page) {
  await page.evaluate(() => {
    const cm = window.__cm;
    cm.createNewChart();
    const T = (id, x, y, label) => ({ id, type: 'table', x, y, rotation: 0, groups: 2, groupShift: 0, ...(label ? { label } : {}),
      seatPositions: [{ x: 14, y: 14 }, { x: 76, y: 14 }, { x: 138, y: 14 }, { x: 200, y: 14 }] });
    cm.state.layoutItems.push(T('ta', 420, 120, 'Red table'), T('tb', 420, 400));
    const seats = cm.getAllSeats();
    cm.state.students.forEach((s, i) => { if (seats[i]) cm.state.assignments[seats[i].seatId] = s.id; });
    cm.renderLayoutCanvas();
  });
}

test('“how do I add a class” gives the real steps, and offers to do it', async ({ page }) => {
  await open(page);
  await bubble(page).click();
  const reply = await ask(page, 'How do I add a new class?');
  await expect(reply.locator('.ai-hit').first()).toContainText('“New class name…” box');
  await expect(reply).not.toContainText('plus');
  await reply.locator('.ai-doit').click();
  await expect(page.locator('.ai-ask-in')).toHaveValue('Make a class called ');
});

test('chat makes a class with students, only after Apply; Undo takes it back', async ({ page }) => {
  await open(page);
  await bubble(page).click();
  const reply = await ask(page, 'Can you create a new class called Period 4 with Jo Smith, Sam Lee and Ana Diaz?');
  await expect(reply.locator('.ai-plan')).toContainText('Create the class Period 4');
  await expect(reply.locator('.ai-plan')).toContainText('Add 3 students: Jo Smith, Sam Lee and Ana Diaz');
  expect(await page.evaluate(() => window.__cm.store.landingData.classes.length)).toBe(0);
  await reply.locator('.ai-apply').click();
  const cls = await page.evaluate(() => window.__cm.store.landingData.classes.map(c => [c.name, c.students.map(s => s.name)]));
  expect(cls).toEqual([['Period 4', ['Jo Smith', 'Sam Lee', 'Ana Diaz']]]);
  await expect(page.locator('#landingDetailClassName')).toHaveText('Period 4');
  await reply.locator('.ai-undo').click();
  expect(await page.evaluate(() => window.__cm.store.landingData.classes.length)).toBe(0);
});

test('chat: add and tag students, answer from the real roster', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await bubble(page).click();
  let reply = await ask(page, 'add students: Jo Smith, Liam Johnson');
  await expect(reply.locator('.ai-plan')).toContainText('Add 1 student to Period 3: Jo Smith');
  await expect(reply.locator('.ai-plan')).toContainText('Already there: Liam Johnson');
  await reply.locator('.ai-apply').click();
  reply = await ask(page, 'Tag Jayden and Jo as 504');
  await reply.locator('.ai-apply').click();
  reply = await ask(page, 'who has a 504?');
  await expect(reply).toContainText('2 students tagged “504”: Jayden Smith and Jo Smith.');
  reply = await ask(page, 'how many students are in this class?');
  await expect(reply).toContainText('Period 3 has 8 students.');
  reply = await ask(page, 'who is tagged IEP?');
  await expect(reply).toContainText('Owen Park and Sofia Kim');
  reply = await ask(page, 'who is tagged ELD?');
  await expect(reply).toContainText('Nobody in Period 3 is tagged “ELD”');
});

test('plain-English rules in the chat: preview, Apply, Undo', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await bubble(page).click();
  const reply = await ask(page, 'Keep Liam and Owen apart. Sofia needs to sit near the front. Spread out the IEP kids.');
  const plan = reply.locator('.ai-plan');
  await expect(plan).toContainText('Here’s what I’ll do for Period 3');
  await expect(plan.locator('li')).toHaveCount(3);
  expect(await page.evaluate(() => window.__cm.store.landingData.classes[0].hardRules.length)).toBe(0);
  await plan.locator('.ai-apply').click();
  const rules = await page.evaluate(() => window.__cm.store.landingData.classes[0].hardRules);
  expect(rules).toEqual([
    { type: 'separate', studentA: 'Liam Johnson', studentB: 'Owen Park' },
    { type: 'front', studentA: 'Sofia Kim', studentB: '' },
    { type: 'spread', tag: 'IEP' },
  ]);
  await expect(page.locator('#ldRulesList')).toContainText('Liam Johnson');
  await page.locator('.cm-undo-toast .cm-undo-btn').click();
  expect(await page.evaluate(() => window.__cm.store.landingData.classes[0].hardRules.length)).toBe(0);
  const list = await ask(page, 'what are the rules?');
  await expect(list).toContainText('no rules yet');
});

test('rules: unclear names ask which one; existing rules are marked', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await page.evaluate(() => { const c = window.__cm.store.landingData.classes[0]; c.hardRules.push({ type: 'separate', studentA: 'Liam Johnson', studentB: 'Owen Park' }); });
  await bubble(page).click();
  const reply = await ask(page, 'Ana and Jayden apart. Liam and Owen should not sit together.');
  await expect(reply.locator('.ai-note').first()).toContainText('Which “Ana”?');
  await expect(reply.locator('li.duplicate')).toContainText('already a rule');
  await reply.locator('.ai-pick', { hasText: 'Ana Lopez' }).click();
  const next = page.locator('.ai-bot').last();
  await expect(next.locator('.ai-plan li.new')).toContainText('Keep Ana Lopez and Jayden Smith apart');
});

test('chart questions and seat changes come from the real chart', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await chartWithSeats(page);
  await bubble(page).click();
  // seats in order: Red table = Liam, Owen | Ana R, Ana L ; table 2 = Sofia, Jayden | Mia
  let reply = await ask(page, 'Where is Liam sitting?');
  await expect(reply).toContainText('Liam Johnson sits at “Red table”');
  await expect(reply).toContainText('In the same group: Owen Park.');
  reply = await ask(page, 'who sits next to Mia?');
  await expect(reply).toContainText('Nobody shares a group with Mia Chen');
  reply = await ask(page, 'swap Liam and Mia');
  await expect(reply.locator('.ai-plan')).toContainText('Swap seats: Liam Johnson ↔ Mia Chen');
  await reply.locator('.ai-apply').click();
  const seatOf = name => page.evaluate(n => { const cm = window.__cm; const s = cm.state.students.find(x => x.name === n); return Object.keys(cm.state.assignments).find(k => cm.state.assignments[k] === s.id); }, name);
  expect(await seatOf('Mia Chen')).toBe('ta_0');
  expect(await seatOf('Liam Johnson')).toBe('tb_2');
  await reply.locator('.ai-undo').click();
  expect(await seatOf('Liam Johnson')).toBe('ta_0');
  reply = await ask(page, 'Pin Sofia');
  await reply.locator('.ai-apply').click();
  expect(await page.evaluate(() => window.__cm.state.pins.length)).toBe(1);
  reply = await ask(page, 'who doesnt have a seat?');
  await expect(reply).toContainText('Everyone has a seat. 1 empty seat.');
  await page.evaluate(() => { const c = window.__cm; c.state.hardRules.push({ type: 'separate', studentA: 'Liam Johnson', studentB: 'Owen Park' }); });
  reply = await ask(page, 'check the rules');
  await expect(reply).toContainText('1 rule not met');
  await expect(reply).toContainText('Liam & Owen should be separated');
});

test('helper hides while presenting, and can be dragged', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = 'P1';
    cm.addLandingClass();
    const cls = cm.store.landingData.classes[0];
    cls.students.push({ id: 'a', name: 'Ann', gender: 'none' });
    cm.saveLandingData();
    cm.createNewChart();
    cm.state.layoutItems.push({ id: 't1', type: 'table', x: 500, y: 300, w: 120, h: 80, seats: 4 });
    cm.renderLayoutCanvas();
  });
  await page.evaluate(() => window.__cm.openPresent());
  await expect(bubble(page)).toBeHidden();
  await page.evaluate(() => window.__cm.closePresent());
  await expect(bubble(page)).toBeVisible();
  const b = await bubble(page).boundingBox();
  await page.mouse.move(b.x + 25, b.y + 25);
  await page.mouse.down();
  await page.mouse.move(b.x - 200, b.y - 150, { steps: 6 });
  await page.mouse.up();
  await expect(panel(page)).toBeHidden();          // a drag isn't a click
  const pos = await page.evaluate(() => JSON.parse(localStorage.getItem('cm-ai')).pos);
  expect(pos.r).toBeGreaterThan(150);
  expect(pos.b).toBeGreaterThan(100);
});

test('the helper is plain code: no AI download, no AI wording, old model files cleaned up', async ({ page, request }) => {
  const asked = [];
  page.on('request', r => asked.push(r.url()));
  const errors = await open(page);
  await bubble(page).click();
  await expect(panel(page)).toContainText('Ask ClassMap');
  await expect(panel(page)).not.toContainText(/\bAI\b/);
  expect(asked.filter(u => /\/models\/|ai-runtime|huggingface|onnx|transformers/.test(u))).toEqual([]);
  // the server no longer hands out model files
  expect((await request.get('http://127.0.0.1:8799/models/onnx-community/Qwen3.5-0.8B-ONNX-OPT/resolve/main/config.json')).status()).not.toBe(200);
  // the service worker deletes the old model cache
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toContain('transformers-cache');
  expect(errors).toEqual([]);
});

test('everyday phrasings and typos are understood', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await bubble(page).click();
  let reply = await ask(page, 'Dont let Liam sit with Owen');
  await expect(reply.locator('.ai-plan')).toContainText('Keep Liam Johnson and Owen Park apart');
  reply = await ask(page, 'Sofia and Mia shouldnt sit together');
  await expect(reply.locator('.ai-plan')).toContainText('Keep Sofia Kim and Mia Chen apart');
  reply = await ask(page, 'seperate Jayden and Liam');
  await expect(reply.locator('.ai-plan')).toContainText('Keep Jayden Smith and Liam Johnson apart');
  reply = await ask(page, 'please set a timer for 3 minutes');
  await expect(reply).toContainText('3-minute timer');
  await page.evaluate(() => { window.__cm.closeTools(); window.__cm.openPanel(); });
  reply = await ask(page, 'make a clas called Period 5');
  await expect(reply.locator('.ai-plan')).toContainText('Create the class Period 5');
  reply = await ask(page, 'how do i bakup my clases');
  await expect(reply.locator('.ai-hit').first()).toContainText('How do I back up or restore?');
  reply = await ask(page, 'make it dark');
  await expect(reply.locator('.ai-hit').first()).toContainText('light and dark');
  // a student's name is never "corrected"
  await page.evaluate(() => { const c = window.__cm.store.landingData.classes[0]; c.students.push({ id: 's9', name: 'Asign Patel', gender: 'none', tags: [] }); window.__cm.saveLandingData(); });
  reply = await ask(page, 'keep Asign and Liam apart');
  await expect(reply.locator('.ai-plan')).toContainText('Keep Asign Patel and Liam Johnson apart');
});

test('not understood: closest help answers, phrasings that work, and a way to tell us', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await bubble(page).click();
  const reply = await ask(page, 'help me with the projecter thing');
  await expect(reply).toContainText('I’m not sure what you mean');
  await expect(reply.locator('.ai-near-q').first()).toBeVisible();
  await reply.locator('.ai-near-q', { hasText: 'projector' }).click();
  await expect(page.locator('.ai-bot .ai-hit').last()).toContainText('Present');
  await reply.locator('.ai-ex').first().click();
  await expect(page.locator('.ai-ask-in')).not.toHaveValue('');
  await expect(reply.locator('a[href="/contact/"]')).toBeVisible();
});
