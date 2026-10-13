import { store } from '../core/store.js';
import { pointerDrag } from '../assign/interactions.js';
import { CUSTOM_COLORS, KIND_DEFAULTS, defaultGroups, esc, groupOfKind, migrateGroupKinds } from '../core/state.js';
import { confirmDialog, plural, showToast, undoToast } from '../core/ui.js';
import { openNameList } from './nameListViewer.js';
import { firstNameOf } from '../roster/builtinNames.js';
import { afterManualPlacement, autoSortClass, classFlaggedCount, guessGroupForClass, nameStatus, recordPlacement } from '../roster/nameList.js';
import { parseRosterText } from '../roster/parseRoster.js';
import { saveLandingData } from '../storage/landingData.js';
import { openTagMenu, tagChipsHTML } from './tags.js';

// ── Roster tab ──
export function renderLdRoster() {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  document.getElementById('ldGenderToggle').checked = cls.genderMode || false;
  if (cls.genderMode) ensureGenderGroups(cls);
  renderLdStudentCols(cls);
}

export function ensureGenderGroups(cls) {
  if (!cls.genderGroups || cls.genderGroups.length === 0) cls.genderGroups = defaultGroups();
}

export function renderLdRosterHeader(cls) {
  // Render the group manager above the columns
  const mgr = document.getElementById('ldGroupManager');
  if (!mgr) return;
  mgr.innerHTML = '';

  if (!cls.genderMode) return;

  ensureGenderGroups(cls);
  migrateGroupKinds(cls.genderGroups);
  const used = k => cls.genderGroups.some(g => g.kind === k);
  const kindOptions = (current) => ['boys','girls','custom'].map(k =>
    `<option value="${k}" ${k === current ? 'selected' : ''} ${k !== 'custom' && k !== current && used(k) ? 'disabled' : ''}>${k === 'boys' ? 'Boys' : k === 'girls' ? 'Girls' : 'Custom'}</option>`).join('');

  const header = document.createElement('div');
  header.className = 'ld-group-manager';
  header.innerHTML = '<span class="ld-group-manager-label">Groups:</span>';

  cls.genderGroups.forEach(g => {
    const pill = document.createElement('div');
    pill.className = 'ld-group-pill';
    pill.innerHTML = `
      <input type="color" class="ld-group-color" value="${esc(g.color)}" title="Change color" data-gid="${esc(g.id)}">
      <input type="text" class="ld-group-name" value="${esc(g.label)}" placeholder="Group name…" data-gid="${esc(g.id)}">
      <select class="ld-group-kind" title="Boys / Girls groups teach the name list. Custom groups never do.">${kindOptions(g.kind)}</select>
      ${cls.genderGroups.length > 1 ? `<button class="ld-group-del" onclick="ldDeleteGroup('${esc(g.id)}')" title="Remove group">✕</button>` : ''}`;
    pill.querySelector('.ld-group-color').addEventListener('input', e => {
      g.color = e.target.value;
      saveLandingData();
      renderLdStudentCols(cls);
    });
    pill.querySelector('.ld-group-name').addEventListener('change', e => {
      g.label = e.target.value.trim() || g.label;
      saveLandingData();
      renderLdStudentCols(cls);
    });
    pill.querySelector('.ld-group-kind').addEventListener('change', e => ldChangeGroupKind(g.id, e.target.value));
    header.appendChild(pill);
  });

  // New group: choose Boys / Girls / Custom, then add
  const newKind = document.createElement('select');
  newKind.className = 'ld-group-kind ld-new-kind';
  newKind.id = 'ldNewGroupKind';
  const firstFree = !used('boys') ? 'boys' : !used('girls') ? 'girls' : 'custom';
  newKind.innerHTML = kindOptions(firstFree);
  header.appendChild(newKind);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-ghost btn-sm';
  addBtn.textContent = '+ Group';
  addBtn.onclick = () => ldAddGroup(cls, newKind.value);
  header.appendChild(addBtn);

  const sortBtn = document.createElement('button');
  sortBtn.className = 'btn btn-ghost btn-sm';
  sortBtn.textContent = '⚡ Auto-sort by name';
  sortBtn.title = 'Put ungrouped students into Boys / Girls when the name is known';
  sortBtn.onclick = () => ldAutoSort(cls);
  header.appendChild(sortBtn);

  const fl = classFlaggedCount(cls);
  const listBtn = document.createElement('button');
  listBtn.className = 'btn btn-ghost btn-sm';
  listBtn.innerHTML = '📖 Name list' + (fl ? ` <span style="color:var(--amber)">⚑ ${fl}</span>` : '');
  listBtn.onclick = () => openNameList();
  header.appendChild(listBtn);
  mgr.appendChild(header);
}

