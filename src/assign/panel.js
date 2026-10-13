import { store } from '../core/store.js';
import { placeStudent, pointerDrag, togglePin, unseatStudent } from './interactions.js';
import { cleanAssignments, getAllSeats } from './seats.js';
import { esc, groupColor, initials, state } from '../core/state.js';
import { isLightColor } from '../landing/roster.js';
import { appendGroupOutlines } from '../layout/tableGroups.js';
import { tableBBox } from '../layout/tables.js';
import { markDirty } from '../storage/autosave.js';

// ═══════════════════════════════════════════════
//  ASSIGN PANEL
// ═══════════════════════════════════════════════
// ── Assign panel ──
export const SEAT_SIZE = 52;

export function renderAssignPanel() {
  if (cleanAssignments()) markDirty();
  const canvas = document.getElementById('assignCanvas');
  canvas.innerHTML = '';

  const seats = getAllSeats();

  if (seats.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'drop-zone-hint';
    hint.innerHTML = `<div class="hint-icon">👆</div><p>Your layout will appear here after you build it in the <strong>Layout</strong> tab.<br>Place seats and tables there first.</p>`;
    canvas.appendChild(hint);
  }

  if (store.layoutImg) {
    const img = document.createElement('img');
    img.className = 'layout-image';
    img.src = store.layoutImg; img.style.opacity = '0.25';
    canvas.appendChild(img);
  }

  state.layoutItems.forEach(item => {
    if (item.type === 'board') {
      const el = document.createElement('div');
      el.className = 'canvas-board';
      el.textContent = '▲ Board';
      el.style.cssText = `position:absolute;left:${item.x}px;top:${item.y}px;pointer-events:none;`;
      if (item.rotation) el.style.transform = `rotate(${item.rotation}deg)`;
      canvas.appendChild(el);

    } else if (item.type === 'teacher') {
      const el = document.createElement('div');
      el.className = 'canvas-teacher';
      el.innerHTML = '★<span>Teacher</span>';
      el.style.cssText = `position:absolute;left:${item.x}px;top:${item.y}px;pointer-events:none;`;
      if (item.rotation) el.style.transform = `rotate(${item.rotation}deg)`;
      canvas.appendChild(el);

    } else if (item.type === 'seat') {
      const chip = makeAssignChip(item.id, item.x, item.y);
      if (item.rotation) chip.style.transform = `rotate(${item.rotation}deg)`;
      canvas.appendChild(chip);
      (chip._extras || []).forEach(x => canvas.appendChild(x));

    } else if (item.type === 'table') {
      canvas.appendChild(makeAssignTable(item));
    }
  });

  updateAssignStats();
  renderUnplaced();
}

