// ═══════════════════════════════════════════════
//  ATTENDANCE — who's absent or late today, per class, kept on this device only
//  (not synced, not in backups or Send & receive). Shared by the seating chart's
//  attendance mode and the classroom tools ("Here"), which skip absent students.
//  The last 90 days are kept so a teacher can look back; nothing is ever sent anywhere.
// ═══════════════════════════════════════════════
import { localDateStr } from '../storage/landingData.js';

const KEEP_DAYS = 90;
const key = classId => `cm-att-${classId}`;
export const today = () => localDateStr(Date.now());

function all(classId) {
  try { return JSON.parse(localStorage.getItem(key(classId)) || '{}'); } catch { return {}; }
}
function saveAll(classId, data) {
  const days = Object.keys(data).sort();
  days.slice(0, Math.max(0, days.length - KEEP_DAYS)).forEach(d => delete data[d]);
  Object.keys(data).forEach(d => { if (!data[d].absent.length && !data[d].tardy.length) delete data[d]; });
  try { localStorage.setItem(key(classId), JSON.stringify(data)); } catch { /* private mode: today still works */ }
}

// { absent: [ids], tardy: [ids] } for a day (today by default)
export function getDay(classId, day = today()) {
  const d = all(classId)[day] || {};
  return { absent: d.absent || [], tardy: d.tardy || [] };
}
export function statusOf(classId, studentId, day = today()) {
  const d = getDay(classId, day);
  return d.absent.includes(studentId) ? 'absent' : d.tardy.includes(studentId) ? 'tardy' : 'here';
}
export function setStatus(classId, studentId, status, day = today()) {
  const data = all(classId);
  const d = { absent: [], tardy: [], ...(data[day] || {}) };
  d.absent = d.absent.filter(x => x !== studentId);
  d.tardy = d.tardy.filter(x => x !== studentId);
  if (status === 'absent') d.absent.push(studentId);
  if (status === 'tardy') d.tardy.push(studentId);
  data[day] = d;
  saveAll(classId, data);
}
// here → absent → late → here
export function cycleStatus(classId, studentId) {
  const next = { here: 'absent', absent: 'tardy', tardy: 'here' }[statusOf(classId, studentId)];
  setStatus(classId, studentId, next);
  return next;
}
export function clearDay(classId, day = today()) {
  const data = all(classId);
  delete data[day];
  saveAll(classId, data);
}
export const isAbsent = (classId, studentId) => getDay(classId).absent.includes(studentId);

// Days with anything recorded, newest first
export function history(classId) {
  const data = all(classId);
  return Object.keys(data).sort().reverse().map(day => ({ day, ...getDay(classId, day) }));
}

// "Period 3 · Mon, Nov 23" + absent and late lists, ready to paste into the school's system
export function summaryText(cls, day = today()) {
  const d = getDay(cls.id, day);
  const name = id => (cls.students.find(s => s.id === id) || {}).name;
  const list = ids => ids.map(name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const [y, m, dd] = day.split('-').map(Number);
  const when = new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const a = list(d.absent), t = list(d.tardy);
  return [`${cls.name} · ${when}`,
    a.length ? `Absent (${a.length}): ${a.join(', ')}` : 'Absent: none',
    t.length ? `Late (${t.length}): ${t.join(', ')}` : 'Late: none'].join('\n');
}
