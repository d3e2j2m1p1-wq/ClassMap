// ═══════════════════════════════════════════════
//  Preview window: the animation at its real speed while you work on a frame. It has its own
//  play button and zoom, and keeps playing whatever you draw. Tap it to jump the canvas to the
//  frame it's showing.
// ═══════════════════════════════════════════════
import { state, on, saveSettings, emit } from '../editor/state.js';
import * as anim from '../editor/anim.js';
import { ICONS } from './icons.js';

let el, cv, view, idx = 0, dir = 1, playing = true, timer = 0, zoom = 0;

export function initPreview(host, v) {
  view = v;
  el = document.createElement('div');
  el.className = 'px-preview paper';
  el.hidden = true;
  el.innerHTML = `<div class="px-ref-head"><span class="px-ref-name">Preview</span>
      <button type="button" class="px-ref-btn" data-a="play" aria-label="Play or pause the preview"></button>
      <button type="button" class="px-ref-btn" data-a="out" aria-label="Zoom out">−</button>
      <button type="button" class="px-ref-btn" data-a="in" aria-label="Zoom in">+</button>
      <button type="button" class="px-ref-btn" data-a="close" aria-label="Close">${ICONS.close}</button></div>
    <canvas class="px-preview-view" title="Tap to show this frame on the canvas"></canvas><span class="px-ref-grip"></span>`;
  host.append(el);
  cv = el.querySelector('canvas');
  el.querySelector('.px-ref-head').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'play') { playing = !playing; schedule(); paint(); }
    if (a === 'in') { zoom = (zoom || fitZoom()) * 2; paint(); }
    if (a === 'out') { zoom = Math.max(0.25, (zoom || fitZoom()) / 2); paint(); }
    if (a === 'close') { state.settings.preview.open = false; saveSettings(); emit('preview'); }
  });
  cv.addEventListener('click', () => { const f = state.sprite?.frames[idx]; if (f) anim.goToFrame(f.id); });
  dragMove(el.querySelector('.px-ref-head'), (dx, dy) => { const P = state.settings.preview; P.x += dx; P.y += dy; place(); });
  dragMove(el.querySelector('.px-ref-grip'), (dx, dy) => { const P = state.settings.preview; P.w = Math.max(140, P.w + dx); P.h = Math.max(140, P.h + dy); place(); paint(); });
  for (const ev of ['preview', 'sprite']) on(ev, show);
  for (const ev of ['changed', 'frames', 'layers', 'frame']) on(ev, () => { if (!playing) idx = Math.max(0, anim.frameIndex()); paint(); });
  show();
}

function dragMove(handle, fn) {
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    let x = e.clientX, y = e.clientY;
    const mv = ev => { fn(ev.clientX - x, ev.clientY - y); x = ev.clientX; y = ev.clientY; };
    const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); saveSettings(); };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
  });
}

function place() {
  const P = state.settings.preview, host = el.parentElement.getBoundingClientRect();
  if (!P.x && !P.y) { P.x = host.width - P.w - 270; P.y = 20; }
  P.x = Math.max(0, Math.min(host.width - 80, P.x)); P.y = Math.max(0, Math.min(host.height - 60, P.y));
  el.style.cssText = `left:${P.x}px;top:${P.y}px;width:${P.w}px;height:${P.h}px`;
}

function show() {
  const open = !!state.sprite && state.settings.preview.open;
  el.hidden = !open;
  if (!open) { clearTimeout(timer); return; }
  place();
  idx = Math.max(0, anim.frameIndex());
  zoom = 0;
  schedule(); paint();
}

const fitZoom = () => { const sp = state.sprite; return Math.max(0.1, Math.min((cv.clientWidth - 8) / sp.width, (cv.clientHeight - 8) / sp.height)); };

function paint() {
  const sp = state.sprite;
  if (!sp || el.hidden) return;
  el.querySelector('[data-a="play"]').innerHTML = playing ? ICONS.pause : ICONS.play;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const z = zoom || fitZoom(), w = sp.width * z, h = sp.height * z;
  const f = sp.frames[Math.min(idx, sp.frames.length - 1)];
  g.imageSmoothingEnabled = false;
  g.drawImage(view.frameCanvas(f.id), Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
}

function schedule() {
  clearTimeout(timer);
  const sp = state.sprite;
  if (!playing || !sp || el.hidden || sp.frames.length < 2) return;
  timer = setTimeout(() => {
    const s = state.sprite; if (!s) return;
    const n = anim.nextIndex(idx, anim.playRange(), dir);
    idx = n.i; dir = n.d;
    paint(); schedule();
  }, sp.frames[Math.min(idx, sp.frames.length - 1)].durationMs);
}
