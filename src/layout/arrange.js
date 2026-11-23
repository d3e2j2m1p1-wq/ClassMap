// ═══════════════════════════════════════════════
//  ARRANGE FOR ME
//  Fits a seating style (rows, pairs, groups of 4 / 6) into this room: facing the board, clear of
//  doors, the teacher's desk and "no seats" areas, with 3-ft walkways to every table.
//  It tries a few hundred spacings for each style, scores each on
//    enough seats · every table reachable from the door · every seat sees the board · closeness
//  and then — the part no template can do — seats the class in the best ones to see which rooms
//  let this class's rules work (keep-apart, groups, tag spots). The teacher picks from previews.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc, state, uid } from '../core/state.js';
import { plural, undoToast } from '../core/ui.js';
import { markDirty } from '../storage/autosave.js';
import { undo } from '../editor/undo.js';
import { defaultSeatPositions, renderLayoutCanvas } from './canvas.js';
import { tableBBox } from './tables.js';
import { addWalls } from './templates.js';
import { roomPoints } from './roomShape.js';
import { getAllSeats } from '../assign/seats.js';
import { planSeating } from '../assign/autoAssign.js';
import { getResolvedRules } from '../assign/rulesEngine.js';
import {
  AISLE_FT, SEAT_PX, VIEW, aabb, boardInfo, boxOf, corners, doorZones, insideBounds, isFurniture, makeBox, pxPerFt,
  reachability, roomBounds, seatCount, sightlines,
} from './roomModel.js';

export const STYLES = [
  // gaps in feet between pieces of furniture: along the board (U) and away from it (V)
  { id: 'rows',  label: 'Rows',        per: 1, gapsU: [0.5, 1, 1.5, 2, 3], gapsV: [3, 3.5, 4, 4.5], aisles: [0, 1], turns: [0] },
  { id: 'pairs', label: 'Pairs',       per: 2, gapsU: [3, 3.5, 4, 5],      gapsV: [3, 3.5, 4, 5],   aisles: [0],    turns: [0] },
  { id: 'pods4', label: 'Groups of 4', per: 4, gapsU: [3, 3.5, 4, 5],      gapsV: [3, 3.5, 4, 5],   aisles: [0],    turns: [0] },
  { id: 'pods6', label: 'Groups of 6', per: 6, gapsU: [3, 3.5, 4, 5],      gapsV: [3, 3.5, 4, 5],   aisles: [0],    turns: [0, 1] },
];

// ── Room frame: u runs along the board's wall, v goes from the board into the room ──
function frameOf(bounds, board) {
  let dir = 'down';
  if (board) {
    const { nx, ny } = board;
    dir = Math.abs(ny) >= Math.abs(nx) ? (ny > 0 ? 'down' : 'up') : (nx > 0 ? 'right' : 'left');
  }
  const { x, y, w, h } = bounds;
  const F = {
    down:  { U: w, V: h, rot: 0,   toC: (u, v) => [x + u, y + v],         toF: (X, Y) => [X - x, Y - y] },
    up:    { U: w, V: h, rot: 180, toC: (u, v) => [x + w - u, y + h - v], toF: (X, Y) => [x + w - X, y + h - Y] },
    right: { U: h, V: w, rot: 90,  toC: (u, v) => [x + v, y + h - u],     toF: (X, Y) => [y + h - Y, X - x] },
    left:  { U: h, V: w, rot: 270, toC: (u, v) => [x + w - v, y + u],     toF: (X, Y) => [Y - y, x + w - X] },
  }[dir];
  return { dir, ...F };
}
// A canvas box → its outline in the frame (axis-aligned rectangle)
function frameRect(frame, box, grow = 0) {
  const pts = corners({ ...box, w: box.w + 2 * grow, h: box.h + 2 * grow }).map(([X, Y]) => frame.toF(X, Y));
  const us = pts.map(p => p[0]), vs = pts.map(p => p[1]);
  return { u0: Math.min(...us), v0: Math.min(...vs), u1: Math.max(...us), v1: Math.max(...vs) };
}
const hit = (a, b) => a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;

