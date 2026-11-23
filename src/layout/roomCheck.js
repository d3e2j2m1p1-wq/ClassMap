// ═══════════════════════════════════════════════
//  ROOM CHECK + TIDY UP
//  A live checklist in the Layout tab: furniture in a door's swing or a "no seats" area,
//  overlapping or outside the walls, tables nobody can walk to (3-ft walkways), seats that
//  can't see the board, not enough seats. Most problems have a Fix button.
//  "Show walkways" draws where a person can actually walk from the door.
//  Tidy up straightens and lines up the teacher's own arrangement and moves things out of the way.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc, state } from '../core/state.js';
import { plural, undoToast } from '../core/ui.js';
import { markDirty } from '../storage/autosave.js';
import { undo } from '../editor/undo.js';
import { renderLayoutCanvas } from './canvas.js';
import { setSelection } from './selection.js';
import { addWalls } from './templates.js';
import {
  AISLE_FT, CELL, VIEW, boxOf, doorZones, findFreeSpot, isFurniture, overlaps, placementProblems, pxPerFt,
  reachability, roomBounds, seatCount, sightlines,
} from './roomModel.js';
import { openArrange } from './arrange.js';

let panelOpen = false;
let showWalk = false;
let lastIssues = [];
let timer = null;

const nameOf = item => item.type === 'table' ? (item.label ? `“${item.label}”` : 'a table')
  : item.type === 'seat' ? 'a desk' : item.type === 'teacher' ? "the teacher's desk" : 'an item';
const listNames = items => {
  const names = items.map(nameOf);
  const labelled = names.filter(n => n.startsWith('“'));
  if (labelled.length === names.length && names.length <= 3) return names.join(', ');
  const t = items.filter(i => i.type === 'table').length, s = items.filter(i => i.type === 'seat').length;
  return [t && plural(t, 'table'), s && plural(s, 'desk'), items.some(i => i.type === 'teacher') && "the teacher's desk"].filter(Boolean).join(' and ');
};

