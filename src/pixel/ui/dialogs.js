// ═══════════════════════════════════════════════
//  Dialogs, pop-overs and toasts in the ClassMap paper look.
// ═══════════════════════════════════════════════
import { ICONS } from './icons.js';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// openDialog({ title, body: html | Node, actions: [{ label, kind, value, onClick }] }) → Promise<value>
export function openDialog({ title, body = '', actions = [{ label: 'OK', kind: 'primary', value: true }], className = '', onOpen } = {}) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'px-overlay';
    ov.innerHTML = `<div class="px-dialog paper ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="px-dialog-head"><h2>${esc(title)}</h2><button class="px-icon-btn px-dialog-x" aria-label="Close">${ICONS.close}</button></div>
      <div class="px-dialog-body"></div>
      <div class="px-dialog-actions"></div></div>`;
    const bodyEl = ov.querySelector('.px-dialog-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
    const close = v => { ov.remove(); removeEventListener('keydown', key, true); resolve(v); };
    const acts = ov.querySelector('.px-dialog-actions');
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'px-btn ' + (a.kind === 'primary' ? 'px-btn-primary' : a.kind === 'danger' ? 'px-btn-danger' : 'px-btn-ghost');
      b.textContent = a.label;
      b.addEventListener('click', async () => {
        if (a.onClick) { const keep = await a.onClick(ov); if (keep === false) return; }
        close(a.value);
      });
      acts.append(b);
    }
    ov.querySelector('.px-dialog-x').addEventListener('click', () => close(null));
    ov.addEventListener('pointerdown', e => { if (e.target === ov) close(null); });
    const key = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); acts.querySelector('.px-btn-primary')?.click(); }
    };
    addEventListener('keydown', key, true);
    document.body.append(ov);
    onOpen?.(ov);
    (ov.querySelector('[autofocus]') || acts.querySelector('.px-btn-primary') || acts.lastChild)?.focus();
  });
}

export const confirmBox = (title, message, { ok = 'OK', danger = false } = {}) =>
  openDialog({ title, body: `<p>${esc(message)}</p>`, actions: [{ label: 'Cancel', value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true }] }).then(Boolean);

export function promptBox(title, value = '', { label = 'Name', ok = 'Save' } = {}) {
  let input;
  return openDialog({
    title,
    body: `<label class="px-field"><span>${esc(label)}</span><input type="text" maxlength="80" value="${esc(value)}" autofocus></label>`,
    actions: [{ label: 'Cancel', value: null }, { label: ok, kind: 'primary', onClick: ov => { input = ov.querySelector('input').value.trim(); return input ? undefined : false; } }],
    onOpen: ov => setTimeout(() => ov.querySelector('input').select(), 0),
  }).then(v => (v === null ? null : input));
}

let toastT = 0;
export function toast(msg, ms = 2600) {
  let t = document.querySelector('.px-toast');
  if (!t) { t = document.createElement('div'); t.className = 'px-toast paper'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}

// A pop-over next to `anchor`. Only one at a time; tapping elsewhere closes it.
let current = null;
export function closePopover() { current?.close(); }
export function popover(anchor, content, { side = 'right', className = '', onClose } = {}) {
  closePopover();
  const el = document.createElement('div');
  el.className = 'px-pop paper ' + className;
  if (typeof content === 'string') el.innerHTML = content; else el.append(content);
  document.body.append(el);
  const place = () => {
    const a = anchor.getBoundingClientRect(), r = el.getBoundingClientRect(), m = 10;
    let x, y;
    if (side === 'right') { x = a.right + m; y = a.top; }
    else if (side === 'left') { x = a.left - r.width - m; y = a.top; }
    else if (side === 'top') { x = a.left + a.width / 2 - r.width / 2; y = a.top - r.height - m; }
    else { x = a.right - r.width; y = a.bottom + m; }       // below, right-aligned
    x = Math.max(8, Math.min(innerWidth - r.width - 8, x));
    y = Math.max(8, Math.min(innerHeight - r.height - 8, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  };
  place();
  const outside = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape') close(); };
  setTimeout(() => { addEventListener('pointerdown', outside, true); addEventListener('keydown', key); }, 0);
  function close() {
    if (current !== handle) return;
    current = null;
    el.remove();
    removeEventListener('pointerdown', outside, true); removeEventListener('keydown', key);
    onClose?.();
  }
  const handle = { el, close, place };
  current = handle;
  return handle;
}
export const popoverOpen = () => !!current;

// Small helpers for building option rows
export const seg = (name, value, choices) => `<div class="px-seg" data-name="${name}" role="radiogroup">${choices.map(([v, l]) =>
  `<button type="button" role="radio" aria-checked="${v === value}" data-v="${v}">${l}</button>`).join('')}</div>`;
export const toggle = (name, on, label) => `<label class="px-toggle"><input type="checkbox" data-name="${name}" ${on ? 'checked' : ''}><span class="px-switch"></span>${esc(label)}</label>`;
export const range = (name, value, min, max, label, unit = '') => `<label class="px-range"><span>${esc(label)}</span>
  <input type="range" data-name="${name}" min="${min}" max="${max}" value="${value}"><output>${value}${unit}</output></label>`;

// Wire seg / toggle / range controls in `root` to call set(name, value)
export function bindControls(root, set) {
  root.querySelectorAll('.px-seg').forEach(s => s.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    s.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    const v = b.dataset.v;
    set(s.dataset.name, /^-?\d+$/.test(v) ? Number(v) : v);
  }));
  root.querySelectorAll('.px-toggle input').forEach(i => i.addEventListener('change', () => set(i.dataset.name, i.checked)));
  root.querySelectorAll('.px-range input').forEach(i => i.addEventListener('input', () => {
    i.nextElementSibling.textContent = i.value + (i.nextElementSibling.textContent.replace(/^-?\d+/, ''));
    set(i.dataset.name, Number(i.value));
  }));
}
