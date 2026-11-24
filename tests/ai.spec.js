// Browser tests for the ClassMap helper and the on-device AI.
// The real model can't run here (no GPU), so a stand-in engine answers instead.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

const GOOD_DEVICE = { webgpu: true, gpu: 'Test GPU', storageFreeGB: 50, memoryGB: 8, mobile: false, promptApi: 'none' };

async function open(page, { device = GOOD_DEVICE, prefs = null } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(([d, p]) => {
    if (d) window.__cmAiDevice = d;
    if (p && !sessionStorage.getItem('cm-ai-set')) { localStorage.setItem('cm-ai', JSON.stringify(p)); sessionStorage.setItem('cm-ai-set', '1'); }
  }, [device, prefs]);
  await page.goto('/app/');
  await page.waitForFunction(() => window.__cm && window.__classmapStarted);
  return errors;
}

// A stand-in for the model: streams a canned reply, chosen by what it was asked
async function mockEngine(page, replies = {}) {
  await page.evaluate(r => {
    const calls = [];
    window.__aiCalls = calls;
    window.__cm.setEngineForTests({
      state: 'off', model: null,
      async load(key, onProgress) {
        this.state = 'loading';
        for (let i = 1; i <= 4; i++) { onProgress({ loaded: i * 25e6, total: 100e6 }); await new Promise(x => setTimeout(x, 30)); }
        this.state = 'ready'; this.model = key;
      },
      async chat(messages, { onToken = () => {} } = {}) {
        calls.push(messages);
        const sys = messages[0].content;
        const reply = /command reader/.test(sys) ? r.command : /seating wishes into rules/.test(sys) ? r.rules : /edit emails/.test(sys) ? r.email : /plan seating and daily support/.test(sys) ? r.accom : r.help;
        for (const w of String(reply).split(/(?<= )/)) onToken(w);
        return String(reply);
      },
      stop() {}, unload() { this.state = 'off'; },
    });
  }, { command: '[{"action":"none"}]', rules: '[]', email: 'Hello.', accom: '- Seat near the front', help: 'Use the Rules tab.', ...replies });
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

test('helper button: first-visit tip once, then quiet', async ({ page }) => {
  const errors = await open(page);
  await expect(bubble(page)).toBeVisible();
  await expect(page.locator('.ai-tip')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.ai-tip')).toContainText('never leaves this device');
  await page.locator('.ai-tip-no').click();
  await expect(page.locator('.ai-tip')).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => window.__classmapStarted);
  await page.waitForTimeout(2000);
  await expect(page.locator('.ai-tip')).toHaveCount(0);
  await expect(bubble(page)).toBeVisible();
  expect(errors).toEqual([]);
});

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

test('no WebGPU: no tip, no AI offer; how-to questions get the written answer', async ({ page }) => {
  await open(page, { device: { ...GOOD_DEVICE, webgpu: false, gpu: '' } });
  await page.waitForTimeout(2000);
  await expect(page.locator('.ai-tip')).toHaveCount(0);
  await bubble(page).click();
  await expect(panel(page)).toContainText('needs a browser with WebGPU');
  await expect(panel(page).locator('.ai-learn')).toHaveCount(0);
  const reply = await ask(page, 'how do I keep two students apart?');
  await expect(reply.locator('.ai-hit').first()).toContainText('Keep apart');
});

test('“how do I add a class” gives the real steps, and offers to do it', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true } });
  await bubble(page).click();
  const reply = await ask(page, 'How do I add a new class?');
  await expect(reply.locator('.ai-hit').first()).toContainText('“New class name…” box');
  await expect(reply).not.toContainText('plus');
  await reply.locator('.ai-doit').click();
  await expect(page.locator('.ai-ask-in')).toHaveValue('Make a class called ');
});

test('chat makes a class with students, only after Apply; Undo takes it back', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true } });
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
  await open(page, { prefs: { tipSeen: true } });
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
  await open(page, { prefs: { tipSeen: true } });
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
  await open(page, { prefs: { tipSeen: true } });
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
  await open(page, { prefs: { tipSeen: true } });
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

test('requests the reader can’t follow go to the AI, which only picks the action', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true, enabled: true, model: 'small' } });
  await mockEngine(page, { command: '[{"action":"rules","text":"Keep Liam and Jaden apart"},{"action":"create_class","name":"Sixth Period"}]' });
  await classOnHome(page);
  await bubble(page).click();
  await expect(panel(page)).toContainText('AI on');
  const reply = await ask(page, 'Liam does better when he is not distracted by Jaden, and I am picking up a sixth period group');
  await expect(reply.locator('.ai-plan').first()).toContainText('Keep Liam Johnson and Jayden Smith apart');
  await expect(reply.locator('.ai-plan').nth(1)).toContainText('Create the class Sixth Period');
  const sys = await page.evaluate(() => window.__aiCalls[0][0].content);
  expect(sys).toContain('Students: Liam Johnson, Owen Park');
  // made-up actions are ignored
  await mockEngine(page, { command: '[{"action":"delete_everything"}]' });
  const r2 = await ask(page, 'do the thing with the stuff');
  await expect(r2).toContainText('I can’t do that yet');
});

