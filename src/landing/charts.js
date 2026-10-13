import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { createNewChart, openChart } from './chartOpen.js';
import { MONTHS, localDateStr, saveLandingData } from '../storage/landingData.js';

// ── Charts tab ──
export function renderTimeline(classId) {
  const content = document.getElementById('timelineContent');
  const dateOf = ch => ch.date || localDateStr(ch.savedAt);
  const charts = store.landingData.charts
    .filter(ch => ch.classId === classId)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || (b.savedAt - a.savedAt));

  if (charts.length === 0) {
    content.className = 'timeline-empty';
    content.innerHTML = '<div class="ti">📋</div><p>No seating charts yet.<br>Click "+ New Chart" to create one.</p>';
    return;
  }

  content.className = 'timeline-scroll';
  const now = new Date();
  const currentMonth = now.getMonth(), currentYear = now.getFullYear();
  const groups = {};
  charts.forEach(ch => {
    const [yy, mm] = dateOf(ch).split('-').map(Number);
    const key = `${yy}-${mm - 1}`;
    if (!groups[key]) groups[key] = { year: yy, month: mm - 1, charts: [] };
    groups[key].charts.push(ch);
  });
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const [ay,am] = a.split('-').map(Number), [by,bm] = b.split('-').map(Number);
    const ac = ay===currentYear&&am===currentMonth, bc = by===currentYear&&bm===currentMonth;
    if (ac) return -1; if (bc) return 1;
    return (by*12+bm)-(ay*12+am);
  });

  content.innerHTML = '';
  sortedKeys.forEach(key => {
    const g = groups[key];
    const isCurrent = g.year===currentYear && g.month===currentMonth;
    const div = document.createElement('div');
    div.className = 'month-group';
    div.innerHTML = `<div class="month-label ${isCurrent?'current-month':''}">
      ${MONTHS[g.month]} ${g.year!==currentYear?g.year:''}
      ${isCurrent?'<span class="current-badge">Current</span>':''}
    </div><div class="chart-cards" id="cards_${key}"></div>`;
    content.appendChild(div);

    const cardsEl = div.querySelector('.chart-cards');
    g.charts.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'chart-card';
      const cls = store.landingData.classes.find(c => c.id === ch.classId);
      const seated = Object.keys(ch.data?.assignments || {}).length;
      const total = (cls?.students || []).length;
      const dateVal = dateOf(ch);
      card.innerHTML = `
        <button class="chart-card-dup" onclick="duplicateChart('${ch.id}',event)" title="Copy to today" aria-label="Copy chart to today">⧉</button>
        <button class="chart-card-del" onclick="deleteChart('${ch.id}',event)" title="Delete" aria-label="Delete chart">✕</button>
        <div class="chart-card-date-row">
          <input type="date" class="chart-date-input" data-chart-id="${ch.id}" value="${dateVal}" title="Edit date">
        </div>
        <div class="chart-card-title">${esc(ch.name || 'Untitled')}</div>
        <div class="chart-card-meta">
          <span>👥 ${total} students</span>
          <span>💺 ${seated} seated</span>
        </div>`;
      const dateInput = card.querySelector('.chart-date-input');
      dateInput.addEventListener('change', e => {
        e.stopPropagation();
        if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { ch.date = e.target.value; saveLandingData(); renderTimeline(store.activeClassId); }
      });
      dateInput.addEventListener('click', e => e.stopPropagation());
      dateInput.addEventListener('mousedown', e => e.stopPropagation());
      card.addEventListener('click', () => openChart(ch));
      cardsEl.appendChild(card);
    });

    if (isCurrent) {
      const nc = document.createElement('div');
      nc.className = 'new-chart-card'; nc.innerHTML = '+ New chart'; nc.onclick = createNewChart;
      cardsEl.appendChild(nc);
    }
  });
}