export function makeAssignTable(item) {
  const bbox = tableBBox(item);

  // The wrapper has the SAME size and rotation as the table in the Layout tab,
  // so it rotates around its centre and sits exactly where it was placed.
  const wrap = document.createElement('div');
  wrap.className = 'assign-table-wrap';
  wrap.dataset.tableId = item.id;
  wrap.style.cssText = `position:absolute;left:${item.x}px;top:${item.y}px;width:${bbox.w}px;height:${bbox.h}px;transform-origin:50% 50%;`;
  if (item.rotation) wrap.style.transform = `rotate(${item.rotation}deg)`;

  const bg = document.createElement('div');
  bg.style.cssText = `position:absolute;left:0;top:0;width:${bbox.w}px;height:${bbox.h}px;
    background:rgba(79,142,247,0.04);border:1.5px dashed rgba(79,142,247,0.25);
    border-radius:10px;cursor:move;`;
  bg.title = 'Drag to move table';
  appendGroupOutlines(bg, item);

  (item.seatPositions || []).forEach((pos, i) => {
    const chip = makeAssignChip(item.id + '_' + i, pos.x, pos.y, true);
    bg.appendChild(chip);
    (chip._extras || []).forEach(x => bg.appendChild(x));
  });
  wrap.appendChild(bg);

  // Drag the whole table (pointer position is converted to canvas coordinates)
  bg.addEventListener('pointerdown', e => {
    if (e.target !== bg || e.button !== 0) return;
    e.stopPropagation();
    const mainEl = document.getElementById('assignMain');
    const r0 = mainEl.getBoundingClientRect();
    const offX = e.clientX - r0.left + mainEl.scrollLeft - item.x;
    const offY = e.clientY - r0.top + mainEl.scrollTop - item.y;
    function onMove(mv) {
      const r = mainEl.getBoundingClientRect();
      item.x = Math.max(0, mv.clientX - r.left + mainEl.scrollLeft - offX);
      item.y = Math.max(0, mv.clientY - r.top + mainEl.scrollTop - offY);
      wrap.style.left = item.x + 'px';
      wrap.style.top = item.y + 'px';
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      markDirty();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

  return wrap;
}

export function makeAssignChip(seatId, x, y, relative) {
  const studentId = state.assignments[seatId];
  const student = studentId ? state.students.find(s => s.id === studentId) : null;
  const chipColor = student ? groupColor(student) : null;

  const chip = document.createElement('div');
  const pinned = !!student && (state.pins || []).includes(student.id);
  chip.className = 'seat-chip ' + (student ? 'grouped' : 'empty') + (student && store.selectedSeatId === seatId ? ' selected-seat' : '') + (pinned ? ' pinned' : '');
  chip._extras = [];
  // Keyboard: Tab to a seat, Enter/Space = tap
  chip.tabIndex = 0;
  chip.setAttribute('role', 'button');

  // One single cssText assignment (position + group colour together)
  let css = `position:absolute;left:${x}px;top:${y}px;`;
  if (chipColor) {
    const light = isLightColor(chipColor);
    css += `background:${chipColor}${light ? '66' : '33'};border-color:${chipColor};color:${light ? 'var(--text)' : chipColor};`;
  }
  chip.style.cssText = css;
  chip.dataset.seatId = seatId;

  if (student) {
    chip.title = student.name + (pinned ? ' (pinned)' : '') + ' — tap to select, drag to move';
    chip.setAttribute('aria-label', student.name + (pinned ? ', pinned' : '') + (store.selectedSeatId === seatId ? ', selected' : ''));
    chip.innerHTML = `<span style="display:flex;flex-direction:column;align-items:center;line-height:1.2;gap:1px;"><span style="font-size:0.72rem;font-weight:800;letter-spacing:0.01em;">${esc(initials(student.name))}</span><span style="font-size:0.58rem;font-weight:500;opacity:0.9;max-width:46px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(student.name.split(' ')[0])}</span></span>`;

    // Tap = select (tap again = deselect). Drag = move/swap, or drag to Unplaced to unseat.
    chip.addEventListener('pointerdown', e => pointerDrag(e, {
      label: student.name,
      sourceEl: chip,
      sourceClass: 'drag-source',
      highlightClass: 'drop-target',
      findTarget: el => el.closest('.seat-chip') || el.closest('.unplaced-wrap'),
      onDrop: t => t.classList.contains('seat-chip') ? placeStudent(student.id, t.dataset.seatId) : unseatStudent(seatId),
      onTap: tap,
    }));
    function tap() {
      if (store.selectedSeatId === seatId) { store.selectedSeatId = null; }
      else if (store.selectedStudentId) { placeStudent(store.selectedStudentId, seatId); return; }
      else { store.selectedSeatId = seatId; store.selectedStudentId = null; }
      renderAssignPanel();
      if (store.selectedSeatId) focusSeat(seatId);
    }
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });

    // Pinned students keep their seat when auto-assigning
    if (pinned) {
      const pin = document.createElement('div');
      pin.className = 'seat-pin-badge';
      pin.textContent = '📌';
      pin.style.left = (x - 6) + 'px';
      pin.style.top = (y - 8) + 'px';
      chip._extras.push(pin);
    }

    // Selected → a real ✕ button takes the student out of the seat
    // (it sits beside the chip because the chip clips its contents)
    if (store.selectedSeatId === seatId) {
      const b = document.createElement('button');
      b.className = 'seat-unseat-btn';
      b.textContent = '✕';
      b.title = 'Take ' + student.name + ' out of this seat';
      b.style.left = (x + SEAT_SIZE - 14) + 'px';
      b.style.top = (y - 8) + 'px';
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('click', e => { e.stopPropagation(); unseatStudent(seatId); });
      chip._extras.push(b);

      const p = document.createElement('button');
      p.className = 'seat-pin-btn' + (pinned ? ' on' : '');
      p.textContent = pinned ? 'Unpin' : '📌 Pin';
      p.title = pinned ? 'Let auto-assign move ' + student.name : 'Keep ' + student.name + ' in this seat when auto-assigning';
      p.style.left = (x + SEAT_SIZE / 2) + 'px';
      p.style.top = (y + SEAT_SIZE + 4) + 'px';
      p.addEventListener('pointerdown', e => e.stopPropagation());
      p.addEventListener('click', e => { e.stopPropagation(); togglePin(student.id); });
      chip._extras.push(p);
    }

  } else {
    chip.title = 'Empty seat — tap a student first, then tap here (or drag a student here)';
    chip.setAttribute('aria-label', 'Empty seat');
    chip.textContent = '+';
    const placeHere = () => {
      const moving = store.selectedStudentId || (store.selectedSeatId && state.assignments[store.selectedSeatId]);
      if (moving) placeStudent(moving, seatId);
    };
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); placeHere(); } });
    chip.addEventListener('click', e => {
      e.stopPropagation();
      const moving = store.selectedStudentId || (store.selectedSeatId && state.assignments[store.selectedSeatId]);
      if (moving) placeStudent(moving, seatId);
    });
  }

  return chip;
}

