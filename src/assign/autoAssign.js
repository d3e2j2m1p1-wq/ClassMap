import { store } from '../core/store.js';
import { renderAssignPanel } from './panel.js';
import { evaluateRules, frontInfo, getResolvedRules, seatsAreNeighbors } from './rulesEngine.js';
import { cleanAssignments, getAllSeats } from './seats.js';
import { getGenderGroups, state } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { renderRoster } from '../editor/roster.js';
import { markDirty } from '../storage/autosave.js';
import { countRepeats, pairKey, partnerSeatPairs, recentPartnerPairs } from './repeats.js';

// ═══════════════════════════════════════════════
//  AUTO-ASSIGN ENGINE
// ═══════════════════════════════════════════════
export function autoAssign() {
  cleanAssignments();
  const allSeats = getAllSeats();
  if (!allSeats.length) { showToast('Add seats in the Layout tab first'); return; }
  if (!state.students.length) { showToast('This class has no students yet'); return; }

  const keep = document.getElementById('assignKeep').checked;
  const balance = document.getElementById('assignGenderBal').value;
  const fillOrder = document.getElementById('fillOrder').value;
  const rules = getResolvedRules();

  // Pinned students always stay; "Keep students already seated" keeps everyone
  const pins = new Set(state.pins || []);
  if (!keep) {
    const kept = {};
    Object.entries(state.assignments).forEach(([seat, sid]) => { if (pins.has(sid)) kept[seat] = sid; });
    state.assignments = kept;
  }
  const locked = new Set(Object.keys(state.assignments));   // seats we must not move
  const avoid = document.getElementById('assignAvoidRepeats');
  const history = avoid && avoid.checked ? recentPartnerPairs(3) : new Set();

  // Seats front → back (measured from the board when there is one), then side to side.
  // Seats within ROW_BAND px of the same distance count as one row.
  const fi = frontInfo(allSeats);
  const ROW_BAND = 40;
  const rowOf = id => Math.round(fi.raw[id] / ROW_BAND);
  const sortedSeats = [...allSeats].sort((a, b) =>
    (rowOf(a.seatId) - rowOf(b.seatId)) || (fi.lat[a.seatId] - fi.lat[b.seatId]));

  // Group seats by table group (a whole table, a pair, a trio …). Seats on their own
  // (single desks, solo tables, the odd one out) are their own group.
  const tableMap = {};
  sortedSeats.forEach(s => {
    const key = s.podKey || s.seatId;
    (tableMap[key] = tableMap[key] || []).push(s);
  });
  const minRow = g => Math.min(...g.map(s => rowOf(s.seatId)));
  const minLat = g => Math.min(...g.map(s => fi.lat[s.seatId]));
  const tableGroups = Object.values(tableMap).sort((a, b) =>
    (minRow(a) - minRow(b)) || (minLat(a) - minLat(b)));

  // Roster groups (Boys / Girls / …) used for balancing
  const groups = state.genderMode ? getGenderGroups() : [];
  const bucketIds = groups.map(g => g.id);
  const allKeys = [...bucketIds, '_none'];
  const keyOf = {};
  state.students.forEach(s => { keyOf[s.id] = bucketIds.includes(s.gender) ? s.gender : '_none'; });

  // One full attempt: fill every free seat, then swap students to fix broken rules.
  // Returns how many rules are still broken.
  const fillAndFix = () => {
    const seatedIds = new Set(Object.values(state.assignments));
    let pool = state.students.filter(s => !seatedIds.has(s.id));

    // Front / back row students go first
    const frontIds = new Set(rules.filter(r => r.type === 'front').map(r => r.a));
    const backIds = new Set(rules.filter(r => r.type === 'back' && !frontIds.has(r.a)).map(r => r.a));
    const frontStudents = shuffle(pool.filter(s => frontIds.has(s.id)));
    const backStudents = shuffle(pool.filter(s => backIds.has(s.id)));
    pool = pool.filter(s => !frontIds.has(s.id) && !backIds.has(s.id));

    const freeSeats = () => sortedSeats.filter(s => !state.assignments[s.seatId]);
    const frontSeats = freeSeats();
    frontStudents.forEach((st, i) => { if (frontSeats[i]) state.assignments[frontSeats[i].seatId] = st.id; });
    const backSeats = freeSeats().reverse();
    backStudents.forEach((st, i) => { if (backSeats[i]) state.assignments[backSeats[i].seatId] = st.id; });

    // Buckets per group (+ "_none" for ungrouped)
    const buckets = { _none: [] };
    bucketIds.forEach(id => { buckets[id] = []; });
    pool.forEach(s => (bucketIds.includes(s.gender) ? buckets[s.gender] : buckets._none).push(s));
    Object.keys(buckets).forEach(k => shuffle(buckets[k]));

    const emptyByTable = tableGroups
      .map(g => g.filter(s => !state.assignments[s.seatId]))
      .filter(g => g.length);

    const fillSequential = list => {
      let i = 0;
      emptyByTable.forEach(g => g.forEach(seat => { if (list[i]) state.assignments[seat.seatId] = list[i++].id; }));
    };

    if (fillOrder === 'alpha') {
      fillSequential(pool.slice().sort((a, b) => a.name.localeCompare(b.name)));

    } else if (balance === 'mixed' && bucketIds.length) {
      // Group by group (pairs, trios, whole tables): take from the roster group this table group
      // has the fewest of so far; on a tie, the one the whole table has fewest of (so a table
      // of 6 in two trios ends up 2+1 and 1+2); then the one with the most students left.
      const counted = (seats) => {
        const c = {};
        seats.forEach(s => { const sid = state.assignments[s.seatId]; if (sid) c[keyOf[sid]] = (c[keyOf[sid]] || 0) + 1; });
        return c;
      };
      const tableCounts = {};
      emptyByTable.filter(g => g[0].podKey).forEach(g => {
        const tid = g[0].tableId;
        if (!tableCounts[tid]) tableCounts[tid] = counted(allSeats.filter(s => s.tableId === tid));
        const tc = tableCounts[tid];
        const counts = counted(allSeats.filter(s => s.podKey === g[0].podKey));
        const picked = [];
        for (let k = 0; k < g.length; k++) {
          const cands = allKeys.filter(id => buckets[id].length);
          if (!cands.length) break;
          cands.sort((a, b) => ((counts[a] || 0) - (counts[b] || 0)) || ((tc[a] || 0) - (tc[b] || 0)) ||
                               (buckets[b].length - buckets[a].length));
          const pickId = cands[0];
          picked.push(buckets[pickId].shift());
          counts[pickId] = (counts[pickId] || 0) + 1;
          tc[pickId] = (tc[pickId] || 0) + 1;
        }
        shuffle(picked);
        g.forEach((seat, i) => { if (picked[i]) state.assignments[seat.seatId] = picked[i].id; });
      });

      // Seats on their own (single desks, solo tables, odd one out): front to back, give each seat
      // the roster group its already-filled neighbours have the fewest of → checkerboard.
      emptyByTable.filter(g => !g[0].podKey).forEach(([seat]) => {
        const cands = allKeys.filter(k => buckets[k].length);
        if (!cands.length) return;
        const near = allSeats.filter(o => state.assignments[o.seatId] && seatsAreNeighbors(seat, o));
        // closer neighbours count more (beside/behind outweighs diagonal)
        const same = k => near.reduce((sum, o) => keyOf[state.assignments[o.seatId]] === k
          ? sum + 1 / Math.max(1, Math.hypot(seat.x - o.x, seat.y - o.y)) : sum, 0);
        cands.sort((a, b) => (same(a) - same(b)) || (buckets[b].length - buckets[a].length));
        state.assignments[seat.seatId] = buckets[cands[0]].shift().id;
      });

    } else if (balance === 'same' && bucketIds.length) {
      fillSequential(allKeys.flatMap(k => buckets[k]));

    } else {
      fillSequential(shuffle(allKeys.flatMap(k => buckets[k])));
    }

    // Fix separate / near / front / back problems by swapping, then avoid repeat partners
    const left = optimizeAssignments(allSeats, rules, locked);
    const reps = reduceRepeats(allSeats, rules, locked, history, keyOf);
    return { left, reps };
  };

  // Swapping can get stuck (e.g. moving A next to B would break a different rule both ways),
  // so if rules are still broken, start over with a new shuffle and keep the best result.
  const start = { ...state.assignments };
  let best = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    state.assignments = { ...start };
    const { left, reps } = fillAndFix();
    if (!best || left < best.left || (left === best.left && reps < best.reps)) best = { left, reps, assignments: { ...state.assignments } };
    if (!left && !reps) break;
  }
  state.assignments = best.assignments;
  const remaining = best.left;

  const seatedNow = new Set(Object.values(state.assignments));
  const unplaced = state.students.filter(s => !seatedNow.has(s.id)).length;

  store.selectedSeatId = null;
  store.selectedStudentId = null;
  markDirty();
  renderAssignPanel();
  renderRoster();

  // Groups that ended up all one roster group (uneven numbers, or a rule needed the swap)
  let unmixed = 0;
  if (balance === 'mixed' && bucketIds.length >= 2) {
    const members = {};
    allSeats.forEach(s => {
      const sid = state.assignments[s.seatId];
      if (s.podKey && sid) (members[s.podKey] = members[s.podKey] || []).push(keyOf[sid]);
    });
    unmixed = Object.values(members).filter(ks => ks.length >= 2 && ks[0] !== '_none' && new Set(ks).size === 1).length;
  }

  let msg = '✓ Auto-assigned!';
  if (unplaced) msg += ` ${unplaced} student${unplaced !== 1 ? 's' : ''} have no seat.`;
  if (remaining) msg += ` ${remaining} rule${remaining !== 1 ? 's' : ''} couldn't be satisfied.`;
  if (unmixed) msg += ` ${unmixed} group${unmixed !== 1 ? 's' : ''} couldn't be mixed.`;
  if (best.reps) msg += ` ${best.reps} pair${best.reps !== 1 ? 's' : ''} sat together recently.`;
  else if (history.size) msg += ' No repeat partners.';
  if (pins.size) msg += ` ${pins.size} pinned.`;
  showToast(msg, (remaining || unmixed || unplaced || best.reps) ? 5000 : 2800);
}

