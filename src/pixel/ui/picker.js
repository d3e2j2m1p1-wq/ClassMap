// ═══════════════════════════════════════════════
//  Colour picker: saturation/brightness square, hue and opacity bars, hex and RGBA fields,
//  previous vs current colour, and recently used colours. Changes apply as you drag.
// ═══════════════════════════════════════════════
import { state, setColor, store, emit } from '../editor/state.js';
import { rgbToHsv, hsvToRgb, rgbaToHex, hexToRgba, sameColor } from '../core/color.js';
import { popover } from './dialogs.js';

const recentKey = 'pixel:recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(recentKey)) || []; } catch { return []; } };

export function rememberRecent(c) {
  const hex = rgbaToHex(c, true);
  const list = [hex, ...loadRecent().filter(h => h !== hex)].slice(0, 10);
  store(recentKey, list);
}

export function openPicker(anchor, side = 'left', { which = 'primary', onAdd } = {}) {
  const start = [...state.settings[which]];
  let [h, s, v] = rgbToHsv(start), a = start[3];
  const el = document.createElement('div');
  el.className = 'px-picker';
  el.innerHTML = `
    <div class="px-sv" aria-label="Saturation and brightness"><canvas width="220" height="150"></canvas><i class="px-knob"></i></div>
    <div class="px-bar px-hue" aria-label="Hue"><i class="px-knob"></i></div>
    <div class="px-bar px-alpha" aria-label="Opacity"><span></span><i class="px-knob"></i></div>
    <div class="px-pick-row">
      <div class="px-cmp" title="Previous / current"><button type="button" class="px-cmp-prev" aria-label="Back to the previous colour"></button><span class="px-cmp-cur"></span></div>
      <label class="px-hex"><span>Hex</span><input type="text" maxlength="9" spellcheck="false" autocomplete="off"></label>
    </div>
    <div class="px-rgba">${['R', 'G', 'B', 'A'].map((k, i) => `<label><span>${k}</span><input type="number" min="0" max="255" data-i="${i}"></label>`).join('')}</div>
    <div class="px-recent-row"><span class="px-mini-label">Recent</span><div class="px-recent"></div></div>
    <button type="button" class="px-btn px-btn-ghost px-pick-add">+ Add to palette</button>`;

  const sv = el.querySelector('.px-sv'), svc = sv.querySelector('canvas'), g = svc.getContext('2d');
  const hue = el.querySelector('.px-hue'), alpha = el.querySelector('.px-alpha');
  const hex = el.querySelector('.px-hex input'), nums = [...el.querySelectorAll('.px-rgba input')];

  const color = () => [...hsvToRgb(h, s, v), a];
  function paintSV() {
    const W = svc.width, H = svc.height;
    g.fillStyle = `rgb(${hsvToRgb(h, 1, 1).join(',')})`; g.fillRect(0, 0, W, H);
    let gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  function show(skip) {
    const c = color();
    sv.querySelector('.px-knob').style.cssText = `left:${s * 100}%;top:${(1 - v) * 100}%;background:rgb(${c.slice(0, 3)})`;
    hue.querySelector('.px-knob').style.left = (h / 360 * 100) + '%';
    alpha.querySelector('span').style.background = `linear-gradient(90deg, rgba(${c.slice(0, 3)},0), rgb(${c.slice(0, 3)}))`;
    alpha.querySelector('.px-knob').style.left = (a / 255 * 100) + '%';
    el.querySelector('.px-cmp-cur').style.background = `rgba(${c.slice(0, 3)},${a / 255})`;
    if (skip !== 'hex') hex.value = rgbaToHex(c);
    if (skip !== 'num') nums.forEach((n, i) => { n.value = c[i]; });
  }
  el.querySelector('.px-cmp-prev').style.background = `rgba(${start.slice(0, 3)},${start[3] / 255})`;

  const apply = skip => { show(skip); setColor(which, color()); };

  // drag on the square and bars
  const drag = (node, fn) => node.addEventListener('pointerdown', e => {
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    const go = ev => { const r = node.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))); };
    go(e);
    const mv = ev => go(ev);
    const up = () => { node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); };
    node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
  });
  drag(sv, (x, y) => { s = x; v = 1 - y; apply(); });
  drag(hue, x => { h = x * 360; paintSV(); apply(); });
  drag(alpha, x => { a = Math.round(x * 255); apply(); });

  hex.addEventListener('input', () => {
    const c = hexToRgba(hex.value);
    if (!c) return;
    [h, s, v] = rgbToHsv(c); a = c[3];
    paintSV(); apply('hex');
  });
  nums.forEach(n => n.addEventListener('input', () => {
    const c = nums.map(x => Math.max(0, Math.min(255, Number(x.value) || 0)));
    const [nh, ns, nv] = rgbToHsv(c);
    if (ns > 0) h = nh;                     // keep the hue while the colour is grey
    s = ns; v = nv; a = c[3];
    paintSV(); apply('num');
  }));
  el.querySelector('.px-cmp-prev').addEventListener('click', () => {
    [h, s, v] = rgbToHsv(start); a = start[3]; paintSV(); apply();
  });

  const recent = el.querySelector('.px-recent');
  const list = loadRecent();
  recent.innerHTML = list.length ? list.map(x => `<button type="button" class="px-sw" style="--c:${x}" data-hex="${x}" aria-label="${x}"></button>`).join('') : '<span class="px-mini-label">Nothing yet</span>';
  recent.addEventListener('click', e => {
    const b = e.target.closest('[data-hex]'); if (!b) return;
    const c = hexToRgba(b.dataset.hex);
    [h, s, v] = rgbToHsv(c); a = c[3]; paintSV(); apply();
  });
  el.querySelector('.px-pick-add').addEventListener('click', () => { onAdd?.(color()); });

  paintSV(); show();
  const pop = popover(anchor, el, {
    side, className: 'px-picker-pop',
    onClose: () => { const c = color(); if (!sameColor(c, start)) rememberRecent(c); emit('picker-closed'); },
  });
  return pop;
}
