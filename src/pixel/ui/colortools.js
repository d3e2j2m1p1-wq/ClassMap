// ═══════════════════════════════════════════════
//  Colour tools menu: shading, colour replace, adjust (HSV / RGBA), levels, outline,
//  anti-aliasing, remap to a palette, and the colour mode (RGBA ↔ indexed).
//  The pixel tools preview live on the canvas while their dialog is open; Apply makes them one
//  undo step, Cancel puts everything back. With a selection they only touch what's selected.
// ═══════════════════════════════════════════════
import { state } from '../editor/state.js';
import * as C from '../core/colorops.js';
import { hexToRgba } from '../core/color.js';
import { BUILT_IN } from '../core/palettes.js';
import { openDialog, popover, confirmBox, toast, esc, seg, toggle, range, bindControls } from './dialogs.js';
import { ICONS } from './icons.js';
import {
  indexed, MAX_INDEXED, SCOPES, previewOp, convertToIndexed, convertToRGBA, artColors, shading, setShading, shadeLabel,
} from '../editor/color.js';
import { colorWell, strip, css } from './paltools.js';
import { loadLibrary } from './palette.js';
import { openPost } from './effects.js';

const pal = () => state.sprite.palette;
const phone = () => matchMedia('(max-width: 700px)').matches;

export function openColorTools(anchor) {
  const sh = shading();
  const el = document.createElement('div');
  el.className = 'px-menu';
  el.innerHTML = `
    <button type="button" data-a="shading" class="px-menu-toggle" aria-pressed="${sh.on}">${ICONS.tint}Shading${sh.on ? ' — on' : '…'}</button>
    <button type="button" data-a="post" class="px-menu-toggle" aria-pressed="${!!state.sprite.post?.length}">${ICONS.magic}Picture effects (shadow, glow, CRT…)</button>
    <hr>
    <div class="px-menu-title">Change the art's colours</div>
    <button type="button" data-a="replace">Replace a colour…</button>
    <button type="button" data-a="adjust">Adjust (hue, saturation, value, RGBA)…</button>
    <button type="button" data-a="levels">Levels…</button>
    <button type="button" data-a="outline">Outline…</button>
    <button type="button" data-a="aa">Anti-alias…</button>
    <button type="button" data-a="remap">Remap to a palette…</button>
    <hr>
    <div class="px-menu-title">Colour mode: ${indexed() ? 'Indexed' : 'RGBA'}</div>
    <button type="button" data-a="mode">${indexed() ? 'Convert to RGBA…' : 'Convert to indexed…'}</button>`;
  const pop = popover(anchor, el, { side: phone() ? 'top' : 'left' });
  el.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a; if (!a) return;
    pop.close();
    ({ post: openPost, shading: () => shadingPanel(anchor), replace: replaceDialog, adjust: adjustDialog, levels: levelsDialog, outline: outlineDialog, aa: aaDialog, remap: remapDialog, mode: openColorMode })[a]?.();
  });
}

// ── shading ──
function shadingPanel(anchor) {
  const p = pal();
  if (p.length < 2) { toast('Shading needs a palette with at least two colours'); return; }
  let picking = null;                 // 'a' after the first tap of a new ramp
  const el = document.createElement('div');
  el.className = 'px-opts px-shade-pop';
  const draw = () => {
    const s = shading(), lo = Math.min(s.a, s.b), hi = Math.max(s.a, s.b);
    el.innerHTML = `
      <div class="px-pop-title">Shading</div>
      <label class="px-toggle"><input type="checkbox" class="px-shade-on" ${s.on ? 'checked' : ''}><span class="px-switch"></span>Shade with the brush, line, shape and bucket</label>
      <p class="px-hint">${picking ? 'Now tap the other end of the ramp.' : 'Tap the first colour of a ramp, then the last. Drawing over a ramp colour moves it one step along; other colours stay as they are.'}</p>
      <div class="px-well-grid px-shade-grid">${p.map((c, i) => `<button type="button" class="px-sw${!picking && i >= lo && i <= hi && p[s.a] && p[s.b] ? ' ramp' : ''}${picking && i === s.a ? ' on' : ''}" data-i="${i}" style="--c:${css(c)}" aria-label="Swatch ${i + 1}"></button>`).join('')}</div>
      ${seg('dir', String(s.dir), [['1', 'Towards the last'], ['-1', 'Towards the first']])}
      <p class="px-hint px-shade-label">${p[s.a] && p[s.b] && s.a !== s.b ? `Right now this will <b>${shadeLabel().toLowerCase()}</b>. Tap a ramp colour in the palette to flip.` : ''}</p>`;
    el.querySelector('.px-shade-on').addEventListener('change', e => { setShading({ on: e.target.checked }); draw(); });
    el.querySelectorAll('.px-seg button').forEach(b => b.addEventListener('click', () => { setShading({ dir: Number(b.dataset.v) }); draw(); }));
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('.px-shade-grid .px-sw'); if (!b) return;
    const i = Number(b.dataset.i);
    if (!picking) { setShading({ a: i, b: i }); picking = 'b'; }
    else { if (i === shading().a) return; setShading({ b: i, on: true }); picking = null; }
    draw();
  });
  draw();
  popover(anchor, el, { side: phone() ? 'top' : 'left' });
}