export function renderLdStudentCols(cls) {
  renderLdRosterHeader(cls);
  const wrap = document.getElementById('ldStudentCols');
  wrap.innerHTML = '';

  if (!cls.genderMode) {
    // Single column — all students
    const sorted = [...cls.students].sort((a,b) => a.name.localeCompare(b.name));
    const col = document.createElement('div');
    col.className = 'ld-student-col';
    col.innerHTML = `<div class="ld-col-header"><span style="color:var(--text)">${cls.students.length} Students</span></div>
      <div class="ld-col-body" id="ldcol_all"></div>
      <div class="ld-add-student">
        <input placeholder="Add student..." id="ldadd_all" onkeydown="if(event.key==='Enter')ldAddStudent(null,this)">
        <button class="btn btn-primary btn-sm" onclick="ldAddStudent(null,document.getElementById('ldadd_all'))">+</button>
      </div>`;
    wrap.appendChild(col);
    sorted.forEach(s => col.querySelector('.ld-col-body').appendChild(ldStudentRow(s, false)));
    return;
  }

  ensureGenderGroups(cls);
  const groups = cls.genderGroups;

  // Build one column per group + one "Unassigned" column
  const unassigned = cls.students.filter(s => !s.gender || !groups.find(g => g.id === s.gender))
    .sort((a,b) => a.name.localeCompare(b.name));

  groups.forEach(g => {
    const members = cls.students.filter(s => s.gender === g.id).sort((a,b) => a.name.localeCompare(b.name));
    const colEl = document.createElement('div');
    colEl.className = 'ld-student-col';
    colEl.innerHTML = `
      <div class="ld-col-header">
        <span class="ld-col-dot" style="background:${esc(g.color)};${isLightColor(g.color)?'border-color:var(--border2)':'border-color:'+esc(g.color)}"></span>
        <span style="color:${isLightColor(g.color)?'var(--text)':esc(g.color)};font-weight:600;">${g.label ? esc(g.label) : '<em style=\'font-style:italic;opacity:0.5;font-weight:400\'>Unnamed group</em>'}</span>
        <span style="color:var(--text3);margin-left:auto;">${members.length}</span>
      </div>
      <div class="ld-col-body" id="ldcol_${esc(g.id)}"></div>
      <div class="ld-add-student">
        <input placeholder="Add..." id="ldadd_${esc(g.id)}" onkeydown="if(event.key==='Enter')ldAddStudent('${esc(g.id)}',this)">
        <button class="btn btn-primary btn-sm" onclick="ldAddStudent('${esc(g.id)}',document.getElementById('ldadd_${esc(g.id)}'))">+</button>
      </div>`;
    wrap.appendChild(colEl);
    const body = colEl.querySelector('.ld-col-body');
    members.forEach(s => body.appendChild(ldStudentRow(s, true, groups)));
    ldWireColDrop(colEl, g.id); // whole column is drop target
  });

  // Always show Unassigned column
  const uCol = document.createElement('div');
  uCol.className = 'ld-student-col ld-col-unassigned';
  uCol.innerHTML = `
    <div class="ld-col-header">
      <span class="ld-col-dot" style="background:var(--surface3);border-color:var(--border2)"></span>
      <span style="color:var(--text3);font-weight:600;">Ungrouped</span>
      <span style="color:var(--text3);margin-left:auto;">${unassigned.length}</span>
    </div>
    <div class="ld-col-body" id="ldcol_unassigned"></div>
    <div class="ld-add-student">
      <input placeholder="Add..." id="ldadd_unassigned" onkeydown="if(event.key==='Enter')ldAddStudent(null,this)">
      <button class="btn btn-primary btn-sm" onclick="ldAddStudent(null,document.getElementById('ldadd_unassigned'))">+</button>
    </div>`;
  wrap.appendChild(uCol);
  const uBody = uCol.querySelector('.ld-col-body');
  unassigned.forEach(s => uBody.appendChild(ldStudentRow(s, true, groups, true)));
  ldWireColDrop(uCol, null); // drop to unassign
}

