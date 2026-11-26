// ═══════════════════════════════════════════════
//  Layers panel: top of the stack first. Tap to pick a layer (Ctrl / ⌘ / Shift adds more),
//  tap it again for its settings, double-tap the name to rename, press and drag to reorder
//  (drop onto a group to put it inside). The eye shows / hides, the lock stops edits.
// ═══════════════════════════════════════════════
import { state, on, emit } from '../editor/state.js';
import { displayRows, find, isGroup } from '../core/layers.js';
import { BLEND_MODES } from '../core/compose.js';
import * as doc from '../editor/doc.js';
import { copyLayers, pasteLayers } from '../editor/clipboard.js';
import { ICONS } from './icons.js';
import { popover, promptBox, esc, toast } from './dialogs.js';

let root, list, view, importImage;
const thumbCanvas = document.createElement('canvas');

export function initLayers(el, v, opts) {
  root = el; view = v; importImage = opts.importImage;
  root.innerHTML = `
    <div class="px-lay-head">
      <span class="px-lay-title">Layers</span>
      <div class="px-pal-spacer"></div>
      <button type="button" class="px-icon-btn px-lay-add" aria-label="New layer" title="New layer">${ICONS.layerAdd}</button>
      <button type="button" class="px-icon-btn px-lay-group" aria-label="Group the selected layers" title="Group the selected layers">${ICONS.folder}</button>
      <button type="button" class="px-icon-btn px-lay-menu" aria-label="Layer menu" title="More">${ICONS.more}</button>
    </div>
    <div class="px-lay-list" role="list"></div>`;
  list = root.querySelector('.px-lay-list');
  root.querySelector('.px-lay-add').addEventListener('click', () => doc.addLayer());
  root.querySelector('.px-lay-group').addEventListener('click', () => doc.addGroup());
  root.querySelector('.px-lay-menu').addEventListener('click', e => layerMenu(e.currentTarget));
  wire();
  on('layers', render); on('sprite', render);
  let t = 0;
  on('changed', () => { clearTimeout(t); t = setTimeout(paintThumbs, 350); });
}

export function render() {
  const sp = state.sprite;
  if (!sp || !list) return;
  list.innerHTML = displayRows(sp).map(({ node: n, depth }) => {
    const g = isGroup(n), active = n.id === state.layerId, sel = state.selectedLayers.has(n.id);
    const badge = [n.blend && n.blend !== 'normal' ? BLEND_MODES.find(b => b[0] === n.blend)?.[1] : '', (n.opacity ?? 255) < 255 ? Math.round(n.opacity / 2.55) + '%' : '', n.kind === 'reference' ? 'Ref' : ''].filter(Boolean).join(' · ');
    return `<div class="px-row${active ? ' active' : ''}${sel ? ' sel' : ''}${g ? ' group' : ''}${n.visible ? '' : ' hidden-layer'}" role="listitem" data-id="${n.id}" style="--d:${depth}">
      <button type="button" class="px-row-btn px-row-eye" aria-label="${n.visible ? 'Hide' : 'Show'} ${esc(n.name)}">${n.visible ? ICONS.eye : ICONS.eyeOff}</button>
      ${g ? `<button type="button" class="px-row-btn px-row-caret${n.collapsed ? '' : ' open'}" aria-label="${n.collapsed ? 'Open' : 'Close'} group">${ICONS.chevron}</button><span class="px-row-folder">${ICONS.folder}</span>`
          : `<canvas class="px-row-thumb" width="30" height="30"></canvas>`}
      <span class="px-row-text"><span class="px-row-name">${esc(n.name)}</span>${badge ? `<span class="px-row-badge">${esc(badge)}</span>` : ''}</span>
      <button type="button" class="px-row-btn px-row-lock${n.locked ? ' on' : ''}" aria-label="${n.locked ? 'Unlock' : 'Lock'} ${esc(n.name)}">${n.locked ? ICONS.lock : ICONS.unlock}</button>
    </div>`;
  }).join('');
  paintThumbs();
}

