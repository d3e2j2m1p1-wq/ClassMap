// ═══════════════════════════════════════════════
//  CLASSROOM TOOLS — full screen, projector-friendly
//  🎲 Name picker: everyone gets a turn before anyone repeats (the round is remembered on this device)
//  👥 Group maker: groups for an activity, following the class's rules; doesn't touch any chart
//  "Who's here" is shared by both: tap a name to mark them absent for today.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { editorOpen } from '../storage/autosave.js';
import { makeGroups } from './groups.js';

let ov = null;
let tool = 'picker';
let classId = null;
let showHere = false;
let groupsOut = null;
let spinTimer = null;
const opts = { size: 4, mode: 'size', count: 6, followRules: true, mix: false, avoidRecent: true };

const today = () => new Date().toISOString().slice(0, 10);
const cls = () => (store.landingData?.classes || []).find(c => c.id === classId) || null;

// ── Small per-device memory (not synced, not exported) ──
const KEY = () => `cm-tools-${classId}`;
function mem() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(KEY()) || '{}'); } catch { /* none */ }
  if (m.absentDay !== today()) { m.absent = []; m.absentDay = today(); }   // absences reset each day
  return { picked: [], absent: [], lastGroups: [], noRepeats: true, ...m };
}
function saveMem(m) { try { localStorage.setItem(KEY(), JSON.stringify(m)); } catch { /* private mode */ } }
const here = () => { const m = mem(); return (cls()?.students || []).filter(s => !m.absent.includes(s.id)); };

// ── Open / close ──
export function openTools(which = 'picker', options = {}) {
  classId = editorOpen() ? window._currentChartClassId : store.activeClassId;
  const c = cls();
  if (!c) { showToast('Pick a class first'); return; }
  if (!(c.students || []).length) { showToast('Add students to this class first'); return; }
  tool = which;
  Object.assign(opts, options);
  groupsOut = null;
  showHere = false;
  closeTools();
  ov = document.createElement('div');
  ov.className = 'tools-view';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Classroom tools');
  document.body.appendChild(ov);
  document.body.classList.add('presenting');
  document.addEventListener('keydown', onKey, true);
  render();
  if (which === 'groups' && options.make) makeNow();
}
export function closeTools() {
  if (!ov) return;
  clearInterval(spinTimer);
  ov.remove();
  ov = null;
  document.body.classList.remove('presenting');
  document.removeEventListener('keydown', onKey, true);
}
function onKey(e) {
  if (!ov) return;
  if (e.key === 'Escape') { e.preventDefault(); if (showHere) { showHere = false; render(); } else closeTools(); return; }
  if (e.target.closest('input, select, textarea')) return;
  if (tool === 'picker' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); pick(); }
}

function render() {
  const c = cls();
  const m = mem();
  const n = here().length, total = c.students.length;
  ov.innerHTML = `
    <div class="tools-bar">
      <div class="tools-title">${esc(c.name)}</div>
      <div class="tools-tabs" role="tablist">
        <button type="button" role="tab" class="tools-tab ${tool === 'picker' ? 'active' : ''}" data-t="picker">🎲 Name picker</button>
        <button type="button" role="tab" class="tools-tab ${tool === 'groups' ? 'active' : ''}" data-t="groups">👥 Groups</button>
      </div>
      <button type="button" class="tools-here ${n < total ? 'some-out' : ''}" aria-expanded="${showHere}">Here: ${n}/${total}</button>
      <button type="button" class="tools-exit">Exit <kbd>Esc</kbd></button>
    </div>
    ${showHere ? hereHTML(c, m) : ''}
    <div class="tools-stage">${tool === 'picker' ? pickerHTML(c, m) : groupsHTML(c)}</div>`;
  ov.querySelectorAll('.tools-tab').forEach(b => b.onclick = () => { tool = b.dataset.t; render(); });
  ov.querySelector('.tools-exit').onclick = closeTools;
  ov.querySelector('.tools-here').onclick = () => { showHere = !showHere; render(); };
  if (showHere) wireHere();
  (tool === 'picker' ? wirePicker : wireGroups)();
}