// Build a dashed-ring SVG for group assignment buttons
export function isLightColor(hex) {
  // Returns true if hex color is light (luminance > 0.6)
  const h = hex.replace('#','');
  if (h.length < 6) return true;
  const r = parseInt(h.slice(0,2),16)/255;
  const g = parseInt(h.slice(2,4),16)/255;
  const b = parseInt(h.slice(4,6),16)/255;
  return (0.299*r + 0.587*g + 0.114*b) > 0.6;
}

export function ringsvg(color, active) {
  const r1 = 9, r2 = 13.5, cx = 16, cy = 16;
  // Two rings of dashes — inner and outer
  const innerDash = active ? `4,2.5` : `2.5,3.5`;
  const outerDash = active ? `5.5,2.8` : `3.5,4`;
  const opacity = active ? 1 : 0.45;
  const sw1 = active ? 3 : 2.2;
  const sw2 = active ? 3.5 : 2.4;
  return `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r1}" stroke="${color}" stroke-width="${sw1}"
      stroke-dasharray="${innerDash}" stroke-linecap="round"
      opacity="${opacity}" transform="rotate(-30 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r2}" stroke="${color}" stroke-width="${sw2}"
      stroke-dasharray="${outerDash}" stroke-linecap="round"
      opacity="${opacity * 0.75}" transform="rotate(15 ${cx} ${cy})"/>
    ${active ? `<circle cx="${cx}" cy="${cy}" r="3.5" fill="${color}" opacity="0.9"/>` : ''}
  </svg>`;
}

export function flagTitle(st) {
  if (st.pin === 'ask') return 'Pinned: always ask — sort this one by hand';
  if (st.builtin === 'both' && !st.learnedBoy && !st.learnedGirl) return 'Often used for both boys and girls — sort by hand';
  return `Seen as both (boy ${st.boy}, girl ${st.girl}) — sort by hand`;
}

