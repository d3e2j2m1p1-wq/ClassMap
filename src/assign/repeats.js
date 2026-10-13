// ═══════════════════════════════════════════════
//  AVOID REPEAT PARTNERS
//  Students who sat together in this class's last few charts shouldn't sit together again.
//  "Together" = the same table group (a pair, a trio, a whole table), or single desks side by side.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { seatsArePartners } from './rulesEngine.js';
import { getAllSeats } from './seats.js';
import { localDateStr } from '../storage/landingData.js';

export const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

// Every pair of seats that counts as sitting together
export function partnerSeatPairs(seats) {
  const out = [];
  for (let i = 0; i < seats.length; i++)
    for (let j = i + 1; j < seats.length; j++)
      if (seatsArePartners(seats[i], seats[j])) out.push([seats[i].seatId, seats[j].seatId]);
  return out;
}

// Student pairs who sat together in this class's last `n` charts dated on or before the open chart
export function recentPartnerPairs(n = 3) {
  const classId = window._currentChartClassId, curId = window._currentChartId;
  const dateOf = ch => ch.date || localDateStr(ch.savedAt || 0);
  const cur = store.landingData.charts.find(c => c.id === curId);
  const curDate = cur ? dateOf(cur) : '9999-12-31';
  const prev = store.landingData.charts
    .filter(ch => ch.classId === classId && ch.id !== curId && ch.data && dateOf(ch) <= curDate)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || (b.savedAt - a.savedAt))
    .slice(0, n);
  const pairs = new Set();
  prev.forEach(ch => {
    const asg = ch.data.assignments || {};
    partnerSeatPairs(getAllSeats(ch.data.layoutItems || [])).forEach(([s, t]) => {
      if (asg[s] && asg[t]) pairs.add(pairKey(asg[s], asg[t]));
    });
  });
  return pairs;
}

export function countRepeats(assign, seatPairs, history) {
  let n = 0;
  for (const [s, t] of seatPairs) {
    const a = assign[s], b = assign[t];
    if (a && b && history.has(pairKey(a, b))) n++;
  }
  return n;
}
