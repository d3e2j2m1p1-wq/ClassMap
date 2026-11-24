// ═══════════════════════════════════════════════
//  CLASSROOM TOOLS — full screen, projector-friendly
//  🎲 Name picker: everyone gets a turn before anyone repeats (the round is remembered on this device)
//  👥 Group maker: groups for an activity, following the class's rules; doesn't touch any chart
//  "Here" is today's attendance (shared with the seating chart): absent students are skipped.
//  The picker also has a skip list: students the teacher never wants called on at random.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { editorOpen } from '../storage/autosave.js';
import { saveLandingData } from '../storage/landingData.js';
import { makeGroups } from './groups.js';
import { clearDay, cycleStatus, getDay, summaryText } from './attendance.js';
import { addPoint, dayPoints } from './participation.js';
import { state } from '../core/state.js';
import { getAllSeats } from '../assign/seats.js';

let ov = null;
let tool = 'picker';
let classId = null;
let showHere = false;     // the attendance list
let showSkip = false;     // the picker's skip list
let groupsOut = null;
let spinTimer = null;
const opts = { size: 4, mode: 'size', count: 6, followRules: true, mix: false, avoidRecent: true };

const cls = () => (store.landingData?.classes || []).find(c => c.id === classId) || null;

// ── Small per-device memory (not synced, not exported) ──
const KEY = () => `cm-tools-${classId}`;
function mem() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(KEY()) || '{}'); } catch { /* none */ }
  return { picked: [], lastGroups: [], noRepeats: true, ...m };
}
function saveMem(m) { try { localStorage.setItem(KEY(), JSON.stringify(m)); } catch { /* private mode */ } }
// Everyone who isn't marked absent today (late counts as here)
const here = () => { const out = getDay(classId).absent; return (cls()?.students || []).filter(s => !out.includes(s.id)); };
// The picker also leaves out the class's skip list
const skipList = () => cls()?.pickerSkip || [];
const pickable = () => here().filter(s => !skipList().includes(s.id));