// What a piece of furniture of this style looks like (unrotated) and its size in the frame
function unitOf(style) {
  if (style.per === 1) return { w: SEAT_PX, h: SEAT_PX, make: (x, y, rot) => ({ type: 'seat', x, y, rotation: rot }) };
  const seatPositions = defaultSeatPositions(style.per);
  const { w, h } = tableBBox({ seatPositions });
  return { w, h, make: (x, y, rot) => ({ type: 'table', x, y, rotation: rot, seatPositions: seatPositions.map(p => ({ ...p })), groups: 1, groupShift: 0 }) };
}

// ── Every candidate room for one style ──
function candidates(style, ctx) {
  const { frame, ppf, blocked, need, front, inset, fixtures } = ctx;
  const unit = unitOf(style);
  const units = Math.ceil(need / style.per);
  const out = [];
  for (const turn of style.turns) for (const gU of style.gapsU) for (const gV of style.gapsV) for (const aisle of style.aisles) {
    // in the frame the unit is fw along u and fh along v; "turn" stands it end-on to the board
    const fw = turn ? unit.h : unit.w, fh = turn ? unit.w : unit.h;
    const rot = (frame.rot + (turn ? 90 : 0)) % 360;
    const gapU = gU * ppf, gapV = gV * ppf, aisleW = aisle ? AISLE_FT * ppf : 0;
    const width = frame.U - 2 * inset;
    let maxCols = Math.floor((width + gapU) / (fw + gapU));
    if (aisle) maxCols = Math.floor((width - aisleW + gapU) / (fw + gapU));
    // also try narrower rooms (fewer columns, more rows): better views from the sides
    for (const less of [0, 1, 2]) for (const extraFront of [0, 2]) {
    const cols = maxCols - less;
    if (cols < 1 || (less && cols < 2)) continue;
    const front0 = front + extraFront * ppf;
    const used = cols * fw + (cols - 1) * gapU + (aisle && cols > 1 ? aisleW : 0);
    for (const shift of [0.5, 0.25, 0.75]) {
      const u0 = inset + (width - used) * shift;
      const mid = Math.floor(cols / 2);
      const uAt = c => u0 + c * (fw + gapU) + (aisle && c >= mid && cols > 1 ? aisleW : 0);
      const slots = [];
      for (let r = 0; ; r++) {
        const v = front0 + r * (fh + gapV);
        if (v + fh > frame.V - inset) break;
        for (let c = 0; c < cols; c++) {
          const rect = { u0: uAt(c), v0: v, u1: uAt(c) + fw, v1: v + fh };
          if (blocked.some(b => hit(rect, b))) continue;
          if (ctx.bounds.poly) {   // shaped room: the table must be inside the outline
            const [cx, cy] = frame.toC((rect.u0 + rect.u1) / 2, (rect.v0 + rect.v1) / 2);
            if (!insideBounds(makeBox(cx, cy, unit.w, unit.h, rot * Math.PI / 180), ctx.bounds, inset)) continue;
          }
          slots.push({ ...rect, r, c });
        }
      }
      // front rows first, from the middle out
      const centre = frame.U / 2;
      slots.sort((a, b) => (a.r - b.r) || (Math.abs((a.u0 + a.u1) / 2 - centre) - Math.abs((b.u0 + b.u1) / 2 - centre)));
      const take = slots.slice(0, units).sort((a, b) => (a.r - b.r) || (a.u0 - b.u0));
      const furniture = take.map(s => {
        const [cx, cy] = frame.toC((s.u0 + s.u1) / 2, (s.v0 + s.v1) / 2);
        return unit.make(cx - unit.w / 2, cy - unit.h / 2, rot);
      });
      const key = take.map(s => `${Math.round(s.u0)},${Math.round(s.v0)}`).join('|');
      out.push({ style, params: { gU, gV, aisle, shift, turn, cols, extraFront }, key, furniture, items: [...fixtures, ...furniture.map((f, i) => ({ ...f, id: 'ar' + i }))], short: Math.max(0, units - take.length) });
    }
    }
  }
  // drop duplicates (different spacings can give the same room)
  const seen = new Set();
  return out.filter(c => !seen.has(c.key) && seen.add(c.key));
}