export function ldStudentRow(s, showGroupBtns, groups, checkFlag) {
  const row = document.createElement('div');
  row.className = 'ld-student-row';
  row.dataset.studentId = s.id;

  const grp = groups ? groups.find(g => g.id === s.gender) : null;
  const dotColor = grp ? grp.color : '#64748b';
  // Use dark text on light backgrounds
  const isLight = !grp || isLightColor(dotColor);
  const textColor = isLight ? '#374151' : '#fff';
  const ini = s.name.trim().split(/\s+/).map(w=>w[0]).join('').substring(0,2).toUpperCase();

  row.innerHTML = `
    <div class="ld-drag-handle" title="Drag to reassign">⠿</div>
    <div class="ld-student-avatar" style="background:${esc(dotColor)};color:${textColor}">${esc(ini)}</div>
    <span class="ld-student-name">${esc(s.name)}<span class="ld-tags">${tagChipsHTML(s)}</span></span>
    <button class="ld-tag-btn" title="Tags" aria-label="Tags for ${esc(s.name)}">🏷</button>
    <button class="ld-student-del" data-sid="${esc(s.id)}" title="Remove" aria-label="Remove ${esc(s.name)}">✕</button>`;

  row.querySelector('.ld-tag-btn').addEventListener('click', e => {
    e.stopPropagation();
    const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
    const st = cls && cls.students.find(x => x.id === s.id);
    if (!st) return;
    openTagMenu(cls, st, e.currentTarget, () => { row.querySelector('.ld-tags').innerHTML = tagChipsHTML(st); });
  });

  // ⚑ = this first name has been sorted as both boy and girl, so it is left for you
  if (checkFlag) {
    const st = nameStatus(firstNameOf(s.name));
    if (st.flagged) {
      const flag = document.createElement('span');
      flag.className = 'ld-flag';
      flag.textContent = '⚑';
      flag.title = flagTitle(st) + ' (click to open the name list)';
      flag.addEventListener('click', e => { e.stopPropagation(); openNameList(firstNameOf(s.name)); });
      row.insertBefore(flag, row.querySelector('.ld-student-del'));
    }
  }

  // Delete button
  row.querySelector('.ld-student-del').addEventListener('click', e => {
    e.stopPropagation();
    ldDeleteStudent(s.id);
  });

  // Drag to another group column (mouse, pen or touch — sideways drags on touch screens,
  // so swiping up and down still scrolls the list)
  row.addEventListener('pointerdown', e => {
    if (e.target.closest('.ld-student-del, .ld-flag, .ld-tag-btn')) return;
    if (!row.closest('.ld-drop-col')) return;          // single-column roster: nowhere to drag to
    pointerDrag(e, {
      label: s.name,
      sourceEl: row,
      sourceClass: 'ld-dragging',
      highlightClass: 'ld-col-drop-active',
      findTarget: el => el.closest('.ld-drop-col'),
      onDrop: t => {
        const gid = t.dataset.dropGid || null;
        if (gid !== (s.gender || null)) ldSetGender(s.id, gid);
      },
    });
  });

  return row;
}

// Mark a roster column as a drop target for dragged students (targetGid null = Ungrouped)
export function ldWireColDrop(colEl, targetGid) {
  colEl.classList.add('ld-drop-col');
  colEl.dataset.dropGid = targetGid || '';
}

export function ldSetGender(id, gid) {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  const st = cls.students.find(x => x.id === id);
  let note = '';
  if (st) {
    const before = nameStatus(firstNameOf(st.name));
    st.gender = gid;   // dropping on a column always moves the student there
    const grp = gid ? (cls.genderGroups || []).find(g => g.id === gid) : null;
    if (recordPlacement(st, grp) && grp) note = afterManualPlacement(cls, st, grp, before);
  }
  saveLandingData();
  renderLdStudentCols(cls);
  if (note) showToast(note);
}

export function ldAddGroup(cls, kind) {
  ensureGenderGroups(cls);
  kind = ['boys','girls','custom'].includes(kind) ? kind : 'custom';
  if (kind !== 'custom' && groupOfKind(cls, kind)) { showToast(`This class already has a ${kind === 'boys' ? 'Boys' : 'Girls'} group`); return; }
  const def = KIND_DEFAULTS[kind];
  const nCustom = cls.genderGroups.filter(g => g.kind === 'custom').length;
  cls.genderGroups.push({
    id: 'g_' + Date.now(),
    label: def ? def.label : '',
    color: def ? def.color : CUSTOM_COLORS[nCustom % CUSTOM_COLORS.length],
    kind,
  });
  saveLandingData();
  renderLdStudentCols(cls);
  if (kind === 'custom') {
    const inputs = document.querySelectorAll('.ld-group-name');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }
}

