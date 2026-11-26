// ═══════════════════════════════════════════════
//  Pictures out: thumbnails for the gallery, and PNG export (scaled up with crisp pixels).
// ═══════════════════════════════════════════════
import { compositeFrame, contentBounds } from '../core/sprite.js';
import { openDialog, toast, esc } from './dialogs.js';
import { ICONS } from './icons.js';

const MAX_OUT = 8192;

// The artwork (all visible layers) drawn at `scale`, optionally cropped to `crop`
export function renderToCanvas(sprite, scale = 1, crop = null) {
  const W = sprite.width, H = sprite.height;
  const px = compositeFrame(sprite);
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
  return renderToCanvas(sprite, scale).toDataURL('image/png');
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

export function openExport(sprite) {
  const scales = [1, 2, 4, 8, 10, 20, 40];
  let scale = Math.min(...scales.filter(s => Math.max(sprite.width, sprite.height) * s >= 256), 40) || 1;
  if (Math.max(sprite.width, sprite.height) * scale > MAX_OUT) scale = 1;
  let trim = false;
  const body = document.createElement('div');
  body.className = 'px-export';
  body.innerHTML = `
    <div class="px-export-preview"><img alt="Preview"></div>
    <label class="px-field"><span>File name</span><input type="text" class="px-ex-name" value="${esc(safeName(sprite.name))}"></label>
    <div class="px-mini-label">Size</div>
    <div class="px-seg px-ex-scales">${scales.map(s => `<button type="button" data-s="${s}" ${Math.max(sprite.width, sprite.height) * s > MAX_OUT ? 'disabled' : ''}>${s}×</button>`).join('')}</div>
    <p class="px-ex-size"></p>
    <label class="px-toggle"><input type="checkbox" class="px-ex-trim"><span class="px-switch"></span>Trim see-through edges</label>`;
  const crop = () => (trim ? contentBounds(compositeFrame(sprite), sprite.width, sprite.height) : null);
  const paint = () => {
    body.querySelectorAll('[data-s]').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.s) === scale)));
    const c = crop() || { w: sprite.width, h: sprite.height };
    body.querySelector('.px-ex-size').textContent = `${c.w * scale} × ${c.h * scale} pixels`;
    body.querySelector('img').src = renderToCanvas(sprite, Math.max(1, Math.floor(160 / Math.max(c.w, c.h))) || 1, crop()).toDataURL();
  };
  body.querySelector('.px-ex-scales').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b && !b.disabled) { scale = Number(b.dataset.s); paint(); } });
  body.querySelector('.px-ex-trim').addEventListener('change', e => { trim = e.target.checked; paint(); });
  paint();

  const file = async () => {
    const name = safeName(body.querySelector('.px-ex-name').value) + '.png';
    const blob = await toBlob(renderToCanvas(sprite, scale, crop()));
    return { name, blob };
  };
  const actions = [];
  const canShare = !!navigator.canShare?.({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] });
  if (canShare) actions.push({ label: 'Share…', onClick: async () => {
    const { name, blob } = await file();
    try { await navigator.share({ files: [new File([blob], name, { type: 'image/png' })] }); } catch (err) { if (err.name !== 'AbortError') toast("Couldn't share. Try Download instead."); return false; }
  } });
  actions.push({ label: 'Download PNG', kind: 'primary', onClick: async () => { const { name, blob } = await file(); download(blob, name); toast(`Saved ${name}`); } });
  return openDialog({ title: 'Export PNG', body, actions, className: 'px-export-dialog' });
}

export { ICONS };
