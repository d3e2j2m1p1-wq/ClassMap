// ═══════════════════════════════════════════════
//  PARTICIPATION ON THE SEATING CHART
//  "★ Points" in the Assign view: tap a student each time they take part. The bar shows who
//  hasn't had a turn yet today (absent students left out). Points never show on the projector
//  or the printed chart, and stay on this device.
// ═══════════════════════════════════════════════
import { state, esc } from '../core/state.js';
import { store } from '../core/store.js';
import { showToast } from '../core/ui.js';
import { addPoint, clearToday, dayPoints, recentPoints, summaryText } from '../tools/participation.js';
import { getDay } from '../tools/attendance.js';
import { setAttendanceMode } from './attendanceMode.js';

let on = false;
let range = 'today';          // today · week
const taps = [];              // for Undo
const classId = () => window._currentChartClassId;
const cls = () => (store.landingData?.classes || []).find(c => c.id === classId()) || null;
export const pointsOn = () => on;

export function initParticipationMode() {
  const host = document.getElementById('panel-assign');
  if (!host || host.querySelector('.pts-toggle')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pts-toggle';
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = '★ <span>Points</span>';
  btn.onclick = () => setPointsMode(!on);
  host.appendChild(btn);
  const banner = document.createElement('div');
  banner.className = 'att-banner pts-banner';
  banner.hidden = true;
  host.appendChild(banner);
  const grab = e => {
    if (!on) return;
    const chip = e.target.closest('.seat-chip.grouped, .chip-pill');
    if (!chip) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.type !== 'click') return;
    const id = chip.classList.contains('chip-pill') ? chip.dataset.id : state.assignments[chip.dataset.seatId];
    if (!id) return;
    addPoint(classId(), id, 1);
    taps.push(id);
    decoratePoints();
  };
  ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(t => {
    document.getElementById('assignMain').addEventListener(t, grab, { capture: true, passive: false });
    document.getElementById('assignFloatPanel').addEventListener(t, grab, { capture: true, passive: false });
  });
  document.getElementById('assignMain').addEventListener('keydown', e => {
    if (on && (e.key === 'Enter' || e.key === ' ') && e.target.closest('.seat-chip.grouped')) { e.preventDefault(); e.stopPropagation(); e.target.closest('.seat-chip').click(); }
  }, true);
  document.addEventListener('keydown', e => { if (on && e.key === 'Escape' && document.getElementById('panel-assign').classList.contains('active')) setPointsMode(false); });
}

export function setPointsMode(v) {
  on = !!v && !!cls();
  if (on) setAttendanceMode(false);            // one tap mode at a time
  const host = document.getElementById('panel-assign');
  if (!host) return;
  host.classList.toggle('pts-mode', on);
  const btn = host.querySelector('.pts-toggle');
  btn?.setAttribute('aria-pressed', String(on));
  btn?.classList.toggle('active', on);
  if (on) { store.selectedSeatId = null; store.selectedStudentId = null; taps.length = 0; }
  decoratePoints();
}

export function decoratePoints() {
  document.querySelectorAll('#assignCanvas .pts-badge').forEach(b => b.remove());
  const banner = document.querySelector('#panel-assign .pts-banner');
  if (banner) banner.hidden = !on;
  const id = classId();
  if (!on || !id) return;
  const pts = range === 'week' ? recentPoints(id, 7) : dayPoints(id);
  // a count beside each seat (a sibling of the seat, so it isn't cut off)
  document.querySelectorAll('#assignCanvas .seat-chip.grouped').forEach(chip => {
    const sid = state.assignments[chip.dataset.seatId];
    const n = pts[sid] || 0;
    const b = document.createElement('div');
    b.className = 'pts-badge' + (n ? '' : ' zero');
    b.textContent = n;
    b.style.left = (chip.offsetLeft + chip.offsetWidth - 14) + 'px';
    b.style.top = (chip.offsetTop - 8) + 'px';
    chip.parentElement.appendChild(b);
  });
  const absent = new Set(getDay(id).absent);
  const here = state.students.filter(s => !absent.has(s.id));
  const none = here.filter(s => !pts[s.id]).map(s => s.name.split(' ')[0]).sort((a, b) => a.localeCompare(b));
  const total = here.reduce((n, s) => n + (pts[s.id] || 0), 0);
  banner.innerHTML = `
    <div class="att-text"><b>Participation · ${range === 'week' ? 'last 7 days' : 'today'}</b><span>Tap a student each time they take part</span></div>
    <div class="pts-none">${none.length ? `<b>${none.length} not yet:</b> ${esc(none.slice(0, 8).join(', '))}${none.length > 8 ? ' …' : ''}` : `<b>Everyone has taken part</b> · ${total} points`}</div>
    <div class="att-actions">
      <button type="button" class="pts-range" title="Switch between today and the last 7 days">${range === 'week' ? 'Today' : '7 days'}</button>
      <button type="button" class="pts-undo" ${taps.length && range === 'today' ? '' : 'disabled'}>Undo</button>
      <button type="button" class="pts-copy">Copy</button>
      <button type="button" class="pts-reset">Reset today</button>
      <button type="button" class="att-done">Done</button>
    </div>`;
  banner.querySelector('.pts-range').onclick = () => { range = range === 'week' ? 'today' : 'week'; decoratePoints(); };
  banner.querySelector('.pts-undo').onclick = () => { const last = taps.pop(); if (last) addPoint(id, last, -1); decoratePoints(); };
  banner.querySelector('.pts-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(summaryText(cls(), pts, range === 'week' ? '(last 7 days)' : '(today)')); showToast('Points copied'); } catch { showToast('Couldn’t copy here'); }
  };
  banner.querySelector('.pts-reset').onclick = () => { clearToday(id); taps.length = 0; decoratePoints(); showToast('Today’s points cleared'); };
  banner.querySelector('.att-done').onclick = () => setPointsMode(false);
}