// Change what a group means (Boys / Girls / Custom)
export async function ldChangeGroupKind(gid, kind) {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  const g = (cls.genderGroups || []).find(x => x.id === gid);
  if (!g || g.kind === kind) return;
  if (kind !== 'custom' && groupOfKind(cls, kind)) {
    showToast(`This class already has a ${kind === 'boys' ? 'Boys' : 'Girls'} group`);
    renderLdStudentCols(cls);
    return;
  }
  const oldDef = KIND_DEFAULTS[g.kind], newDef = KIND_DEFAULTS[kind];
  if (newDef) {
    // Swap default names/colours, but never overwrite something the teacher customised
    if (!g.label || (oldDef && g.label === oldDef.label) || /^Group \d+$/.test(g.label)) g.label = newDef.label;
    const c = String(g.color || '').toLowerCase();
    if (!c || c === '#ffffff' || (oldDef && c === oldDef.color) || CUSTOM_COLORS.includes(c)) g.color = newDef.color;
  }
  g.kind = kind;

  const members = cls.students.filter(x => x.gender === gid);
  if (kind === 'custom') {
    members.forEach(m => recordPlacement(m, g));               // custom groups don't teach: retract
  } else if (members.length) {
    const word = kind === 'boys' ? 'boys' : 'girls';
    const learn = await confirmDialog({
      title: `Learn names from “${g.label}”?`,
      details: plural(members.length, 'student') + ' in this group',
      message: `Their first names will be remembered as ${word}, so ClassMap can sort them automatically in other classes.`,
      confirmLabel: 'Learn names',
      cancelLabel: 'Not now',
    });
    members.forEach(m => recordPlacement(m, learn ? g : null));   // "Not now" keeps the list free of stale votes
  }
  saveLandingData();
  renderLdStudentCols(cls);
}

export function ldDeleteGroup(gid) {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  cls.genderGroups = cls.genderGroups.filter(g => g.id !== gid);
  // Unassign students from this group
  cls.students.forEach(s => { if (s.gender === gid) s.gender = null; });
  saveLandingData();
  renderLdStudentCols(cls);
}