export function renderUnplaced() {
  const el = document.getElementById('unplacedChips');
  const seatedIds = new Set(Object.values(state.assignments));
  const unplaced = state.students.filter(s => !seatedIds.has(s.id));
  if (store.selectedStudentId && !unplaced.some(s => s.id === store.selectedStudentId)) store.selectedStudentId = null;
  el.innerHTML = '';
  if (!unplaced.length) {
    el.innerHTML = '<p style="font-size:0.75rem;color:var(--text3);">All students placed! 🎉</p>';
    return;
  }
  unplaced.forEach(s => {
    const pill = document.createElement('div');
    pill.className = 'chip-pill' + (store.selectedStudentId === s.id ? ' selected-pill' : '');
    pill.style.borderLeft = `3px solid ${groupColor(s)}`;
    pill.dataset.id = s.id;
    pill.title = 'Tap, then tap a seat — or drag onto a seat';
    pill.textContent = s.name;
    pill.addEventListener('pointerdown', e => pointerDrag(e, {
      label: s.name,
      sourceEl: pill,
      sourceClass: 'drag-source',
      highlightClass: 'drop-target',
      findTarget: el2 => el2.closest('.seat-chip'),
      onDrop: t => placeStudent(s.id, t.dataset.seatId),
      onTap: () => {
        store.selectedStudentId = store.selectedStudentId === s.id ? null : s.id;
        store.selectedSeatId = null;
        renderAssignPanel();
      },
    }));
    el.appendChild(pill);
  });
}

export function updateAssignStats() {
  const seats = getAllSeats();
  const seated = Object.keys(state.assignments).length;
  document.getElementById('assignSeated').textContent = seated;
  document.getElementById('assignTotal').textContent = state.students.length;
  document.getElementById('assignEmpty').textContent = Math.max(0, seats.length - seated);
}

// Keep keyboard focus on a seat after the panel re-renders
export function focusSeat(seatId) {
  const el = document.querySelector(`#assignCanvas .seat-chip[data-seat-id="${CSS.escape(seatId)}"]`);
  if (el) el.focus({ preventScroll: true });
}
