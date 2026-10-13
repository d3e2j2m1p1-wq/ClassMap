import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { saveLandingData } from '../storage/landingData.js';
import { ruleSummary } from '../assign/rulesEngine.js';
import { classTags, fillTagSelects, noTagsToast } from './tags.js';

// ── Rules tab ──
export function renderLdRules() {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  const list = document.getElementById('ldRulesList');
  list.innerHTML = '';
  if (cls.hardRules.length === 0) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text3);padding:8px 0;">No permanent rules yet.</div>';
  } else {
    cls.hardRules.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'ld-rule-row';
      const { label, text } = ruleSummary(r);
      row.innerHTML = `<span class="ld-rule-tag">${esc(label)}</span>
        <span>${esc(text)}</span>
        <button class="ld-rule-del" onclick="ldDeleteRule(${i})" aria-label="Delete rule">✕</button>`;
      list.appendChild(row);
    });
  }
  // Init typeaheads for rule adding
  initLdTypeahead('ldRuleStudentA', 'ldTaInputA');
  initLdTypeahead('ldRuleStudentB', 'ldTaInputB');
  fillTagSelects(cls);
  // Show/hide B field based on rule type
  ldUpdateRuleTypeFields();
  document.getElementById('ldRuleType').onchange = ldUpdateRuleTypeFields;
}

export function ldUpdateRuleTypeFields() {
  const type = document.getElementById('ldRuleType').value;
  const needsB = type === 'separate' || type === 'near' || type === 'partners';
  const isTag = type === 'spread' || type === 'helper';
  document.getElementById('ldRuleStudentA').style.display = isTag ? 'none' : '';
  document.getElementById('ldRuleStudentB').style.display = needsB ? '' : 'none';
  document.getElementById('ldRuleTagA').style.display = isTag ? '' : 'none';
  document.getElementById('ldRuleTagB').style.display = type === 'helper' ? '' : 'none';
}

export function initLdTypeahead(wrapId, inputId) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = `<input id="${inputId}" placeholder="Student name..." autocomplete="off">`;
  const input = wrap.querySelector('input');
  input.addEventListener('input', () => {
    wrap.querySelector('.ld-typeahead-dropdown')?.remove();
    const q = input.value.toLowerCase();
    if (!q) return;
    const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
    const matches = (cls?.students||[]).filter(s => s.name.toLowerCase().includes(q)).slice(0,6);
    if (!matches.length) return;
    const dd = document.createElement('div');
    dd.className = 'ld-typeahead-dropdown';
    matches.forEach(s => {
      const item = document.createElement('div');
      item.className = 'ld-typeahead-item';
      item.textContent = s.name;
      item.addEventListener('mousedown', e => { e.preventDefault(); input.value = s.name; dd.remove(); });
      dd.appendChild(item);
    });
    wrap.appendChild(dd);
  });
  input.addEventListener('blur', () => setTimeout(() => wrap.querySelector('.ld-typeahead-dropdown')?.remove(), 150));
}

export function ldAddRule() {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  const type = document.getElementById('ldRuleType').value;
  if (type === 'spread' || type === 'helper') {
    const tags = classTags(cls);
    if (!tags.length) { noTagsToast(); return; }
    const tag = document.getElementById('ldRuleTagA').value;
    const helperTag = document.getElementById('ldRuleTagB').value;
    if (type === 'helper' && (!helperTag || helperTag === tag)) { showToast('Pick two different tags'); return; }
    cls.hardRules.push(type === 'spread' ? { type, tag } : { type, tag, helperTag });
    saveLandingData();
    renderLdRules();
    return;
  }
  const a = document.getElementById('ldTaInputA')?.value.trim();
  const b = document.getElementById('ldTaInputB')?.value.trim();
  if (!a) { showToast('Enter a student name'); return; }
  const find = n => cls.students.find(s => s.name.trim().toLowerCase() === n.toLowerCase());
  const sa = find(a);
  if (!sa) { showToast(`No student named "${a}" in this class`); return; }
  let sb = null;
  if (type === 'separate' || type === 'near' || type === 'partners') {
    if (!b) { showToast('Enter a second student'); return; }
    sb = find(b);
    if (!sb) { showToast(`No student named "${b}" in this class`); return; }
    if (sb.id === sa.id) { showToast('Pick two different students'); return; }
  }
  cls.hardRules.push({ type, studentA: sa.name, studentB: sb ? sb.name : '' });
  saveLandingData();
  renderLdRules();
}

export function ldDeleteRule(i) {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  cls.hardRules.splice(i, 1);
  saveLandingData();
  renderLdRules();
}
