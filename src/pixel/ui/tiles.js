// ═══════════════════════════════════════════════
//  Tiles panel (shown while a tilemap layer is selected): the tileset's tiles, Tiles / Pixels
//  mode, flips for the next placement, and tileset actions. Plus the dialogs for new tilemap
//  layers and turning a regular layer into tiles.
// ═══════════════════════════════════════════════
import { state, on, emit } from '../editor/state.js';
import * as TM from '../editor/tilemap.js';
import { FLIP_X, FLIP_Y, FLIP_D, tilesheet, tilesFromSheet } from '../core/tiles.js';
import { openDialog, popover, promptBox, confirmBox, toast, esc, seg, bindControls } from './dialogs.js';
import { download, safeName } from './export.js';
import { ICONS } from './icons.js';

let root = null, view = null;
const phone = () => matchMedia('(max-width: 700px)').matches;

export function initTiles(rightPanel, v) {
  view = v;
  root = document.createElement('section');
  root.className = 'px-tiles paper';
  root.setAttribute('aria-label', 'Tiles');
  rightPanel.insertBefore(root, rightPanel.querySelector('.px-layers'));
  for (const ev of ['layers', 'tiles', 'sprite', 'frames']) on(ev, render);
  root.addEventListener('click', onClick);
  view.tileGrid = () => { const n = TM.activeTilemap(), s = TM.tilesetOf(n); return s ? { tw: s.tw, th: s.th, strong: root.classList.contains('peek') } : null; };
  render();
}

function thumb(t, tw, th) {
  const c = document.createElement('canvas'); c.width = tw; c.height = th;
  c.getContext('2d').putImageData(new ImageData(t, tw, th), 0, 0);
  return c.toDataURL();
}

export function render() {
  if (!root) return;
  const n = TM.activeTilemap(), set = TM.tilesetOf(n);
  root.hidden = !set;
  if (!set) return;
  const u = TM.tileUI();
  if (!set.tiles[u.pick]) u.pick = Math.min(Math.max(1, u.pick), set.tiles.length - 1);
  const sq = set.tw === set.th;
  root.innerHTML = `
    <div class="px-tiles-head">
      <button type="button" class="px-tiles-name" data-t="peek" title="Hold to show the tile grid strongly">${esc(set.name)} <span>${set.tw}×${set.th}</span></button>
      <button type="button" class="px-icon-btn" data-t="add" aria-label="New empty tile" title="New empty tile">${ICONS.plus}</button>
      <button type="button" class="px-icon-btn" data-t="menu" aria-label="Tileset menu" title="Tileset menu">${ICONS.more}</button>
    </div>
    <div class="px-tiles-mode">${seg('mode', u.mode, [['tiles', 'Place tiles'], ['pixels', 'Draw pixels']])}</div>
    <div class="px-tiles-grid">${set.tiles.map((t, i) => i === 0
      ? `<button type="button" class="px-tile empty ${u.pick === 0 ? 'on' : ''}" data-i="0" title="Empty (erases cells)" aria-label="Empty tile">${ICONS.close}</button>`
      : `<button type="button" class="px-tile ${u.pick === i ? 'on' : ''}" data-i="${i}" title="Tile ${i}" aria-label="Tile ${i}"><img alt="" src="${thumb(t, set.tw, set.th)}"></button>`).join('')}</div>
    <div class="px-tiles-flips">
      <button type="button" class="px-icon-btn ${u.flags & FLIP_X ? 'on' : ''}" data-f="${FLIP_X}" title="Flip ↔ when placing" aria-label="Flip left-right">↔</button>
      <button type="button" class="px-icon-btn ${u.flags & FLIP_Y ? 'on' : ''}" data-f="${FLIP_Y}" title="Flip ↕ when placing" aria-label="Flip up-down">↕</button>
      ${sq ? `<button type="button" class="px-icon-btn ${u.flags & FLIP_D ? 'on' : ''}" data-f="${FLIP_D}" title="Turn sideways (swap x and y) when placing" aria-label="Swap x and y">⤡</button>` : ''}
      <span class="px-hint">${u.mode === 'tiles' ? 'Brush places, eraser clears, bucket fills, dropper picks.' : 'Drawing changes the tile everywhere it is used.'}</span>
    </div>`;
  bindControls(root.querySelector('.px-tiles-mode'), (k, v) => { TM.tileUI().mode = v; render(); emit('tool'); });
  const peek = root.querySelector('[data-t="peek"]');
  const on_ = () => { root.classList.add('peek'); view.request(); }, off = () => { root.classList.remove('peek'); view.request(); };
  peek.addEventListener('pointerdown', on_); peek.addEventListener('pointerup', off); peek.addEventListener('pointerleave', off);
}

async function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const u = TM.tileUI();
  if (b.dataset.i) { u.pick = Number(b.dataset.i); if (u.pick === 0 && state.settings.tool !== 'eraser') toast('The empty tile clears cells'); render(); return; }
  if (b.dataset.f) { u.flags = (u.flags ^ Number(b.dataset.f)) >>> 0; render(); return; }
  if (b.dataset.t === 'add') { TM.addTile(); return; }
  if (b.dataset.t === 'menu') menu(b);
}

