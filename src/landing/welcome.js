// ═══════════════════════════════════════════════
//  FIRST RUN, SAMPLE CLASS, BACKUP REMINDER
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { defaultGroups } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { openChart } from './chartOpen.js';
import { showLanding } from './landing.js';
import { autoAssign } from '../assign/autoAssign.js';
import { switchPanel } from '../editor/panels.js';
import { defaultSeatPositions } from '../layout/canvas.js';
import { CLASS_COLORS, localDateStr, saveLandingData } from '../storage/landingData.js';

// Home page: the welcome card shows while there are no classes yet
export function updateWelcome() {
  const page = document.getElementById('landing-page');
  if (page) page.classList.toggle('no-classes', !store.landingData.classes.length);
  updateBackupReminder();
}

// A ready-made class to try everything on: 20 students, 5 tables of 4 in pairs, seated
export function createSampleClass() {
  const boys = ['James', 'Liam', 'Noah', 'Lucas', 'Ethan', 'Mateo', 'Daniel', 'Leo', 'Owen', 'Samuel'];
  const girls = ['Olivia', 'Emma', 'Ava', 'Mia', 'Sofia', 'Isabella', 'Camila', 'Chloe', 'Zoe', 'Grace'];
  const initials = 'ABCDEFGHJKLMNPRSTVWY';
  const now = Date.now();
  const students = [];
  boys.forEach((n, i) => students.push({ id: `st_${now}_b${i}`, name: `${n} ${initials[i]}.`, gender: 'g_boys' }));
  girls.forEach((n, i) => students.push({ id: `st_${now}_g${i}`, name: `${n} ${initials[19 - i]}.`, gender: 'g_girls' }));
  const id = 'cls_' + now;
  let name = 'Sample class';
  for (let n = 2; store.landingData.classes.some(c => c.name === name); n++) name = `Sample class (${n})`;
  store.landingData.classes.push({
    id, name,
    color: CLASS_COLORS[store.landingData.classes.length % CLASS_COLORS.length],
    students,
    hardRules: [{ id: 'r_' + now, type: 'separate', studentA: students[0].name, studentB: students[1].name }],
    genderMode: true,
    genderGroups: defaultGroups(),
  });
  // (kept right of the Auto-Assign panel, which floats over the left side of the canvas)
  const items = [{ id: '1', type: 'board', x: 620, y: 30, rotation: 0 }];
  [[360, 120], [600, 120], [840, 120], [480, 330], [720, 330]].forEach(([x, y], i) => {
    items.push({ id: String(i + 2), type: 'table', x, y, rotation: 0, seatPositions: defaultSeatPositions(4), groups: 2, groupShift: 0 });
  });
  const ch = {
    id: 'chart_' + now, classId: id, name, savedAt: now, date: localDateStr(now),
    data: { className: name, tempRules: [], sessionNotes: '', layoutItems: items, assignments: {}, pins: [],
            tableDefaults: { seats: 4, groups: 2 }, layoutImg: null, nextId: 8 },
  };
  store.landingData.charts.push(ch);
  saveLandingData();
  store.activeClassId = id;
  openChart(ch);
  switchPanel('assign', document.querySelector('[data-panel="assign"]'));
  document.getElementById('assignGenderBal').value = 'mixed';
  autoAssign();
  showToast('This is a sample class — try dragging students, or Auto-Assign again', 5000);
}

// ── Backup reminder (home page) ──
const LAST_BACKUP = 'classmap_last_backup', SNOOZE = 'classmap_backup_snooze';
const DAY = 86400000;
const read = k => { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } };
const write = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) {} };

export function noteBackupMade() {
  write(LAST_BACKUP, Date.now());
  updateBackupReminder();
}

export function updateBackupReminder() {
  const el = document.getElementById('backupReminder');
  if (!el) return;
  const last = read(LAST_BACKUP), snooze = read(SNOOZE);
  const hasCharts = store.landingData.charts.length > 0;
  const due = hasCharts && Date.now() - last > 14 * DAY && Date.now() > snooze;
  el.hidden = !due;
  if (!due) return;
  const days = last ? Math.floor((Date.now() - last) / DAY) : null;
  el.querySelector('.br-text').textContent = last
    ? `Last backup: ${days} days ago`
    : 'Your classes are only saved in this browser — keep a backup copy';
}

export function snoozeBackupReminder() {
  write(SNOOZE, Date.now() + 7 * DAY);
  updateBackupReminder();
}

// ── Something went wrong: say so, calmly, instead of leaving a half-working page ──
let _shown = false;
export function initErrorBanner() {
  const show = () => {
    if (_shown) return;
    _shown = true;
    const b = document.createElement('div');
    b.className = 'error-banner';
    b.setAttribute('role', 'alert');
    b.innerHTML = `<span>Something went wrong. Your classes are still saved on this device.</span>
      <button type="button" class="eb-reload">Reload</button>
      <button type="button" class="eb-close" aria-label="Dismiss">✕</button>`;
    b.querySelector('.eb-reload').addEventListener('click', () => location.reload());
    b.querySelector('.eb-close').addEventListener('click', () => b.remove());
    document.body.appendChild(b);
  };
  window.addEventListener('error', e => {
    // ignore browser-extension scripts and harmless resize warnings
    if (e.filename && !e.filename.startsWith(location.origin)) return;
    if (/ResizeObserver/.test(e.message || '')) return;
    show();
  });
  window.addEventListener('unhandledrejection', show);
}

