// ═══════════════════════════════════════════════
//  Palette tools: gradient generator, sorting, reducing, colours from the art, Lospec import,
//  palette files in and out (.gpl, .hex, .pal, images, .aseprite), and the panel layout.
//  Also the small colour well used by the colour dialogs.
// ═══════════════════════════════════════════════
import { state, saveSettings } from '../editor/state.js';
import * as C from '../core/colorops.js';
import { rgbaToHex, hexToRgba, sameColor } from '../core/color.js';
import { readAseprite } from '../core/aseprite.js';
import { openDialog, popover, toast, esc, seg, toggle, range, bindControls } from './dialogs.js';
import { indexed, MAX_INDEXED, insertColors, reorderPalette, artColors, editPalette, remapArt } from '../editor/color.js';
import { loadColors, saveToLibrary, mayRemove, render as renderPalette } from './palette.js';
import { download, safeName } from './export.js';

const pal = () => state.sprite.palette;
export const css = c => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
export const strip = (colors, max = 64) => `<div class="px-strip">${colors.slice(0, max).map(c => `<i style="--c:${css(c)}" title="${rgbaToHex(c)}"></i>`).join('')}${colors.length > max ? `<span>+${colors.length - max}</span>` : ''}</div>`;

// Where new colours go: just after the swatch that matches the primary colour, else at the end
const insertAt = () => { const i = pal().findIndex(c => sameColor(c, state.settings.primary)); return i < 0 ? pal().length : i + 1; };

// A colour button for dialogs: tap to choose from the palette, the current colours, or a hex code
export function colorWell(initial, onChange, label = 'Colour') {
  let c = [...initial];
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'px-cwell';
  const paint = () => { b.style.setProperty('--c', css(c)); b.title = rgbaToHex(c); b.setAttribute('aria-label', `${label}: ${rgbaToHex(c)}`); };
  const set = x => { c = [...x]; paint(); onChange(c); };
  paint();
  b.addEventListener('click', () => {
    const el = document.createElement('div');
    el.className = 'px-well-pick';
    const cur = [state.settings.primary, state.settings.secondary, [0, 0, 0, 0]];
    el.innerHTML = `
      <div class="px-mini-label">Current</div>
      <div class="px-well-grid">${cur.map((x, i) => `<button type="button" class="px-sw" data-c="${rgbaToHex(x, true)}" style="--c:${css(x)}" aria-label="${['Primary', 'Secondary', 'Transparent'][i]}" title="${['Primary', 'Secondary', 'Transparent'][i]}"></button>`).join('')}</div>
      ${pal().length ? `<div class="px-mini-label">Palette</div><div class="px-well-grid">${pal().map(x => `<button type="button" class="px-sw" data-c="${rgbaToHex(x, true)}" style="--c:${css(x)}" aria-label="${rgbaToHex(x)}" title="${rgbaToHex(x)}"></button>`).join('')}</div>` : ''}
      <label class="px-hex"><span>Hex</span><input type="text" maxlength="9" spellcheck="false" autocomplete="off" value="${rgbaToHex(c)}"></label>`;
    const pop = popover(b, el, { side: 'bottom', className: 'px-pop-top' });
    el.addEventListener('click', e => { const s = e.target.closest('[data-c]'); if (s) { set(hexToRgba(s.dataset.c)); pop.close(); } });
    el.querySelector('input').addEventListener('input', e => { const x = hexToRgba(e.target.value); if (x) set(x); });
  });
  return b;
}

