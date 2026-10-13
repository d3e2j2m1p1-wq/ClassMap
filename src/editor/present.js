// ═══════════════════════════════════════════════
//  PRESENT & PRINT
//  Both show a clean copy of the Assign tab's chart (no buttons, no selection),
//  scaled to fit: the whole screen for the projector, a landscape page for printing.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc, state } from '../core/state.js';
import { choiceDialog, prettyDate, showToast } from '../core/ui.js';
import { renderAssignPanel } from '../assign/panel.js';
import { editorOpen, flushSave } from '../storage/autosave.js';
import { localDateStr } from '../storage/landingData.js';
import { ruleSummary } from '../assign/rulesEngine.js';

// Clean copy of the Assign canvas
function cloneChart() {
  renderAssignPanel();
  const src = document.getElementById('assignCanvas');
  const c = src.cloneNode(true);
  c.removeAttribute('id');
  c.className = 'chart-clone';
  c.removeAttribute('style');
  c.querySelectorAll('.seat-unseat-btn, .seat-pin-btn, .drop-zone-hint').forEach(e => e.remove());
  c.querySelectorAll('.selected-seat, .drop-target, .drag-source').forEach(e => e.classList.remove('selected-seat', 'drop-target', 'drag-source'));
  c.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  c.querySelectorAll('[title]').forEach(e => e.removeAttribute('title'));
  return c;
}

// Scale + centre `chart` inside `box` (both already in the page so they can be measured)
function fitInto(chart, box, maxScale = 3) {
  chart.style.transform = 'none';
  const cr = chart.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of chart.children) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    x0 = Math.min(x0, r.left - cr.left); y0 = Math.min(y0, r.top - cr.top);
    x1 = Math.max(x1, r.right - cr.left); y1 = Math.max(y1, r.bottom - cr.top);
  }
  if (x0 === Infinity) return;
  const w = x1 - x0, h = y1 - y0, pad = 12;
  const bw = box.clientWidth - pad * 2, bh = box.clientHeight - pad * 2;
  const s = Math.max(0.1, Math.min(bw / w, bh / h, maxScale));
  const tx = (box.clientWidth - w * s) / 2 - x0 * s;
  const ty = (box.clientHeight - h * s) / 2 - y0 * s;
  chart.style.transformOrigin = '0 0';
  chart.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
}

function chartTitle() {
  const name = document.getElementById('classNameInput').value.trim() || 'Seating chart';
  const ch = store.landingData.charts.find(c => c.id === window._currentChartId);
  const date = ch ? (ch.date || localDateStr(ch.savedAt)) : localDateStr(Date.now());
  return { name, date: prettyDate(date) };
}

// ── Present: full screen for the projector ──
let _present = null;

export function openPresent() {
  if (!editorOpen()) return;
  if (!state.layoutItems.length) { showToast('Build a layout first'); return; }
  closePresent();
  const { name, date } = chartTitle();
  const ov = document.createElement('div');
  ov.className = 'present-view';
  ov.innerHTML = `
    <div class="present-bar">
      <div class="present-title">${esc(name)}<span>${esc(date)}</span></div>
      <button type="button" class="present-exit">Exit <kbd>Esc</kbd></button>
    </div>
    <div class="present-stage"></div>`;
  const stage = ov.querySelector('.present-stage');
  const chart = cloneChart();
  stage.appendChild(chart);
  document.body.appendChild(ov);

  const refit = () => fitInto(chart, stage, 4);
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); closePresent(); } };
  const onFs = () => { if (!document.fullscreenElement && _present) closePresent(); };
  ov.querySelector('.present-exit').addEventListener('click', closePresent);
  window.addEventListener('resize', refit);
  document.addEventListener('keydown', onKey, true);
  _present = { ov, refit, onKey, onFs };
  refit();
  if (ov.requestFullscreen) {
    ov.requestFullscreen().then(() => {
      document.addEventListener('fullscreenchange', onFs);
      setTimeout(refit, 50);
    }).catch(() => {});
  }
}

export function closePresent() {
  if (!_present) return;
  const { ov, refit, onKey, onFs } = _present;
  _present = null;
  window.removeEventListener('resize', refit);
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('fullscreenchange', onFs);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  ov.remove();
}

// ── Print ──
function describeRule(r) {
  const a = esc(r.studentA || ''), b = esc(r.studentB || '');
  switch (r.type) {
    case 'separate': return `Keep <b>${a}</b> and <b>${b}</b> apart`;
    case 'near':     return `Seat <b>${a}</b> near <b>${b}</b>`;
    case 'partners': return `<b>${a}</b> and <b>${b}</b> work in the same group`;
    case 'front':    return `<b>${a}</b> sits in the front row`;
    case 'back':     return `<b>${a}</b> sits in the back row`;
    default:         return esc(ruleSummary(r).text);
  }
}

function buildPrintView(withSubPage) {
  removePrintView();
  const { name, date } = chartTitle();
  const v = document.createElement('div');
  v.className = 'print-view';
  v.id = 'printView';
  const seated = new Set(Object.values(state.assignments));
  const unplaced = state.students.filter(s => !seated.has(s.id)).map(s => s.name).sort((x, y) => x.localeCompare(y));
  const rules = [...(state.hardRules || []), ...(state.tempRules || [])];
  const notes = document.getElementById('sessionNotes').value.trim();

  v.innerHTML = `
    <div class="print-head"><h1>${esc(name)}</h1><div>${esc(date)} · ${state.students.length} students</div></div>
    <div class="print-stage"></div>
    ${withSubPage ? `
    <section class="print-sub">
      <h2>Notes for the substitute — ${esc(name)}, ${esc(date)}</h2>
      ${notes ? `<h3>Today</h3><p class="print-notes">${esc(notes)}</p>` : ''}
      <h3>Seating rules</h3>
      ${rules.length ? `<ul>${rules.map(r => `<li>${describeRule(r)}</li>`).join('')}</ul>` : '<p>No special seating rules.</p>'}
      ${unplaced.length ? `<h3>Not seated on this chart</h3><p>${unplaced.map(esc).join(', ')}</p>` : ''}
      <h3>Notes</h3><div class="print-lines"></div>
    </section>` : ''}`;
  document.body.appendChild(v);
  const stage = v.querySelector('.print-stage');
  const chart = cloneChart();
  stage.appendChild(chart);
  fitInto(chart, stage, 2.5);
}

function removePrintView() {
  const old = document.getElementById('printView');
  if (old) old.remove();
}

export async function printChart() {
  if (!editorOpen()) return;
  if (!state.layoutItems.length) { showToast('Build a layout first'); return; }
  const pick = await choiceDialog({
    title: 'Print this chart',
    message: 'The substitute version adds a second page with today\'s notes, the seating rules and space to write.',
    choices: [
      { label: 'For a substitute', value: 'sub' },
      { label: 'Chart only', value: 'chart', primary: true },
    ],
  });
  if (!pick) return;
  flushSave();
  buildPrintView(pick === 'sub');
  setTimeout(() => window.print(), 50);
}

export function initPrint() {
  // Ctrl+P / the browser's Print while a chart is open → print the chart, not the editor
  window.addEventListener('beforeprint', () => {
    if (!document.getElementById('printView') && editorOpen() && state.layoutItems.length) buildPrintView(false);
  });
  window.addEventListener('afterprint', removePrintView);
}
