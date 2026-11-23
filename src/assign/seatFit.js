// ═══════════════════════════════════════════════
//  SAFE SEATS — while a student is picked up (dragged, or tapped and waiting for a seat),
//  every other seat shows whether putting them there keeps the rules:
//    green  = every rule still holds          (seat-fit-ok)
//    amber  = only a tag's usual spot is missed (seat-fit-meh)
//    red    = breaks a seating rule           (seat-fit-bad)
//  An occupied seat means a swap, so the other student's rules count too.
//  The drag label says why a red or amber seat is a problem.
// ═══════════════════════════════════════════════
import { state } from '../core/state.js';
import { evaluateRules, getResolvedRules, violationMessage } from './rulesEngine.js';
import { getAllSeats } from './seats.js';

const CLASSES = ['seat-fit-ok', 'seat-fit-meh', 'seat-fit-bad'];
let reasons = new Map();

// How each seat would work for `studentId`: Map seatId → { level, why }
export function seatFit(studentId) {
  const seats = getAllSeats();
  const rules = getResolvedRules();
  const out = new Map();
  if (!studentId) return out;
  const from = Object.keys(state.assignments).find(k => state.assignments[k] === studentId) || null;
  seats.forEach(s => {
    if (s.seatId === from) return;
    const sim = { ...state.assignments };
    const other = sim[s.seatId] || null;
    if (from) delete sim[from];
    if (other && from) sim[from] = other;     // a swap
    sim[s.seatId] = studentId;
    const mine = evaluateRules(sim, seats, rules).filter(v => v.ids.includes(studentId) || (other && from && v.ids.includes(other)));
    const hard = mine.filter(v => !v.soft);
    const level = hard.length ? 'bad' : mine.length ? 'meh' : 'ok';
    out.set(s.seatId, { level, why: (hard[0] || mine[0]) ? violationMessage(hard[0] || mine[0]).replace(/^\S+ (Rule: )?/, '') : '' });
  });
  return out;
}

// Colour the seats in the Assign tab
export function showSeatFit(studentId) {
  clearSeatFit();
  if (!studentId || !getResolvedRules().length) return;   // no rules: every seat is fine, no need for colour
  reasons = seatFit(studentId);
  document.querySelectorAll('#assignCanvas .seat-chip').forEach(chip => {
    const f = reasons.get(chip.dataset.seatId);
    if (f) chip.classList.add('seat-fit-' + f.level);
  });
  document.getElementById('assignCanvas')?.classList.add('showing-fit');
}
export function clearSeatFit() {
  reasons = new Map();
  document.querySelectorAll('#assignCanvas .seat-chip').forEach(c => c.classList.remove(...CLASSES));
  document.getElementById('assignCanvas')?.classList.remove('showing-fit');
}
// Why a seat is amber or red (for the drag label)
export function fitNote(seatId) {
  const f = reasons.get(seatId);
  if (!f || f.level === 'ok') return f ? '✓ keeps every rule' : '';
  return (f.level === 'bad' ? '✕ ' : '• ') + f.why;
}
