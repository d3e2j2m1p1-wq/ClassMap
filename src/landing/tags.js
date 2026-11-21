// ═══════════════════════════════════════════════
//  STUDENT TAGS ("Needs support", "Strong reader", "ELL" …)
//  Stored on each student as `tags: [...]` (class roster). Rules can then
//  spread a tag across groups, or pair everyone with a tag with a helper tag.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { saveLandingData } from '../storage/landingData.js';

export const PRESET_TAGS = ['IEP', '504', 'Needs support', 'Strong reader', 'ELL', 'Talkative', 'Preferential seating'];

// ── Tag settings (per class): where tagged students sit, whether they're spread out, whether it's private ──
//   cls.tagSettings = { "<tag, lower case>": { place: ''|'front'|'back'|'teacher', spread: bool, private: bool } }
// Tags never show on the projector or the printed chart. Private tags also stay off the substitute page.
export const TAG_PLACES = [
  ['', 'Anywhere'],
  ['front', 'Toward the front'],
  ['back', 'Toward the back'],
  ['teacher', "Near the teacher's desk"],
];
const PRIVATE_BY_DEFAULT = new Set(['iep', '504', 'medical']);
export const tagKey = t => String(t).trim().toLowerCase();

export function tagSetting(cls, tag) {
  const k = tagKey(tag);
  const s = (cls && cls.tagSettings && cls.tagSettings[k]) || {};
  return {
    place: TAG_PLACES.some(([v]) => v === s.place) ? s.place : '',
    spread: !!s.spread,
    private: s.private ?? PRIVATE_BY_DEFAULT.has(k),
  };
}

export function setTagSetting(cls, tag, patch) {
  if (!cls) return;
  const k = tagKey(tag);
  cls.tagSettings = cls.tagSettings || {};
  cls.tagSettings[k] = { ...tagSetting(cls, tag), ...patch };
}

// Short label for a seat badge: "IEP", "ELL", "Needs support" → "NS", "Talkative" → "Tal"
export function tagAbbr(tag) {
  const words = String(tag).trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
  const w = words[0] || '';
  return w.length <= 4 ? w.toUpperCase() : w.slice(0, 3);
}

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
    const hint = document.createElement('div');
    hint.className = 'tm-hint';
    hint.textContent = 'Choose how each tag is seated in the Rules tab.';
    m.appendChild(hint);
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

// ── Rules tab: one row per tag — where they sit, spread out, private ──
export function renderTagSettings(cls) {
  const box = document.getElementById('ldTagSettings');
  if (!box || !cls) return;
  const tags = classTags(cls);
  if (!tags.length) {
    box.innerHTML = '<div class="tag-set-empty">No tags yet. Tag students with the tag button in the Roster tab, then choose here how each tag is seated.</div>';
    return;
  }
  box.innerHTML = '';
  tags.forEach(tag => {
    const st = tagSetting(cls, tag);
    const n = (cls.students || []).filter(s => hasTag(s, tag)).length;
    const row = document.createElement('div');
    row.className = 'tag-set-row';
    row.innerHTML = `
      <div class="tag-set-name"><span class="ld-tag-chip${st.private ? ' private' : ''}">${esc(tag)}</span><span class="tag-set-count">${n} student${n !== 1 ? 's' : ''}</span></div>
      <label class="tag-set-field">Seat
        <select aria-label="Where “${esc(tag)}” students sit">${TAG_PLACES.map(([v, l]) => `<option value="${v}"${v === st.place ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </label>
      <label class="tag-set-check" title="Never put two “${esc(tag)}” students in the same group"><input type="checkbox" data-k="spread"${st.spread ? ' checked' : ''}> Spread out</label>
      <label class="tag-set-check" title="Leave this tag off the substitute printout"><input type="checkbox" data-k="private"${st.private ? ' checked' : ''}> Private</label>`;
    row.querySelector('select').addEventListener('change', e => { setTagSetting(cls, tag, { place: e.target.value }); saveLandingData(); });
    row.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      setTagSetting(cls, tag, { [cb.dataset.k]: cb.checked });
      saveLandingData();
      renderTagSettings(cls);
    }));
    box.appendChild(row);
  });
}