export function ldAddStudent(gender, inputEl) {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  const name = inputEl.value.trim();
  if (!name) return;
  if (cls.students.some(s => s.name.trim().toLowerCase() === name.toLowerCase())) {
    showToast('That name is already in the roster'); return;
  }
  // Specific group column → that group (and it teaches the name list); otherwise guess from the first name
  const g = gender || guessGroupForClass(cls, name) || null;
  const student = { id: 'st_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), name, gender: g };
  const before = nameStatus(firstNameOf(name));
  cls.students.push(student);
  let note = '';
  if (gender) {
    const grp = (cls.genderGroups || []).find(x => x.id === gender);
    if (grp && recordPlacement(student, grp)) note = afterManualPlacement(cls, student, grp, before);
  }
  saveLandingData();
  inputEl.value = '';
  renderLdStudentCols(cls);
  if (note) showToast(note);
}

// Remove a student and everything that points at them (rules, seats in saved charts)
export function purgeStudentRefs(cls, st) {
  const nm = st.name.trim().toLowerCase();
  const refs = r => [r.studentA, r.studentB].some(x => x && String(x).trim().toLowerCase() === nm);
  cls.hardRules = (cls.hardRules || []).filter(r => !refs(r));
  store.landingData.charts.filter(c => c.classId === cls.id).forEach(ch => {
    const d = ch.data;
    if (!d) return;
    if (d.assignments) Object.keys(d.assignments).forEach(k => { if (d.assignments[k] === st.id) delete d.assignments[k]; });
    if (d.tempRules) d.tempRules = d.tempRules.filter(r => !(refs(r) || r.studA === st.id || r.studB === st.id));
  });
}

export function ldDeleteStudent(id) {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  const st = cls.students.find(s => s.id === id);
  cls.students = cls.students.filter(s => s.id !== id);
  if (st) purgeStudentRefs(cls, st);
  saveLandingData();
  renderLdStudentCols(cls);
}

export function sortSummary(r) {
  const parts = [];
  if (r.moved) parts.push(`Sorted ${r.moved} student${r.moved !== 1 ? 's' : ''} by name`);
  if (r.flagged) parts.push(`${r.flagged} flagged ⚑ name${r.flagged !== 1 ? 's' : ''} left for you`);
  return parts.join(' · ');
}

export function ldAutoSort(cls) {
  ensureGenderGroups(cls);
  if (!groupOfKind(cls, 'boys') && !groupOfKind(cls, 'girls')) {
    showToast('Add a Boys or Girls group first — Custom groups are never auto-filled');
    return;
  }
  const r = autoSortClass(cls);
  saveLandingData();
  renderLdStudentCols(cls);
  showToast(sortSummary(r) || 'No more names recognised — drag the rest into a group and ClassMap will learn them');
}

export function ldParseRoster() {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  const text = document.getElementById('ldRosterPaste').value.trim();
  if (!text) return;
  const names = parseRosterText(text);

  const existingNames = new Set(cls.students.map(s => s.name.toLowerCase()));
  let added = 0, dupes = 0;
  names.forEach(raw => {
    // Handle "Last, First" format
    let name = raw;
    const m = raw.match(/^([^,]+),\s*(.+)$/);
    if (m) name = m[2].trim() + ' ' + m[1].trim();
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (existingNames.has(name.toLowerCase())) { dupes++; return; }
    const gender = guessGroupForClass(cls, name);
    cls.students.push({ id: 'st_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), name, gender: gender || null });
    existingNames.add(name.toLowerCase());
    added++;
  });
  saveLandingData();
  document.getElementById('ldRosterPaste').value = '';
  renderLdStudentCols(cls);
  showToast(`Added ${added} student${added!==1?'s':''}` + (dupes ? ` · ${dupes} already in the roster` : ''));
}

export async function ldClearRoster() {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  const n = cls.students.length;
  if (!n) { showToast('There are no students to remove'); return; }
  const ok = await confirmDialog({
    title: `Remove all ${plural(n, 'student')} from “${cls.name}”?`,
    message: 'Their permanent rules, and their seats and rules in this class\'s charts, are removed too.',
    confirmLabel: 'Remove all',
    danger: true,
  });
  if (!ok) return;
  // Snapshot what removing touches, for Undo
  const snap = {
    students: structuredClone(cls.students),
    hardRules: structuredClone(cls.hardRules || []),
    charts: {},
  };
  store.landingData.charts.filter(ch => ch.classId === cls.id && ch.data).forEach(ch => {
    snap.charts[ch.id] = { assignments: structuredClone(ch.data.assignments || {}), tempRules: structuredClone(ch.data.tempRules || []) };
  });
  cls.students.slice().forEach(st => purgeStudentRefs(cls, st));
  cls.students = [];
  saveLandingData();
  renderLdStudentCols(cls);
  undoToast(`Removed ${plural(n, 'student')} from “${cls.name}”`, () => {
    const c = store.landingData.classes.find(x => x.id === cls.id);
    if (!c) return;
    c.students = snap.students;
    c.hardRules = snap.hardRules;
    store.landingData.charts.forEach(ch => {
      const sc = snap.charts[ch.id];
      if (sc && ch.data) { ch.data.assignments = sc.assignments; ch.data.tempRules = sc.tempRules; }
    });
    saveLandingData();
    if (store.activeClassId === c.id) renderLdStudentCols(c);
  });
}

export function ldToggleGender() {
  const cls = store.landingData.classes.find(c => c.id === store.activeClassId);
  if (!cls) return;
  cls.genderMode = document.getElementById('ldGenderToggle').checked;
  let note = '';
  if (cls.genderMode) {
    ensureGenderGroups(cls);
    note = sortSummary(autoSortClass(cls));
  }
  saveLandingData();
  renderLdStudentCols(cls);
  if (note) showToast(note);
}