// ── Open / close ──
export function openTools(which = 'picker', options = {}) {
  classId = editorOpen() ? window._currentChartClassId : store.activeClassId;
  const c = cls();
  if (!c) { showToast('Pick a class first'); return; }
  if (!(c.students || []).length) { showToast('Add students to this class first'); return; }
  tool = which;
  Object.assign(opts, options);
  if (which === 'timer' && options.minutes) { Object.assign(timer, { total: options.minutes * 60, left: options.minutes * 60, running: false, done: false }); }
  if (which === 'voice' && options.level != null) { const m = mem(); m.voice = options.level; saveMem(m); }
  groupsOut = null;
  showHere = !!options.here;
  showSkip = false;
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
  if (which === 'timer' && options.start) toggleTimer();
}
export function closeTools() {
  if (!ov) return;
  clearInterval(spinTimer);
  stopTick();
  Object.assign(timer, { left: timer.total, running: false, done: false });
  ov.remove();
  ov = null;
  document.body.classList.remove('presenting');
  document.removeEventListener('keydown', onKey, true);
}
function onKey(e) {
  if (!ov) return;
  if (e.key === 'Escape') { e.preventDefault(); if (showHere || showSkip) { showHere = showSkip = false; render(); } else closeTools(); return; }
  if (e.target.closest('input, select, textarea')) return;
  if (tool === 'picker' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); pick(); }
  if (tool === 'timer' && e.key === ' ') { e.preventDefault(); toggleTimer(); }
  if (tool === 'voice' && /^[0-3]$/.test(e.key)) { e.preventDefault(); setVoice(+e.key); }
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
        <button type="button" role="tab" class="tools-tab ${tool === 'timer' ? 'active' : ''}" data-t="timer">⏱ <span class="tab-time">${timer.running ? fmt(timer.left) : 'Timer'}</span></button>
        <button type="button" role="tab" class="tools-tab ${tool === 'voice' ? 'active' : ''}" data-t="voice">🔊 Voice</button>
        <button type="button" role="tab" class="tools-tab ${tool === 'print' ? 'active' : ''}" data-t="print">🏷 Name tents</button>
      </div>
      <button type="button" class="tools-here ${n < total ? 'some-out' : ''}" aria-expanded="${showHere}">Here: ${n}/${total}</button>
      <button type="button" class="tools-exit">Exit <kbd>Esc</kbd></button>
    </div>
    ${showHere ? hereHTML(c) : showSkip ? skipHTML(c) : ''}
    <div class="tools-stage">${{ picker: () => pickerHTML(c, m), groups: () => groupsHTML(c), timer: timerHTML, voice: () => voiceHTML(m), print: printHTML }[tool]()}</div>`;
  ov.querySelectorAll('.tools-tab').forEach(b => b.onclick = () => { tool = b.dataset.t; render(); });
  ov.querySelector('.tools-exit').onclick = closeTools;
  ov.querySelector('.tools-here').onclick = () => { showHere = !showHere; showSkip = false; render(); };
  if (showHere) wireHere();
  if (showSkip) wireSkip();
  ({ picker: wirePicker, groups: wireGroups, timer: wireTimer, voice: wireVoice, print: wirePrint })[tool]();
}

// ── Who's here (today's attendance, shared with the seating chart) ──
function hereHTML(c) {
  const d = getDay(classId);
  const kids = [...c.students].sort((a, b) => a.name.localeCompare(b.name));
  const st = id => d.absent.includes(id) ? 'out' : d.tardy.includes(id) ? 'late' : '';
  return `<div class="tools-here-panel">
      <p>Tap a name once for <b>absent</b>, twice for <b>late</b>, again for here. Absent students are skipped until tomorrow.</p>
      <div class="tools-chips">${kids.map(s => `<button type="button" class="tools-chip ${st(s.id)}" data-id="${esc(s.id)}">${esc(s.name)}${st(s.id) === 'late' ? ' <small>late</small>' : ''}</button>`).join('')}</div>
      <div class="tools-row"><button type="button" class="tools-btn ghost tools-all-here">Everyone’s here</button><button type="button" class="tools-btn ghost tools-copy-att">Copy attendance</button><button type="button" class="tools-btn tools-here-done">Done</button></div>
    </div>`;
}
function wireHere() {
  ov.querySelectorAll('.tools-here-panel .tools-chip').forEach(b => b.onclick = () => {
    cycleStatus(classId, b.dataset.id);
    groupsOut = null;
    render();
  });
  ov.querySelector('.tools-all-here').onclick = () => { clearDay(classId); render(); };
  ov.querySelector('.tools-copy-att').onclick = async () => {
    try { await navigator.clipboard.writeText(summaryText(cls())); showToast('Attendance copied'); } catch { showToast('Couldn’t copy here'); }
  };
  ov.querySelector('.tools-here-done').onclick = () => { showHere = false; render(); };
}

// ── The picker's skip list (saved with the class) ──
function skipHTML(c) {
  const kids = [...c.students].sort((a, b) => a.name.localeCompare(b.name));
  const skip = skipList();
  return `<div class="tools-here-panel">
      <p>Students on this list are never picked at random (they still join groups). Tap a name to add or remove them.</p>
      <div class="tools-chips">${kids.map(s => `<button type="button" class="tools-chip ${skip.includes(s.id) ? 'skip' : ''}" data-id="${esc(s.id)}" aria-pressed="${skip.includes(s.id)}">${esc(s.name)}</button>`).join('')}</div>
      <div class="tools-row">${skip.length ? '<button type="button" class="tools-btn ghost tools-skip-clear">Clear the list</button>' : ''}<button type="button" class="tools-btn tools-skip-done">Done</button></div>
    </div>`;
}
function wireSkip() {
  const c = cls();
  ov.querySelectorAll('.tools-here-panel .tools-chip').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    const list = skipList();
    c.pickerSkip = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    saveLandingData();
    render();
  });
  ov.querySelector('.tools-skip-clear')?.addEventListener('click', () => { c.pickerSkip = []; saveLandingData(); render(); });
  ov.querySelector('.tools-skip-done').onclick = () => { showSkip = false; render(); };
}

// ══ 🎲 Name picker ══
let current = null;
function pool(m) {
  const kids = pickable();
  if (!m.noRepeats) return kids;
  return kids.filter(s => !m.picked.includes(s.id));
}
function pickerHTML(c, m) {
  const left = pool(m), kids = pickable();
  const absent = c.students.length - here().length, skipped = here().length - kids.length;
  const done = m.noRepeats && kids.length && !left.length;
  const recent = m.picked.slice(-8).reverse().map(id => c.students.find(s => s.id === id)).filter(Boolean);
  return `
    <div class="picker">
      <div class="picker-name ${current ? '' : 'idle'}" aria-live="polite">${current ? esc(current.name) : done ? 'Everyone’s had a turn' : 'Ready'}</div>
      <div class="tools-row center">
        ${done ? '<button type="button" class="tools-btn big picker-new">Start a new round</button>'
          : `<button type="button" class="tools-btn big picker-go" ${kids.length ? '' : 'disabled'}>Pick a name</button>`}
      </div>
      <p class="picker-left">${m.noRepeats ? `${left.length} of ${kids.length} still to go this round` : `Picking from ${kids.length}`}${absent ? ` · ${absent} absent` : ''}${skipped ? ` · ${skipped} skipped` : ''}</p>
      <div class="tools-row center small">
        <label class="tools-check"><input type="checkbox" class="picker-norep" ${m.noRepeats ? 'checked' : ''}> Everyone once before repeats</label>
        <label class="tools-check" title="Students with fewer participation points today are more likely to be picked"><input type="checkbox" class="picker-favor" ${m.favor ? 'checked' : ''}> Favor fewer points</label>
        <label class="tools-check"><input type="checkbox" class="picker-award" ${m.award ? 'checked' : ''}> A pick earns a point</label>
        <button type="button" class="tools-link picker-skip">Skip list${skipList().length ? ` (${skipList().length})` : ''}</button>
        ${m.picked.length ? '<button type="button" class="tools-link picker-undo">Put the last name back</button><button type="button" class="tools-link picker-reset">Start over</button>' : ''}
      </div>
      ${recent.length ? `<div class="picker-recent"><span>Called:</span> ${recent.map(s => esc(s.name)).join(' · ')}</div>` : ''}
      <p class="tools-tip">Press Space to pick.</p>
    </div>`;
}
function wirePicker() {
  ov.querySelector('.picker-go')?.addEventListener('click', pick);
  ov.querySelector('.picker-new')?.addEventListener('click', () => { const m = mem(); m.picked = []; saveMem(m); current = null; render(); });
  ov.querySelector('.picker-skip').onclick = () => { showSkip = !showSkip; showHere = false; render(); };
  ov.querySelector('.picker-favor').onchange = e => { const m = mem(); m.favor = e.target.checked; saveMem(m); };
  ov.querySelector('.picker-award').onchange = e => { const m = mem(); m.award = e.target.checked; saveMem(m); };
  ov.querySelector('.picker-norep').onchange = e => { const m = mem(); m.noRepeats = e.target.checked; saveMem(m); render(); };
  ov.querySelector('.picker-undo')?.addEventListener('click', () => { const m = mem(); m.picked.pop(); saveMem(m); current = null; render(); });
  ov.querySelector('.picker-reset')?.addEventListener('click', () => { const m = mem(); m.picked = []; saveMem(m); current = null; render(); });
}
function pick() {
  if (spinTimer) return;
  const m = mem();
  let left = pool(m);
  if (!left.length) { if (!m.noRepeats || !pickable().length) return; m.picked = []; left = pickable(); }
  // with "favor fewer points", someone with 0 points is 3× as likely as someone with 2
  let chosen;
  if (m.favor) {
    const pts = dayPoints(classId);
    const w = left.map(s => 1 / (1 + (pts[s.id] || 0)));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    chosen = left.find((s, i) => (r -= w[i]) <= 0) || left[left.length - 1];
  } else chosen = left[Math.floor(Math.random() * left.length)];
  if (m.award) addPoint(classId, chosen.id, 1);
  m.picked.push(chosen.id);
  saveMem(m);
  const box = ov.querySelector('.picker-name');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || window.__cmNoSpin;
  if (reduce || pickable().length < 2) { current = chosen; render(); return; }
  // a quick shuffle through names, slowing down, then the pick
  const names = pickable();
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

// ══ ⏱ Timer ══
// Keeps running while you switch tools; stops when the tools close.
const timer = { total: 300, left: 300, running: false, endAt: 0, done: false, tick: null, sound: true };
const fmt = s => { s = Math.max(0, Math.ceil(Math.round(s * 10) / 10)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function timerHTML() {
  const pct = timer.total ? (1 - timer.left / timer.total) * 100 : 0;
  return `
    <div class="timer ${timer.done ? 'done' : ''}">
      <div class="timer-digits" aria-live="off">${timer.done ? 'Time’s up!' : fmt(timer.left)}</div>
      <div class="timer-bar"><div style="width:${timer.done ? 100 : pct}%"></div></div>
      <div class="tools-row center">
        <button type="button" class="tools-btn ghost timer-minus" ${timer.running ? 'disabled' : ''} aria-label="One minute less">−1 min</button>
        <button type="button" class="tools-btn big timer-go">${timer.running ? 'Pause' : timer.done ? 'Again' : timer.left < timer.total ? 'Resume' : 'Start'}</button>
        <button type="button" class="tools-btn ghost timer-plus" aria-label="One minute more">+1 min</button>
      </div>
      <div class="tools-row center timer-presets">
        ${[1, 2, 3, 5, 10, 15, 20, 30].map(n => `<button type="button" class="tools-chip timer-set ${timer.total === n * 60 ? 'on' : ''}" data-m="${n}">${n} min</button>`).join('')}
      </div>
      <div class="tools-row center small">
        <button type="button" class="tools-link timer-reset">Reset</button>
        <label class="tools-check"><input type="checkbox" class="timer-sound" ${timer.sound ? 'checked' : ''}> Chime at the end</label>
      </div>
      <p class="tools-tip">Space starts and pauses.</p>
    </div>`;
}
function wireTimer() {
  const q = s => ov.querySelector(s);
  q('.timer-go').onclick = toggleTimer;
  q('.timer-plus').onclick = () => adjustTimer(60);
  q('.timer-minus').onclick = () => adjustTimer(-60);
  q('.timer-reset').onclick = () => setTimer(timer.total);
  q('.timer-sound').onchange = e => { timer.sound = e.target.checked; };
  ov.querySelectorAll('.timer-set').forEach(b => b.onclick = () => setTimer(+b.dataset.m * 60));
}
function setTimer(sec) {
  stopTick();
  Object.assign(timer, { total: sec, left: sec, running: false, done: false });
  render();
}
function adjustTimer(d) {
  if (timer.running) { timer.endAt += d * 1000; timer.total = Math.max(timer.total + d, 1); }
  else { timer.left = Math.max(10, timer.left + d); timer.total = Math.max(timer.left, timer.total + d); timer.done = false; }
  render();
}
export function toggleTimer() {
  if (timer.done) { timer.left = timer.total; timer.done = false; }
  if (timer.running) { timer.left = (timer.endAt - Date.now()) / 1000; timer.running = false; stopTick(); }
  else { timer.endAt = Date.now() + timer.left * 1000; timer.running = true; startTick(); }
  render();
}
function startTick() {
  stopTick();
  timer.tick = setInterval(() => {
    timer.left = (timer.endAt - Date.now()) / 1000;
    if (timer.left <= 0) { timer.left = 0; timer.running = false; timer.done = true; stopTick(); if (timer.sound) chime(); if (ov) render(); return; }
    if (!ov) return;
    const dg = ov.querySelector('.timer-digits'), bar = ov.querySelector('.timer-bar > div');
    if (dg) dg.textContent = fmt(timer.left);
    if (bar) bar.style.width = (1 - timer.left / timer.total) * 100 + '%';
    const tab = ov.querySelector('.tools-tab[data-t=timer] .tab-time');
    if (tab) tab.textContent = fmt(timer.left);
  }, 200);
}
function stopTick() { clearInterval(timer.tick); timer.tick = null; }
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = [880, 988, 1175][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.65);
    });
    setTimeout(() => ctx.close(), 1800);
  } catch { /* no sound on this device */ }
}

// ══ 🔊 Voice level ══
const LEVELS = [
  { n: 0, icon: '🤫', name: 'Silent', hint: 'No talking' },
  { n: 1, icon: '💬', name: 'Whisper', hint: 'Only your partner can hear you' },
  { n: 2, icon: '👥', name: 'Table talk', hint: 'Only your group can hear you' },
  { n: 3, icon: '📣', name: 'Presenting', hint: 'The whole class can hear you' },
];
function voiceHTML(m) {
  const cur = LEVELS[m.voice ?? 0];
  return `
    <div class="voice lv${cur.n}">
      <div class="voice-big"><span class="voice-icon">${cur.icon}</span><span class="voice-num">${cur.n}</span></div>
      <div class="voice-name">${cur.name}</div>
      <div class="voice-hint">${cur.hint}</div>
      <div class="voice-pick">${LEVELS.map(l => `<button type="button" class="voice-btn lv${l.n} ${l.n === cur.n ? 'on' : ''}" data-n="${l.n}"><b>${l.n}</b> ${l.name}</button>`).join('')}</div>
      <p class="tools-tip">Press 0–3 to switch.</p>
    </div>`;
}
function wireVoice() {
  ov.querySelectorAll('.voice-btn').forEach(b => b.onclick = () => setVoice(+b.dataset.n));
}
function setVoice(n) { const m = mem(); m.voice = n; saveMem(m); render(); }

// ══ 🏷 Name tents and desk labels (printed) ══
const printOpts = { kind: 'tents', names: 'first' };
// Students in seat order (front to back, left to right) with their table, when a chart is open; else A–Z
function printList() {
  const c = cls();
  let list = [...c.students].sort((a, b) => a.name.localeCompare(b.name)).map(s => ({ s, where: '' }));
  if (editorOpen() && window._currentChartClassId === c.id && printOpts.kind === 'labels') {
    const seats = getAllSeats();
    const items = state.layoutItems;
    const tables = items.filter(i => i.type === 'table');
    const pos = id => items.find(i => i.id === id) || { x: 0, y: 0 };
    const order = [...seats].sort((a, b) => (pos(a.itemId).y - pos(b.itemId).y) || (pos(a.itemId).x - pos(b.itemId).x) || (a.y - b.y) || (a.x - b.x));
    const seated = [];
    order.forEach(seat => {
      const sid = state.assignments[seat.seatId];
      const s = sid && c.students.find(x => x.id === sid);
      if (!s) return;
      const it = pos(seat.itemId);
      seated.push({ s, where: it.type === 'table' ? (it.label || `Table ${tables.indexOf(it) + 1}`) : 'Desk' });
    });
    const done = new Set(seated.map(x => x.s.id));
    list = [...seated, ...list.filter(x => !done.has(x.s.id))];
  }
  return list;
}
const shown = s => printOpts.names === 'first' ? s.name.split(' ')[0] : s.name;
// font size (pt) so a name fits a width (pt)
const fit = (text, width, max) => Math.max(14, Math.min(max, Math.floor(width / (Math.max(3, text.length) * 0.56))));
function sheetsHTML() {
  const list = printList();
  const pages = [];
  if (printOpts.kind === 'tents') {
    for (let i = 0; i < list.length; i += 2) pages.push(`<div class="tp-page tents">${list.slice(i, i + 2).map(({ s }) => {
      const n = esc(shown(s)), fs = fit(shown(s), 500, 96);
      return `<div class="tent"><div class="tent-half flip"><span style="font-size:${fs}pt">${n}</span></div><div class="tent-fold"></div><div class="tent-half"><span style="font-size:${fs}pt">${n}</span></div></div>`;
    }).join('<div class="tent-cut"></div>')}</div>`);
  } else {
    for (let i = 0; i < list.length; i += 12) pages.push(`<div class="tp-page labels">${list.slice(i, i + 12).map(({ s, where }) =>
      `<div class="label"><span class="label-name" style="font-size:${fit(shown(s), 240, 40)}pt">${esc(shown(s))}</span>${where ? `<span class="label-where">${esc(where)}</span>` : ''}</div>`).join('')}</div>`);
  }
  return pages.join('');
}
function printHTML() {
  const c = cls();
  const n = c.students.length;
  const sheets = printOpts.kind === 'tents' ? Math.ceil(n / 2) : Math.ceil(n / 12);
  return `
    <div class="print-tool">
      <div class="groups-controls">
        <div class="tools-seg">
          <button type="button" class="tools-chip pt-kind ${printOpts.kind === 'tents' ? 'on' : ''}" data-k="tents">Name tents</button>
          <button type="button" class="tools-chip pt-kind ${printOpts.kind === 'labels' ? 'on' : ''}" data-k="labels">Desk labels</button>
        </div>
        <select class="tools-select pt-names" aria-label="Names">
          <option value="first" ${printOpts.names === 'first' ? 'selected' : ''}>First names</option>
          <option value="full" ${printOpts.names === 'full' ? 'selected' : ''}>Full names</option>
        </select>
        <button type="button" class="tools-btn pt-print">🖨 Print ${sheets} ${sheets === 1 ? 'page' : 'pages'}</button>
      </div>
      <p class="pt-how">${printOpts.kind === 'tents'
        ? 'Two tents per page. Cut along the middle line, then fold each one on its dotted line so it stands on the desk with the name on both sides.'
        : `Twelve labels per page${editorOpen() ? ', in seat order with each table’s name' : ' (open a chart first to print them in seat order with table names)'}. Cut on the lines and tape them to desks.`}</p>
      <div class="pt-preview"><div class="pt-scale">${sheetsHTML()}</div></div>
    </div>`;
}
function wirePrint() {
  ov.querySelectorAll('.pt-kind').forEach(b => b.onclick = () => { printOpts.kind = b.dataset.k; render(); });
  ov.querySelector('.pt-names').onchange = e => { printOpts.names = e.target.value; render(); };
  ov.querySelector('.pt-print').onclick = () => {
    document.getElementById('printView')?.remove();
    const v = document.createElement('div');
    v.className = 'print-view tents-print';
    v.id = 'printView';
    v.innerHTML = sheetsHTML();
    document.body.appendChild(v);
    setTimeout(() => window.print(), 50);
  };
}
