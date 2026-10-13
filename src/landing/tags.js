// ═══════════════════════════════════════════════
//  STUDENT TAGS ("Needs support", "Strong reader", "ELL" …)
//  Stored on each student as `tags: [...]` (class roster). Rules can then
//  spread a tag across groups, or pair everyone with a tag with a helper tag.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { saveLandingData } from '../storage/landingData.js';

export const PRESET_TAGS = ['Needs support', 'Strong reader', 'ELL', 'Talkative', 'Preferential seating'];

export const sameTag = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
export const hasTag = (student, tag) => (student.tags || []).some(t => sameTag(t, tag));

// Every tag used in a class, A→Z
export function classTags(cls) {
  const seen = new Map();
  (cls?.students || []).forEach(s => (s.tags || []).forEach(t => { const k = t.trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, t.trim()); }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function tagChipsHTML(student) {
  return (student.tags || []).map(t => `<span class="ld-tag-chip">${esc(t)}</span>`).join('');
}

// ── Tag menu for one student (🏷 on a roster row) ──
let _menu = null;
function closeMenu() {
  if (_menu) { _menu.remove(); _menu = null; }
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
}
function onOutside(e) { if (_menu && !_menu.contains(e.target)) closeMenu(); }
function onKey(e) { if (e.key === 'Escape') closeMenu(); }

export function openTagMenu(cls, student, anchor, onChange) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'float-menu tm-inner tag-menu';
  const render = () => {
    m.innerHTML = `<div class="tm-label">Tags for ${esc(student.name)}</div>`;
    const names = classTags(cls);
    PRESET_TAGS.forEach(p => { if (!names.some(n => sameTag(n, p))) names.push(p); });
    names.forEach(t => {
      const on = hasTag(student, t);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tm-item' + (on ? ' active' : '');
      b.innerHTML = `<span>${esc(t)}</span>`;
      b.addEventListener('click', e => {
        e.stopPropagation();
        student.tags = on ? (student.tags || []).filter(x => !sameTag(x, t)) : [...(student.tags || []), t];
        saveLandingData();
        onChange();
        render();
      });
      m.appendChild(b);
    });
    const row = document.createElement('div');
    row.className = 'tag-new';
    row.innerHTML = `<input type="text" placeholder="New tag…" maxlength="30" aria-label="New tag"><button type="button">Add</button>`;
    const input = row.querySelector('input');
    const add = () => {
      const t = input.value.trim();
      if (!t) return;
      if (!hasTag(student, t)) student.tags = [...(student.tags || []), t];
      saveLandingData();
      onChange();
      render();
      m.querySelector('.tag-new input').focus();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    row.querySelector('button').addEventListener('click', e => { e.stopPropagation(); add(); });
    m.appendChild(row);
  };
  render();
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  let top = r.bottom + 4;
  if (top + m.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 4);
  m.style.top = top + 'px';
  _menu = m;
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
}

// Rules tab: fill the two tag pickers
export function fillTagSelects(cls) {
  const tags = classTags(cls);
  ['ldRuleTagA', 'ldRuleTagB'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = tags.length
      ? tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')
      : '<option value="">No tags yet — add them in Roster</option>';
    if (tags.some(t => t === keep)) sel.value = keep;
    else if (id === 'ldRuleTagB' && tags.length > 1) sel.value = tags[1];
  });
}

export function noTagsToast() { showToast('Add tags to students first (🏷 in the Roster tab)'); }