// ── the pixel tools: one dialog shape, live preview ──
function toolDialog({ title, controls, run, ok = 'Apply', label, needsColor }) {
  const o = { scope: state.selectedLayers.size > 1 ? 'layers' : 'cel' };
  const session = previewOp(o.scope);
  let current = session;
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  const { html, wells = [], values } = controls();
  Object.assign(o, values);
  body.innerHTML = `${html}
    <div class="px-mini-label">Apply to</div>${seg('scope', o.scope, SCOPES)}
    ${state.selection ? '<p class="px-hint">Only inside the selection.</p>' : ''}
    ${indexed() ? '<p class="px-hint">Indexed artwork: new colours become the nearest palette colour.</p>' : ''}`;
  for (const [sel, key, name] of wells) body.querySelector(sel).append(colorWell(o[key], c => { o[key] = c; go(); }, name));
  let t = 0;
  const go = () => { cancelAnimationFrame(t); t = requestAnimationFrame(() => current.run((px, W, H, mask) => run(px, W, H, mask, o))); };
  bindControls(body, (k, v) => {
    if (k === 'scope') { current.cancel(); current = previewOp(v); o.scope = v; go(); return; }
    o[k] = v; go();
  });
  go();
  let done = false;
  return openDialog({
    title, body, className: 'px-col-dlg px-tool-dlg',
    actions: [{ label: 'Cancel', value: null }, {
      label: ok, kind: 'primary', onClick: () => {
        cancelAnimationFrame(t);
        current.run((px, W, H, mask) => run(px, W, H, mask, o));
        if (!current.count) toast('Nothing to change there (the layer may be locked or a reference)');
        else if (!current.apply(label || title)) toast('Nothing changed');
        done = true;
      },
    }],
  }).then(v => { if (!done) { cancelAnimationFrame(t); current.cancel(); } return v; });
}

function replaceDialog() {
  toolDialog({
    title: 'Replace a colour', ok: 'Replace', label: 'Replace colour',
    controls: () => ({
      html: `<div class="px-ends"><div class="px-mini-label">Replace</div><span class="w-from"></span><div class="px-mini-label">With</div><span class="w-to"></span></div>
        ${range('tolerance', 0, 0, 100, 'Also close colours (tolerance)')}`,
      wells: [['.w-from', 'from', 'Replace'], ['.w-to', 'to', 'With']],
      values: { from: [...state.settings.primary], to: [...state.settings.secondary], tolerance: 0 },
    }),
    run: (px, W, H, mask, o) => C.replaceColor(px, o.from, o.to, { tolerance: o.tolerance, mask }),
  });
}

function adjustDialog() {
  toolDialog({
    title: 'Adjust colours', label: 'Adjust colours',
    controls: () => ({
      html: `${range('h', 0, -180, 180, 'Hue', '°')}${range('s', 0, -100, 100, 'Saturation', '%')}${range('v', 0, -100, 100, 'Value', '%')}
        <details class="px-more"><summary>Red, green, blue, opacity</summary>${range('r', 0, -255, 255, 'Red')}${range('g', 0, -255, 255, 'Green')}${range('b', 0, -255, 255, 'Blue')}${range('a', 0, -255, 255, 'Opacity')}</details>`,
      values: { h: 0, s: 0, v: 0, r: 0, g: 0, b: 0, a: 0 },
    }),
    run: (px, W, H, mask, o) => C.adjustColors(px, o, mask),
  });
}

function levelsDialog() {
  toolDialog({
    title: 'Levels', label: 'Levels',
    controls: () => ({
      html: `${seg('channel', 'all', [['all', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['a', 'Opacity']])}
        <div class="px-mini-label">Input</div>${range('inLo', 0, 0, 254, 'Darkest')}${range('inHi', 255, 1, 255, 'Brightest')}${range('gamma', 100, 10, 300, 'Midtones', '%')}
        <div class="px-mini-label">Output</div>${range('outLo', 0, 0, 255, 'Darkest')}${range('outHi', 255, 0, 255, 'Brightest')}`,
      values: { channel: 'all', inLo: 0, inHi: 255, gamma: 100, outLo: 0, outHi: 255 },
    }),
    run: (px, W, H, mask, o) => C.applyLevels(px, { ...o, inHi: Math.max(o.inHi, o.inLo + 1), gamma: o.gamma / 100 }, mask),
  });
}

