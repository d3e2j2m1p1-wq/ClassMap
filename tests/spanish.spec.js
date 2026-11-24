// Spanish interface: translated as it renders, names never touched, switch back and forth, helper in Spanish
import { test, expect } from '@playwright/test';

async function open(page, lang = 'es') {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(l => { if (!sessionStorage.getItem('set')) { localStorage.setItem('cm-lang', l); sessionStorage.setItem('set', '1'); } localStorage.setItem('cm-ai', JSON.stringify({ tipSeen: true })); }, lang);
  await page.goto('/app/');
  await page.waitForFunction(() => window.__cm && window.__classmapStarted);
  return errors;
}
async function classOnHome(page, name = 'Periodo 3') {
  await page.evaluate(n => {
    const cm = window.__cm;
    document.getElementById('newClassInput').value = n;
    cm.addLandingClass();
    const cls = cm.store.landingData.classes[0];
    // a student and a class whose names are also app words: they must stay as typed
    [['s1', 'Liam Johnson', ['IEP']], ['s2', 'Owen Park'], ['s3', 'Ana Ruiz'], ['s4', 'Ready Smith'], ['s5', 'Mia Chen', ['IEP']]]
      .forEach(([id, nm, tags]) => cls.students.push({ id, name: nm, gender: null, tags: tags || [] }));
    cm.store.activeClassId = cls.id;
    cm.saveLandingData();
    cm.showLanding();
  }, name);
}

test('Spanish: home and chart in Spanish; names as typed; English comes back', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('.landing-subtitle')).toHaveText('Tu organizador de asientos para el aula');
  await expect(page.locator('#newClassInput')).toHaveAttribute('placeholder', 'Nombre de la clase nueva...');
  await classOnHome(page, 'Present');                       // "Present" is also a button label
  await expect(page.locator('.ld-tab[data-tab=roster]')).toHaveText('👥 Lista');
  await expect(page.locator('#landingDetailClassName')).toHaveText('Present');
  await page.locator('.ld-tab[data-tab=rules]').click();
  await page.evaluate(() => window.__cm.createNewChart());
  await expect(page.locator('.tab-btn[data-panel=layout]')).toHaveText('Salón');
  await page.locator('.tab-btn[data-panel=assign]').click();
  await expect(page.locator('#assignFloatPanel .assign-float-title')).toContainText('Asignar automáticamente');
  // English again, without reloading
  await page.locator('[aria-label="Más opciones"]').click();
  await page.locator('.more-menu .lang-btn').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.tab-btn[data-panel=layout]')).toHaveText('Layout');
  await expect(page.locator('#assignFloatPanel .assign-float-title')).toContainText('Auto-Assign');
  expect(await page.evaluate(() => localStorage.getItem('cm-lang'))).toBe('en');
  expect(errors).toEqual([]);
});

test('Spanish: patterns only match what they should', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  const r = await page.evaluate(() => {
    const t = window.__cm.translate;
    return [t('3 students'), t('1 student'), t('Show walkways'), t('Remove Liam Johnson'), t('Remove everything'), t('Ready Smith'), t('Ready'),
      t('12 seats · 9 students'), t('Keep Liam Johnson and Owen Park apart'), t('2 students tagged “IEP”: Liam Johnson and Mia Chen.')];
  });
  expect(r).toEqual(['3 estudiantes', '1 estudiante', 'Mostrar pasillos', 'Quitar a Liam Johnson', 'Remove everything', 'Ready Smith', 'Ready' /* a student is called Ready */,
    '12 asientos · 9 estudiantes', 'Separa a Liam Johnson y Owen Park', '2 estudiantes con la etiqueta “IEP”: Liam Johnson y Mia Chen.']);
});

test('Spanish: the helper understands Spanish requests and searches help in Spanish', async ({ page }) => {
  await open(page);
  await classOnHome(page);
  await page.locator('.ai-bubble').click();
  const ask = async t => { await page.locator('.ai-ask-in').fill(t); await page.locator('.ai-send').click(); return page.locator('.ai-bot').last(); };
  let r = await ask('Separa a Liam y Owen');
  await expect(r.locator('.ai-plan')).toContainText('Separa a Liam Johnson y Owen Park');
  await r.locator('.ai-apply').click();
  expect(await page.evaluate(() => window.__cm.store.landingData.classes[0].hardRules)).toEqual([{ type: 'separate', studentA: 'Liam Johnson', studentB: 'Owen Park' }]);
  r = await ask('¿Quién tiene IEP?');
  await expect(r).toContainText('2 estudiantes con la etiqueta “IEP”: Liam Johnson y Mia Chen.');
  r = await ask('haz una clase llamada Periodo 5 con Jo, Sam y Lee');
  await expect(r.locator('.ai-plan')).toContainText('Crear la clase Periodo 5');
  await r.locator('.ai-apply').click();
  expect(await page.evaluate(() => window.__cm.store.landingData.classes.find(c => c.name === 'Periodo 5').students.map(s => s.name))).toEqual(['Jo', 'Sam', 'Lee']);
  r = await ask('¿Cómo paso lista?');
  await expect(r.locator('.ai-hit').first()).toContainText('¿Cómo paso lista?');
  r = await ask('haz grupos de 3');
  await expect(page.locator('.tools-view .group-card').first()).toBeVisible();
  await expect(page.locator('.tools-view .tools-tab[data-t=groups]')).toContainText('Grupos');
});

