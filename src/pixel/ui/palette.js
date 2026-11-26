// ═══════════════════════════════════════════════
//  Palette panel: primary / secondary colour, the artwork's palette, and a library of palettes.
//  Tap a swatch to paint with it (tap it again to edit it); press and hold to drag it somewhere
//  else; hold and let go without moving for more (edit, secondary, new row, delete).
//  Every palette change is one undo step. With shading on, the ramp is marked and tapping a
//  colour in it flips between lightening and darkening.
// ═══════════════════════════════════════════════
import { state, setColor, swapColors, on, store } from '../editor/state.js';
import { rgbaToHex, hexToRgba, sameColor } from '../core/color.js';
import { BUILT_IN } from '../core/palettes.js';
import { ICONS } from './icons.js';
import { popover, closePopover, confirmBox, promptBox, toast, esc } from './dialogs.js';
import { openPicker } from './picker.js';
import {
  indexed, MAX_INDEXED, insertColors, deleteColors, reorderPalette, setPalette, toggleBreak, beginColorEdit,
  shading, setShading, shadeLabel, editPalette,
} from '../editor/color.js';
import { paletteTools } from './paltools.js';
import { openColorTools } from './colortools.js';

const libKey = 'pixel:palettes';
export const loadLibrary = () => { try { return JSON.parse(localStorage.getItem(libKey)) || []; } catch { return []; } };
export const saveLibrary = list => store(libKey, list);

let root, swatches, onChange, drag = null;
const phoneLayout = () => matchMedia('(max-width: 700px)').matches;

export function initPalette(el, changed) {
  root = el; onChange = changed;
  root.innerHTML = `
    <div class="px-pal-head">
      <div class="px-wells">
        <button type="button" class="px-well px-well-2" aria-label="Secondary colour (tap to swap)" title="Secondary colour — tap to swap (X)"></button>
        <button type="button" class="px-well px-well-1" aria-label="Primary colour (tap to change)" title="Primary colour — tap to change"></button>
      </div>
      <button type="button" class="px-icon-btn px-swap" aria-label="Swap colours" title="Swap colours (X)">${ICONS.swap}</button>
      <div class="px-pal-spacer"></div>
      <button type="button" class="px-icon-btn px-add" aria-label="Add colour to palette" title="Add the current colour">${ICONS.plus}</button>
      <button type="button" class="px-icon-btn px-color-tools" aria-label="Colour tools" title="Colour tools: shading, replace, adjust, outline…">${ICONS.tint}</button>
      <button type="button" class="px-icon-btn px-pal-menu" aria-label="Palette menu" title="Palettes">${ICONS.palette}</button>
    </div>
    <div class="px-pal-mode" hidden></div>
    <div class="px-swatches" role="listbox" aria-label="Palette"></div>`;
  swatches = root.querySelector('.px-swatches');
  root.querySelector('.px-well-1').addEventListener('click', () => openPicker(root, phoneLayout() ? 'top' : 'left', { onAdd: addColor }));
  root.querySelector('.px-well-2').addEventListener('click', () => swapColors());
  root.querySelector('.px-swap').addEventListener('click', () => swapColors());
  root.querySelector('.px-add').addEventListener('click', () => addColor(state.settings.primary));
  root.querySelector('.px-pal-menu').addEventListener('click', e => paletteMenu(e.currentTarget));
  root.querySelector('.px-color-tools').addEventListener('click', e => openColorTools(e.currentTarget));
  root.querySelector('.px-pal-mode').addEventListener('click', e => { if (e.target.closest('.px-badge-shade')) setShading({ dir: -shading().dir }); });
  wireSwatches();
  on('color', paintWells);
  on('sprite', render);
  on('palette', () => { render(); onChange?.(); });
  on('shading', render);
  paintWells();
}

const pal = () => state.sprite?.palette || [];
const css = c => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;