// ── gradient generator ──
function gradientDialog() {
  const o = { a: [...state.settings.primary], b: [...state.settings.secondary], steps: 6, space: 'rgb', long: false, exclude: false };
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `
    <div class="px-ends"><div class="px-mini-label">From</div><span class="px-end-a"></span><div class="px-mini-label">To</div><span class="px-end-b"></span></div>
    ${range('steps', o.steps, 2, 32, 'Colours (with the ends)')}
    <div class="px-mini-label">Blend in</div>${seg('space', o.space, [['rgb', 'RGB'], ['hsv', 'HSV (through the hues)']])}
    <div class="px-hue-dir">${seg('long', 'short', [['short', 'Short way round'], ['long', 'Long way round']])}</div>
    ${toggle('exclude', o.exclude, 'Leave out the two end colours')}
    <div class="px-mini-label">Preview</div><div class="px-preview-strip"></div>`;
  body.querySelector('.px-end-a').append(colorWell(o.a, c => { o.a = c; show(); }, 'From'));
  body.querySelector('.px-end-b').append(colorWell(o.b, c => { o.b = c; show(); }, 'To'));
  const out = () => C.gradient(o.a, o.b, o.steps, { space: o.space, long: o.long, exclude: o.exclude });
  const show = () => {
    body.querySelector('.px-preview-strip').innerHTML = strip(out());
    body.querySelector('.px-hue-dir').hidden = o.space !== 'hsv';
  };
  bindControls(body, (k, v) => { o[k] = k === 'long' ? v === 'long' : v; show(); });
  show();
  openDialog({
    title: 'Gradient', body, className: 'px-col-dlg',
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Add to palette', kind: 'primary', onClick: () => {
        const cols = out();
        if (!cols.length) { toast('No colours to add'); return false; }
        if (!insertColors(cols, insertAt(), 'Add gradient')) return false;
        toast(`Added ${cols.length} colour${cols.length === 1 ? '' : 's'}`);
      },
    }],
  });
}

// ── sort ──
const SORT_NAMES = { hue: 'Hue', saturation: 'Saturation', lightness: 'Lightness', value: 'Value', red: 'Red', green: 'Green', blue: 'Blue', alpha: 'Opacity' };
function sortDialog() {
  if (pal().length < 2) { toast('Nothing to sort yet'); return; }
  const o = { by: 'hue', desc: 'asc' };
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `
    <label class="px-field"><span>Sort by</span><select class="px-sort-by">${C.SORTS.map(k => `<option value="${k}">${SORT_NAMES[k]}</option>`).join('')}</select></label>
    ${seg('desc', o.desc, [['asc', 'Low to high'], ['desc', 'High to low']])}
    <div class="px-mini-label">Preview</div><div class="px-preview-strip"></div>
    ${indexed() ? '<p class="px-hint">Your art stays exactly the same: only the order of the swatches changes.</p>' : ''}`;
  const order = () => C.sortOrder(pal(), o.by, o.desc === 'desc');
  const show = () => { body.querySelector('.px-preview-strip').innerHTML = strip(order().map(i => pal()[i]), 256); };
  body.querySelector('.px-sort-by').addEventListener('change', e => { o.by = e.target.value; show(); });
  bindControls(body, (k, v) => { o[k] = v; show(); });
  show();
  openDialog({ title: 'Sort the palette', body, className: 'px-col-dlg', actions: [{ label: 'Cancel', value: null }, { label: 'Sort', kind: 'primary', onClick: () => { reorderPalette(order(), 'Sort palette'); } }] });
}

// ── reduce ──
function reduceDialog() {
  const p = pal();
  if (p.length < 2) { toast('Nothing to reduce yet'); return; }
  const used = new Map(artColors().map(c => [c.color.join(), c.count]));
  const o = { n: Math.max(1, Math.min(p.length - 1, Math.ceil(p.length / 2))), method: 'median', unused: false, remap: indexed() };
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `
    ${range('n', o.n, 1, p.length - 1, 'Colours to keep')}
    <div class="px-mini-label">How</div>${seg('method', o.method, [['median', 'Median cut'], ['kmeans', 'k-means']])}
    ${toggle('unused', o.unused, 'First remove colours the art doesn\'t use')}
    ${indexed() ? '<p class="px-hint">Indexed artwork: pixels move to the nearest colour that\'s left.</p>' : toggle('remap', o.remap, 'Also move the art\'s pixels to the new colours')}
    <div class="px-mini-label">Result</div><div class="px-preview-strip"></div>`;
  const result = () => {
    let src = p;
    if (o.unused) src = p.filter(c => used.has(c.join()));
    return C.reducePalette(src, o.n, { method: o.method, weights: src.map(c => used.get(c.join()) || 0) });
  };
  const show = () => { const r = result(); body.querySelector('.px-preview-strip').innerHTML = strip(r, 256) + `<p class="px-hint">${p.length} → ${r.length} colours</p>`; };
  bindControls(body, (k, v) => { o[k] = v; show(); });
  show();
  openDialog({
    title: 'Reduce the palette', body, className: 'px-col-dlg',
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Reduce', kind: 'primary', onClick: async () => {
        if (!(await mayRemove())) return false;
        const r = result();
        if (o.remap && !indexed()) remapArt(r, { replace: true });
        else editPalette(q => { q.splice(0, q.length, ...r); }, 'Reduce palette');
      },
    }],
  });
}

