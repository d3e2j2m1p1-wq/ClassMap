// ═══════════════════════════════════════════════
//  Looks: themes and left-hand mode.
//  Every colour of the interface comes from CSS custom properties, so a theme is just a set
//  of them (plus an optional font). Built in: ClassMap (follows the day / night switch) and
//  High contrast. Edit any colour and it becomes "Custom"; themes go in and out as small
//  .json files so people can share them.
// ═══════════════════════════════════════════════
import { state, saveSettings, emit } from '../editor/state.js';
import { download } from './export.js';
import { toast, esc, seg, toggle, bindControls } from './dialogs.js';

export const TOKENS = [
  ['--bg', 'Background'], ['--surface', 'Panels'], ['--surface2', 'Panels (shade)'], ['--surface3', 'Panels (deeper)'],
  ['--border', 'Lines (soft)'], ['--border2', 'Lines'], ['--line', 'Outlines (ink)'], ['--pop', 'Paper shadow'],
  ['--text', 'Text'], ['--text2', 'Text (soft)'], ['--text3', 'Labels'],
  ['--top', 'Header band'], ['--coral', 'Main buttons'], ['--blue', 'Selected things'], ['--rose', 'Warnings'], ['--dot', 'Background dots'],
];
export const FONTS = [["'Nunito', system-ui, sans-serif", 'Nunito (ClassMap)'], ['system-ui, sans-serif', 'This device'], ["ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif", 'Rounded'], ['Georgia, serif', 'Serif'], ['ui-monospace, Menlo, Consolas, monospace', 'Monospace']];

// High contrast: black and white with a bright yellow focus colour
const CONTRAST = {
  '--bg': '#000000', '--surface': '#000000', '--surface2': '#111111', '--surface3': '#222222', '--border': '#FFFFFF', '--border2': '#FFFFFF',
  '--line': '#FFFFFF', '--pop': '#FFE500', '--text': '#FFFFFF', '--text2': '#FFFFFF', '--text3': '#FFE500', '--top': '#000000',
  '--coral': '#FFE500', '--blue': '#00D7FF', '--rose': '#FF6B6B', '--dot': '#333333',
};

const theme = () => (state.settings.theme ||= { preset: 'classmap', vars: {}, font: FONTS[0][0] });

export function applyTheme() {
  const t = theme(), b = document.body;
  for (const [k] of TOKENS) b.style.removeProperty(k);
  b.classList.toggle('px-contrast', t.preset === 'contrast');
  const vars = t.preset === 'contrast' ? CONTRAST : t.preset === 'custom' ? t.vars : {};
  for (const [k, v] of Object.entries(vars)) if (TOKENS.some(x => x[0] === k) && /^#[0-9a-f]{6,8}$/i.test(v)) b.style.setProperty(k, v);
  if (t.font && t.font !== FONTS[0][0]) b.style.setProperty('--font', t.font); else b.style.removeProperty('--font');
  b.classList.toggle('px-lefty', !!state.settings.lefty);
  emit('theme');
}

// The colour a token has right now (whatever set it)
const current = k => {
  const v = getComputedStyle(document.body).getPropertyValue(k).trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return '#000000';
  const [r, g, b] = m[1].split(',').map(x => parseFloat(x));
  return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
};

export const lookPane = () => {
  const t = theme(), s = state.settings;
  return `
    <div class="px-mini-label">Theme</div>
    ${seg('preset', t.preset, [['classmap', 'ClassMap'], ['contrast', 'High contrast'], ['custom', 'Custom']])}
    <p class="px-hint">ClassMap follows the day / night switch at the top. Change any colour below to make your own.</p>
    <div class="px-theme-grid">${TOKENS.map(([k, label]) => `<label class="px-theme-row"><input type="color" data-var="${k}" value="${current(k)}"><span>${esc(label)}</span></label>`).join('')}</div>
    <label class="px-field"><span>Font</span><select class="px-theme-font">${FONTS.map(([v, l]) => `<option value="${esc(v)}" ${v === t.font ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <div class="px-set-row">
      <button type="button" class="px-btn px-btn-ghost" data-theme="export">Export theme…</button>
      <button type="button" class="px-btn px-btn-ghost" data-theme="import">Import theme…</button>
    </div>
    <div class="px-mini-label">Hands</div>
    ${toggle('lefty', !!s.lefty, 'Left-hand mode (tools on the right, palette on the left)')}`;
};

// Wire the Look pane; redraw() rebuilds it
export function wireLook(root, redraw) {
  const t = theme();
  bindControls(root, (k, v) => {
    if (k === 'preset') {
      if (v === 'custom' && !Object.keys(t.vars).length) t.vars = Object.fromEntries(TOKENS.map(([x]) => [x, current(x)]));
      t.preset = v;
    }
    if (k === 'lefty') state.settings.lefty = v;
    saveSettings(); applyTheme(); redraw();
  });
  root.querySelectorAll('[data-var]').forEach(inp => inp.addEventListener('input', () => {
    if (t.preset !== 'custom') { t.vars = Object.fromEntries(TOKENS.map(([x]) => [x, current(x)])); t.preset = 'custom'; root.querySelectorAll('.px-seg[data-name="preset"] button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === 'custom'))); }
    t.vars[inp.dataset.var] = inp.value;
    saveSettings(); applyTheme();
  }));
  root.querySelector('.px-theme-font').addEventListener('change', e => { t.font = e.target.value; saveSettings(); applyTheme(); });
  root.addEventListener('click', e => {
    const a = e.target.closest('[data-theme]')?.dataset.theme; if (!a) return;
    if (a === 'export') {
      const vars = Object.fromEntries(TOKENS.map(([x]) => [x, current(x)]));
      download(new Blob([JSON.stringify({ kind: 'classmap-pixel-theme', v: 1, name: 'My theme', vars, font: t.font }, null, 2)], { type: 'application/json' }), 'classmap-pixel-theme.json');
    }
    if (a === 'import') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        try {
          const o = JSON.parse(await input.files[0].text());
          if (o?.kind !== 'classmap-pixel-theme' || typeof o.vars !== 'object') throw new Error();
          t.preset = 'custom';
          t.vars = Object.fromEntries(Object.entries(o.vars).filter(([k, v]) => TOKENS.some(x => x[0] === k) && /^#[0-9a-f]{6,8}$/i.test(v)));
          if (FONTS.some(f => f[0] === o.font)) t.font = o.font;
          saveSettings(); applyTheme(); redraw();
          toast(`Theme "${String(o.name || 'Imported').slice(0, 40)}" in use`);
        } catch { toast("That isn't a ClassMap Pixel theme file"); }
      });
      input.click();
    }
  });
}
