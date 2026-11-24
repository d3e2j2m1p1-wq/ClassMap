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
        const reply = /seating wishes into rules/.test(sys) ? r.rules : /edit emails/.test(sys) ? r.email : /plan seating and daily support/.test(sys) ? r.accom : r.help;
        for (const w of String(reply).split(/(?<= )/)) onToken(w);
        return String(reply);
      },
      stop() {}, unload() { this.state = 'off'; },
    });
  }, { rules: '[]', email: 'Hello.', accom: '- Seat near the front', help: 'Use the Rules tab.', ...replies });
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

test('no WebGPU: no tip, no AI offer, help search still works', async ({ page }) => {
  await open(page, { device: { ...GOOD_DEVICE, webgpu: false, gpu: '' } });
  await page.waitForTimeout(2000);
  await expect(page.locator('.ai-tip')).toHaveCount(0);
  await bubble(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('needs a browser with WebGPU');
  await expect(panel(page).locator('.ai-learn')).toHaveCount(0);
  await panel(page).locator('.ai-help-q').fill('keep two students apart');
  await expect(panel(page).locator('.ai-hit').first()).toContainText('keep two students apart', { ignoreCase: true });
  await expect(panel(page).locator('.ai-ask')).toHaveCount(0);   // no AI to ask
});

test('help search finds guide sections too', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true } });
  await bubble(page).click();
  await panel(page).locator('.ai-help-q').fill('substitute');
  await expect(panel(page).locator('.ai-hit').first()).toBeVisible();
  const r = await page.evaluate(async () => (await window.__cm.searchHelp('substitute teacher seating chart', 6)).map(h => h.kind));
  expect(r).toContain('guide');
});

test('plain-English rules without the AI: preview, Apply, Undo', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true } });
  await classOnHome(page);
  await bubble(page).click();
  await panel(page).locator('.ai-tool[data-v="rules"]').click();
  await panel(page).locator('.ai-input').fill('Keep Liam and Owen apart. Sofia needs to sit near the front. Spread out the IEP kids.');
  await panel(page).locator('.ai-go').click();
  const plan = panel(page).locator('.ai-plan');
  await expect(plan).toContainText('Here’s what I’ll do for Period 3');
  await expect(plan.locator('li')).toHaveCount(3);
  // nothing changed yet
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
});

test('rules: unclear names ask which one; existing rules are marked', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true } });
  await classOnHome(page);
  await page.evaluate(() => { const c = window.__cm.store.landingData.classes[0]; c.hardRules.push({ type: 'separate', studentA: 'Liam Johnson', studentB: 'Owen Park' }); });
  await bubble(page).click();
  await panel(page).locator('.ai-tool[data-v="rules"]').click();
  await panel(page).locator('.ai-input').fill('Ana and Jayden apart. Liam and Owen should not sit together.');
  await panel(page).locator('.ai-go').click();
  await expect(panel(page).locator('.ai-note')).toContainText('Which “Ana”?');
  await expect(panel(page).locator('li.duplicate')).toContainText('already a rule');
  await panel(page).locator('.ai-pick', { hasText: 'Ana Lopez' }).click();
  await expect(panel(page).locator('.ai-input')).toHaveValue(/Ana Lopez and Jayden apart/);
  await expect(panel(page).locator('.ai-plan li.new')).toContainText('Keep Ana Lopez and Jayden Smith apart');
});

test('rules the pattern reader can’t read go to the AI, names checked against the class', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true, enabled: true, model: 'small' } });
  await mockEngine(page, { rules: 'Here you go: [{"type":"separate","a":"Liam","b":"Jaden"},{"type":"front","a":"Zed"}]' });
  await classOnHome(page);
  await bubble(page).click();
  await expect(panel(page)).toContainText('AI on');
  await panel(page).locator('.ai-tool[data-v="rules"]').click();
  await panel(page).locator('.ai-input').fill('Liam does better when he is not distracted by Jaden.');
  await panel(page).locator('.ai-go').click();
  await expect(panel(page).locator('.ai-plan')).toContainText('Keep Liam Johnson and Jayden Smith apart');
  await expect(panel(page).locator('.ai-note.warn')).toContainText('Not in this class: “Zed”');
  const asked = await page.evaluate(() => window.__aiCalls[0][1].content);
  expect(asked).toBe('Liam does better when he is not distracted by Jaden.');
});

test('rules applied while a chart is open reach the chart too', async ({ page }) => {
  await open(page, { prefs: { tipSeen: true } });
  await classOnHome(page);
  await page.evaluate(() => window.__cm.createNewChart());
  await bubble(page).click();
  await panel(page).locator('.ai-tool[data-v="rules"]').click();
  await panel(page).locator('.ai-input').fill('Put Mia and Ana Ruiz in the same group');
  await panel(page).locator('.ai-go').click();
  await panel(page).locator('.ai-apply').click();
  const r = await page.evaluate(() => [window.__cm.state.hardRules, window.__cm.store.landingData.classes[0].hardRules]);
  expect(r[0]).toEqual(r[1]);
  expect(r[0][0]).toMatchObject({ type: 'partners', studentA: 'Mia Chen', studentB: 'Ana Ruiz' });
});

test('Learn more: device check, turn on with progress, then Remove AI', async ({ page }) => {
  await open(page);
  await mockEngine(page);
  await page.locator('.ai-tip-more').click({ timeout: 4000 });
  const p = panel(page);
  await expect(p).toContainText('never leave this device');
  await expect(p.locator('.ai-check')).toContainText('Test GPU');
  await expect(p.locator('.ai-check')).toContainText('8 GB or more');
  await expect(p.locator('input[name=aiModel][value=small]')).toBeChecked();
  await p.locator('.ai-turnon').click();
  await expect(p).toContainText('ClassMap helper', { timeout: 5000 });
  await expect(p).toContainText('AI on · Small');
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
