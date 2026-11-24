// ═══════════════════════════════════════════════
//  GROUP MAKER — split the students who are here into groups for an activity.
//  Follows the class's rules where it can:
//    keep apart → different groups · same group / near → same group
//    spread out a tag → one per group where possible · helper → each tagged student gets a helper
//  and, if asked, mixes the class's student groups (boys/girls …) and avoids last time's partners.
//  Random start + swaps that lower the "cost", many times over; the best result wins.
//  Nothing here touches seating charts.
// ═══════════════════════════════════════════════
import { hasTag } from '../landing/tags.js';

const norm = s => String(s || '').trim().toLowerCase();
const COST = { apart: 100, together: 40, near: 8, spread: 25, helper: 20, mix: 3, repeat: 4 };

// Sizes for n students: `size` per group (sizes differ by at most one), or exactly `count` groups
export function groupSizes(n, { size = 4, count = null } = {}) {
  if (n <= 0) return [];
  const g = Math.max(1, Math.min(n, count || Math.round(n / size) || 1));
  const base = Math.floor(n / g), extra = n % g;
  return Array.from({ length: g }, (_, i) => base + (i < extra ? 1 : 0));
}

// Rules → pairs and tag lists, in student ids
function readRules(students, rules) {
  const byName = new Map(students.map(s => [norm(s.name), s.id]));
  const id = n => byName.get(norm(n));
  const out = { apart: [], together: [], near: [], spread: [], helper: [] };
  (rules || []).forEach(r => {
    if (r.type === 'spread') { const ids = students.filter(s => hasTag(s, r.tag)).map(s => s.id); if (ids.length > 1) out.spread.push(ids); return; }
    if (r.type === 'helper') {
      const ids = students.filter(s => hasTag(s, r.tag)).map(s => s.id);
      const helpers = new Set(students.filter(s => hasTag(s, r.helperTag)).map(s => s.id));
      if (ids.length && helpers.size) out.helper.push({ ids, helpers });
      return;
    }
    const a = id(r.studentA), b = id(r.studentB);
    if (!a || !b || a === b) return;
    if (r.type === 'separate') out.apart.push([a, b]);
    else if (r.type === 'partners') out.together.push([a, b]);
    else if (r.type === 'near') out.near.push([a, b]);
  });
  return out;
}

// groups: array of arrays of ids
function cost(groups, ctx) {
  const where = new Map();
  groups.forEach((g, i) => g.forEach(id => where.set(id, i)));
  let c = 0;
  const same = (a, b) => where.has(a) && where.has(b) && where.get(a) === where.get(b);
  const both = (a, b) => where.has(a) && where.has(b);
  ctx.rules.apart.forEach(([a, b]) => { if (same(a, b)) c += COST.apart; });
  ctx.rules.together.forEach(([a, b]) => { if (both(a, b) && !same(a, b)) c += COST.together; });
  ctx.rules.near.forEach(([a, b]) => { if (both(a, b) && !same(a, b)) c += COST.near; });
  ctx.rules.spread.forEach(ids => {
    const here = ids.filter(x => where.has(x));
    const per = Math.ceil(here.length / groups.length);      // the fewest per group that's possible
    groups.forEach(g => { const k = g.filter(x => here.includes(x)).length; if (k > per) c += (k - per) * COST.spread; });
  });
  ctx.rules.helper.forEach(({ ids, helpers }) => ids.forEach(x => {
    if (!where.has(x)) return;
    if (!groups[where.get(x)].some(y => y !== x && helpers.has(y))) c += COST.helper;
  }));
  if (ctx.mixBy) {
    groups.forEach(g => {
      const counts = {};
      g.forEach(x => { const k = ctx.mixBy.get(x) || '?'; counts[k] = (counts[k] || 0) + 1; });
      Object.entries(ctx.share).forEach(([k, share]) => { const d = (counts[k] || 0) - share * g.length; c += d * d * COST.mix; });
    });
  }
  if (ctx.recent.size) groups.forEach(g => { for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (ctx.recent.has(pairKey(g[i], g[j]))) c += COST.repeat; });
  return c;
}
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// students: [{id, name, tags, gender}] (only the ones who are here)
// → { groups: [[student]], problems: [text] }
export function makeGroups(students, { size = 4, count = null, rules = [], followRules = true, mix = false, recent = [], rnd = Math.random } = {}) {
  const sizes = groupSizes(students.length, { size, count });
  if (!sizes.length) return { groups: [], problems: [] };
  const ctx = {
    rules: followRules ? readRules(students, rules) : { apart: [], together: [], near: [], spread: [], helper: [] },
    mixBy: null, share: {},
    recent: new Set(),
  };
  if (mix) {
    const kinds = students.map(s => s.gender || '?');
    if (new Set(kinds).size > 1) {
      ctx.mixBy = new Map(students.map(s => [s.id, s.gender || '?']));
      kinds.forEach(k => { ctx.share[k] = (ctx.share[k] || 0) + 1 / kinds.length; });
    }
  }
  (recent || []).forEach(g => { for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) ctx.recent.add(pairKey(g[i], g[j])); });

  const ids = students.map(s => s.id);
  let best = null, bestCost = Infinity;
  for (let restart = 0; restart < 12 && bestCost > 0; restart++) {
    const order = shuffle([...ids], rnd);
    let at = 0;
    const groups = sizes.map(n => order.slice(at, at += n));
    let c = cost(groups, ctx);
    // swap two students in different groups when it helps (a few passes)
    for (let pass = 0; pass < 40 && c > 0; pass++) {
      let improved = false;
      for (let gi = 0; gi < groups.length; gi++) for (let gj = gi + 1; gj < groups.length; gj++) {
        for (let a = 0; a < groups[gi].length; a++) for (let b = 0; b < groups[gj].length; b++) {
          [groups[gi][a], groups[gj][b]] = [groups[gj][b], groups[gi][a]];
          const c2 = cost(groups, ctx);
          if (c2 < c) { c = c2; improved = true; }
          else [groups[gi][a], groups[gj][b]] = [groups[gj][b], groups[gi][a]];
        }
      }
      if (!improved) break;
    }
    if (c < bestCost) { bestCost = c; best = groups.map(g => [...g]); }
  }
  const byId = new Map(students.map(s => [s.id, s]));
  return { groups: best.map(g => shuffle(g, rnd).map(id => byId.get(id))), problems: problemsOf(best, ctx, byId) };
}

// Rules the groups couldn't keep, in words
function problemsOf(groups, ctx, byId) {
  const where = new Map();
  groups.forEach((g, i) => g.forEach(id => where.set(id, i)));
  const nm = id => byId.get(id)?.name || '?';
  const out = [];
  ctx.rules.apart.forEach(([a, b]) => { if (where.get(a) === where.get(b)) out.push(`${nm(a)} and ${nm(b)} are in the same group`); });
  ctx.rules.together.forEach(([a, b]) => { if (where.has(a) && where.has(b) && where.get(a) !== where.get(b)) out.push(`${nm(a)} and ${nm(b)} are in different groups`); });
  return out;
}
