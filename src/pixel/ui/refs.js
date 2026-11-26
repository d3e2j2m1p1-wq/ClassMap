// ═══════════════════════════════════════════════
//  Reference images: floating windows over the canvas, saved with the artwork.
//  Drag the title bar to move, the corner to resize, scroll / pinch to zoom, two fingers or
//  a middle-drag to pan. Press and drag on the picture to pick colours from it.
// ═══════════════════════════════════════════════
import { state, on, emit, setColor } from '../editor/state.js';
import { uid } from '../core/sprite.js';
import { ICONS } from './icons.js';
import { popover, toast, esc, confirmBox } from './dialogs.js';

let host;
const MAX = 1600;
const images = new Map();       // ref id → { img canvas, data }

export function initRefs(el) {
  host = el;
  on('sprite', build);
}

const refs = () => state.sprite?.references || (state.sprite ? (state.sprite.references = []) : []);
const dirty = () => emit('dirty');

// Read an image file / blob as a PNG data URL, shrunk if it is very large
export async function imageToDataURL(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}

export async function addReference(blob, name = 'Reference') {
  try {
    const { url, w, h } = await imageToDataURL(blob);
    const W = Math.max(220, Math.min(300, w + 4)), H = Math.max(170, Math.min(260, h + 36));
    const k = Math.min((W - 4) / w, (H - 36) / h);
    const n = refs().length;
    refs().push({ id: uid(), name, src: url, x: 170 + n * 26, y: 24 + n * 26, w: W, h: H, zoom: k, px: 0, py: 0, opacity: 1, min: false, hidden: false });
    build(); dirty();
  } catch { toast("Couldn't open that image"); }
}

function build() {
  if (!host) return;
  host.querySelectorAll('.px-ref').forEach(n => n.remove());
  if (!state.sprite) return;
  for (const r of refs()) if (!r.hidden) makeWindow(r);
}

function load(r) {
  if (images.has(r.id)) return Promise.resolve(images.get(r.id));
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const v = { canvas: c, data: g.getImageData(0, 0, c.width, c.height).data };
      images.set(r.id, v); res(v);
    };
    im.src = r.src;
  });
}

