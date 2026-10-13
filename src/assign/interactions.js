import { store } from '../core/store.js';
import { renderAssignPanel } from './panel.js';
import { checkRuleViolations, showViolationBanner } from './rulesEngine.js';
import { state } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { renderRoster } from '../editor/roster.js';
import { editorOpen, markDirty } from '../storage/autosave.js';

// ── One drag helper for mouse, pen and touch ──
// HTML drag-and-drop doesn't work on iPads/phones, so everything is built on pointer events.
// A press that barely moves counts as a tap.
//   o = { label, sourceEl, sourceClass, highlightClass, findTarget(el) → target|null,
//         onDrop(target), onTap() }
export function pointerDrag(e, o) {
  if (e.button !== 0) return;
  e.stopPropagation();
  if (e.pointerType === 'mouse') e.preventDefault();   // no text selection while dragging
  const sx = e.clientX, sy = e.clientY;
  let ghost = null, hot = null;
  const targetAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? o.findTarget(el) : null;
  };
  const light = t => {
    if (t === hot) return;
    if (hot) hot.classList.remove(o.highlightClass);
    if (t) t.classList.add(o.highlightClass);
    hot = t;
  };
  const onMove = mv => {
    if (!ghost) {
      if (Math.hypot(mv.clientX - sx, mv.clientY - sy) < 6) return;
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = o.label || '';
      document.body.appendChild(ghost);
      if (o.sourceClass) o.sourceEl.classList.add(o.sourceClass);
    }
    ghost.style.left = mv.clientX + 'px';
    ghost.style.top = mv.clientY + 'px';
    light(targetAt(mv.clientX, mv.clientY));
  };
  const end = (up, cancelled) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    light(null);
    const dragged = !!ghost;
    if (ghost) { ghost.remove(); if (o.sourceClass) o.sourceEl.classList.remove(o.sourceClass); }
    if (cancelled) return;
    const t = dragged ? targetAt(up.clientX, up.clientY) : null;
    // Run after the browser's own click event, so re-rendering can't swallow or misdirect it
    setTimeout(() => {
      if (!dragged) { if (o.onTap) o.onTap(); }
      else if (t && t !== o.sourceEl) o.onDrop(t);
    }, 0);
  };
  const onUp = up => end(up, false);
  const onCancel = () => end(null, true);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

// Put a student in a seat. Coming from another seat → the two swap.
// Coming from Unplaced onto someone → that person goes back to Unplaced.
export function placeStudent(studentId, seatId) {
  if (!studentId || !seatId) return;
  const fromSeat = Object.keys(state.assignments).find(k => state.assignments[k] === studentId) || null;
  store.selectedSeatId = null;
  store.selectedStudentId = null;
  if (fromSeat === seatId) { renderAssignPanel(); return; }
  const occupant = state.assignments[seatId] || null;
  if (fromSeat) {
    if (occupant) state.assignments[fromSeat] = occupant;
    else delete state.assignments[fromSeat];
  }
  state.assignments[seatId] = studentId;
  markDirty();
  renderAssignPanel();
  renderRoster();

  // Rule check for everyone who moved
  let msgs = checkRuleViolations(studentId, seatId);
  if (occupant && fromSeat) msgs = msgs.concat(checkRuleViolations(occupant, fromSeat));
  msgs = [...new Set(msgs)];
  if (msgs.length) showViolationBanner(msgs);
  if (occupant && !fromSeat) {
    const o = state.students.find(s => s.id === occupant);
    if (o) showToast(o.name + ' moved to Unplaced');
  }
}

export function unseatStudent(seatId) {
  if (state.assignments[seatId]) state.pins = (state.pins || []).filter(id => id !== state.assignments[seatId]);
  store.selectedSeatId = null;
  store.selectedStudentId = null;
  if (state.assignments[seatId]) {
    delete state.assignments[seatId];
    markDirty();
    renderRoster();
  }
  renderAssignPanel();
}

export function clearAssignSelection() {
  if (!store.selectedSeatId && !store.selectedStudentId) return;
  store.selectedSeatId = null;
  store.selectedStudentId = null;
  renderAssignPanel();
}

export function initAssignInteractions() {
  // Tap empty canvas → deselect
  document.getElementById('assignMain').addEventListener('click', e => {
    if (e.target.closest('.seat-chip, .seat-unseat-btn, .seat-pin-btn, .assign-table-wrap')) return;
    clearAssignSelection();
  });
  // Tap the Unplaced area while a seated student is selected → unseat them
  const tray = document.getElementById('unplacedChips').closest('.unplaced-wrap');
  if (tray) tray.addEventListener('click', e => {
    if (e.target.closest('.chip-pill')) return;
    if (store.selectedSeatId && state.assignments[store.selectedSeatId]) unseatStudent(store.selectedSeatId);
  });
  // Esc = deselect · Delete/Backspace = unseat the selected student
  document.addEventListener('keydown', e => {
    if (!editorOpen() || !document.getElementById('panel-assign').classList.contains('active')) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') clearAssignSelection();
    else if ((e.key === 'p' || e.key === 'P') && store.selectedSeatId && state.assignments[store.selectedSeatId]) {
      togglePin(state.assignments[store.selectedSeatId]);
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedSeatId && state.assignments[store.selectedSeatId]) {
      e.preventDefault();
      unseatStudent(store.selectedSeatId);
    }
  });
}

// Pin / unpin: a pinned student keeps their seat when auto-assigning
export function togglePin(studentId) {
  const pins = new Set(state.pins || []);
  const st = state.students.find(s => s.id === studentId);
  if (pins.has(studentId)) { pins.delete(studentId); showToast((st ? st.name : 'Student') + ' unpinned'); }
  else { pins.add(studentId); showToast('📌 ' + (st ? st.name : 'Student') + ' stays here when you auto-assign'); }
  state.pins = [...pins];
  markDirty();
  renderAssignPanel();
}