function paintWells() {
  if (!root) return;
  root.querySelector('.px-well-1').style.setProperty('--c', css(state.settings.primary));
  root.querySelector('.px-well-2').style.setProperty('--c', css(state.settings.secondary));
  swatches?.querySelectorAll('.px-sw').forEach(b => b.classList.toggle('on', !!pal()[b.dataset.i] && sameColor(pal()[b.dataset.i], state.settings.primary)));
}

// order: a preview order while dragging (old indexes)
export function render(order) {
  if (!swatches) return;
  const p = pal(), sp = state.sprite;
  const idx = Array.isArray(order) ? order : p.map((c, i) => i);
  const sh = shading(), ramp = sh.on && p[sh.a] && p[sh.b] && sh.a !== sh.b ? [Math.min(sh.a, sh.b), Math.max(sh.a, sh.b)] : null;
  const grid = state.settings.placement === 'grid' && !phoneLayout();
  const cols = state.settings.paletteCols || 8;
  const breaks = new Set(grid && !Array.isArray(order) ? sp?.paletteBreaks || [] : []);
  let html = '', col = 0;
  idx.forEach((oi, i) => {
    if (breaks.has(i) && col) { html += '<i class="px-sw-gap"></i>'.repeat(cols - col); col = 0; }
    const c = p[oi];
    const inRamp = ramp && i >= ramp[0] && i <= ramp[1];
    const towards = inRamp && (i === (sh.dir === 1 ? sh.b : sh.a));
    html += `<button type="button" class="px-sw${inRamp ? ' ramp' : ''}${towards ? ' ramp-to' : ''}" role="option" data-i="${i}" style="--c:${css(c)}" aria-label="${rgbaToHex(c)}" title="${rgbaToHex(c)}"></button>`;
    col = (col + 1) % cols;
  });
  swatches.innerHTML = html || '<p class="px-pal-empty">No colours yet. Tap + to add the current one, or load a palette.</p>';
  swatches.classList.toggle('grid', grid);
  swatches.style.setProperty('--cols', cols);
  // mode line: indexed / shading
  const mode = root.querySelector('.px-pal-mode');
  const bits = [];
  if (indexed()) bits.push(`<span class="px-badge">Indexed · ${p.length}/${MAX_INDEXED}</span>`);
  if (ramp) bits.push(`<button type="button" class="px-badge px-badge-shade" title="Tap to flip">${ICONS.tint}Shading: ${shadeLabel().toLowerCase()}</button>`);
  if (state.paletteLocked) bits.push(`<span class="px-badge px-badge-lock" title="Locked: colours can't be removed">${ICONS.lock}</span>`);
  mode.innerHTML = bits.join('');
  mode.hidden = !bits.length;
  root.querySelector('.px-color-tools').classList.toggle('on', !!ramp);
  paintWells();
}

export function addColor(c) {
  const p = pal();
  if (p.some(x => sameColor(x, c))) { toast('That colour is already in the palette'); return; }
  insertColors([c], p.length, 'Add colour');
}

// Locked palettes can't lose colours: ask to unlock first
export async function mayRemove() {
  if (!state.paletteLocked) return true;
  if (!(await confirmBox('Unlock the palette?', 'This palette is locked so no colour gets removed by accident. Unlock it to carry on?', { ok: 'Unlock' }))) return false;
  state.paletteLocked = false;
  render();
  return true;
}