function makeWindow(r) {
  const w = document.createElement('div');
  w.className = 'px-ref paper' + (r.min ? ' min' : '');
  w.dataset.id = r.id;
  w.innerHTML = `
    <div class="px-ref-head">
      <span class="px-ref-name">${esc(r.name)}</span>
      <input type="range" class="px-ref-op" min="10" max="100" value="${Math.round(r.opacity * 100)}" aria-label="Window opacity" title="Opacity">
      <button type="button" class="px-ref-btn px-ref-min" aria-label="${r.min ? 'Open' : 'Minimise'}">${r.min ? '+' : '–'}</button>
      <button type="button" class="px-ref-btn px-ref-x" aria-label="Close">${ICONS.close}</button>
    </div>
    <canvas class="px-ref-view"></canvas>
    <span class="px-ref-grip" aria-hidden="true"></span>`;
  host.append(w);
  const cv = w.querySelector('canvas'), g = cv.getContext('2d');
  const place = () => { w.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.min ? 'auto' : r.h + 'px'};opacity:${r.opacity}`; };
  let img = null;
  const draw = () => {
    if (!img || r.min) return;
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = r.zoom < 1;
    g.drawImage(img.canvas, -r.px * r.zoom, -r.py * r.zoom, img.canvas.width * r.zoom, img.canvas.height * r.zoom);
  };
  place();
  load(r).then(v => { img = v; draw(); });
  new ResizeObserver(draw).observe(cv);

  // move by the title bar
  const head = w.querySelector('.px-ref-head');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button, input')) return;
    e.preventDefault(); head.setPointerCapture(e.pointerId);
    const s = { x: e.clientX - r.x, y: e.clientY - r.y };
    const mv = ev => { r.x = Math.max(0, ev.clientX - s.x); r.y = Math.max(0, ev.clientY - s.y); place(); };
    const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); dirty(); };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
  });
  // resize by the corner
  const grip = w.querySelector('.px-ref-grip');
  grip.addEventListener('pointerdown', e => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const s = { x: e.clientX, y: e.clientY, w: r.w, h: r.h };
    const mv = ev => { r.w = Math.max(140, s.w + ev.clientX - s.x); r.h = Math.max(110, s.h + ev.clientY - s.y); place(); draw(); };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); dirty(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
  });
  w.querySelector('.px-ref-op').addEventListener('input', e => { r.opacity = e.target.value / 100; place(); });
  w.querySelector('.px-ref-op').addEventListener('change', dirty);
  w.querySelector('.px-ref-min').addEventListener('click', () => { r.min = !r.min; build(); dirty(); });
  w.querySelector('.px-ref-x').addEventListener('click', () => { r.hidden = true; build(); dirty(); });

  // zoom, pan, and pick colours
  const zoomAt = (k, sx, sy) => {
    const nz = Math.max(0.05, Math.min(32, r.zoom * k));
    r.px += sx / r.zoom - sx / nz; r.py += sy / r.zoom - sy / nz; r.zoom = nz; draw();
  };
  cv.addEventListener('wheel', e => { e.preventDefault(); const b = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - b.left, e.clientY - b.top); }, { passive: false });
  const ptrs = new Map();
  let pinch = null;
  const pick = e => {
    if (!img) return;
    const b = cv.getBoundingClientRect();
    const ix = Math.floor((e.clientX - b.left) / r.zoom + r.px), iy = Math.floor((e.clientY - b.top) / r.zoom + r.py);
    if (ix < 0 || iy < 0 || ix >= img.canvas.width || iy >= img.canvas.height) return;
    const o = (iy * img.canvas.width + ix) * 4, d = img.data;
    if (d[o + 3]) setColor('primary', [d[o], d[o + 1], d[o + 2], d[o + 3]]);
  };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY, e.button === 1]);
    if (ptrs.size === 2) { const [a, c] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - c[0], a[1] - c[1]), m: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2] }; }
    else if (e.button !== 1) pick(e);
  });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs.set(e.pointerId, [e.clientX, e.clientY, p[2]]);
    if (pinch && ptrs.size === 2) {
      const [a, c] = [...ptrs.values()], d = Math.hypot(a[0] - c[0], a[1] - c[1]), m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const b = cv.getBoundingClientRect();
      r.px -= (m[0] - pinch.m[0]) / r.zoom; r.py -= (m[1] - pinch.m[1]) / r.zoom;
      zoomAt(d / pinch.d, m[0] - b.left, m[1] - b.top);
      pinch = { d, m };
    } else if (p[2]) { r.px -= dx / r.zoom; r.py -= dy / r.zoom; draw(); }
    else pick(e);
  });
  const lift = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) dirty(); };
  cv.addEventListener('pointerup', lift); cv.addEventListener('pointercancel', lift);
  cv.addEventListener('dblclick', () => { if (!img) return; r.zoom = Math.min(cv.clientWidth / img.canvas.width, cv.clientHeight / img.canvas.height); r.px = r.py = 0; draw(); dirty(); });
}

// The reference images menu (header button)
export function openRefMenu(anchor, { pickFile, importLayer }) {
  const m = document.createElement('div');
  m.className = 'px-menu';
  m.innerHTML = `
    <div class="px-menu-title">Reference images</div>
    <button type="button" data-a="add">Add an image window…</button>
    <button type="button" data-a="paste">Paste an image as a window</button>
    <button type="button" data-a="layer">Reference layer from an image…</button>
    ${refs().length ? '<hr>' + refs().map((r, i) => `<div class="px-ref-row"><button type="button" data-a="toggle" data-i="${i}">${r.hidden ? 'Show' : 'Hide'} · ${esc(r.name)}</button><button type="button" class="px-icon-btn" data-a="del" data-i="${i}" aria-label="Remove ${esc(r.name)}">${ICONS.trash}</button></div>`).join('') : ''}`;
  const pop = popover(anchor, m, { side: 'below' });
  m.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, i = Number(b.dataset.i);
    pop.close();
    if (a === 'add') pickFile(f => addReference(f, f.name.replace(/\.[^.]+$/, '') || 'Reference'));
    if (a === 'layer') importLayer();
    if (a === 'paste') {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) { addReference(await it.getType(t), 'Pasted image'); return; } }
        toast('No image on the clipboard');
      } catch { toast('The browser didn\'t allow reading the clipboard. Try "Add an image window…"'); }
    }
    if (a === 'toggle') { refs()[i].hidden = !refs()[i].hidden; build(); dirty(); }
    if (a === 'del' && await confirmBox('Remove reference?', `"${refs()[i].name}" will be removed from this artwork.`, { ok: 'Remove', danger: true })) {
      images.delete(refs()[i].id); refs().splice(i, 1); build(); dirty();
    }
  });
}
