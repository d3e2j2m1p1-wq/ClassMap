import { avatarColor, esc, getGenderGroups, initials, state } from '../core/state.js';

// ═══════════════════════════════════════════════
//  RENDER ROSTER (read-only view inside the editor)
// ═══════════════════════════════════════════════
export function renderRoster() {
  const total = state.students.length;
  const emptyEl = document.getElementById('rosterEmptyState');
  const contentEl = document.getElementById('rosterContent');

  if (total === 0) {
    emptyEl.style.display = 'flex';
    contentEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  contentEl.style.display = '';

  const byName = (a, b) => a.name.localeCompare(b.name);
  const groups = state.genderMode ? getGenderGroups() : [];
  const inGroup = s => groups.some(g => g.id === s.gender);
  const ungrouped = state.genderMode ? state.students.filter(s => !inGroup(s)) : [];

  // Stats row
  let stats = `<div class="stat-pill">Total <span>${total}</span></div>`;
  if (state.genderMode) {
    groups.forEach(g => {
      const n = state.students.filter(s => s.gender === g.id).length;
      stats += `<div class="stat-pill" style="border-left:3px solid ${esc(g.color)}">${esc(g.label || 'Unnamed')} <span>${n}</span></div>`;
    });
    if (ungrouped.length) stats += `<div class="stat-pill">Ungrouped <span>${ungrouped.length}</span></div>`;
  }
  document.getElementById('rosterStats').innerHTML = stats;

  // Columns
  const cols = document.getElementById('rosterColumns');
  cols.innerHTML = '';
  const addCol = (title, color, students) => {
    const col = document.createElement('div');
    col.className = 'gender-col';
    col.innerHTML = `
      <div class="gender-col-header">
        ${color ? `<span class="ld-col-dot" style="background:${esc(color)};border-color:${esc(color)}"></span>` : ''}
        <span class="gender-title">${esc(title)}</span>
        <span class="gender-count">${students.length}</span>
      </div>
      <div class="student-list-inner scrollable"></div>`;
    renderStudentList(col.querySelector('.student-list-inner'), students);
    cols.appendChild(col);
  };

  if (!state.genderMode) {
    cols.style.gridTemplateColumns = '1fr';
    addCol('All Students', null, [...state.students].sort(byName));
  } else {
    const n = groups.length + (ungrouped.length ? 1 : 0);
    cols.style.gridTemplateColumns = `repeat(${Math.max(1, n)}, 1fr)`;
    groups.forEach(g => addCol(g.label || 'Unnamed group', g.color,
      state.students.filter(s => s.gender === g.id).sort(byName)));
    if (ungrouped.length) addCol('Ungrouped', null, ungrouped.sort(byName));
  }
}

export function renderStudentList(el, students) {
  el.innerHTML = '';
  if (students.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>No students yet</p></div>';
    return;
  }
  students.forEach(s => el.appendChild(makeStudentChip(s)));
}

export function makeStudentChip(s) {
  const div = document.createElement('div');
  div.className = 'student-chip' + (isSeated(s.id) ? ' seated' : '');
  div.draggable = false;
  div.dataset.id = s.id;
  div.innerHTML = `
    <div class="avatar" style="background:${avatarColor(s)}; color:#fff; opacity:0.9">${esc(initials(s.name))}</div>
    <span class="sname">${esc(s.name)}</span>
    ${isSeated(s.id) ? '<span style="font-size:0.65rem;color:var(--green,#4ade80)">✓ seated</span>' : ''}`;
  return div;
}

export function isSeated(studentId) {
  return Object.values(state.assignments).includes(studentId);
}
