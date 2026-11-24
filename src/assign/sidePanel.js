// ═══════════════════════════════════════════════
//  CLASS PANEL — the right-hand panel in the Assign view
//  Roster: add, rename, tag or remove students without leaving the chart.
//  Rules:  see every rule (and whether the chart meets it right now), add or remove rules.
//  Changes go to the class itself, so every chart of the class gets them, and the open
//  chart updates straight away. Every change can be undone.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc, state } from '../core/state.js';
import { showToast, undoToast } from '../core/ui.js';
import { saveLandingData } from '../storage/landingData.js';
import { markDirty } from '../storage/autosave.js';
import { guessGroupForClass } from '../roster/nameList.js';
import { classTags, hasTag, openTagMenu, PRESET_TAGS } from '../landing/tags.js';
import { purgeStudentRefs } from '../landing/roster.js';
import { evaluateRules, ruleSummary, violationMessage } from './rulesEngine.js';
import { getAllSeats } from './seats.js';
import { renderAssignPanel } from './panel.js';
import { renderRoster } from '../editor/roster.js';
import { renderHardRules, renderTempRules } from '../editor/rules.js';
import { restore, snapshot } from '../ai/commands.js';

let tab = 'roster';
let filter = '';
const cls = () => (store.landingData?.classes || []).find(c => c.id === window._currentChartClassId) || null;
const uid = () => 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const norm = s => String(s || '').trim().toLowerCase();