// tap = use (or edit, if it's already the colour); hold = drag to reorder; hold still = menu
function wireSwatches() {
  let press = null;
  swatches.addEventListener('pointerdown', e => {
    const b = e.target.closest('.px-sw'); if (!b) return;
    e.preventDefault();
    swatches.setPointerCapture(e.pointerId);
    press = { i: Number(b.dataset.i), b, x: e.clientX, y: e.clientY, lifted: false, secondary: e.button === 2 };
    press.t = setTimeout(() => {
      press.lifted = true; b.classList.add('lifted'); navigator.vibrate?.(8);
      drag = { order: pal().map((c, i) => i), at: press.i, moved: false };
    }, 380);
  });
  swatches.addEventListener('pointermove', e => {
    if (!press) return;
    if (!press.lifted) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); press.cancelled = true; }
      return;
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.px-sw');
    if (!over || !swatches.contains(over) || over === press.b) return;
    const j = Number(over.dataset.i);
    const [k] = drag.order.splice(drag.at, 1);
    drag.order.splice(j, 0, k);
    drag.at = j; drag.moved = true;
    render(drag.order);
    press.b = swatches.querySelector(`[data-i="${j}"]`);
    press.b.classList.add('lifted');
  });
  const end = e => {
    if (!press) return;
    clearTimeout(press.t);
    const pr = press, d = drag; press = null; drag = null;
    pr.b.classList.remove('lifted');
    if (pr.cancelled) return;
    if (d?.moved) { reorderPalette(d.order); return; }
    if (pr.lifted) { render(); swatchMenu(pr.b, pr.i); return; }
    if (e.type !== 'pointerup') return;
    const c = pal()[pr.i], sh = shading();
    if (sh.on && pr.i >= Math.min(sh.a, sh.b) && pr.i <= Math.max(sh.a, sh.b) && pal()[sh.a] && pal()[sh.b]) {
      setShading({ dir: -sh.dir });
      toast(`Shading: ${shadeLabel().toLowerCase()}`);
      return;
    }
    if (!pr.secondary && sameColor(c, state.settings.primary)) { editSwatch(pr.i); return; }
    setColor(pr.secondary ? 'secondary' : 'primary', c);
  };
  swatches.addEventListener('pointerup', end);
  swatches.addEventListener('pointercancel', end);
  swatches.addEventListener('contextmenu', e => e.preventDefault());
}

// Edit swatch i with the picker. In indexed mode the art changes with it.
function editSwatch(i) {
  setColor('primary', pal()[i]);
  const session = beginColorEdit(i);
  const stop = on('color', () => session.set(state.settings.primary));
  const done = on('picker-closed', () => { stop(); done(); session.done(); });
  openPicker(root, phoneLayout() ? 'top' : 'left', { onAdd: addColor });
}

function swatchMenu(anchor, i) {
  const el = document.createElement('div');
  el.className = 'px-menu';
  const grid = state.settings.placement === 'grid';
  const isBreak = (state.sprite.paletteBreaks || []).includes(i);
  el.innerHTML = `
    <button type="button" data-a="edit">Edit colour</button>
    <button type="button" data-a="secondary">Use as secondary</button>
    ${grid && i > 0 ? `<button type="button" data-a="row">${isBreak ? 'Join the row above' : 'Start a new row here'}</button>` : ''}
    <button type="button" data-a="delete" class="danger">Delete</button>`;
  const pop = popover(anchor, el, { side: phoneLayout() ? 'top' : 'left' });
  el.addEventListener('click', async e => {
    const a = e.target.closest('button')?.dataset.a; if (!a) return;
    pop.close();
    if (a === 'secondary') setColor('secondary', pal()[i]);
    if (a === 'row') toggleBreak(i);
    if (a === 'edit') editSwatch(i);
    if (a === 'delete') {
      if (indexed() && pal().filter(c => c[3]).length <= 1) { toast('Indexed artwork needs at least one colour'); return; }
      if (!(await mayRemove())) return;
      deleteColors([i]);
      if (indexed()) toast('Pixels of that colour moved to the nearest one left');
    }
  });
}

