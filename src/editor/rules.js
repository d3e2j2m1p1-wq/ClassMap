import { esc, groupColor, initials, state, uid } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { markDirty } from '../storage/autosave.js';
import { ruleSummary } from '../assign/rulesEngine.js';

// ═══════════════════════════════════════════════
//  RULES
// ═══════════════════════════════════════════════
export function populateRuleSelects() {
  // Rebuild all typeahead data (no-op here, typeaheads read state.students directly)
  renderHardRules();
  renderTempRules();
}

// Typeahead widget: returns { wrap, getValue, setValue, clear }
export function makeTypeahead(placeholder, onSelect) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.style.cssText = 'width:100%;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:"Geist",sans-serif;font-size:0.8rem;padding:6px 9px;outline:none;';

  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);box-shadow:var(--shadow);z-index:100;max-height:180px;overflow-y:auto;display:none;margin-top:2px;';

  let selectedId = null;
  let selectedName = '';

  function showDropdown(q) {
    const sorted = [...state.students].sort((a,b) => a.name.localeCompare(b.name));
    const filtered = q ? sorted.filter(s => s.name.toLowerCase().includes(q.toLowerCase())) : sorted;
    dropdown.innerHTML = '';
    if (filtered.length === 0) {
      dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.75rem;color:var(--text3);">No students found</div>';
    } else {
      filtered.forEach(s => {
        const item = document.createElement('div');
        const gColor = groupColor(s);
        item.style.cssText = `padding:7px 12px;font-size:0.8rem;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.1s;`;
        item.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:${gColor}22;color:${gColor};font-size:0.6rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${esc(initials(s.name))}</span><span>${esc(s.name)}</span>`;
        item.addEventListener('mouseenter', () => item.style.background = 'var(--surface2)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          selectedId = s.id;
          selectedName = s.name;
          input.value = s.name;
          input.style.borderColor = 'var(--blue)';
          dropdown.style.display = 'none';
          onSelect(s.id, s.name);
        });
        dropdown.appendChild(item);
      });
    }
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', () => { selectedId = null; input.style.borderColor = ''; showDropdown(input.value); });
  input.addEventListener('focus', () => showDropdown(input.value));
  input.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none'; }, 150));

  wrap.appendChild(input);
  wrap.appendChild(dropdown);

  return {
    el: wrap,
    getValue: () => selectedId,
    getName: () => input.value,
    clear: () => { selectedId = null; selectedName = ''; input.value = ''; input.style.borderColor = ''; }
  };
}

// Typeahead instances for rules
export const typeaheads = {};

export function initRuleTypeaheads() {
  const fields = [
    { id: 'hardStudA', wrap: 'hardStudA_wrap' },
    { id: 'hardStudB', wrap: 'hardStudB_wrap' },
    { id: 'hardStudSingle', wrap: 'hardStudSingle_wrap' },
    { id: 'tempStudA', wrap: 'tempStudA_wrap' },
    { id: 'tempStudB', wrap: 'tempStudB_wrap' },
    { id: 'tempStudSingle', wrap: 'tempStudSingle_wrap' },
  ];
  fields.forEach(({ id, wrap }) => {
    const wrapEl = document.getElementById(wrap);
    if (!wrapEl || typeaheads[id]) return;
    const ta = makeTypeahead('Search student...', (sid) => { typeaheads[id]._selected = sid; });
    ta._selected = null;
    typeaheads[id] = ta;
    wrapEl.appendChild(ta.el);
  });
}

export function getTypeaheadVal(id) {
  return typeaheads[id] ? typeaheads[id]._selected : null;
}
export function clearTypeahead(id) {
  if (typeaheads[id]) { typeaheads[id].clear(); typeaheads[id]._selected = null; }
}

export function updateTempFormFields() {
  const type = document.getElementById('tempRuleType').value;
  const twoFields = ['separate','near','partners'];
  document.getElementById('tempTwoStudents').style.display = twoFields.includes(type) ? '' : 'none';
  document.getElementById('tempOneStudent').style.display = !twoFields.includes(type) ? '' : 'none';
}

export function addTempRule() {
  const type = document.getElementById('tempRuleType').value;
  const twoFields = ['separate','near','partners'];
  // Temp rules store student names directly (not IDs) for consistency
  let rule = { id: uid(), type, perm: false };
  if (twoFields.includes(type)) {
    const idA = getTypeaheadVal('tempStudA');
    const idB = getTypeaheadVal('tempStudB');
    if (!idA || !idB || idA === idB) { showToast('Search and select two different students'); return; }
    const sA = state.students.find(s => s.id === idA);
    const sB = state.students.find(s => s.id === idB);
    rule.studentA = sA ? sA.name : idA;
    rule.studentB = sB ? sB.name : idB;
    rule.studA = idA; rule.studB = idB; // keep IDs for back-compat
  } else {
    const idA = getTypeaheadVal('tempStudSingle');
    if (!idA) { showToast('Search and select a student'); return; }
    const sA = state.students.find(s => s.id === idA);
    rule.studentA = sA ? sA.name : idA;
    rule.studA = idA;
  }
  state.tempRules.push(rule);
  ['tempStudA','tempStudB','tempStudSingle'].forEach(clearTypeahead);
  renderTempRules();
  markDirty();
}

export function renderHardRules() {
  // Hard rules are class-level, stored with names directly (studentA, studentB)
  const el = document.getElementById('hardRulesList');
  if (!el) return;
  if (!state.hardRules || state.hardRules.length === 0) {
    el.innerHTML = '<p style="font-size:0.75rem;color:var(--text3);padding:4px 0 8px;">No permanent rules set for this class.</p>';
    return;
  }
  const typeClass = { separate:'sep', front:'front', back:'front', near:'near', partners:'near', spread:'near', helper:'near' };
  el.innerHTML = state.hardRules.map(r => {
    const { label, text } = ruleSummary(r);
    return `<div class="rule-row">
    <span class="rule-names">${esc(text)}</span>
    <span class="rule-type-badge ${typeClass[r.type]||'sep'}">${esc(label)}</span>
  </div>`;
  }).join('');
}

export function renderTempRules() {
  const el = document.getElementById('tempRulesList');
  if (state.tempRules.length === 0) { el.innerHTML = '<p style="font-size:0.75rem;color:var(--text3);padding:4px 0 8px;">No temp rules yet.</p>'; return; }
  el.innerHTML = state.tempRules.map(r => tempRuleRowHTML(r)).join('');
}

export function tempRuleRowHTML(r) {
  const nameA = r.studentA || (state.students.find(s => s.id === r.studA) || {}).name || '?';
  const nameB = r.studentB || (r.studB ? (state.students.find(s => s.id === r.studB) || {}).name || '?' : null);
  const typeLabel = { separate: 'Separate', front: 'Front row', back: 'Back row', near: 'Keep near', partners: 'Same group' }[r.type] || r.type;
  const typeClass = { separate:'sep', front:'front', back:'front', near:'near', partners:'near' }[r.type] || 'sep';
  return `<div class="rule-row">
    <span class="rule-names">${esc(nameA)}${nameB ? ' + ' + esc(nameB) : ''}</span>
    <span class="rule-type-badge ${typeClass}">${esc(typeLabel)}</span>
    <button class="chip-btn del" onclick="removeTempRule('${r.id}')" title="Remove">✕</button>
  </div>`;
}

export function removeTempRule(id) {
  state.tempRules = state.tempRules.filter(r => r.id !== id);
  renderTempRules();
  markDirty();
}