// ── How good is a room? (lower is better) ──
function scoreRoom(c, ctx) {
  const items = c.items;
  const seats = seatCount(items);
  const reach = reachability(items, ctx.bounds);
  const views = sightlines(items, ctx.bounds) || [];
  const viewProblems = views.filter(v => v.problem).length;
  const dists = views.map(v => v.dist);
  const mean = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
  const farthest = dists.length ? Math.max(...dists) : 0;
  const short = Math.max(0, ctx.need - seats);
  c.stats = { seats, unreachable: reach.unreachable.filter(isFurniture).length, blockedDoors: reach.blockedDoors.length, viewProblems, mean, farthest, short };
  c.score = short * 1000 + c.stats.unreachable * 220 + c.stats.blockedDoors * 600 + viewProblems * 14 + mean * 2 + farthest + (seats - ctx.need) * 1.5;
  return c;
}

// Seat the class in a candidate room (without drawing anything) to see how its rules work there
function rulesCheck(c) {
  const saved = { items: state.layoutItems, assignments: state.assignments };
  try {
    state.layoutItems = c.items;
    state.assignments = {};
    const plan = planSeating({ restarts: 3 });
    c.rules = { left: plan.best.left, soft: plan.best.soft };
    c.score += plan.best.left * 400 + plan.best.soft * 4;
  } catch { c.rules = null; }
  finally { state.layoutItems = saved.items; state.assignments = saved.assignments; }
}

// ── The search ──
export function arrangeOptions(items = state.layoutItems, students = state.students.length || 24) {
  const bounds = roomBounds(items);
  const ppf = pxPerFt(items);
  const board = boardInfo(items, bounds);
  const frame = frameOf(bounds, board);
  const fixtures = items.filter(i => !isFurniture(i));
  // where furniture can't go: around the teacher's desk (a walkway), "no seats" areas, door swings + the way in
  const aisle = AISLE_FT * ppf;
  const blocked = [];
  fixtures.forEach(f => {
    if (f.type === 'teacher') blocked.push(frameRect(frame, boxOf(f), aisle * 0.8));
    else if (f.type === 'zone') blocked.push(frameRect(frame, boxOf(f), ppf * 0.5));
  });
  doorZones(items, bounds).forEach(d => {
    blocked.push(frameRect(frame, d.zone, ppf * 0.5));
    const reach = Math.max(d.box.w, aisle * 1.5);
    blocked.push(frameRect(frame, makeBox(d.box.cx + d.nx * (d.box.h / 2 + reach / 2), d.box.cy + d.ny * (d.box.h / 2 + reach / 2), Math.max(d.box.w, aisle) + aisle * 0.5, reach, d.box.a)));
  });
  // seats start this far from the board (or the front wall)
  const boardV = board ? frameRect(frame, board.box).v1 : 0;
  const front = Math.max(boardV, 0) + VIEW.closeFt * ppf;
  const need = Math.max(1, students);
  const ctx = { frame, ppf, blocked, need, front, inset: ppf * 0.5, fixtures, bounds };
  const byStyle = {};
  STYLES.forEach(st => {
    byStyle[st.id] = candidates(st, ctx).map(c => scoreRoom(c, ctx)).sort((a, b) => a.score - b.score);
  });
  // Show variety: rooms that differ only by being shifted left/right count as one
  const look = c => `${c.style.id}|${c.params.gU}|${c.params.gV}|${c.params.aisle}|${c.params.turn}|${c.params.cols}`;
  STYLES.forEach(st => {
    const seen = new Set();
    byStyle[st.id] = byStyle[st.id].filter(c => !seen.has(look(c)) && seen.add(look(c)));
  });
  // the best few of each style get the class seated in them
  const hasRules = state.students.length && getResolvedRules().length > 0;
  if (hasRules) STYLES.forEach(st => byStyle[st.id].filter(c => !c.stats.short).slice(0, 3).forEach(rulesCheck));
  STYLES.forEach(st => byStyle[st.id].sort((a, b) => a.score - b.score));
  // "Best for this class": the best of each style that fits; then runners-up if fewer than 3 styles fit
  const fits = st => byStyle[st.id].filter(c => !c.stats.short);
  let best = STYLES.map(st => fits(st)[0]).filter(Boolean).sort((a, b) => a.score - b.score);
  if (best.length < 3) best = [...best, ...STYLES.flatMap(st => fits(st).slice(1, 3))].sort((a, b) => a.score - b.score).slice(0, 3);
  return { byStyle, best, need, ppf, bounds, hasRules, rulesCount: hasRules ? getResolvedRules().length : 0 };
}

