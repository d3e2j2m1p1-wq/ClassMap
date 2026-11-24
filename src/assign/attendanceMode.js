// ═══════════════════════════════════════════════
//  ATTENDANCE ON THE SEATING CHART
//  "✓ Attendance" in the Assign view: scan the room, tap a student → absent, tap again → late,
//  again → here. Copy the list for the school's system. Today's absences also show (faintly)
//  on the chart outside this mode, and the classroom tools skip absent students.
//  Never shown on the projector or the printed chart. Stored on this device only.
// ═══════════════════════════════════════════════
import { state, esc } from '../core/state.js';
import { store } from '../core/store.js';
import { showToast } from '../core/ui.js';
import { clearDay, cycleStatus, getDay, summaryText } from '../tools/attendance.js';

let on = false;
const classId = () => window._currentChartClassId;
const cls = () => (store.landingData?.classes || []).find(c => c.id === classId()) || null;
export const attendanceOn = () => on;

export function initAttendanceMode() {
  const host = document.getElementById('panel-assign');
  if (!host || host.querySelector('.att-toggle')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'att-toggle';
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = '✓ <span>Attendance</span>';
  btn.onclick = () => setAttendanceMode(!on);
  host.appendChild(btn);
  const banner = document.createElement('div');
  banner.className = 'att-banner';
  banner.hidden = true;
  host.appendChild(banner);
  // In attendance mode a tap marks the student instead of selecting or dragging them
  const grab = e => {
    if (!on) return;
    const chip = e.target.closest('.seat-chip.grouped, .chip-pill');
    if (!chip) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.type !== 'click') return;
    const id = chip.classList.contains('chip-pill') ? chip.dataset.id : state.assignments[chip.dataset.seatId];
    if (!id) return;
    cycleStatus(classId(), id);
    decorateAttendance();
  };
  ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t => {
    const fn = t === 'keydown' ? e => { if (on && (e.key === 'Enter' || e.key === ' ') && e.target.closest('.seat-chip.grouped')) { e.preventDefault(); e.stopPropagation(); e.target.closest('.seat-chip').click(); } } : grab;
    document.getElementById('assignMain').addEventListener(t, fn, { capture: true, passive: false });
    document.getElementById('assignFloatPanel').addEventListener(t, fn, { capture: true, passive: false });
  });
  document.addEventListener('keydown', e => { if (on && e.key === 'Escape' && document.getElementById('panel-assign').classList.contains('active')) setAttendanceMode(false); });
}

export function setAttendanceMode(v) {
  on = !!v && !!cls();
  if (on) import('./participationMode.js').then(m => m.pointsOn() && m.setPointsMode(false));   // one tap mode at a time
  const host = document.getElementById('panel-assign');
  if (!host) return;
  host.classList.toggle('att-mode', on);
  const btn = host.querySelector('.att-toggle');
  btn?.setAttribute('aria-pressed', String(on));
  btn?.classList.toggle('active', on);
  if (on) { store.selectedSeatId = null; store.selectedStudentId = null; }
  decorateAttendance();
}

// Marks on the seats (and the unplaced names), plus the banner's counts
export function decorateAttendance() {
  const id = classId();
  if (!id) return;
  const d = getDay(id);
  const mark = (el, sid) => {
    el.classList.toggle('att-absent', d.absent.includes(sid));
    el.classList.toggle('att-late', d.tardy.includes(sid));
  };
  document.querySelectorAll('#assignCanvas .seat-chip').forEach(chip => {
    const sid = state.assignments[chip.dataset.seatId];
    if (sid) mark(chip, sid); else chip.classList.remove('att-absent', 'att-late');
  });
  document.querySelectorAll('#unplacedChips .chip-pill').forEach(p => mark(p, p.dataset.id));
  const banner = document.querySelector('#panel-assign .att-banner:not(.pts-banner)');
  if (!banner) return;
  banner.hidden = !on;
  if (!on) return;
  const known = new Set(state.students.map(s => s.id));
  const a = d.absent.filter(x => known.has(x)).length, t = d.tardy.filter(x => known.has(x)).length;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  banner.innerHTML = `
    <div class="att-text"><b>Attendance · ${esc(date)}</b><span>Tap a student: absent → late → here</span></div>
    <div class="att-counts"><span class="att-n absent">${a} absent</span><span class="att-n late">${t} late</span></div>
    <div class="att-actions">
      <button type="button" class="att-copy">Copy</button>
      ${a || t ? '<button type="button" class="att-clear">Everyone’s here</button>' : ''}
      <button type="button" class="att-done">Done</button>
    </div>`;
  banner.querySelector('.att-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(summaryText(cls())); showToast('Attendance copied'); } catch { showToast('Couldn’t copy here'); }
  };
  banner.querySelector('.att-clear')?.addEventListener('click', () => { clearDay(id); decorateAttendance(); });
  banner.querySelector('.att-done').onclick = () => setAttendanceMode(false);
}