// ── Who's here ──
function hereHTML(c, m) {
  const kids = [...c.students].sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="tools-here-panel">
      <p>Tap anyone who’s absent today. They’re left out of picks and groups until tomorrow.</p>
      <div class="tools-chips">${kids.map(s => `<button type="button" class="tools-chip ${m.absent.includes(s.id) ? 'out' : ''}" data-id="${esc(s.id)}" aria-pressed="${m.absent.includes(s.id)}">${esc(s.name)}</button>`).join('')}</div>
      <div class="tools-row"><button type="button" class="tools-btn ghost tools-all-here">Everyone’s here</button><button type="button" class="tools-btn tools-here-done">Done</button></div>
    </div>`;
}
function wireHere() {
  ov.querySelectorAll('.tools-chip').forEach(b => b.onclick = () => {
    const m = mem();
    const id = b.dataset.id;
    m.absent = m.absent.includes(id) ? m.absent.filter(x => x !== id) : [...m.absent, id];
    saveMem(m);
    groupsOut = null;
    render();
  });
  ov.querySelector('.tools-all-here').onclick = () => { const m = mem(); m.absent = []; saveMem(m); render(); };
  ov.querySelector('.tools-here-done').onclick = () => { showHere = false; render(); };
}

// ══ 🎲 Name picker ══
let current = null;
function pool(m) {
  const kids = here();
  if (!m.noRepeats) return kids;
  return kids.filter(s => !m.picked.includes(s.id));
}
function pickerHTML(c, m) {
  const left = pool(m), kids = here();
  const done = m.noRepeats && kids.length && !left.length;
  const recent = m.picked.slice(-8).reverse().map(id => c.students.find(s => s.id === id)).filter(Boolean);
  return `
    <div class="picker">
      <div class="picker-name ${current ? '' : 'idle'}" aria-live="polite">${current ? esc(current.name) : done ? 'Everyone’s had a turn' : 'Ready'}</div>
      <div class="tools-row center">
        ${done ? '<button type="button" class="tools-btn big picker-new">Start a new round</button>'
          : `<button type="button" class="tools-btn big picker-go" ${kids.length ? '' : 'disabled'}>Pick a name</button>`}
      </div>
      <p class="picker-left">${m.noRepeats ? `${left.length} of ${kids.length} still to go this round` : `Picking from ${kids.length}`}${kids.length < c.students.length ? ` · ${c.students.length - kids.length} absent` : ''}</p>
      <div class="tools-row center small">
        <label class="tools-check"><input type="checkbox" class="picker-norep" ${m.noRepeats ? 'checked' : ''}> Everyone once before repeats</label>
        ${m.picked.length ? '<button type="button" class="tools-link picker-undo">Put the last name back</button><button type="button" class="tools-link picker-reset">Start over</button>' : ''}
      </div>
      ${recent.length ? `<div class="picker-recent"><span>Called:</span> ${recent.map(s => esc(s.name)).join(' · ')}</div>` : ''}
      <p class="tools-tip">Press Space to pick.</p>
    </div>`;
}
function wirePicker() {
  ov.querySelector('.picker-go')?.addEventListener('click', pick);
  ov.querySelector('.picker-new')?.addEventListener('click', () => { const m = mem(); m.picked = []; saveMem(m); current = null; render(); });
  ov.querySelector('.picker-norep').onchange = e => { const m = mem(); m.noRepeats = e.target.checked; saveMem(m); render(); };
  ov.querySelector('.picker-undo')?.addEventListener('click', () => { const m = mem(); m.picked.pop(); saveMem(m); current = null; render(); });
  ov.querySelector('.picker-reset')?.addEventListener('click', () => { const m = mem(); m.picked = []; saveMem(m); current = null; render(); });
}
function pick() {
  if (spinTimer) return;
  const m = mem();
  let left = pool(m);
  if (!left.length) { if (!m.noRepeats || !here().length) return; m.picked = []; left = here(); }
  const chosen = left[Math.floor(Math.random() * left.length)];
  m.picked.push(chosen.id);
  saveMem(m);
  const box = ov.querySelector('.picker-name');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || window.__cmNoSpin;
  if (reduce || here().length < 2) { current = chosen; render(); return; }
  // a quick shuffle through names, slowing down, then the pick
  const names = here();
  let i = 0, delay = 40;
  box.classList.remove('idle');
  box.classList.add('spinning');
  const step = () => {
    box.textContent = names[Math.floor(Math.random() * names.length)].name;
    i++;
    if (i > 14) { spinTimer = null; current = chosen; render(); return; }
    delay *= 1.15;
    spinTimer = setTimeout(step, delay);
  };
  spinTimer = setTimeout(step, delay);
}

// ══ 👥 Groups ══
function groupsHTML(c) {
  const n = here().length;
  const hasKinds = c.genderMode && new Set(here().map(s => s.gender || '?')).size > 1;
  const sizes = [2, 3, 4, 5, 6];
  return `
    <div class="groups">
      <div class="groups-controls">
        <select class="tools-select groups-mode" aria-label="How to split">
          <option value="size" ${opts.mode === 'size' ? 'selected' : ''}>Groups of</option>
          <option value="count" ${opts.mode === 'count' ? 'selected' : ''}>Number of groups</option>
        </select>
        <select class="tools-select groups-n" aria-label="${opts.mode === 'size' ? 'Group size' : 'Number of groups'}">
          ${(opts.mode === 'size' ? sizes : Array.from({ length: Math.max(1, Math.min(12, n)) }, (_, i) => i + 2).filter(k => k <= n))
            .map(k => `<option ${k === (opts.mode === 'size' ? opts.size : opts.count) ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
        <label class="tools-check"><input type="checkbox" class="groups-rules" ${opts.followRules ? 'checked' : ''}> Follow class rules</label>
        ${hasKinds ? `<label class="tools-check"><input type="checkbox" class="groups-mix" ${opts.mix ? 'checked' : ''}> Mix ${esc((c.genderGroups || []).map(g => g.name).join(' / ') || 'groups')}</label>` : ''}
        <label class="tools-check"><input type="checkbox" class="groups-recent" ${opts.avoidRecent ? 'checked' : ''}> New partners from last time</label>
        <button type="button" class="tools-btn groups-go">${groupsOut ? 'Shuffle again' : 'Make groups'}</button>
        ${groupsOut ? '<button type="button" class="tools-btn ghost groups-copy">Copy</button>' : ''}
      </div>
      ${groupsOut ? `
        ${groupsOut.problems.length ? `<p class="groups-note">Couldn’t keep every rule: ${groupsOut.problems.map(esc).join('; ')}.</p>` : ''}
        <div class="groups-grid" style="--cols:${Math.min(groupsOut.groups.length, groupsOut.groups.length > 6 ? 4 : 3)}">
          ${groupsOut.groups.map((g, i) => `<div class="group-card"><div class="group-h">Group ${i + 1}</div>${g.map(s => `<div class="group-name">${esc(s.name)}</div>`).join('')}</div>`).join('')}
        </div>` : `<p class="groups-empty">${n} students here. Choose a size and press <b>Make groups</b>.</p>`}
    </div>`;
}
function wireGroups() {
  const q = s => ov.querySelector(s);
  q('.groups-mode').onchange = e => { opts.mode = e.target.value; render(); };
  q('.groups-n').onchange = e => { if (opts.mode === 'size') opts.size = +e.target.value; else opts.count = +e.target.value; };
  q('.groups-rules').onchange = e => { opts.followRules = e.target.checked; };
  q('.groups-mix')?.addEventListener('change', e => { opts.mix = e.target.checked; });
  q('.groups-recent').onchange = e => { opts.avoidRecent = e.target.checked; };
  q('.groups-go').onclick = makeNow;
  q('.groups-copy')?.addEventListener('click', async () => {
    const text = groupsOut.groups.map((g, i) => `Group ${i + 1}: ${g.map(s => s.name).join(', ')}`).join('\n');
    try { await navigator.clipboard.writeText(text); showToast('Groups copied'); } catch { showToast('Couldn’t copy here'); }
  });
}
export function makeNow() {
  const c = cls();
  const m = mem();
  const kids = here();
  if (kids.length < 2) { showToast('Need at least two students here'); return; }
  groupsOut = makeGroups(kids, {
    size: opts.size, count: opts.mode === 'count' ? opts.count : null,
    rules: c.hardRules || [], followRules: opts.followRules, mix: opts.mix,
    recent: opts.avoidRecent ? m.lastGroups : [],
  });
  m.lastGroups = groupsOut.groups.map(g => g.map(s => s.id));
  saveMem(m);
  render();
}
