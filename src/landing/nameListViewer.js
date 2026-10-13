import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { openModal, showToast } from '../core/ui.js';
import { renderLdStudentCols } from './roster.js';
import { firstNameOf } from '../roster/builtinNames.js';
import { autoSortClass, capName, mergeNameList, nameList, nameStatus, normalizeName, recordPlacement, saveNameList } from '../roster/nameList.js';
import { saveLandingData } from '../storage/landingData.js';

// ═══════════════════════════════════════════════
//  NAME LIST VIEWER
// ═══════════════════════════════════════════════
export function openNameList(search) {
  document.getElementById('nlSearch').value = search || '';
  renderNameList();
  openModal('nameListModal');
}

export function nlStatusHTML(st) {
  let chip, detail = [];
  if (st.pin === 'boy') chip = '<span class="nl-chip boys">Pinned: Boys</span>';
  else if (st.pin === 'girl') chip = '<span class="nl-chip girls">Pinned: Girls</span>';
  else if (st.pin === 'ask') chip = '<span class="nl-chip flag">⚑ Always ask</span>';
  else if (st.flagged) chip = '<span class="nl-chip flag">⚑ Flagged</span>';
  else if (st.kind === 'boys') chip = '<span class="nl-chip boys">→ Boys</span>';
  else if (st.kind === 'girls') chip = '<span class="nl-chip girls">→ Girls</span>';
  else chip = '<span class="nl-chip none">Not known yet</span>';
  if (st.learnedBoy || st.learnedGirl) detail.push(`sorted by you: boy ${st.learnedBoy} · girl ${st.learnedGirl}`);
  if (st.builtin === 'both') detail.push('built-in: used for both');
  else if (st.builtin) detail.push(`built-in: ${st.builtin}`);
  return chip + (detail.length ? `<span>${esc(detail.join(' · '))}</span>` : '');
}

export function nlRowHTML(n, display, rosterCount, ungrouped) {
  const st = nameStatus(n);
  const hasData = Object.values(nameList.votes).some(v => v[0] === n) || nameList.pins[n];
  return `<div class="nl-row" data-n="${esc(n)}">
    <div class="nl-name">${esc(display)}</div>
    <div class="nl-info">${nlStatusHTML(st)}${rosterCount ? `<span> · ${rosterCount} student${rosterCount !== 1 ? 's' : ''} in your classes${ungrouped ? `, ${ungrouped} ungrouped` : ''}</span>` : ''}</div>
    <select class="nl-pin" title="Override what ClassMap does with this name">
      <option value="" ${!st.pin ? 'selected' : ''}>Automatic</option>
      <option value="boy" ${st.pin === 'boy' ? 'selected' : ''}>Always boy</option>
      <option value="girl" ${st.pin === 'girl' ? 'selected' : ''}>Always girl</option>
      <option value="ask" ${st.pin === 'ask' ? 'selected' : ''}>Always ask</option>
    </select>
    ${hasData ? '<button class="nl-del" title="Forget what was learned about this name">✕</button>' : '<span style="width:20px"></span>'}
  </div>`;
}