function paletteMenu(anchor) {
  const lib = loadLibrary();
  const el = document.createElement('div');
  el.className = 'px-menu px-pal-lib';
  el.innerHTML = `
    <div class="px-pal-tools">
      <button type="button" data-a="gradient">Gradient…</button>
      <button type="button" data-a="sort">Sort…</button>
      <button type="button" data-a="reduce">Reduce…</button>
      <button type="button" data-a="fromArt">Colours from the art</button>
      <button type="button" data-a="lospec">Lospec palette…</button>
      <button type="button" data-a="import">Open a file…</button>
      <button type="button" data-a="export">Export…</button>
      <button type="button" data-a="layout">Layout…</button>
    </div>
    <button type="button" data-a="lock" class="px-menu-toggle" aria-pressed="${state.paletteLocked}">${state.paletteLocked ? ICONS.lock + 'Locked — tap to unlock' : ICONS.unlock + 'Lock (so colours can\'t be removed)'}</button>
    <hr>
    <div class="px-menu-title">Load a palette</div>
    ${BUILT_IN.map((p, i) => libRow('b' + i, p)).join('')}
    ${lib.length ? '<div class="px-menu-title">Your palettes</div>' + lib.map((p, i) => libRow('u' + i, p, true)).join('') : ''}
    <hr>
    <button type="button" data-a="save">Save this palette to your library</button>
    <button type="button" data-a="clear" class="danger">Remove every colour</button>`;
  const pop = popover(anchor, el, { side: phoneLayout() ? 'top' : 'left' });
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'del') {
      e.stopPropagation();
      const j = Number(b.dataset.k.slice(1));
      if (await confirmBox('Delete palette?', `"${lib[j].name}" will be removed from your library.`, { ok: 'Delete', danger: true })) {
        lib.splice(j, 1); saveLibrary(lib); pop.close();
      }
      return;
    }
    pop.close();
    if (paletteTools[a]) { paletteTools[a](anchor); return; }
    if (a === 'lock') { state.paletteLocked = !state.paletteLocked; render(); toast(state.paletteLocked ? 'Palette locked: colours can be added and moved, not removed' : 'Palette unlocked'); }
    if (a === 'load') {
      const src = b.dataset.k[0] === 'b' ? BUILT_IN[b.dataset.k.slice(1)] : lib[b.dataset.k.slice(1)];
      await loadColors(src.colors.map(hexToRgba).filter(Boolean), src.name);
    }
    if (a === 'save') {
      if (!pal().length) { toast('Add some colours first'); return; }
      const name = await promptBox('Save palette', state.sprite.name + ' palette', { ok: 'Save' });
      if (!name) return;
      saveToLibrary(name, pal());
      toast(`Saved "${name}"`);
    }
    if (a === 'clear') {
      if (!pal().length) return;
      if (indexed()) { toast('Indexed artwork needs a palette. Convert it to RGBA first (colour tools)'); return; }
      if (!(await mayRemove())) return;
      if (await confirmBox('Remove every colour?', 'The palette will be empty. The pixels you\'ve drawn don\'t change.', { ok: 'Remove all', danger: true })) {
        editPalette(p => { p.length = 0; }, 'Clear palette');
      }
    }
  });
}

export function saveToLibrary(name, colors) {
  const lib = loadLibrary();
  lib.push({ name, colors: colors.map(c => rgbaToHex(c)) });
  saveLibrary(lib);
}

// Replace the artwork's palette (asks first; in indexed mode the art moves to the new colours)
export async function loadColors(colors, name) {
  if (!colors.length) { toast('No colours in that palette'); return false; }
  if (indexed() && colors.length > MAX_INDEXED) toast(`Only the first ${MAX_INDEXED} colours fit an indexed palette`);
  if (pal().length) {
    let msg = indexed()
      ? `Your artwork's palette will become "${name}", and every pixel moves to its nearest colour in it. You can undo this.`
      : `Your artwork's palette will become "${name}". The pixels you've drawn don't change.`;
    if (state.paletteLocked) msg += ' (This unlocks the palette.)';
    if (!(await confirmBox('Replace the palette?', msg, { ok: 'Replace' }))) return false;
    if (state.paletteLocked) { state.paletteLocked = false; render(); }
  }
  setPalette(colors, 'Load palette');
  return true;
}

function libRow(k, p, mine) {
  const strip = p.colors.slice(0, 16).map(c => `<i style="background:${esc(c)}"></i>`).join('');
  return `<div class="px-lib-row"><button type="button" data-a="load" data-k="${k}"><span class="px-lib-name">${esc(p.name)}</span><span class="px-lib-strip">${strip}</span></button>${mine ? `<button type="button" class="px-icon-btn px-lib-del" data-a="del" data-k="${k}" aria-label="Delete ${esc(p.name)}">${ICONS.trash}</button>` : ''}</div>`;
}

export { closePopover };