// Hill-climb: swap violating students with other seats while that reduces broken rules.
// Prefers swaps with a student of the same group so group balance is kept.
export function optimizeAssignments(allSeats, rules, locked) {
  const count = () => evaluateRules(state.assignments, allSeats, rules).length;
  let best = count();
  if (!best) return 0;
  const groupOf = id => (state.students.find(s => s.id === id) || {}).gender || null;
  const seatOfStudent = id => Object.keys(state.assignments).find(k => state.assignments[k] === id);

  for (let iter = 0; iter < 300 && best > 0; iter++) {
    const vios = evaluateRules(state.assignments, allSeats, rules);
    const ids = shuffle([...new Set(vios.flatMap(v => v.ids))]);
    let improved = false;

    for (const sid of ids) {
      const fromSeat = seatOfStudent(sid);
      if (!fromSeat || locked.has(fromSeat)) continue;
      let bestMove = null;

      for (const seat of allSeats) {
        if (seat.seatId === fromSeat || locked.has(seat.seatId)) continue;
        const other = state.assignments[seat.seatId];

        state.assignments[seat.seatId] = sid;
        if (other) state.assignments[fromSeat] = other; else delete state.assignments[fromSeat];
        const c = count();
        state.assignments[fromSeat] = sid;
        if (other) state.assignments[seat.seatId] = other; else delete state.assignments[seat.seatId];

        if (c < best) {
          const sameGroup = !other || groupOf(other) === groupOf(sid);
          const key = c * 10 + (sameGroup ? 0 : 1);
          if (!bestMove || key < bestMove.key || (key === bestMove.key && Math.random() < 0.3)) {
            bestMove = { seatId: seat.seatId, other, c, key };
          }
        }
      }

      if (bestMove) {
        state.assignments[bestMove.seatId] = sid;
        if (bestMove.other) state.assignments[fromSeat] = bestMove.other; else delete state.assignments[fromSeat];
        best = bestMove.c;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return best;
}

// Clear every seat except pinned students
export function clearAssignments() {
  const pins = new Set(state.pins || []);
  const kept = {};
  Object.entries(state.assignments).forEach(([seat, sid]) => { if (pins.has(sid)) kept[seat] = sid; });
  state.assignments = kept;
  if (Object.keys(kept).length) showToast('Cleared — pinned students stayed');
  store.selectedSeatId = null;
  store.selectedStudentId = null;
  markDirty();
  renderAssignPanel();
  renderRoster();
}

export function toggleAssignPanel() {
  const panel = document.getElementById('assignFloatPanel');
  panel.classList.toggle('collapsed');
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// After the rules are settled: swap students (only with someone from the same roster group,
// so the boy/girl mix stays) while that lowers how many pairs sat together recently,
// without breaking any more rules. Returns the repeats left.
function reduceRepeats(allSeats, rules, locked, history, keyOf) {
  if (!history.size) return 0;
  const seatPairs = partnerSeatPairs(allSeats);
  const vio = () => evaluateRules(state.assignments, allSeats, rules).length;
  const rep = () => countRepeats(state.assignments, seatPairs, history);
  let bestV = vio(), bestR = rep();
  const free = allSeats.map(s => s.seatId).filter(id => !locked.has(id));
  const swap = (s, t) => {
    const a = state.assignments[s], b = state.assignments[t];
    if (b) state.assignments[s] = b; else delete state.assignments[s];
    if (a) state.assignments[t] = a; else delete state.assignments[t];
  };
  for (let pass = 0; pass < 6 && bestR > 0; pass++) {
    let improved = false;
    const hot = new Set();
    seatPairs.forEach(([s, t]) => {
      const a = state.assignments[s], b = state.assignments[t];
      if (a && b && history.has(pairKey(a, b))) { hot.add(s); hot.add(t); }
    });
    for (const s of shuffle([...hot])) {
      if (locked.has(s) || !state.assignments[s]) continue;
      const sid = state.assignments[s];
      for (const t of shuffle(free.slice())) {
        const other = state.assignments[t];
        if (t === s || !other || keyOf[other] !== keyOf[sid]) continue;
        swap(s, t);
        const v = vio(), r = rep();
        if (v <= bestV && r < bestR) { bestV = v; bestR = r; improved = true; break; }
        swap(s, t);
      }
      if (!bestR) break;
    }
    if (!improved) break;
  }
  return bestR;
}