function menu(anchor) {
  const set = TM.tilesetOf(TM.activeTilemap());
  const el = document.createElement('div');
  el.className = 'px-menu';
  el.innerHTML = `
    <button type="button" data-a="dup">Duplicate this tile</button>
    <button type="button" data-a="del" class="danger">Delete this tile</button>
    <hr>
    <button type="button" data-a="dedupe">Merge identical tiles</button>
    <button type="button" data-a="unused">Remove unused tiles</button>
    <hr>
    <button type="button" data-a="export">Export tiles (PNG)</button>
    <button type="button" data-a="import">Add tiles from a picture…</button>
    <button type="button" data-a="rename">Rename tileset…</button>
    <button type="button" data-a="regular">Turn this layer into a regular layer</button>`;
  const pop = popover(anchor, el, { side: phone() ? 'top' : 'left' });
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    pop.close();
    if (a === 'dup') TM.duplicateTile();
    if (a === 'del' && await confirmBox('Delete this tile?', 'Cells using it become empty. You can undo this.', { ok: 'Delete', danger: true })) TM.deleteTile();
    if (a === 'dedupe') TM.tidy(false);
    if (a === 'unused') TM.tidy(true);
    if (a === 'rename') { const n = await promptBox('Rename tileset', set.name); if (n) TM.renameSet(n); }
    if (a === 'regular') TM.convertToRegular(state.layerId);
    if (a === 'export') {
      const s = tilesheet(set, 8);
      const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
      c.getContext('2d').putImageData(new ImageData(s.pixels, s.w, s.h), 0, 0);
      download(await new Promise(r => c.toBlob(r, 'image/png')), safeName(set.name) + '.png');
    }
    if (a === 'import') {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
      input.addEventListener('change', async () => {
        try {
          const bmp = await createImageBitmap(input.files[0]);
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
          const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
          const tiles = tilesFromSheet(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, set.tw, set.th);
          if (!tiles.length) { toast(`No ${set.tw}×${set.th} tiles found in that picture`); return; }
          TM.importTiles(tiles); toast(`Added ${tiles.length} tile${tiles.length === 1 ? '' : 's'}`);
        } catch { toast("Couldn't open that picture"); }
      });
      input.click();
    }
  });
}

// New tilemap layer, or turn the current regular layer into tiles
export function tilemapDialog(convert = false) {
  const sp = state.sprite, sets = sp.tilesets || [];
  const o = { size: 16, w: 16, h: 16, set: 'new' };
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  const draw = () => {
    body.innerHTML = `
      ${!convert && sets.length ? `<label class="px-field"><span>Tileset</span><select class="px-tm-set"><option value="new">A new tileset</option>${sets.map(s => `<option value="${s.id}" ${o.set === s.id ? 'selected' : ''}>${esc(s.name)} (${s.tw}×${s.th})</option>`).join('')}</select></label>` : ''}
      ${o.set === 'new' ? `<div class="px-mini-label">Tile size</div>${seg('size', o.size, [[8, '8×8'], [16, '16×16'], [32, '32×32'], [0, 'Other']])}
        ${o.size === 0 ? `<div class="px-wh"><label class="px-field"><span>Width</span><input type="number" class="px-tm-w" min="2" max="256" value="${o.w}"></label><span class="px-wh-x">×</span><label class="px-field"><span>Height</span><input type="number" class="px-tm-h" min="2" max="256" value="${o.h}"></label></div>` : ''}` : ''}
      <p class="px-hint">${convert ? 'The layer is cut into tiles on every frame; identical pieces become one tile, so editing it changes them all.' : 'Paint with tiles from the tiles panel. Drawing pixels into an empty cell makes a new tile.'}</p>`;
    bindControls(body, (k, v) => { o[k] = v; if (v) { o.w = o.h = v; } draw(); });
    body.querySelector('.px-tm-set')?.addEventListener('change', e => { o.set = e.target.value; draw(); });
  };
  draw();
  openDialog({
    title: convert ? 'Turn into tiles' : 'New tilemap layer', body, className: 'px-col-dlg',
    actions: [{ label: 'Cancel', value: null }, {
      label: convert ? 'Make tiles' : 'Add layer', kind: 'primary', onClick: () => {
        const w = o.size || Number(body.querySelector('.px-tm-w')?.value) || o.w, h = o.size || Number(body.querySelector('.px-tm-h')?.value) || o.h;
        if (!(w >= 2 && h >= 2 && w <= 256 && h <= 256)) { toast('Tiles can be 2 to 256 pixels each way'); return false; }
        if (convert) TM.convertToTilemap(state.layerId, w, h);
        else TM.newTilemapLayer({ tw: w, th: h, tilesetId: o.set === 'new' ? null : o.set });
      },
    }],
  });
}