function outlineDialog() {
  toolDialog({
    title: 'Outline', label: 'Outline',
    controls: () => ({
      html: `<div class="px-ends"><div class="px-mini-label">Colour</div><span class="w-col"></span></div>
        ${seg('inside', 'out', [['out', 'Outside'], ['in', 'Inside']])}
        ${seg('eight', 'four', [['four', 'Sides only'], ['eight', 'Sides and corners']])}`,
      wells: [['.w-col', 'color', 'Outline colour']],
      values: { color: [...state.settings.primary], inside: 'out', eight: 'four' },
    }),
    run: (px, W, H, mask, o) => C.outlinePixels(px, W, H, o.color, { inside: o.inside === 'in', eight: o.eight === 'eight', mask }),
  });
}

function aaDialog() {
  toolDialog({
    title: 'Anti-alias', label: 'Anti-alias',
    controls: () => ({
      html: `<p class="px-hint">Softens stair-step edges by filling each step's inside corner with an in-between colour. Straight edges stay crisp.</p>
        ${range('strength', 50, 10, 90, 'Strength', '%')}
        ${toggle('overEmpty', true, 'Also soften edges against empty pixels (see-through)')}`,
      values: { strength: 50, overEmpty: true },
    }),
    run: (px, W, H, mask, o) => C.antiAlias(px, W, H, { strength: o.strength / 100, overEmpty: o.overEmpty, mask }),
  });
}

// Remap: every colour → nearest in a chosen palette (the artwork's own, a built-in, or yours)
function remapDialog() {
  const lib = loadLibrary();
  const sources = [['own', "This artwork's palette", pal()], ...BUILT_IN.map((p, i) => ['b' + i, p.name, p.colors.map(hexToRgba)]), ...lib.map((p, i) => ['u' + i, p.name, p.colors.map(hexToRgba).filter(Boolean)])];
  let target = sources[0][2];
  const sp = state.sprite, before = sp.palette.map(c => [...c]);
  const o = { dither: false, replace: indexed() };
  toolDialog({
    title: 'Remap to a palette', ok: 'Remap', label: 'Remap colours',
    controls: () => ({
      html: `<label class="px-field"><span>Palette</span><select class="px-remap-src">${sources.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></label>
        <div class="px-remap-strip"></div>
        ${toggle('dither', false, 'Dither (a checker pattern for in-between colours)')}
        ${indexed() ? '<p class="px-hint">Indexed artwork: the chosen palette becomes the artwork\'s palette.</p>' : toggle('replace', false, 'Make it this artwork\'s palette too')}`,
      values: o,
    }),
    run: (px, W, H, mask, opts) => {
      const t = target.filter(c => c[3] > 0).length ? target : before;
      sp.palette = opts.replace || indexed() ? t.map(c => [...c]) : before.map(c => [...c]);
      return C.snapToPalette(px, t, { dither: opts.dither, width: W, mask });
    },
  }).then(v => { if (v === null) { sp.palette = before; } });
  const body = document.querySelector('.px-tool-dlg');
  const sel = body.querySelector('.px-remap-src');
  const show = () => { body.querySelector('.px-remap-strip').innerHTML = strip(target, 64); };
  sel.addEventListener('change', () => { target = sources.find(s => s[0] === sel.value)[2]; show(); body.querySelector('[data-name="dither"]').dispatchEvent(new Event('change')); });
  show();
}

// ── colour mode ──
export async function openColorMode() {
  if (indexed()) {
    if (await confirmBox('Convert to RGBA?', 'Every pixel keeps its colour exactly, and you can paint any colour again (not just the palette). You can undo this.', { ok: 'Convert' })) {
      convertToRGBA(); toast('Now in RGBA colour mode');
    }
    return;
  }
  const used = artColors().length, have = pal().filter(c => c[3] > 0).length;
  const o = { buildFromArt: true, dither: false };
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `
    <p>In indexed mode every pixel is one of the palette's colours: edit a palette colour and the art changes with it. You can only paint with palette colours.</p>
    <p class="px-hint">The art uses ${used} colour${used === 1 ? '' : 's'}; the palette has ${have}. Indexed palettes hold up to ${MAX_INDEXED}.</p>
    ${toggle('buildFromArt', o.buildFromArt, "Add the art's colours to the palette first")}
    <p class="px-hint px-build-note"></p>
    ${toggle('dither', o.dither, 'Dither colours that have to change')}`;
  const note = () => {
    const n = body.querySelector('.px-build-note');
    if (o.buildFromArt) n.textContent = used + have <= MAX_INDEXED ? 'Nothing will change colour.' : `The art has too many colours, so it gets the ${MAX_INDEXED} that represent it best.`;
    else n.textContent = have ? 'Colours not in the palette change to the nearest one.' : 'The palette is empty, so it will be made from the art.';
  };
  bindControls(body, (k, v) => { o[k] = v; note(); });
  note();
  openDialog({
    title: 'Convert to indexed', body, className: 'px-col-dlg',
    actions: [{ label: 'Cancel', value: null }, { label: 'Convert', kind: 'primary', onClick: () => { convertToIndexed(o); toast('Now in indexed colour mode'); } }],
  });
}