function paintThumbs() {
  const sp = state.sprite;
  if (!sp || !list) return;
  thumbCanvas.width = sp.width; thumbCanvas.height = sp.height;
  const g = thumbCanvas.getContext('2d');
  list.querySelectorAll('.px-row:not(.group)').forEach(row => {
    const cel = sp.cels.find(c => c.layerId === row.dataset.id && c.frameId === state.frameId);
    const cv = row.querySelector('canvas'); if (!cel || !cv) return;
    g.putImageData(new ImageData(cel.pixels, sp.width, sp.height), 0, 0);
    const t = cv.getContext('2d'), k = Math.min(30 / sp.width, 30 / sp.height);
    t.clearRect(0, 0, 30, 30);
    t.imageSmoothingEnabled = k < 1;
    t.drawImage(thumbCanvas, (30 - sp.width * k) / 2, (30 - sp.height * k) / 2, sp.width * k, sp.height * k);
  });
}

function wire() {
  let press = null;
  list.addEventListener('click', e => {
    const row = e.target.closest('.px-row'); if (!row) return;
    const id = row.dataset.id, n = find(state.sprite, id)?.node; if (!n) return;
    if (e.target.closest('.px-row-eye')) { doc.setLayerProp(id, 'visible', !n.visible); return; }
    if (e.target.closest('.px-row-lock')) { doc.setLayerProp(id, 'locked', !n.locked); return; }
    if (e.target.closest('.px-row-caret')) { doc.setLayerProp(id, 'collapsed', !n.collapsed); return; }
    if (press?.dragged) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      if (state.selectedLayers.has(id) && state.selectedLayers.size > 1) { state.selectedLayers.delete(id); if (state.layerId === id) state.layerId = [...state.selectedLayers].at(-1); emit('layers'); }
      else doc.setActive(id, true);
      return;
    }
    if (state.layerId === id && state.selectedLayers.size === 1) { props(row, id); return; }
    doc.setActive(id);
  });
  list.addEventListener('dblclick', async e => {
    const row = e.target.closest('.px-row'); if (!row || !e.target.closest('.px-row-text')) return;
    const n = find(state.sprite, row.dataset.id)?.node;
    const name = await promptBox('Rename layer', n.name);
    if (name) doc.setLayerProp(n.id, 'name', name);
  });

  // press and hold (or drag a little with a mouse) to reorder
  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('.px-row');
    if (!row || e.target.closest('.px-row-btn')) return;
    press = { id: row.dataset.id, y: e.clientY, x: e.clientX, live: false, dragged: false, pid: e.pointerId };
    press.t = setTimeout(() => { if (press) { press.live = true; row.classList.add('lifted'); try { list.setPointerCapture(press.pid); } catch { /* */ } } }, e.pointerType === 'mouse' ? 0 : 320);
  });
  list.addEventListener('pointermove', e => {
    if (!press) return;
    if (!press.live) { if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); if (e.pointerType !== 'mouse') press = null; } return; }
    if (Math.abs(e.clientY - press.y) < 5 && !press.dragged) return;
    press.dragged = true;
    e.preventDefault();
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.px-row');
    list.querySelectorAll('.drop-above, .drop-below, .drop-into').forEach(r => r.classList.remove('drop-above', 'drop-below', 'drop-into'));
    if (!over || over.dataset.id === press.id) { press.target = null; return; }
    const r = over.getBoundingClientRect(), k = (e.clientY - r.top) / r.height;
    const where = over.classList.contains('group') && k > 0.3 && k < 0.7 ? 'into' : k < 0.5 ? 'above' : 'below';
    over.classList.add('drop-' + where);
    press.target = { id: over.dataset.id, where };
  });
  const end = () => {
    if (!press) return;
    clearTimeout(press.t);
    const p = press;
    list.querySelectorAll('.lifted, .drop-above, .drop-below, .drop-into').forEach(r => r.classList.remove('lifted', 'drop-above', 'drop-below', 'drop-into'));
    if (p.dragged && p.target) doc.moveNode(p.id, p.target.id, p.target.where);
    setTimeout(() => { press = null; }, 0);
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

// A layer's settings: name, opacity, blend mode and actions
function props(anchor, id) {
  const n = find(state.sprite, id)?.node;
  const el = document.createElement('div');
  el.className = 'px-opts';
  const op = Math.round((n.opacity ?? 255) / 2.55);
  el.innerHTML = `<div class="px-pop-title">${isGroup(n) ? 'Group' : n.kind === 'reference' ? 'Reference layer' : 'Layer'}</div>
    <label class="px-field"><span>Name</span><input type="text" class="px-lp-name" value="${esc(n.name)}" maxlength="60"></label>
    <label class="px-range"><span>Opacity</span><input type="range" class="px-lp-op" min="0" max="100" value="${op}"><output>${op}%</output></label>
    <label class="px-field"><span>Blend mode</span><select class="px-lp-blend">${BLEND_MODES.map(([v, l]) => `<option value="${v}" ${v === (n.blend || 'normal') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="px-lp-actions">
      <button type="button" class="px-btn px-btn-ghost" data-a="dup">Duplicate</button>
      ${isGroup(n) ? '' : '<button type="button" class="px-btn px-btn-ghost" data-a="merge">Merge down</button>'}
      ${n.kind === 'reference' ? '<button type="button" class="px-btn px-btn-ghost" data-a="raster">Rasterize</button>' : ''}
      <button type="button" class="px-btn px-btn-danger" data-a="del">Delete</button>
    </div>`;
  const name = el.querySelector('.px-lp-name');
  name.addEventListener('change', () => { const v = name.value.trim(); if (v) doc.setLayerProp(id, 'name', v); });
  const r = el.querySelector('.px-lp-op'), before = n.opacity ?? 255;
  r.addEventListener('input', () => { n.opacity = Math.round(r.value * 2.55); r.nextElementSibling.textContent = r.value + '%'; view.recompose(); });
  r.addEventListener('change', () => { const v = Math.round(r.value * 2.55); n.opacity = before; doc.setLayerProp(id, 'opacity', v); });
  el.querySelector('.px-lp-blend').addEventListener('change', e => doc.setLayerProp(id, 'blend', e.target.value));
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    pop.close();
    if (a === 'dup') doc.duplicateLayers();
    if (a === 'merge') doc.mergeDown();
    if (a === 'raster') doc.rasterize(id);
    if (a === 'del') doc.deleteLayers();
  });
  const pop = popover(anchor, el, { side: 'left', className: 'px-opts-pop' });
}

function layerMenu(anchor) {
  const m = document.createElement('div');
  m.className = 'px-menu';
  const n = find(state.sprite, state.layerId)?.node;
  m.innerHTML = `
    <button type="button" data-a="add">New layer</button>
    <button type="button" data-a="group">Group selected layers</button>
    <button type="button" data-a="dup">Duplicate</button>
    <button type="button" data-a="merge">Merge down</button>
    <button type="button" data-a="flatten">Flatten visible layers</button>
    <hr>
    <button type="button" data-a="copy">Copy layers</button>
    <button type="button" data-a="cut">Cut layers</button>
    <button type="button" data-a="paste">Paste layers</button>
    <hr>
    <button type="button" data-a="ref">Reference layer from an image…</button>
    ${n?.kind === 'reference' ? '<button type="button" data-a="raster">Rasterize reference layer</button>' : ''}
    <button type="button" data-a="del" class="danger">Delete</button>`;
  const pop = popover(anchor, m, { side: 'left' });
  m.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    pop.close();
    ({
      add: () => doc.addLayer(), group: () => doc.addGroup(), dup: () => doc.duplicateLayers(), merge: () => doc.mergeDown(),
      flatten: () => doc.flattenVisible(), copy: () => copyLayers(false), cut: () => copyLayers(true), paste: () => pasteLayers(),
      ref: () => importImage('reference'), raster: () => doc.rasterize(state.layerId), del: () => doc.deleteLayers(),
    })[a]?.();
  });
}

export { toast };
