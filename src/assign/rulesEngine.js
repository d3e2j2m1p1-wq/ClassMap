import { SEAT_SIZE } from './panel.js';
import { getAllSeats } from './seats.js';
import { esc, state } from '../core/state.js';
import { hasTag } from '../landing/tags.js';

// ── Rule engine (shared by drag/drop warnings and auto-assign) ──
export function resolveStudentId(nameOrId) {
  if (!nameOrId) return null;
  const byId = state.students.find(s => s.id === nameOrId);
  if (byId) return byId.id;
  const q = String(nameOrId).trim().toLowerCase();
  const byName = state.students.find(s => s.name.trim().toLowerCase() === q);
  return byName ? byName.id : null;
}

export function getResolvedRules() {
  const all = [...state.hardRules, ...state.tempRules];
  const tagged = tag => state.students.filter(s => hasTag(s, tag)).map(s => s.id);
  const tagRules = all.filter(r => r.type === 'spread' || r.type === 'helper').map(r => ({
    type: r.type, tag: r.tag, helperTag: r.helperTag,
    ids: tagged(r.tag),
    helpers: r.type === 'helper' ? tagged(r.helperTag) : [],
  })).filter(r => r.ids.length);
  const studentRules = all.filter(r => r.type !== 'spread' && r.type !== 'helper')
    .map(r => ({
      type: r.type,
      a: resolveStudentId(r.studentA || r.studA),
      b: resolveStudentId(r.studentB || r.studB),
    }))
    .filter(r => r.a && (r.type === 'front' || r.type === 'back' || r.b));
  return [...studentRules, ...tagRules];
}

// One wording for a rule everywhere (rules lists, print): { label, text }
export function ruleSummary(r) {
  const a = r.studentA || '', b = r.studentB || '';
  switch (r.type) {
    case 'separate': return { label: 'Separate', text: `${a} + ${b}` };
    case 'near':     return { label: 'Keep near', text: `${a} + ${b}` };
    case 'partners': return { label: 'Same group', text: `${a} + ${b}` };
    case 'front':    return { label: 'Front row', text: a };
    case 'back':     return { label: 'Back row', text: a };
    case 'spread':   return { label: 'Spread out', text: `Everyone tagged “${r.tag}” in different groups` };
    case 'helper':   return { label: 'Helper', text: `Each “${r.tag}” student sits with a “${r.helperTag}” student` };
    default:         return { label: r.type, text: a };
  }
}

// Same table, or desks close enough to touch / sit diagonal
export function seatsAreNeighbors(a, b) {
  if (!a || !b || a.seatId === b.seatId) return false;
  if (a.tableId && a.tableId === b.tableId) return true;
  return Math.hypot(a.x - b.x, a.y - b.y) < 100;
}
// Same group at a table; seats on their own (single desks, solo seats) count when side by side
export function seatsArePartners(a, b) {
  if (!a || !b || a.seatId === b.seatId) return false;
  if (a.podKey && a.podKey === b.podKey) return true;
  if (a.podKey || b.podKey) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) < 100;
}
export function seatsAreNear(a, b) {
  if (!a || !b || a.seatId === b.seatId) return false;
  if (a.tableId && a.tableId === b.tableId) return true;
  return Math.hypot(a.x - b.x, a.y - b.y) < 170;
}

// Where is the front of the room?
// With a board on the layout, a seat's depth is its straight-out distance from the board
// (so the board can be on any wall, at any angle). Without a board, the top of the screen is the front.
//   raw[seatId]   = distance from the front in px      lat[seatId] = side-to-side position
//   depth[seatId] = 0 (front row) … 1 (back row)        range       = raw max − min
export const BOARD_W = 148, BOARD_H = 28;   // size of the board item on the canvas
export let _frontCache = { seats: null, info: null };
export function frontInfo(seats) {
  if (_frontCache.seats === seats) return _frontCache.info;
  const boards = state.layoutItems.filter(i => i.type === 'board');
  const raw = {}, lat = {};
  seats.forEach(s => {
    const px = s.x + SEAT_SIZE / 2, py = s.y + SEAT_SIZE / 2;
    if (!boards.length) { raw[s.seatId] = py; lat[s.seatId] = px; return; }
    let best = null;
    boards.forEach(b => {
      const th = (b.rotation || 0) * Math.PI / 180;
      const dx = px - (b.x + BOARD_W / 2), dy = py - (b.y + BOARD_H / 2);
      const along = dx * Math.cos(th) + dy * Math.sin(th);
      const away = Math.abs(-dx * Math.sin(th) + dy * Math.cos(th));
      if (!best || away < best.away) best = { away, along };
    });
    raw[s.seatId] = best.away;
    lat[s.seatId] = best.along;
  });
  const vals = Object.values(raw);
  const min = vals.length ? Math.min(...vals) : 0;
  const range = vals.length ? Math.max(...vals) - min : 0;
  const depth = {};
  Object.keys(raw).forEach(k => { depth[k] = range > 0 ? (raw[k] - min) / range : 0; });
  const info = { raw, lat, depth, range };
  _frontCache = { seats, info };
  return info;
}

