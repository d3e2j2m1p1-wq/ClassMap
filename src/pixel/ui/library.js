// ═══════════════════════════════════════════════
//  Text, custom brushes and objects (stamps).
//   • Text: type, pick a font (our two pixel fonts or the device's fonts), size and colour;
//     it becomes crisp pixels you place like a paste.
//   • Brushes: made from a selection or an image; the brush and eraser can paint with them.
//   • Objects: save a selection into a collection, then stamp it into any artwork.
// ═══════════════════════════════════════════════
import { state, saveSettings, emit } from '../editor/state.js';
import * as lib from '../editor/library.js';
import { pasteBlock } from '../editor/clipboard.js';
import { pixelText, systemText, PIXEL_FONTS, SYSTEM_FONTS } from '../core/text.js';
import { openDialog, popover, promptBox, confirmBox, toast, esc, seg, toggle, range, bindControls } from './dialogs.js';
import { colorWell } from './paltools.js';
import { ICONS } from './icons.js';

const phone = () => matchMedia('(max-width: 700px)').matches;
const pickImage = fn => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) fn(f); });
  input.click();
};

// ── Text ──
const textOpts = () => (state.settings.text ||= { text: 'Hello!', font: 'wren5', size: 1, bold: false, align: 'left' });

export function makeText({ text, font, size, bold, align }, color) {
  return PIXEL_FONTS[font]
    ? pixelText(text, font, color, { scale: Math.max(1, Math.min(8, size)), align })
    : systemText(text, font, Math.max(4, Math.min(96, size)), color, { bold, align });
}