// ── Apply a candidate ──
function useRoom(c) {
  const hadNames = state.layoutItems.some(i => i.type === 'table' && i.label);
  const furniture = c.furniture.map(f => ({ ...f, id: uid() }));
  if (hadNames) furniture.filter(f => f.type === 'table').forEach((t, i) => { t.label = 'Table ' + (i + 1); });
  state.layoutItems = [...state.layoutItems.filter(i => !isFurniture(i)), ...furniture];
  state.assignments = {};
  store.selectedIds = new Set();
  renderLayoutCanvas();
  markDirty();
  undoToast(`Room arranged: ${c.style.label} · ${plural(c.stats.seats, 'seat')} — seat the class in Assign`, () => undo());
}

// ── Dialog ──
let lastResult = null;
export function openArrange() {
  closeArrange();
  const wrap = document.createElement('div');
  wrap.className = 'ar-backdrop';
  wrap.id = 'arrangeDialog';
  wrap.innerHTML = `<div class="ar-dialog" role="dialog" aria-modal="true" aria-labelledby="arTitle">
    <div class="ar-head">
      <div><h2 id="arTitle">Arrange for me</h2>
      <p>Fits ${plural(state.students.length || 24, 'student')} around the board, doors, desk and “no seats” areas — every table reachable with ${AISLE_FT}-ft walkways.</p></div>
      <button class="ar-x" aria-label="Close">✕</button>
    </div>
    <div class="ar-body"><div class="ar-wait">Trying layouts…</div></div>
    <div class="ar-foot">Keeps your walls, board, desk, doors, windows and “no seats” areas. Replaces tables and desks, so nobody stays seated. You can Undo.</div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('.ar-x').onclick = closeArrange;
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) closeArrange(); });
  document.addEventListener('keydown', arrangeKeys, true);

  if (!state.layoutItems.some(i => i.type === 'room')) {
    wrap.querySelector('.ar-body').innerHTML = `<div class="ar-empty">
      <p><b>Add the room's walls first</b> so ClassMap knows how much space there is. Then drag the corners to match your room.</p>
      <button class="rc-btn primary" id="arWalls">Add walls</button></div>`;
    wrap.querySelector('#arWalls').onclick = () => { addWalls(); closeArrange(); };
    return;
  }
  // let the dialog paint before the search runs
  setTimeout(() => { lastResult = arrangeOptions(); renderTab('best'); }, 30);
}
function arrangeKeys(e) { if (e.key === 'Escape') { e.stopPropagation(); closeArrange(); } }
export function closeArrange() {
  const d = document.getElementById('arrangeDialog');
  if (d) d.remove();
  document.removeEventListener('keydown', arrangeKeys, true);
}

function renderTab(tab) {
  const d = document.getElementById('arrangeDialog');
  if (!d || !lastResult) return;
  const R = lastResult;
  // a style that can't fit everyone still shows its closest tries, clearly marked
  const list = (tab === 'best' ? R.best : (R.byStyle[tab] || []).filter(c => c.stats.seats > 0)).slice(0, 3);
  const tabs = [['best', 'Best for this class'], ...STYLES.map(s => [s.id, s.label])];
  d.querySelector('.ar-body').innerHTML = `
    <div class="ar-tabs" role="tablist">${tabs.map(([id, l]) => `<button role="tab" aria-selected="${id === tab}" class="ar-tab${id === tab ? ' on' : ''}" data-tab="${id}">${esc(l)}</button>`).join('')}</div>
    ${list.length ? `<div class="ar-cards">${list.map((c, i) => card(c, i, R)).join('')}</div>`
      : `<div class="ar-empty"><p>Nothing fits yet. Make the walls bigger, or move the teacher's desk or “no seats” areas.</p></div>`}
    ${list.some(c => c.stats.short) ? `<p class="ar-note">With ${AISLE_FT}-ft walkways this style can't seat all ${plural(R.need, 'student')} here. Make the walls bigger, move the desk or a “no seats” area, or add a few desks by hand after.</p>` : ''}`;
  d.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderTab(b.dataset.tab));
  d.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { useRoom(list[+b.dataset.use]); closeArrange(); });
}

function card(c, i, R) {
  const s = c.stats;
  const lines = [
    s.short ? `<span class="ar-warn">⚠ only ${plural(s.seats, 'seat')} for ${plural(R.need, 'student')}</span>`
      : `${plural(s.seats, 'seat')}${s.seats > R.need ? ` <span class="ar-dim">(${s.seats - R.need} spare)</span>` : ''}`,
    s.unreachable || s.blockedDoors ? `<span class="ar-warn">⚠ ${plural(s.unreachable, 'table')} hard to reach</span>` : `✓ ${AISLE_FT}-ft walkways to every table`,
    s.farthest ? (s.viewProblems ? `<span class="ar-warn">⚠ ${plural(s.viewProblems, 'seat')} with a poor view</span>` : `✓ every seat sees the board · farthest ${Math.round(s.farthest)} ft`) : '',
    c.rules ? (c.rules.left ? `<span class="ar-warn">⚠ ${plural(c.rules.left, 'seating rule')} can't be met</span>` : `✓ all ${plural(R.rulesCount, 'seating rule')} work`) : '',
    c.rules && c.rules.soft ? `<span class="ar-dim">${plural(c.rules.soft, 'tagged student')} miss their usual spot</span>` : '',
  ].filter(Boolean);
  const name = `${c.style.label}${c.params.aisle ? ', centre aisle' : ''}${c.params.turn ? ', end-on' : ''}`;
  const what = c.style.per === 1 ? 'desks' : 'tables';
  const spacing = `${what} ${fmtFt(c.params.gU)} ft apart · rows ${fmtFt(c.params.gV)} ft apart`;
  return `<div class="ar-card">
    ${preview(c.items, R.bounds)}
    <div class="ar-name">${esc(name)}<small>${esc(spacing)}</small></div>
    <ul class="ar-stats">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
    <button class="rc-btn primary" data-use="${i}">Use this</button>
  </div>`;
}