test('Learn more: device check, turn on with progress, then Remove AI', async ({ page }) => {
  await open(page);
  await mockEngine(page);
  await page.locator('.ai-tip-more').click({ timeout: 4000 });
  const p = panel(page);
  await expect(p).toContainText('never leave this device');
  await expect(p.locator('.ai-check')).toContainText('Test GPU');
  await expect(p.locator('.ai-check')).toContainText('8 GB or more');
  await expect(p.locator('input[name=aiModel][value=large]')).toBeChecked();   // 8 GB → the larger model
  await p.locator('.ai-turnon').click();
  await expect(p).toContainText('ClassMap helper', { timeout: 5000 });
  await expect(p).toContainText('AI on · Larger');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cm-ai')).enabled)).toBe(true);
  // ⋮ → Remove
  await p.locator('.ai-menu-btn').click();
  await page.locator('.ai-menu [data-k="remove"]').click();
  await page.locator('.cm-btn-confirm').click();
  await expect(p).toContainText('AI off');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cm-ai')).enabled)).toBe(false);
});

test('parent email polish streams in and copies', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, { prefs: { tipSeen: true, enabled: true, model: 'small' } });
  await mockEngine(page, { email: 'Dear Ms. Garcia,\n\nThank you for meeting with me on Tuesday.' });
  await bubble(page).click();
  await panel(page).locator('.ai-tool[data-v="email"]').click();
  await panel(page).locator('.ai-input').fill('hi ms garcia thanks for meeting tues');
  await panel(page).locator('.ai-chip', { hasText: 'In Spanish' }).click();
  await panel(page).locator('.ai-go').click();
  await expect(panel(page).locator('.ai-email')).toContainText('Thank you for meeting with me on Tuesday.');
  const sys = await page.evaluate(() => window.__aiCalls[0][0].content);
  expect(sys).toContain('Spanish');
  expect(sys).toContain('Keep every name, date, time and fact');
  await panel(page).locator('.ai-copy').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Dear Ms. Garcia');
});

test('accommodation summary: notes, then suggested tags and front seat only after Apply', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true, enabled: true, model: 'small' } });
  await mockEngine(page, { accom: '- Seat near the board\n- Give directions one step at a time\n- Allow movement breaks' });
  await classOnHome(page);
  await bubble(page).click();
  await panel(page).locator('.ai-tool[data-v="accom"]').click();
  await panel(page).locator('.ai-student').selectOption('s6');
  await panel(page).locator('.ai-input').fill('504 plan. Preferential seating near instruction. Extended time 1.5x. Breaks as needed.');
  await panel(page).locator('.ai-go').click();
  await expect(panel(page).locator('.ai-sum li')).toHaveCount(3);
  // the student's name isn't sent to the model
  expect(JSON.stringify(await page.evaluate(() => window.__aiCalls[0]))).not.toContain('Jayden');
  const plan = panel(page).locator('.ai-plan');
  await expect(plan).toContainText('Tag Jayden Smith: “504”, “Preferential seating”');
  await expect(plan).toContainText('Seat Jayden Smith toward the front');
  expect(await page.evaluate(() => window.__cm.store.landingData.classes[0].students.find(s => s.id === 's6').tags)).toEqual([]);
  await plan.locator('.ai-apply').click();
  const r = await page.evaluate(() => { const c = window.__cm.store.landingData.classes[0]; return [c.students.find(s => s.id === 's6').tags, c.hardRules]; });
  expect(r[0]).toEqual(['504', 'Preferential seating']);
  expect(r[1]).toEqual([{ type: 'front', studentA: 'Jayden Smith', studentB: '' }]);
});

test('helper hides while presenting, and can be dragged', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true } });
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

test('AI file routes only serve the two models and the runtime', async ({ request }) => {
  const w = 'http://127.0.0.1:8799';
  expect((await request.get(`${w}/models/someone/other-model/resolve/main/config.json`)).status()).toBe(404);
  expect((await request.get(`${w}/models/onnx-community/Qwen3.5-0.8B-ONNX-OPT/resolve/main/../../x`)).status()).toBe(404);
  expect((await request.get(`${w}/ai-runtime/evil.js`)).status()).toBe(404);
  expect((await request.post(`${w}/ai-runtime/ort-wasm-simd-threaded.asyncify.wasm`)).status()).toBe(405);
  // the Worker's runtime version must match the one Transformers.js was built with
  const src = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
  const pinned = /ORT_VERSION = '([^']+)'/.exec(src)[1];
  const dep = JSON.parse(readFileSync(new URL('../node_modules/@huggingface/transformers/package.json', import.meta.url), 'utf8')).dependencies['onnxruntime-web'];
  expect(pinned).toBe(dep);
});