export function openText(at) {
  const o = textOpts();
  let color = [...state.settings.primary];
  const body = document.createElement('div');
  body.className = 'px-col-dialog px-text-dialog';
  const fonts = [...Object.entries(PIXEL_FONTS).map(([k, f]) => [k, f.name]), ...SYSTEM_FONTS.map(([k, n]) => [k, `${n} (this device)`])];
  const sizeRow = () => (PIXEL_FONTS[o.font] ? range('size', Math.min(8, o.size), 1, 8, 'Pixel size', '×') : range('size', Math.max(6, o.size), 6, 64, 'Size', ' px'));
  body.innerHTML = `
    <textarea class="px-text-in" rows="3" spellcheck="false" autofocus>${esc(o.text)}</textarea>
    <div class="px-text-row">
      <label class="px-field"><span>Font</span><select class="px-text-font">${fonts.map(([k, n]) => `<option value="${k}" ${k === o.font ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <div class="px-ends"><div class="px-mini-label">Colour</div><span class="w-text"></span></div>
    </div>
    <div class="px-text-size"></div>
    <div class="px-text-align">${seg('align', o.align, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']])}</div>
    <div class="px-text-bold"></div>
    <div class="px-mini-label">Preview</div><canvas class="px-text-preview"></canvas>
    <p class="px-hint">Pixel fonts stay sharp at any size. Device fonts are drawn by your browser, then every pixel is made fully on or off.</p>`;
  body.querySelector('.w-text').append(colorWell(color, c => { color = c; show(); }, 'Text colour'));
  const cv = body.querySelector('.px-text-preview');
  const show = () => {
    o.text = body.querySelector('.px-text-in').value;
    const b = makeText(o, color);
    const k = Math.max(1, Math.min(6, Math.floor(380 / b.w), Math.floor(120 / b.h)));
    cv.width = b.w * k; cv.height = b.h * k;
    const t = document.createElement('canvas'); t.width = b.w; t.height = b.h;
    t.getContext('2d').putImageData(new ImageData(b.pixels, b.w, b.h), 0, 0);
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(t, 0, 0, cv.width, cv.height);
    cv.title = `${b.w} × ${b.h} pixels`;
  };
  const controls = () => {
    body.querySelector('.px-text-size').innerHTML = sizeRow();
    body.querySelector('.px-text-bold').innerHTML = PIXEL_FONTS[o.font] ? '' : toggle('bold', o.bold, 'Bold');
    bindControls(body.querySelector('.px-text-size'), (k, v) => { o[k] = v; show(); });
    bindControls(body.querySelector('.px-text-bold'), (k, v) => { o[k] = v; show(); });
  };
  body.querySelector('.px-text-font').addEventListener('change', e => {
    o.font = e.target.value;
    o.size = PIXEL_FONTS[o.font] ? 1 : 12;
    controls(); show();
  });
  body.querySelector('.px-text-in').addEventListener('input', show);
  bindControls(body.querySelector('.px-text-align'), (k, v) => { o[k] = v; show(); });
  controls(); show();
  openDialog({
    title: 'Text', body, className: 'px-col-dlg',
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Place it', kind: 'primary', onClick: () => {
        o.text = body.querySelector('.px-text-in').value;
        if (!o.text.trim()) { toast('Type something first'); return false; }
        saveSettings();
        const b = makeText(o, color);
        pasteBlock(b.pixels, b.w, b.h, at?.x ?? null, at?.y ?? null, 'Drag the text into place, then ✓', !!at);
      },
    }],
  });
}

// ── Brushes (inside the brush / eraser options) ──
export function brushOptions(o) {
  const items = lib.list('brushes');
  if (o.tip !== 'custom') return '';
  return `<div class="px-brushes">
    <div class="px-mini-label">Your brushes</div>
    <div class="px-lib-grid">${items.map(it => `<button type="button" class="px-lib-item ${it.id === o.customId ? 'on' : ''}" data-brush="${it.id}" title="${esc(it.name)} (${it.w}×${it.h})"><img alt="${esc(it.name)}" src="${lib.thumb(it, 32)}"></button>`).join('') || '<span class="px-hint">None yet — make one from a selection or an image.</span>'}</div>
    <div class="px-set-row">
      <button type="button" class="px-btn px-btn-ghost" data-bact="sel">From the selection</button>
      <button type="button" class="px-btn px-btn-ghost" data-bact="img">From an image…</button>
      ${o.customId && items.some(i => i.id === o.customId) ? '<button type="button" class="px-btn px-btn-ghost" data-bact="del">Delete this one</button>' : ''}
    </div>
    ${toggle('brushColors', !!o.brushColors, "Use the brush's own colours (off = paint its shape in the current colour)")}
  </div>`;
}

// Click handling for the brush grid; returns true if it handled the click
export async function brushClick(e, o, rerender) {
  const b = e.target.closest('[data-brush], [data-bact]');
  if (!b) return false;
  if (b.dataset.brush) { o.customId = b.dataset.brush; saveSettings(); emit('options'); rerender(); return true; }
  const a = b.dataset.bact;
  if (a === 'sel') saveBrush(item => { o.customId = item.id; saveSettings(); rerender(); });
  if (a === 'img') pickImage(async f => {
    try {
      const blk = await lib.blockFromFile(f);
      const item = lib.add('brushes', blk, f.name.replace(/\.[^.]+$/, ''));
      if (!item) { toast('No room left to keep more brushes on this device'); return; }
      o.customId = item.id; saveSettings(); rerender();
    } catch { toast("Couldn't open that image"); }
  });
  if (a === 'del' && await confirmBox('Delete brush?', 'This brush is removed from every artwork on this device.', { ok: 'Delete', danger: true })) {
    lib.remove('brushes', o.customId); o.customId = null; saveSettings(); rerender();
  }
  return true;
}

export async function saveBrush(done) {
  const blk = lib.blockFromCanvas();
  if (blk.error) { toast(blk.error); return; }
  const name = await promptBox('New brush', `Brush ${lib.list('brushes').length + 1}`, { ok: 'Save' });
  if (!name) return;
  const item = lib.add('brushes', blk, name);
  if (!item) { toast('No room left to keep more brushes on this device'); return; }
  const t = state.settings.tools;
  for (const k of ['brush', 'eraser']) if (!t[k].customId) t[k].customId = item.id;
  saveSettings();
  toast(`Saved brush "${name}". Pick the "Custom" tip in the brush options to paint with it.`);
  done?.(item);
}

// ── Objects ──
export async function saveObject() {
  const blk = lib.blockFromCanvas();
  if (blk.error) { toast(blk.error); return; }
  const items = lib.list('objects');
  const cols = [...new Set(items.map(i => i.collection).filter(Boolean))];
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `
    <label class="px-field"><span>Name</span><input type="text" class="px-obj-name" maxlength="60" value="Object ${items.length + 1}" autofocus></label>
    <label class="px-field"><span>Collection</span><input type="text" class="px-obj-col" maxlength="40" list="px-obj-cols" value="${esc(cols[0] || 'My objects')}"></label>
    <datalist id="px-obj-cols">${cols.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <p class="px-hint">${blk.w} × ${blk.h} pixels. Objects can be stamped into any artwork on this device.</p>`;
  openDialog({
    title: 'Save as object', body, className: 'px-col-dlg',
    onOpen: ov => setTimeout(() => ov.querySelector('.px-obj-name').select(), 0),
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Save', kind: 'primary', onClick: () => {
        const name = body.querySelector('.px-obj-name').value.trim() || 'Object';
        const col = body.querySelector('.px-obj-col').value.trim() || 'My objects';
        if (!lib.add('objects', blk, name, col)) { toast('No room left to keep more objects on this device'); return false; }
        toast(`Saved "${name}" to ${col}`);
      },
    }],
  });
}

export function openObjects(anchor) {
  const el = document.createElement('div');
  el.className = 'px-opts px-objects';
  const draw = () => {
    const items = lib.list('objects');
    const groups = new Map();
    for (const it of items) { const c = it.collection || 'My objects'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
    el.innerHTML = `<div class="px-pop-title">Objects</div>
      <p class="px-hint">Tap one to stamp it, then drag it into place. Hold for more.</p>
      ${[...groups].map(([c, list]) => `<div class="px-mini-label">${esc(c)}</div><div class="px-lib-grid">${list.map(it => `<button type="button" class="px-lib-item" data-obj="${it.id}" title="${esc(it.name)} (${it.w}×${it.h})"><img alt="${esc(it.name)}" src="${lib.thumb(it, 40)}"></button>`).join('')}</div>`).join('')
        || '<p class="px-hint">No objects yet.</p>'}
      <button type="button" class="px-btn px-btn-ghost" data-oact="save">Save the selection as an object…</button>`;
  };
  draw();
  const pop = popover(anchor, el, { side: phone() ? 'top' : 'right', className: 'px-opts-pop' });
  let hold = null;
  el.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-obj]'); if (!b) return;
    hold = setTimeout(() => { hold = 'menu'; objectMenu(b, b.dataset.obj, () => { draw(); pop.place(); }); }, 450);
  });
  el.addEventListener('pointerup', () => { if (hold && hold !== 'menu') clearTimeout(hold); });
  el.addEventListener('click', e => {
    if (hold === 'menu') { hold = null; return; }
    const b = e.target.closest('[data-obj], [data-oact]'); if (!b) return;
    if (b.dataset.oact === 'save') { pop.close(); saveObject(); return; }
    const blk = lib.decode(lib.find('objects', b.dataset.obj));
    if (!blk) return;
    pop.close();
    pasteBlock(blk.pixels, blk.w, blk.h, null, null, 'Drag the object into place, then ✓');
  });
}

function objectMenu(anchor, id, redraw) {
  const it = lib.find('objects', id);
  const el = document.createElement('div');
  el.className = 'px-menu';
  el.innerHTML = `<div class="px-menu-title">${esc(it.name)}</div>
    <button type="button" data-a="rename">Rename…</button>
    <button type="button" data-a="move">Move to collection…</button>
    <button type="button" data-a="del" class="danger">Delete</button>`;
  const pop = popover(anchor, el, { side: 'bottom', className: 'px-pop-top' });
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    pop.close();
    if (a === 'rename') { const n = await promptBox('Rename object', it.name); if (n) lib.rename('objects', id, { name: n }); }
    if (a === 'move') { const n = await promptBox('Move to collection', it.collection || 'My objects', { label: 'Collection', ok: 'Move' }); if (n) lib.rename('objects', id, { collection: n }); }
    if (a === 'del' && await confirmBox('Delete object?', `"${it.name}" is removed from every artwork on this device.`, { ok: 'Delete', danger: true })) lib.remove('objects', id);
    redraw();
  });
}

export { ICONS };