// ── colours from the art ──
function fromArt() {
  const have = new Set(pal().map(c => c.join()));
  const add = artColors().map(c => c.color).filter(c => !have.has(c.join()));
  if (!add.length) { toast('Every colour in the art is already in the palette'); return; }
  const room = indexed() ? MAX_INDEXED - pal().length : Infinity;
  if (room <= 0) { toast(`The palette is full (${MAX_INDEXED} colours)`); return; }
  const list = add.slice(0, room);
  if (insertColors(list, pal().length, 'Colours from the art')) toast(`Added ${list.length} colour${list.length === 1 ? '' : 's'} from the art${list.length < add.length ? ` (${add.length - list.length} didn't fit)` : ''}`);
}

// ── bringing palettes in ──

// After reading colours from somewhere: preview, then add / replace, optionally saving to the library
function importPreview(found, source) {
  const { name, colors, author } = found;
  if (!colors.length) { toast('No colours found there'); return; }
  const o = { save: false };
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `
    <div><div class="px-imp-name">${esc(name)}</div><p class="px-hint">${colors.length} colour${colors.length === 1 ? '' : 's'}${author ? ` · by ${esc(author)}` : ''}${source ? ` · ${esc(source)}` : ''}</p></div>
    ${strip(colors, 256)}
    ${toggle('save', o.save, 'Also save it to your palettes')}`;
  bindControls(body, (k, v) => { o[k] = v; });
  const keep = () => { if (o.save) { saveToLibrary(name, colors); toast(`Saved "${name}" to your palettes`); } };
  openDialog({
    title: 'Palette', body, className: 'px-col-dlg',
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Add to this palette', onClick: () => { const have = new Set(pal().map(c => c.join())); const add = colors.filter(c => !have.has(c.join())); if (add.length && !insertColors(add, pal().length, 'Add palette')) return false; keep(); } },
      { label: 'Use this palette', kind: 'primary', onClick: async () => { if (!(await loadColors(colors, name))) return false; keep(); } },
    ],
  });
}

// Lospec's public palette JSON: straight from Lospec, or through classmap.dev if the browser
// isn't allowed to (only the palette's name goes; nothing about you)
export async function fetchLospec(slug) {
  for (const url of [`https://lospec.com/palette-list/${slug}.json`, `/api/lospec/${slug}`]) {
    let res;
    try { res = await fetch(url, { credentials: 'omit' }); } catch { continue; }
    if (res.status === 404) throw new Error(`Lospec has no palette called "${slug}".`);
    if (!res.ok) continue;
    try { return C.fromLospecJSON(await res.json()); } catch { continue; }
  }
  throw new Error("Couldn't reach Lospec right now. Paste the colour codes below, or open a palette file instead.");
}

function lospecDialog() {
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `
    <label class="px-field"><span>Lospec palette name or link</span><input type="text" class="px-lospec-in" placeholder="e.g. sweetie-16 or lospec.com/palette-list/…" spellcheck="false" autocomplete="off" autofocus></label>
    <p class="px-hint">Find palettes at lospec.com/palette-list. The palette's colours are downloaded; nothing about you is sent.</p>
    <p class="px-lospec-msg px-hint" role="status"></p>
    <details class="px-paste"><summary>Or paste colour codes</summary>
      <textarea class="px-paste-in" rows="4" placeholder="#1a1c2c #5d275d #b13e53 …" spellcheck="false"></textarea></details>`;
  const msg = body.querySelector('.px-lospec-msg');
  openDialog({
    title: 'Lospec palette', body, className: 'px-col-dlg',
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Open a file…', onClick: () => { importFile(); } },
      {
        label: 'Get palette', kind: 'primary', onClick: async () => {
          const pasted = body.querySelector('.px-paste-in').value.trim();
          const raw = body.querySelector('.px-lospec-in').value;
          if (!raw.trim() && pasted) {
            const found = C.parsePalette(pasted, 'Pasted palette');
            if (!found.colors.length) { msg.textContent = 'No colour codes found in that text.'; return false; }
            importPreview(found, 'pasted');
            return;
          }
          const slug = C.lospecSlug(raw);
          if (!slug) { msg.textContent = 'Type a palette name like "sweetie-16", or paste its Lospec link.'; return false; }
          msg.textContent = 'Getting the palette…';
          try {
            const found = await fetchLospec(slug);
            importPreview(found, 'Lospec');
          } catch (err) {
            msg.textContent = err.message;
            body.querySelector('.px-paste').open = true;
            return false;
          }
        },
      },
    ],
  });
}

