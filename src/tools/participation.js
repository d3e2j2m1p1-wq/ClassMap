// ═══════════════════════════════════════════════
//  PARTICIPATION POINTS — tap a student when they take part; see who hasn't yet.
//  Per class, per day, on this device only (not synced or exported). Last 90 days kept.
// ═══════════════════════════════════════════════
import { localDateStr } from '../storage/landingData.js';

const KEEP_DAYS = 90;
const key = classId => `cm-pts-${classId}`;
export const today = () => localDateStr(Date.now());

function all(classId) {
  try { return JSON.parse(localStorage.getItem(key(classId)) || '{}'); } catch { return {}; }
}
function saveAll(classId, data) {
  Object.keys(data).forEach(d => { if (!Object.keys(data[d] || {}).length) delete data[d]; });
  const days = Object.keys(data).sort();
  days.slice(0, Math.max(0, days.length - KEEP_DAYS)).forEach(d => delete data[d]);
  try { localStorage.setItem(key(classId), JSON.stringify(data)); } catch { /* private mode */ }
}

// { studentId: points } for one day
export function dayPoints(classId, day = today()) { return { ...(all(classId)[day] || {}) }; }

// Totals over the last `days` days (today included)
export function recentPoints(classId, days = 7) {
  const data = all(classId);
  const from = localDateStr(Date.now() - (days - 1) * 86400000);
  const out = {};
  Object.entries(data).forEach(([d, pts]) => { if (d >= from) Object.entries(pts).forEach(([id, n]) => { out[id] = (out[id] || 0) + n; }); });
  return out;
}

export function addPoint(classId, studentId, delta = 1) {
  const data = all(classId);
  const d = { ...(data[today()] || {}) };
  d[studentId] = Math.max(0, (d[studentId] || 0) + delta);
  if (!d[studentId]) delete d[studentId];
  data[today()] = d;
  saveAll(classId, data);
  return d[studentId] || 0;
}
export function clearToday(classId) {
  const data = all(classId);
  delete data[today()];
  saveAll(classId, data);
}

export function summaryText(cls, pts, label) {
  const rows = cls.students.map(s => [s.name, pts[s.id] || 0]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return `${cls.name} · participation ${label}\n` + rows.map(([n, p]) => `${n}: ${p}`).join('\n');
}