const fmtFt = v => (Math.round(v * 2) / 2).toString();

// Small drawing of a room
function preview(items, b) {
  const pad = 10;
  const poly = (box, cls) => `<polygon class="${cls}" points="${corners(box).map(p => p.join(',')).join(' ')}"/>`;
  const parts = [];
  items.forEach(i => {
    if (i.type === 'room') parts.push(`<polygon class="pv-wall" points="${roomPoints(i).map(p => p.join(',')).join(' ')}"/>`);
  });
  items.forEach(i => {
    const box = boxOf(i);
    if (i.type === 'zone') parts.push(poly(box, 'pv-zone'));
    else if (['board', 'door', 'window', 'teacher', 'outlet'].includes(i.type)) parts.push(poly(box, 'pv-' + i.type));
    else if (i.type === 'table') parts.push(poly(box, 'pv-table'));
  });
  getAllSeats(items).forEach(s => parts.push(`<circle class="pv-seat" cx="${s.x + SEAT_PX / 2}" cy="${s.y + SEAT_PX / 2}" r="${SEAT_PX / 2 - 3}"/>`));
  const e = items.map(i => aabb(boxOf(i))).reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }),
    { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
  return `<svg class="ar-pv" viewBox="${e.x0 - pad} ${e.y0 - pad} ${e.x1 - e.x0 + 2 * pad} ${e.y1 - e.y0 + 2 * pad}" aria-hidden="true">${parts.join('')}</svg>`;
}