// .gpl / .hex / .pal / .txt, an image (its most used colours), or an .aseprite file's palette
async function readPaletteFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '') || 'Imported palette';
  if (/\.(aseprite|ase)$/i.test(file.name)) {
    const { sprite } = await readAseprite(new Uint8Array(await file.arrayBuffer()));
    let colors = sprite.palette.filter(c => c[3] > 0);
    if (!colors.length) colors = C.colorCounts(sprite.cels.map(c => c.pixels)).slice(0, 255).map(c => c.color);
    return { name, colors };
  }
  if (file.type.startsWith('image/') || /\.(png|gif|jpe?g|webp|bmp)$/i.test(file.name)) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(bmp, 0, 0, w, h);
    return { name, colors: C.colorCounts([g.getImageData(0, 0, w, h).data]).slice(0, 255).map(x => x.color) };
  }
  return C.parsePalette(await file.text(), file.name);
}

function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gpl,.hex,.pal,.txt,.aseprite,.ase,image/*';
  input.addEventListener('change', async () => {
    const f = input.files?.[0]; if (!f) return;
    try { importPreview(await readPaletteFile(f), f.name); } catch { toast("Couldn't read colours from that file"); }
  });
  input.click();
}

// ── palettes out ──
function exportMenu(anchor) {
  if (!pal().length) { toast('Add some colours first'); return; }
  const el = document.createElement('div');
  el.className = 'px-menu';
  el.innerHTML = `
    <div class="px-menu-title">Export the palette</div>
    <button type="button" data-f="gpl">GIMP palette (.gpl)</button>
    <button type="button" data-f="hex">Hex list (.hex)</button>
    <button type="button" data-f="pal">JASC palette (.pal)</button>
    <button type="button" data-f="png">Swatch strip (.png)</button>`;
  const pop = popover(anchor, el, { side: matchMedia('(max-width: 700px)').matches ? 'top' : 'left' });
  el.addEventListener('click', async e => {
    const f = e.target.closest('[data-f]')?.dataset.f; if (!f) return;
    pop.close();
    const name = safeName(state.sprite.name + ' palette'), p = pal();
    if (f === 'gpl') download(new Blob([C.writeGPL(state.sprite.name, p)], { type: 'text/plain' }), name + '.gpl');
    if (f === 'hex') download(new Blob([C.writeHEX(p)], { type: 'text/plain' }), name + '.hex');
    if (f === 'pal') download(new Blob([C.writePAL(p)], { type: 'text/plain' }), name + '.pal');
    if (f === 'png') {
      const c = document.createElement('canvas'); c.width = p.length; c.height = 1;
      const img = new ImageData(p.length, 1); p.forEach((x, i) => img.data.set(x, i * 4));
      c.getContext('2d').putImageData(img, 0, 0);
      download(await new Promise(r => c.toBlob(r, 'image/png')), name + '.png');
    }
  });
}

// ── panel layout ──
function layoutMenu(anchor) {
  const s = state.settings;
  const el = document.createElement('div');
  el.className = 'px-opts';
  el.innerHTML = `
    <div class="px-pop-title">Palette layout</div>
    ${seg('placement', s.placement, [['packed', 'Packed'], ['grid', 'Grid']])}
    <p class="px-hint">Grid keeps a fixed number of columns, and any swatch can start a new row (hold it), so colour ramps line up.</p>
    <div class="px-grid-cols">${range('paletteCols', s.paletteCols, 4, 16, 'Columns')}</div>`;
  const pop = popover(anchor, el, { side: matchMedia('(max-width: 700px)').matches ? 'top' : 'left' });
  const show = () => { el.querySelector('.px-grid-cols').hidden = s.placement !== 'grid'; pop.place(); };
  bindControls(el, (k, v) => { s[k] = v; saveSettings(); show(); renderPalette(); });
  show();
}

export const paletteTools = {
  gradient: gradientDialog, sort: sortDialog, reduce: reduceDialog, fromArt, lospec: lospecDialog,
  import: importFile, export: exportMenu, layout: layoutMenu,
};