// Returns [{ type, ids:[...] }] for every rule that is currently broken
export function evaluateRules(assign, seats, rules) {
  if (!seats.length) return [];
  const seatById = {};
  seats.forEach(s => { seatById[s.seatId] = s; });
  const seatOf = {};
  Object.keys(assign).forEach(k => { if (seatById[k]) seatOf[assign[k]] = seatById[k]; });
  const fi = frontInfo(seats);

  const out = [];
  rules.forEach(r => {
    if (r.type === 'spread') {
      const seated = r.ids.filter(id => seatOf[id]);
      for (let i = 0; i < seated.length; i++)
        for (let j = i + 1; j < seated.length; j++)
          if (seatsArePartners(seatOf[seated[i]], seatOf[seated[j]])) out.push({ type: 'spread', ids: [seated[i], seated[j]], tag: r.tag });
      return;
    }
    if (r.type === 'helper') {
      r.ids.forEach(id => {
        const s = seatOf[id];
        if (!s) return;
        if (!r.helpers.some(h => h !== id && seatOf[h] && seatsArePartners(s, seatOf[h])))
          out.push({ type: 'helper', ids: [id], tag: r.tag, helperTag: r.helperTag });
      });
      return;
    }
    const sa = seatOf[r.a];
    if (!sa) return;
    if (r.type === 'separate') {
      const sb = seatOf[r.b];
      if (sb && seatsAreNeighbors(sa, sb)) out.push({ type: 'separate', ids: [r.a, r.b] });
    } else if (r.type === 'near') {
      const sb = seatOf[r.b];
      if (sb && !seatsAreNear(sa, sb)) out.push({ type: 'near', ids: [r.a, r.b] });
    } else if (r.type === 'partners') {
      const sb = seatOf[r.b];
      if (sb && !seatsArePartners(sa, sb)) out.push({ type: 'partners', ids: [r.a, r.b] });
    } else if (r.type === 'front') {
      if (fi.range > 1 && fi.depth[sa.seatId] > 0.35) out.push({ type: 'front', ids: [r.a] });
    } else if (r.type === 'back') {
      if (fi.range > 1 && fi.depth[sa.seatId] < 0.65) out.push({ type: 'back', ids: [r.a] });
    }
  });
  return out;
}

export function violationMessage(v) {
  const first = id => {
    const st = state.students.find(s => s.id === id);
    return st ? st.name.split(' ')[0] : '?';
  };
  if (v.type === 'separate') return `⚠️ Rule: ${first(v.ids[0])} & ${first(v.ids[1])} should be separated`;
  if (v.type === 'near')     return `💡 Rule: ${first(v.ids[0])} & ${first(v.ids[1])} should be near each other`;
  if (v.type === 'partners') return `💡 Rule: ${first(v.ids[0])} & ${first(v.ids[1])} should be in the same group`;
  if (v.type === 'front')    return `⚠️ Rule: ${first(v.ids[0])} should sit in the front row`;
  if (v.type === 'spread')   return `💡 Rule: ${first(v.ids[0])} & ${first(v.ids[1])} are both “${v.tag}” — spread them out`;
  if (v.type === 'helper')   return `💡 Rule: ${first(v.ids[0])} (“${v.tag}”) needs a “${v.helperTag}” in their group`;
  return `⚠️ Rule: ${first(v.ids[0])} should sit in the back row`;
}

// Warnings for a student placed in targetSeatId (used after drag/drop)
export function checkRuleViolations(studentId, targetSeatId) {
  const seats = getAllSeats();
  const temp = { ...state.assignments };
  Object.keys(temp).forEach(k => { if (temp[k] === studentId) delete temp[k]; });
  temp[targetSeatId] = studentId;
  const msgs = evaluateRules(temp, seats, getResolvedRules())
    .filter(v => v.ids.includes(studentId))
    .map(violationMessage);
  return [...new Set(msgs)];
}

export function showViolationBanner(msgs) {
  if (msgs.length === 0) return;
  document.getElementById('violationBannerText').innerHTML = msgs.map(m => `<div>${esc(m)}</div>`).join('');
  document.getElementById('violationBanner').classList.add('show');
}

export function closeViolationBanner() {
  document.getElementById('violationBanner').classList.remove('show');
}

export function showViolationToast(msgs) {
  showViolationBanner(msgs);
}