export function renderNameList() {
  const body = document.getElementById('nlBody');
  const q = normalizeName(document.getElementById('nlSearch').value);
  const rawQ = document.getElementById('nlSearch').value.trim();

  // Every first name we know about: learned, pinned, or present in a roster
  const display = new Map(), rosterCount = new Map(), ungroupedCount = new Map();
  Object.values(nameList.votes).forEach(v => { if (!display.has(v[0])) display.set(v[0], v[2] || capName(v[0])); });
  Object.keys(nameList.pins).forEach(n => { if (!display.has(n)) display.set(n, capName(n)); });
  store.landingData.classes.forEach(c => c.students.forEach(st => {
    const f = firstNameOf(st.name), n = normalizeName(f);
    if (!n) return;
    rosterCount.set(n, (rosterCount.get(n) || 0) + 1);
    if (c.genderMode && !(st.gender && (c.genderGroups || []).some(g => g.id === st.gender))) {
      ungroupedCount.set(n, (ungroupedCount.get(n) || 0) + 1);
    }
    if (!display.has(n)) display.set(n, f);
  }));
  const learned = new Set([...Object.values(nameList.votes).map(v => v[0]), ...Object.keys(nameList.pins)]);

  const match = n => !q || n.includes(q);
  // "Needs your decision" = flagged names that still have an ungrouped student waiting
  const needs = [...display.keys()].filter(n => ungroupedCount.has(n) && match(n))
    .filter(n => { const st = nameStatus(n); return st.flagged && st.pin !== 'ask'; })
    .sort((a, b) => display.get(a).localeCompare(display.get(b)));
  const needsSet = new Set(needs);
  const others = [...learned].filter(n => match(n) && !needsSet.has(n))
    .sort((a, b) => display.get(a).localeCompare(display.get(b)));

  let html = '';
  if (needs.length) html += `<div class="nl-section">⚑ Needs your decision (${needs.length})</div>` +
    needs.map(n => nlRowHTML(n, display.get(n), rosterCount.get(n), ungroupedCount.get(n))).join('');
  if (others.length) html += `<div class="nl-section">Learned &amp; pinned names (${others.length})</div>` +
    others.map(n => nlRowHTML(n, display.get(n), rosterCount.get(n), ungroupedCount.get(n))).join('');
  if (q && !display.has(q)) {
    html += `<div class="nl-section">Check this name</div>` + nlRowHTML(q, capName(rawQ.split(/\s+/)[0] || q), 0);
  }
  if (!html) html = `<div class="nl-empty">Nothing learned yet.<br>Drag students into Boys or Girls groups on the Roster tab — ClassMap remembers each first name and sorts it for you next time.</div>`;
  body.innerHTML = html;

  // Summary
  const nVotes = Object.keys(nameList.votes).length;
  const nNames = new Set(Object.values(nameList.votes).map(v => v[0])).size;
  const nFlag = [...display.keys()].filter(n => ungroupedCount.has(n) && nameStatus(n).flagged && nameStatus(n).pin !== 'ask').length;
  document.getElementById('nlSummary').textContent =
    `${nNames} name${nNames !== 1 ? 's' : ''} learned from ${nVotes} student${nVotes !== 1 ? 's' : ''} you sorted · ${nFlag} flagged name${nFlag !== 1 ? 's' : ''} waiting on you`;

  body.querySelectorAll('.nl-row').forEach(row => {
    const n = row.dataset.n;
    row.querySelector('.nl-pin').addEventListener('change', e => nlSetPin(n, e.target.value));
    const del = row.querySelector('.nl-del');
    if (del) del.addEventListener('click', () => nlForget(n));
  });
}

export function nlRefreshRoster() {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  let moved = 0;
  if (cls && cls.genderMode) { moved = autoSortClass(cls).moved; saveLandingData(); renderLdStudentCols(cls); }
  return moved;
}

export function nlSetPin(n, val) {
  if (val) nameList.pins[n] = val; else delete nameList.pins[n];
  saveNameList();
  const moved = nlRefreshRoster();
  renderNameList();
  if (moved) showToast(`Sorted ${moved} student${moved !== 1 ? 's' : ''} in this class`);
}

export function nlForget(n) {
  Object.keys(nameList.votes).forEach(sid => { if (nameList.votes[sid][0] === n) delete nameList.votes[sid]; });
  delete nameList.pins[n];
  saveNameList();
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (cls) renderLdStudentCols(cls);
  renderNameList();
}

// Bootstrap: learn from students already sitting in Boys/Girls groups
export function learnFromRosters() {
  let n = 0;
  store.landingData.classes.forEach(cls => {
    (cls.students || []).forEach(st => {
      const g = (cls.genderGroups || []).find(x => x.id === st.gender);
      if (g && (g.kind === 'boys' || g.kind === 'girls') && recordPlacement(st, g)) n++;
    });
  });
  renderNameList();
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (cls) renderLdStudentCols(cls);
  showToast(n ? `Learned from ${n} sorted student${n !== 1 ? 's' : ''}` : 'Nothing new to learn from your classes');
}

export function exportNameList() {
  const blob = new Blob([JSON.stringify({ classmapNameList: 1, votes: nameList.votes, pins: nameList.pins }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'classmap-name-list.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importNameListFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const n = mergeNameList(data.nameList || data);
      renderNameList();
      const moved = nlRefreshRoster();
      showToast(n ? `Imported ${n} entr${n !== 1 ? 'ies' : 'y'}${moved ? ` · sorted ${moved} in this class` : ''}` : 'Nothing new in that file');
    } catch (e) { showToast('❌ That file is not a ClassMap name list'); }
    input.value = '';
  };
  reader.readAsText(file);
}