// ── Shell ──
export function renderClassPanel() {
  const el = document.getElementById('classSidePanel');
  if (!el) return;
  const c = cls();
  if (!c) { el.hidden = true; return; }
  el.hidden = false;
  if (!el.dataset.ready) { el.dataset.ready = '1'; if (innerWidth <= 760) el.classList.add('collapsed'); }   // phones: start folded
  const body = el.querySelector('.csp-body');
  el.querySelectorAll('.csp-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  el.querySelector('.csp-count-roster').textContent = state.students.length;
  el.querySelector('.csp-count-rules').textContent = (c.hardRules || []).length + (state.tempRules || []).length;
  body.innerHTML = tab === 'roster' ? rosterHTML(c) : rulesHTML(c);
  (tab === 'roster' ? wireRoster : wireRules)(body, c);
}
export function toggleClassPanel() {
  const el = document.getElementById('classSidePanel');
  el.classList.toggle('collapsed');
  // on phones only one sheet is open at a time
  if (innerWidth <= 760 && !el.classList.contains('collapsed')) document.getElementById('assignFloatPanel')?.classList.add('collapsed');
}
export function classPanelTab(t) { tab = t; renderClassPanel(); }

// Save, redraw everything that shows students or rules, offer Undo
function changed(snap, msg) {
  saveLandingData();
  markDirty();
  renderAssignPanel();
  try { renderRoster(); renderHardRules(); renderTempRules(); } catch { /* tab not built */ }
  renderClassPanel();
  if (msg) undoToast(msg, () => { restore(snap); renderClassPanel(); });
}

// ═══ Roster ═══
function rosterHTML(c) {
  const seated = new Set(Object.values(state.assignments || {}));
  const pins = new Set(state.pins || []);
  const list = [...state.students].sort((a, b) => a.name.localeCompare(b.name))
    .filter(s => !filter || norm(s.name).includes(norm(filter)) || (s.tags || []).some(t => norm(t).includes(norm(filter))));
  return `
    <form class="csp-add" autocomplete="off">
      <input type="text" class="csp-add-in" placeholder="Add a student, or search…" aria-label="Add a student or search" value="${esc(filter)}">
      <button type="submit" class="btn btn-primary btn-sm">Add</button>
    </form>
    <div class="csp-list">
      ${list.map(s => `
        <div class="csp-row" data-id="${esc(s.id)}">
          <div class="csp-who">
            <button type="button" class="csp-name" title="Rename">${esc(s.name)}</button>
            <div class="csp-meta">
              ${(s.tags || []).map(t => `<span class="ld-tag-chip">${esc(t)}</span>`).join('')}
              ${!seated.has(s.id) ? '<span class="csp-dim">no seat</span>' : ''}${pins.has(s.id) ? '<span class="csp-dim">📌</span>' : ''}
            </div>
          </div>
          <button type="button" class="csp-icon csp-tag" aria-label="Tags for ${esc(s.name)}" title="Tags">🏷</button>
          <button type="button" class="csp-icon csp-del" aria-label="Remove ${esc(s.name)}" title="Remove from class">✕</button>
        </div>`).join('') || `<p class="csp-empty">${filter ? `No one matches “${esc(filter)}”. Press Add to add them.` : 'No students yet.'}</p>`}
    </div>
    <p class="csp-hint">Changes apply to the whole class. Tags never show on the projector or the printed chart.</p>`;
}

function wireRoster(body, c) {
  const input = body.querySelector('.csp-add-in');
  input.addEventListener('input', () => {
    filter = input.value;
    const pos = input.selectionStart;
    renderClassPanel();
    const again = document.querySelector('#classSidePanel .csp-add-in');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
  body.querySelector('.csp-add').addEventListener('submit', e => {
    e.preventDefault();
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (c.students.some(s => norm(s.name) === norm(name))) { showToast('That name is already in the class'); return; }
    const snap = snapshot();
    const st = { id: 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name, gender: guessGroupForClass(c, name) || null };
    c.students.push(st);
    state.students.push({ ...st });
    filter = '';
    changed(snap, `Added ${name}`);
    document.querySelector('#classSidePanel .csp-add-in')?.focus();
  });
  body.querySelectorAll('.csp-row').forEach(row => {
    const id = row.dataset.id;
    const st = () => c.students.find(s => s.id === id);
    row.querySelector('.csp-name').onclick = () => startRename(row, c, id);
    row.querySelector('.csp-tag').onclick = e => {
      const s = st();
      if (!s) return;
      openTagMenu(c, s, e.currentTarget, () => {
        const mirror = state.students.find(x => x.id === id);
        if (mirror) mirror.tags = [...(s.tags || [])];
        markDirty();
        renderAssignPanel();
        renderClassPanel();
      });
    };
    row.querySelector('.csp-del').onclick = () => {
      const s = st();
      if (!s) return;
      const snap = snapshot();
      removeStudent(c, s);
      changed(snap, `Removed ${s.name}`);
    };
  });
}

function startRename(row, c, id) {
  const s = c.students.find(x => x.id === id);
  const btn = row.querySelector('.csp-name');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'csp-rename';
  input.value = s.name;
  input.setAttribute('aria-label', 'New name');
  btn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!save || !name || name === s.name) { renderClassPanel(); return; }
    if (c.students.some(x => x.id !== id && norm(x.name) === norm(name))) { showToast('Another student already has that name'); renderClassPanel(); return; }
    const snap = snapshot();
    renameStudent(c, s, name);
    changed(snap, `Renamed to ${name}`);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
}

// Rules point at students by name, so a new name has to reach every rule that uses the old one
export function renameStudent(c, s, name) {
  const old = norm(s.name);
  const fix = r => {
    if (norm(r.studentA) === old) r.studentA = name;
    if (norm(r.studentB) === old) r.studentB = name;
  };
  (c.hardRules || []).forEach(fix);
  store.landingData.charts.filter(ch => ch.classId === c.id).forEach(ch => (ch.data?.tempRules || []).forEach(fix));
  (state.tempRules || []).forEach(fix);
  s.name = name;
  const mirror = state.students.find(x => x.id === s.id);
  if (mirror) mirror.name = name;
  state.hardRules = (c.hardRules || []).map(r => ({ ...r }));
}

function removeStudent(c, s) {
  c.students = c.students.filter(x => x.id !== s.id);
  purgeStudentRefs(c, s);
  state.students = state.students.filter(x => x.id !== s.id);
  Object.keys(state.assignments || {}).forEach(k => { if (state.assignments[k] === s.id) delete state.assignments[k]; });
  state.pins = (state.pins || []).filter(x => x !== s.id);
  const nm = norm(s.name);
  state.tempRules = (state.tempRules || []).filter(r => norm(r.studentA) !== nm && norm(r.studentB) !== nm && r.studA !== s.id && r.studB !== s.id);
  state.hardRules = (c.hardRules || []).map(r => ({ ...r }));
}

// ═══ Rules ═══
const TYPES = [
  ['separate', 'Keep apart', 2], ['near', 'Seat near each other', 2], ['partners', 'Same group', 2],
  ['front', 'Toward the front', 1], ['back', 'Toward the back', 1],
  ['spread', 'Spread out a tag', 't'], ['helper', 'Pair a tag with a helper tag', 'tt'],
];
let form = { type: 'separate', a: '', b: '', tag: '', helperTag: '', temp: false };

// Is this one rule met in the chart right now?
function unmet(r) {
  const idOf = n => (state.students.find(s => norm(s.name) === norm(n)) || {}).id;
  let res;
  if (r.type === 'spread' || r.type === 'helper') {
    const tagged = t => state.students.filter(s => hasTag(s, t)).map(s => s.id);
    res = { type: r.type, tag: r.tag, helperTag: r.helperTag, ids: tagged(r.tag), helpers: r.type === 'helper' ? tagged(r.helperTag) : [] };
    if (!res.ids.length) return [];
  } else {
    res = { type: r.type, a: idOf(r.studentA) || r.studA, b: idOf(r.studentB) || r.studB };
    if (!res.a) return [];
  }
  return evaluateRules(state.assignments || {}, getAllSeats(), [res]);
}

function ruleRow(r, i, kind) {
  const { label, text } = ruleSummary(r);
  const bad = unmet(r);
  return `<div class="csp-rule ${bad.length ? 'bad' : ''}">
      <div><span class="ld-rule-tag">${esc(label)}</span> <span>${esc(text)}</span>
        ${kind === 'temp' ? '<small class="csp-dim">this chart only</small>' : ''}
        ${bad.length ? `<small class="csp-warn">⚠ ${esc(violationMessage(bad[0]).replace(/^\S+\s+(Rule:\s*)?/, ''))}</small>` : ''}</div>
      <button type="button" class="csp-icon csp-rdel" data-kind="${kind}" data-i="${i}" aria-label="Delete rule">✕</button>
    </div>`;
}

function rulesHTML(c) {
  const hard = c.hardRules || [], temp = state.tempRules || [];
  const t = TYPES.find(x => x[0] === form.type);
  const kids = [...state.students].sort((a, b) => a.name.localeCompare(b.name));
  const opts = sel => `<option value="">Student…</option>` + kids.map(s => `<option value="${esc(s.name)}" ${sel === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const tags = [...new Set([...classTags(c), ...PRESET_TAGS.filter(p => state.students.some(s => hasTag(s, p)))])];
  const tagOpts = sel => `<option value="">Tag…</option>` + tags.map(x => `<option ${sel === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const bad = [...hard, ...temp].filter(r => unmet(r).length).length;
  return `
    ${hard.length || temp.length ? `<p class="csp-sum">${bad ? `<b class="csp-warn">${bad} not met</b> in this chart` : '✓ Every rule is met in this chart'}</p>` : ''}
    <div class="csp-list">
      ${hard.map((r, i) => ruleRow(r, i, 'class')).join('')}
      ${temp.map((r, i) => ruleRow(r, i, 'temp')).join('')}
      ${!hard.length && !temp.length ? '<p class="csp-empty">No rules yet.</p>' : ''}
    </div>
    <div class="csp-form">
      <select class="csp-type" aria-label="Rule type">${TYPES.map(([k, l]) => `<option value="${k}" ${k === form.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${t[2] === 't' || t[2] === 'tt'
        ? `<select class="csp-tagA" aria-label="Tag">${tagOpts(form.tag)}</select>${t[2] === 'tt' ? `<select class="csp-tagB" aria-label="Helper tag">${tagOpts(form.helperTag)}</select>` : ''}`
        : `<select class="csp-a" aria-label="Student">${opts(form.a)}</select>${t[2] === 2 ? `<select class="csp-b" aria-label="Second student">${opts(form.b)}</select>` : ''}`}
      <div class="csp-form-row">
        <label class="csp-temp" ${typeof t[2] === 'string' ? 'hidden' : ''}><input type="checkbox" ${form.temp ? 'checked' : ''}> This chart only</label>
        <button type="button" class="btn btn-primary btn-sm csp-radd">Add rule</button>
      </div>
      ${typeof t[2] === 'string' && !tags.length ? '<p class="csp-hint">Tag students first (Roster tab, 🏷).</p>' : ''}
    </div>
    <p class="csp-hint">Class rules apply to every chart of this class. Tip: you can also tell the helper (lower right) “Keep Liam and Owen apart”.</p>`;
}

function wireRules(body, c) {
  const val = s => body.querySelector(s)?.value || '';
  const keep = () => { form = { ...form, type: val('.csp-type'), a: val('.csp-a'), b: val('.csp-b'), tag: val('.csp-tagA'), helperTag: val('.csp-tagB'), temp: !!body.querySelector('.csp-temp input')?.checked }; };
  body.querySelector('.csp-type').onchange = () => { keep(); renderClassPanel(); };
  body.querySelectorAll('.csp-a, .csp-b, .csp-tagA, .csp-tagB, .csp-temp input').forEach(x => x.onchange = keep);
  body.querySelector('.csp-radd').onclick = () => {
    keep();
    const kind = TYPES.find(x => x[0] === form.type)[2];
    let rule;
    if (kind === 't' || kind === 'tt') {
      if (!form.tag) { showToast('Pick a tag'); return; }
      if (kind === 'tt' && (!form.helperTag || form.helperTag === form.tag)) { showToast('Pick two different tags'); return; }
      rule = kind === 't' ? { type: 'spread', tag: form.tag } : { type: 'helper', tag: form.tag, helperTag: form.helperTag };
    } else {
      if (!form.a || (kind === 2 && !form.b)) { showToast(kind === 2 ? 'Pick two students' : 'Pick a student'); return; }
      if (kind === 2 && form.a === form.b) { showToast('Pick two different students'); return; }
      rule = { type: form.type, studentA: form.a, studentB: kind === 2 ? form.b : '' };
    }
    const same = r => r.type === rule.type && (rule.tag ? norm(r.tag) === norm(rule.tag) && norm(r.helperTag) === norm(rule.helperTag)
      : [norm(r.studentA), norm(r.studentB)].sort().join('|') === [norm(rule.studentA), norm(rule.studentB)].sort().join('|'));
    if ([...(state.hardRules || []), ...(state.tempRules || [])].some(same)) { showToast('That rule is already there'); return; }
    const snap = snapshot();
    if (form.temp && kind !== 't' && kind !== 'tt') {
      const ids = [form.a, form.b].map(n => (state.students.find(s => s.name === n) || {}).id);
      state.tempRules.push({ id: uid(), perm: false, ...rule, studA: ids[0], ...(kind === 2 ? { studB: ids[1] } : {}) });
    } else {
      c.hardRules = c.hardRules || [];
      c.hardRules.push(rule);
      state.hardRules = c.hardRules.map(r => ({ ...r }));
    }
    form = { ...form, a: '', b: '' };
    changed(snap, 'Rule added');
  };
  body.querySelectorAll('.csp-rdel').forEach(b => b.onclick = () => {
    const snap = snapshot();
    const i = +b.dataset.i;
    if (b.dataset.kind === 'temp') state.tempRules.splice(i, 1);
    else { c.hardRules.splice(i, 1); state.hardRules = c.hardRules.map(r => ({ ...r })); }
    changed(snap, 'Rule removed');
  });
}