test('Spanish follows the browser’s language the first time; the 🌐 button switches', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'es-MX' });
  const page = await ctx.newPage();
  await page.goto('/app/');
  await page.waitForFunction(() => window.__classmapStarted);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('.landing-header .lang-btn')).toHaveText('🌐 English');
  await page.locator('.landing-header .lang-btn').click();
  await expect(page.locator('.landing-subtitle')).toHaveText('Your classroom seating organizer');
  await expect(page.locator('.landing-header .lang-btn')).toHaveText('🌐 Español');
  await ctx.close();
});

// ── Google Classroom import (mocked Google) ──
test('Google Classroom: pick classes, see the plan, import; existing classes only gain new students; Undo', async ({ page }) => {
  await page.addInitScript(() => {
    window.__scopes = [];
    window.google = { accounts: { oauth2: {
      initTokenClient: cfg => { window.__scopes.push(cfg.scope); return { requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'gc', expires_in: 3600 }), 10) }; },
      revoke: (t, cb) => cb && cb(),
    } } };
  });
  const asked = [];
  await page.route('https://classroom.googleapis.com/**', route => {
    const url = route.request().url();
    asked.push(url.replace('https://classroom.googleapis.com/v1', ''));
    if (route.request().headers().authorization !== 'Bearer gc') return route.fulfill({ status: 401, body: '' });
    if (/\/courses\?/.test(url)) return route.fulfill({ json: { courses: [{ id: 'c1', name: 'Biology', section: 'Period 2' }, { id: 'c2', name: 'Period 3' }, { id: 'c3', name: 'Empty club' }] } });
    const p = (first, last) => ({ profile: { name: { givenName: first, familyName: last, fullName: `${first} ${last}` } } });
    if (url.includes('/courses/c1/students')) {
      // two pages
      if (!url.includes('pageToken')) return route.fulfill({ json: { students: [p('Ana', 'Ruiz'), p('Ben', 'Ortiz')], nextPageToken: 'n2' } });
      return route.fulfill({ json: { students: [p('Cara', 'Diaz')] } });
    }
    if (url.includes('/courses/c2/students')) return route.fulfill({ json: { students: [p('Liam', 'Johnson'), p('Zoe', 'Hart')] } });
    if (url.includes('/courses/c3/students')) return route.fulfill({ json: {} });
    return route.fulfill({ status: 404, body: '' });
  });
  await open(page, 'en');
  await classOnHome(page, 'Period 3');      // already has Liam Johnson (with an IEP tag)
  await page.locator('.add-class-form + .gc-import-btn').click();
  const D = page.locator('.gc-dialog');
  await expect(D.locator('.gc-course')).toHaveCount(3);
  await expect(D.locator('.gc-course', { hasText: 'Biology — Period 2' })).toContainText('3 students');
  await expect(D.locator('.gc-course', { hasText: 'Period 3' })).toContainText('already in ClassMap');
  await expect(D.locator('.gc-course', { hasText: 'Empty club' }).locator('input')).toBeDisabled();
  await D.locator('input[value=initial]').check();
  await D.locator('.gc-next').click();
  await expect(D.locator('.gc-plan')).toContainText('Create Biology — Period 2 with 3 students');
  await expect(D.locator('.gc-plan')).toContainText('Add 2 new students to Period 3');   // "Liam J." is new in initial style
  await D.locator('.gc-back').click();
  await D.locator('input[value=full]').check();
  await D.locator('.gc-next').click();
  await expect(D.locator('.gc-plan')).toContainText('Add 1 new student to Period 3');
  await D.locator('.gc-apply').click();
  const classes = await page.evaluate(() => window.__cm.store.landingData.classes.map(c => [c.name, c.students.map(s => s.name)]));
  expect(classes).toEqual([
    ['Period 3', ['Liam Johnson', 'Owen Park', 'Ana Ruiz', 'Ready Smith', 'Mia Chen', 'Zoe Hart']],
    ['Biology — Period 2', ['Ana Ruiz', 'Ben Ortiz', 'Cara Diaz']],
  ]);
  // Liam keeps his tag
  expect(await page.evaluate(() => window.__cm.store.landingData.classes[0].students[0].tags)).toEqual(['IEP']);
  expect(await page.evaluate(() => window.__scopes[0])).toBe('https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.rosters.readonly');
  expect(asked[0]).toBe('/courses?teacherId=me&courseStates=ACTIVE&pageSize=100');
  await page.locator('.cm-undo-toast .cm-undo-btn').last().click();
  expect(await page.evaluate(() => window.__cm.store.landingData.classes.map(c => c.students.length))).toEqual([5]);
});
