// ═══════════════════════════════════════════════
//  Pictures out: thumbnails for the gallery, and the Export dialog —
//  PNG (one frame), GIF, APNG, animated WebP, sprite sheet + JSON, and .aseprite.
//  Everything is scaled up with crisp pixels (nearest neighbour).
// ═══════════════════════════════════════════════
import { compositeFrame, contentBounds } from '../core/sprite.js';
import { composeFrame } from '../core/compose.js';
import { encodeGIF } from '../core/gif.js';
import { encodeAPNG } from '../core/apng.js';
import { encodeWebP, canEncodeWebP } from '../core/webp.js';
import { buildSheet, sheetJSON } from '../core/sheet.js';
import { writeAseprite } from '../core/aseprite.js';
import { leafLayers } from '../core/layers.js';
import { exportSequence } from '../editor/anim.js';
import { state } from '../editor/state.js';
import { openDialog, toast, esc, seg, toggle } from './dialogs.js';
import { ICONS } from './icons.js';

const MAX_OUT = 8192, MAX_ANIM = 4096;

// The artwork (all visible layers) of one frame drawn at `scale`, optionally cropped to `crop`
export function renderToCanvas(sprite, scale = 1, crop = null, frameId) {
  const W = sprite.width, H = sprite.height;
  const px = frameId ? composeFrame(sprite, frameId) : compositeFrame(sprite, state.sprite === sprite ? state.frameId : sprite.frames[0].id);
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  src.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
  const c = crop || { x: 0, y: 0, w: W, h: H };
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.w * scale)); out.height = Math.max(1, Math.round(c.h * scale));
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  return out;
}

export function thumbnail(sprite, max = 160) {
  const big = Math.max(sprite.width, sprite.height);
  const scale = big <= max ? Math.max(1, Math.floor(max / big)) : max / big;
  return renderToCanvas(sprite, scale, null, sprite.frames[0].id).toDataURL('image/png');
}

export const safeName = s => (s || 'artwork').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'artwork';

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  (window.__pxDownload || (x => x.click()))(a, blob);    // the hook is for tests
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

const toBlob = canvas => new Promise(r => canvas.toBlob(r, 'image/png'));

// Nearest-neighbour enlarge of an RGBA image by a whole number
export function scalePixels(px, w, h, s) {
  if (s === 1) return px;
  const out = new Uint8ClampedArray(w * s * h * s * 4), o32 = new Uint32Array(out.buffer), i32 = new Uint32Array(px.buffer, px.byteOffset, w * h);
  for (let y = 0; y < h * s; y++) { const sy = (y / s) | 0; for (let x = 0; x < w * s; x++) o32[y * w * s + x] = i32[sy * w + ((x / s) | 0)]; }
  return out;
}

// The frames an export uses: a range (everything, the current frame or a tag) and a direction
function frameList(sp, { range, direction, scale }) {
  const fr = sp.frames, cur = fr.findIndex(f => f.id === state.frameId);
  const tag = sp.tags.find(t => t.id === range);
  const [from, to] = range === 'current' ? [cur, cur] : tag ? [tag.from, tag.to] : [0, fr.length - 1];
  const seq = exportSequence(from, to, direction);
  const memo = new Map();
  return seq.map((i, k) => {
    if (!memo.has(i)) memo.set(i, scalePixels(composeFrame(sp, fr[i].id), sp.width, sp.height, scale));
    return { pixels: memo.get(i), delayMs: fr[i].durationMs, name: `${safeName(sp.name)} ${k}.png`, index: i };
  });
}

const TABS = [['png', 'PNG'], ['gif', 'GIF'], ['apng', 'APNG'], ['webp', 'WebP'], ['sheet', 'Sprite sheet'], ['ase', 'Aseprite']];