// ── What's wrong with this room? ──
export function analyzeRoom(items = state.layoutItems) {
  const issues = [];
  const bounds = roomBounds(items);
  const ppf = pxPerFt(items);
  const doors = doorZones(items, bounds);
  const furniture = items.filter(isFurniture);
  const seats = seatCount(items), students = state.students.length;

  if (!furniture.length) return { issues, stats: { seats, students, ppf, bounds } };

  // Placement: walls, overlaps, desk, "no seats", door swing
  const by = { outside: [], overlap: [], desk: [], zone: [], door: [] };
  furniture.forEach(f => placementProblems(f, items, bounds, doors).forEach(p => by[p].push(f)));
  // an overlap involves two items — report (and move) only the later one of each pair
  by.overlap = furniture.filter((f, i) => by.overlap.includes(f) &&
    furniture.slice(0, i).some(o => overlaps(boxOf(f), boxOf(o), -2)));
  const move = list => () => moveOutOfTheWay(list);
  if (by.door.length) issues.push({ key: 'door', level: 'problem', ids: by.door.map(i => i.id), fix: move(by.door), fixLabel: 'Move',
    text: `${cap(listNames(by.door))} ${by.door.length === 1 ? 'is' : 'are'} in the door's way` });
  if (by.zone.length) issues.push({ key: 'zone', level: 'problem', ids: by.zone.map(i => i.id), fix: move(by.zone), fixLabel: 'Move',
    text: `${cap(listNames(by.zone))} ${by.zone.length === 1 ? 'is' : 'are'} in a “no seats” area` });
  if (by.desk.length) issues.push({ key: 'desk', level: 'problem', ids: by.desk.map(i => i.id), fix: move(by.desk), fixLabel: 'Move',
    text: `${cap(listNames(by.desk))} ${by.desk.length === 1 ? 'is' : 'are'} on top of the teacher's desk` });
  if (by.overlap.length) issues.push({ key: 'overlap', level: 'problem', ids: by.overlap.map(i => i.id), fix: move(by.overlap), fixLabel: 'Move apart',
    text: `${cap(listNames(by.overlap))} ${by.overlap.length === 1 ? 'overlaps' : 'overlap'} other furniture` });
  if (by.outside.length) issues.push({ key: 'outside', level: 'problem', ids: by.outside.map(i => i.id), fix: move(by.outside), fixLabel: 'Move inside',
    text: `${cap(listNames(by.outside))} ${by.outside.length === 1 ? 'is' : 'are'} outside the walls` });

  // Walkways
  const reach = reachability(items, bounds);
  if (reach.blockedDoors.length)
    issues.push({ key: 'doorblocked', level: 'problem', ids: reach.blockedDoors.map(d => d.id),
      text: `There's no ${AISLE_FT}-ft walkway in from ${reach.blockedDoors.length === 1 ? 'the door' : plural(reach.blockedDoors.length, 'door')}` });
  else if (reach.unreachable.length) {
    const from = reach.from === 'door' ? 'from the door' : reach.from === 'desk' ? "from the teacher's desk" : '';
    issues.push({ key: 'walk', level: 'problem', ids: reach.unreachable.map(i => i.id),
      text: `${cap(listNames(reach.unreachable))} can't be reached ${from} with a ${AISLE_FT}-ft walkway`.replace('  ', ' '),
      hint: 'Spread tables apart, or try Tidy up / Arrange for me' });
  }

  // Sightlines
  const views = sightlines(items, bounds);
  let farthest = 0;
  if (views) {
    farthest = Math.max(0, ...views.map(v => v.dist));
    const kinds = {
      behind: 'behind the board', angle: `at a sharp angle to the board (over ${VIEW.maxAngle}°)`,
      close: `very close to the board (under ${VIEW.closeFt} ft)`, far: `far from the board (over ${VIEW.farFt} ft)`,
    };
    Object.entries(kinds).forEach(([k, label]) => {
      const vs = views.filter(v => v.problem === k);
      if (!vs.length) return;
      const ids = [...new Set(vs.map(v => v.seat.itemId))];
      issues.push({ key: 'view-' + k, level: k === 'behind' ? 'problem' : 'tip', ids,
        text: `${plural(vs.length, 'seat')} ${vs.length === 1 ? 'is' : 'are'} ${label}` });
    });
  } else {
    issues.push({ key: 'noboard', level: 'info', ids: [], text: 'Add the board so ClassMap can check what every seat can see' });
  }

  // Counts and missing pieces
  if (students && seats < students)
    issues.push({ key: 'seats', level: 'problem', ids: [], text: `${plural(seats, 'seat')} for ${plural(students, 'student')} — ${students - seats} more needed`,
      hint: 'Arrange for me can lay out enough' });
  if (!bounds.walls) issues.push({ key: 'nowalls', level: 'info', ids: [], text: 'Add walls to check walkways along the edges of the room', fix: () => { addWalls(); scheduleRoomCheck(); }, fixLabel: 'Add walls' });
  if (!doorZones(items, bounds).length) issues.push({ key: 'nodoor', level: 'info', ids: [], text: 'Add a door so ClassMap can check the way in' });

  return { issues, reach, views, stats: { seats, students, ppf, bounds, farthest, feet: bounds.walls ? [bounds.w / ppf, bounds.h / ppf] : null } };
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ── Fixes ──
function moveOutOfTheWay(list) {
  const items = state.layoutItems;
  const bounds = roomBounds(items);
  const doors = doorZones(items, bounds);
  let moved = 0, stuck = 0;
  list.forEach(f => {
    const live = items.find(i => i.id === f.id);
    if (!live || !placementProblems(live, items, bounds, doors).length) return;
    const spot = findFreeSpot(live, items, bounds, doors);
    if (spot) { live.x = spot.x; live.y = spot.y; moved++; } else stuck++;
  });
  renderLayoutCanvas();
  markDirty();
  if (moved) undoToast(`Moved ${plural(moved, 'item')}` + (stuck ? ` · ${stuck} had nowhere to go` : ''), () => undo());
}

// ── Tidy up: straighten, line up rows and columns, even gaps, then move things out of the way ──
export function tidyUp() {
  const items = state.layoutItems;
  const furn = items.filter(isFurniture);
  if (!furn.length) return;
  let straightened = 0, lined = 0;
  // 1. straighten to the nearest 45°
  furn.forEach(f => {
    const r = f.rotation || 0, snapped = ((Math.round(r / 45) * 45) % 360 + 360) % 360;
    if (Math.abs(r - snapped) > 0.5 && Math.abs(r - snapped) < 359.5) { f.rotation = snapped; straightened++; }
  });
  // 2. line up rows (same centre height) and columns (same centre across), within half an item
  const centre = f => { const b = boxOf(f); return [b.cx, b.cy, b.w, b.h]; };
  const lineUp = axis => {
    const list = furn.map(f => { const [cx, cy, w, h] = centre(f); return { f, c: axis === 'y' ? cy : cx, size: axis === 'y' ? h : w }; })
      .sort((a, b) => a.c - b.c);
    const groups = [];
    list.forEach(e => {
      const g = groups[groups.length - 1];
      if (g && Math.abs(e.c - g[0].c) < Math.min(e.size, g[0].size) * 0.4) g.push(e); else groups.push([e]);
    });
    groups.filter(g => g.length > 1).forEach(g => {
      const target = Math.round(g.map(e => e.c).sort((a, b) => a - b)[g.length >> 1] / (CELL / 2)) * (CELL / 2);
      g.forEach(e => {
        const d = target - e.c;
        if (Math.abs(d) > 0.5) { e.f[axis] += d; lined++; }
      });
    });
    return groups;
  };
  const rows = lineUp('y');
  lineUp('x');
  // 3. even gaps along each row of 3+ when the gaps are already close to each other
  rows.filter(g => g.length >= 3).forEach(g => {
    const boxes = g.map(e => ({ e, b: boxOf(e.f) })).sort((a, b) => a.b.cx - b.b.cx);
    const gaps = boxes.slice(1).map((x, i) => (x.b.cx - x.b.w / 2) - (boxes[i].b.cx + boxes[i].b.w / 2));
    if (Math.min(...gaps) < 0 || Math.max(...gaps) > Math.min(...gaps) * 1.6 + CELL) return;
    const first = boxes[0].b, last = boxes[boxes.length - 1].b;
    const total = (last.cx + last.w / 2) - (first.cx - first.w / 2) - boxes.reduce((n, x) => n + x.b.w, 0);
    const gap = total / (boxes.length - 1);
    let pos = first.cx - first.w / 2;
    boxes.forEach(x => { const d = pos - (x.b.cx - x.b.w / 2); if (Math.abs(d) > 0.5) { x.e.f.x += d; } pos += x.b.w + gap; });
  });
  // 4. out of doors, "no seats" areas, the desk, each other, back inside the walls
  const bounds = roomBounds(items), doors = doorZones(items, bounds);
  let moved = 0;
  furn.forEach(f => {
    if (!placementProblems(f, items, bounds, doors).length) return;
    const spot = findFreeSpot(f, items, bounds, doors);
    if (spot) { f.x = spot.x; f.y = spot.y; moved++; }
  });
  renderLayoutCanvas();
  markDirty();
  const parts = [straightened && `straightened ${straightened}`, lined && 'lined up rows', moved && `moved ${moved} out of the way`].filter(Boolean);
  undoToast(parts.length ? 'Tidied up: ' + parts.join(', ') : 'Already tidy', () => undo());
}

// ── Panel ──
export function toggleRoomCheck(force) {
  panelOpen = typeof force === 'boolean' ? force : !panelOpen;
  document.getElementById('roomCheckPanel').hidden = !panelOpen;
  document.getElementById('roomCheckBtn').classList.toggle('active', panelOpen);
  runRoomCheck();
}
export function toggleWalkways() {
  showWalk = !showWalk;
  runRoomCheck();
}

export function scheduleRoomCheck() {
  clearTimeout(timer);
  timer = setTimeout(runRoomCheck, 120);
}

export function runRoomCheck() {
  const btn = document.getElementById('roomCheckBtn');
  if (!btn) return;
  const { issues, reach, stats } = analyzeRoom();
  lastIssues = issues;
  const problems = issues.filter(i => i.level === 'problem').length;
  btn.querySelector('.rc-badge').textContent = problems ? String(problems) : '✓';
  btn.classList.toggle('has-problems', problems > 0);

  // highlight problem items (only while the panel is open)
  const bad = new Set(panelOpen ? issues.filter(i => i.level === 'problem').flatMap(i => i.ids) : []);
  document.querySelectorAll('#layoutCanvas .canvas-item').forEach(el => el.classList.toggle('has-issue', bad.has(el.dataset.id)));
  drawWalkways(panelOpen && showWalk ? reach : null);
  if (panelOpen) renderPanel(issues, stats);
}

function renderPanel(issues, stats) {
  const p = document.getElementById('roomCheckPanel');
  const room = state.layoutItems.find(i => i.type === 'room');
  const feet = stats.feet;
  const furnitureCount = state.layoutItems.filter(isFurniture).length;
  const levelIcon = { problem: '⚠', tip: '💡', info: 'ⓘ' };
  const list = issues.length
    ? issues.map((it, n) => `
      <li class="rc-issue ${it.level}">
        <span class="rc-ico" aria-hidden="true">${levelIcon[it.level]}</span>
        <div class="rc-body"><div>${esc(it.text)}</div>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</div>
        <div class="rc-actions">
          ${it.ids.length ? `<button class="rc-btn" data-show="${n}">Show</button>` : ''}
          ${it.fix ? `<button class="rc-btn primary" data-fix="${n}">${esc(it.fixLabel || 'Fix')}</button>` : ''}
        </div>
      </li>`).join('')
    : (furnitureCount ? `<li class="rc-ok">✓ Looks good — everyone can be reached with ${AISLE_FT}-ft walkways${stats.farthest ? ` and every seat can see the board (farthest ${Math.round(stats.farthest)} ft)` : ''}.</li>`
      : '<li class="rc-ok">Place some tables, or let Arrange for me lay out the room.</li>');
  p.innerHTML = `
    <div class="rc-head"><b>Room check</b><button class="rc-close" aria-label="Close room check">✕</button></div>
    <div class="rc-scale">${room
      ? `Room is <input id="rcFeetW" type="number" min="8" max="120" step="1" value="${Math.round(feet[0])}" aria-label="Room width in feet"> ft wide × ${Math.round(feet[1])} ft deep`
      : `About ${Math.round(SEAT_FT(stats.ppf))} ft per desk. Add walls to set the room's real size.`}</div>
    <div class="rc-tools">
      <button class="rc-btn" id="rcWalk" aria-pressed="${showWalk}">${showWalk ? 'Hide' : 'Show'} walkways</button>
      <button class="rc-btn" id="rcTidy">✨ Tidy up</button>
      <button class="rc-btn primary" id="rcArrange">Arrange for me…</button>
    </div>
    <ul class="rc-list">${list}</ul>`;
  p.querySelector('.rc-close').onclick = () => toggleRoomCheck(false);
  p.querySelector('#rcWalk').onclick = toggleWalkways;
  p.querySelector('#rcTidy').onclick = tidyUp;
  p.querySelector('#rcArrange').onclick = () => openArrange();
  const fw = p.querySelector('#rcFeetW');
  if (fw) fw.addEventListener('change', () => {
    const v = parseFloat(fw.value);
    if (v >= 8 && v <= 120) { room.feetW = v; markDirty(); runRoomCheck(); }
  });
  p.querySelectorAll('[data-show]').forEach(b => b.onclick = () => setSelection(lastIssues[+b.dataset.show].ids.filter(id => state.layoutItems.some(i => i.id === id))));
  p.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => lastIssues[+b.dataset.fix].fix());
}
const SEAT_FT = ppf => 52 / ppf;

// Walkable floor the door can reach, drawn faintly green; furniture nobody can reach outlined by CSS
function drawWalkways(reach) {
  const canvasEl = document.getElementById('layoutCanvas');
  let cv = canvasEl.querySelector('.walk-overlay');
  if (!reach) { if (cv) cv.remove(); return; }
  const { walk, seen } = reach;
  if (!cv) { cv = document.createElement('canvas'); cv.className = 'walk-overlay'; cv.setAttribute('aria-hidden', 'true'); }
  canvasEl.insertBefore(cv, canvasEl.firstChild);
  const b = walk.bounds;
  cv.width = walk.cols * CELL; cv.height = walk.rows * CELL;
  cv.style.left = b.x + 'px'; cv.style.top = b.y + 'px';
  const g = cv.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = 'rgba(52, 208, 126, 0.22)';
  for (let i = 0; i < seen.length; i++) if (seen[i]) g.fillRect((i % walk.cols) * CELL + 1, ((i / walk.cols) | 0) * CELL + 1, CELL - 2, CELL - 2);
}

export function initRoomCheck() {
  // re-check after anything in the room changes (drags end on pointerup; edits re-render)
  document.addEventListener('pointerup', () => {
    const panel = document.getElementById('panel-layout');
    if (panel && panel.classList.contains('active')) scheduleRoomCheck();
  });
}