export function openExport(sprite) {
  const animated = sprite.frames.length > 1;
  const big = Math.max(sprite.width, sprite.height);
  const scales = [1, 2, 4, 8, 10, 20, 40];
  const o = {
    tab: animated ? 'gif' : 'png',
    scale: Math.min(...scales.filter(s => big * s >= 256), 40) || 1,
    trim: false, range: 'all', direction: 'forward', loop: 0, layout: 'packed', cols: 4, border: 0, spacing: 0, padding: 0, json: 'hash',
    name: safeName(sprite.name),
  };
  const webp = canEncodeWebP();
  const body = document.createElement('div');
  body.className = 'px-export';

  const rangeRow = () => `<div class="px-mini-label">Frames</div>
    <select class="px-ex-range">
      <option value="all" ${o.range === 'all' ? 'selected' : ''}>All ${sprite.frames.length} frames</option>
      <option value="current" ${o.range === 'current' ? 'selected' : ''}>Only the current frame</option>
      ${sprite.tags.map(t => `<option value="${t.id}" ${o.range === t.id ? 'selected' : ''}>Tag: ${esc(t.name)} (${t.to - t.from + 1})</option>`).join('')}
    </select>
    ${seg('direction', o.direction, [['forward', 'Forward'], ['reverse', 'Reverse'], ['pingpong', 'Ping-pong']])}`;
  const maxFor = () => (o.tab === 'png' ? MAX_OUT : MAX_ANIM);
  const scaleRow = () => `<div class="px-mini-label">Size</div>
    <div class="px-seg px-ex-scales">${scales.map(s => `<button type="button" data-s="${s}" aria-checked="${s === o.scale}" ${big * s > maxFor() ? 'disabled' : ''}>${s}×</button>`).join('')}</div>
    <p class="px-ex-size"></p>`;
  const loopRow = () => `<div class="px-mini-label">Loop</div>${seg('loop', o.loop, [[0, 'Forever'], [1, 'Once'], [3, '3 times']])}`;
  const panes = {
    png: () => `${scaleRow()}${toggle('trim', o.trim, 'Trim see-through edges')}<p class="px-hint">Exports the current frame.</p>`,
    gif: () => `${rangeRow()}${scaleRow()}${loopRow()}<p class="px-hint">GIFs have up to 256 colours and no half-see-through pixels (those become fully clear or solid).</p>`,
    apng: () => `${rangeRow()}${scaleRow()}${loopRow()}<p class="px-hint">Animated PNG: every colour and see-through level, plays in all current browsers.</p>`,
    webp: () => webp ? `${rangeRow()}${scaleRow()}${loopRow()}` : '<p class="px-hint">This browser can\'t make WebP files. Try GIF or APNG, or open ClassMap Pixel in Chrome, Edge or Firefox.</p>',
    sheet: () => `${rangeRow()}${scaleRow()}
      <div class="px-mini-label">Layout</div>${seg('layout', o.layout, [['packed', 'Square'], ['rows', 'One row'], ['columns', 'One column'], ['custom', 'Columns:']])}
      ${o.layout === 'custom' ? `<label class="px-field"><span>Columns</span><input type="number" class="px-ex-cols" min="1" max="256" value="${o.cols}"></label>` : ''}
      <div class="px-guide-grid">${[['border', 'Border'], ['spacing', 'Between'], ['padding', 'Around each']].map(([k, l]) => `<label class="px-field"><span>${l}</span><input type="number" data-pad="${k}" min="0" max="64" value="${o[k]}"></label>`).join('')}</div>
      <div class="px-mini-label">Data file for game engines</div>${seg('json', o.json, [['hash', 'JSON (hash)'], ['array', 'JSON (array)'], ['none', 'None']])}`,
    ase: () => '<p class="px-hint">Saves everything — layers, groups, blend modes, frames, timings, tags, linked cels and the palette — as an .aseprite file that Aseprite (and ClassMap Pixel) can open.</p>',
  };
  const draw = () => {
    body.innerHTML = `<div class="px-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === o.tab}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="px-export-preview"><img alt="Preview"><span class="px-ex-info"></span></div>
      <label class="px-field"><span>File name</span><input type="text" class="px-ex-name" value="${esc(o.name)}"></label>
      <div class="px-tabpane">${panes[o.tab]()}</div>`;
    paint();
  };
  const crop = () => (o.trim ? contentBounds(compositeFrame(sprite, state.frameId), sprite.width, sprite.height) : null);
  const paint = () => {
    const size = body.querySelector('.px-ex-size');
    const c = o.tab === 'png' ? (crop() || { w: sprite.width, h: sprite.height }) : { w: sprite.width, h: sprite.height };
    if (size) size.textContent = `${c.w * o.scale} × ${c.h * o.scale} pixels`;
    const img = body.querySelector('.px-export-preview img');
    img.src = renderToCanvas(sprite, Math.max(1, Math.floor(160 / Math.max(c.w, c.h))) || 1, o.tab === 'png' ? crop() : null, state.frameId).toDataURL();
    const info = body.querySelector('.px-ex-info');
    if (o.tab !== 'png' && o.tab !== 'ase') {
      const tag = sprite.tags.find(t => t.id === o.range);
      const k = o.range === 'current' ? 1 : tag ? tag.to - tag.from + 1 : sprite.frames.length;
      const n = o.direction === 'pingpong' ? Math.max(1, 2 * k - 2) : k;
      info.textContent = `${n} frame${n === 1 ? '' : 's'}`;
    } else info.textContent = '';
  };
  body.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (t) { o.name = body.querySelector('.px-ex-name').value; o.tab = t.dataset.tab; if (big * o.scale > maxFor()) o.scale = 1; draw(); return; }
    const s = e.target.closest('[data-s]');
    if (s && !s.disabled) { o.scale = Number(s.dataset.s); body.querySelectorAll('[data-s]').forEach(b => b.setAttribute('aria-checked', String(b === s))); paint(); return; }
    const sg = e.target.closest('.px-seg[data-name] button');
    if (sg) {
      const k = sg.parentElement.dataset.name, v = sg.dataset.v;
      sg.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === sg)));
      o[k] = /^\d+$/.test(v) ? Number(v) : v;
      if (k === 'layout') { o.name = body.querySelector('.px-ex-name').value; draw(); } else paint();
    }
  });
  body.addEventListener('change', e => {
    if (e.target.classList.contains('px-ex-range')) { o.range = e.target.value; paint(); }
    if (e.target.classList.contains('px-ex-trim') || e.target.dataset.name === 'trim') { o.trim = e.target.checked; paint(); }
    if (e.target.classList.contains('px-ex-cols')) o.cols = Math.max(1, Number(e.target.value) || 1);
    if (e.target.dataset.pad) o[e.target.dataset.pad] = Math.max(0, Number(e.target.value) || 0);
  });
  draw();

  async function make() {
    const name = safeName(body.querySelector('.px-ex-name').value);
    const W = sprite.width * o.scale, H = sprite.height * o.scale;
    if (o.tab === 'png') return [{ blob: await toBlob(renderToCanvas(sprite, o.scale, crop(), state.frameId)), name: name + '.png' }];
    if (o.tab === 'ase') return [{ blob: new Blob([await writeAseprite(sprite)], { type: 'application/octet-stream' }), name: name + '.aseprite' }];
    const frames = frameList(sprite, o);
    if (o.tab === 'gif') return [{ blob: new Blob([encodeGIF(frames, W, H, { loop: o.loop })], { type: 'image/gif' }), name: name + '.gif' }];
    if (o.tab === 'apng') return [{ blob: new Blob([await encodeAPNG(frames, W, H, { loop: o.loop })], { type: 'image/png' }), name: name + '.png' }];
    if (o.tab === 'webp') { if (!webp) return null; return [{ blob: new Blob([await encodeWebP(frames, W, H, { loop: o.loop })], { type: 'image/webp' }), name: name + '.webp' }]; }
    // sprite sheet
    const sh = buildSheet(frames, W, H, o);
    const c = document.createElement('canvas'); c.width = sh.width; c.height = sh.height;
    c.getContext('2d').putImageData(new ImageData(sh.pixels, sh.width, sh.height), 0, 0);
    const files = [{ blob: await toBlob(c), name: name + '.png' }];
    if (o.json !== 'none') {
      const layers = leafLayers(sprite).map(l => ({ name: l.name, opacity: l.opacity ?? 255, blendMode: l.blend || 'normal' }));
      // tags still match the frame numbers only when every frame goes out in order
      const tags = o.range === 'all' && o.direction === 'forward' ? sprite.tags : [];
      const data = sheetJSON(frames.map((f, k) => ({ ...f, name: `${name} ${k}.aseprite` })), sh.pos, W, H, sh.width, sh.height, { image: name + '.png', format: o.json, tags, layers, scale: o.scale });
      files.push({ blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name: name + '.json' });
    }
    return files;
  }

  const actions = [];
  const canShare = !!navigator.canShare?.({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] });
  if (canShare) actions.push({ label: 'Share…', onClick: async () => {
    const files = await make(); if (!files) return false;
    try { await navigator.share({ files: files.map(f => new File([f.blob], f.name, { type: f.blob.type })) }); } catch (err) { if (err.name !== 'AbortError') toast("Couldn't share. Try Download instead."); return false; }
  } });
  actions.push({ label: 'Download', kind: 'primary', onClick: async () => {
    const btns = document.querySelectorAll('.px-export-dialog .px-btn');
    btns.forEach(b => { b.disabled = true; });
    try {
      const files = await make();
      if (!files) return false;
      for (const f of files) download(f.blob, f.name);
      toast(files.length > 1 ? `Saved ${files.map(f => f.name).join(' and ')}` : `Saved ${files[0].name}`);
    } catch (err) { toast("Couldn't export: " + err.message, 5000); return false; } finally { btns.forEach(b => { b.disabled = false; }); }
  } });
  return openDialog({ title: 'Export', body, actions, className: 'px-export-dialog' });
}

export { ICONS };
