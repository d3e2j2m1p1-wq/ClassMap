// ═══════════════════════════════════════════════
//  SEATING RULES IN PLAIN ENGLISH
//  "Keep Liam and Owen apart. Ana needs the front. Spread out the IEP kids."
//  → [{ type: 'separate', a: Liam, b: Owen }, { type: 'front', a: Ana }, { type: 'spread', tag: 'IEP' }]
//  1. A careful pattern reader handles the usual ways teachers say things.
//  2. Every name is matched against the class roster; unknown or unclear names are pointed out.
//  Nothing is changed until the teacher presses Apply.
// ═══════════════════════════════════════════════
import { classTags, tagKey } from '../landing/tags.js';

export const RULE_LABEL = {
  separate: 'Keep apart', near: 'Seat near each other', partners: 'Same group',
  front: 'Front of the room', back: 'Back of the room', spread: 'Spread out', helper: 'Pair with a helper',
};

// ── Names ──
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Every way a student might be written: "Ana Ruiz", "Ana", "Ruiz", "Ana R", "Ana R."
export function rosterIndex(students) {
  const keys = [];
  students.forEach(s => {
    const parts = norm(s.name).split(' ').filter(Boolean);
    if (!parts.length) return;
    const first = parts[0], last = parts.length > 1 ? parts[parts.length - 1] : '';
    const add = (k, weight) => keys.push({ k, s, weight, words: k.split(' ').length });
    add(parts.join(' '), 3);
    if (last) { add(`${first} ${last[0]}`, 2); add(last, 1); }
    add(first, 1);
  });
  return keys;
}

// Find the students named in a piece of text, in order. Returns { found: [{student, at}], unclear: [{text, options}] }
export function findStudents(text, index) {
  const words = norm(text).split(' ');
  const found = [], unclear = [];
  const used = new Set();
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    let best = null;
    for (let n = 3; n >= 1 && !best; n--) {
      if (i + n > words.length) continue;
      const phrase = words.slice(i, i + n).join(' ').replace(/'s$/, '');
      if (STOP.has(phrase)) continue;
      let hits = index.filter(e => e.words === n && e.k === phrase);
      if (!hits.length && n === 1 && phrase.length >= 4) hits = index.filter(e => e.words === 1 && e.weight >= 1 && lev(e.k, phrase) === 1);
      if (!hits.length) continue;
      const top = Math.max(...hits.map(h => h.weight));
      const people = [...new Map(hits.filter(h => h.weight === top).map(h => [h.s.id, h.s])).values()];
      best = { n, people, phrase };
    }
    if (!best) continue;
    for (let k = i; k < i + best.n; k++) used.add(k);
    if (best.people.length === 1) found.push({ student: best.people[0], at: i });
    else unclear.push({ text: best.phrase, options: best.people });
  }
  return { found, unclear };
}
// words that are never names, even if a student happens to be called that
const STOP = new Set(['and', 'or', 'the', 'a', 'an', 'to', 'in', 'at', 'of', 'with', 'from', 'by', 'near', 'next', 'front', 'back', 'keep', 'seat', 'sit', 'put', 'apart', 'away', 'together', 'same', 'group', 'table', 'row', 'should', 'not', 'dont', "don't", 'never', 'can', 'needs', 'need', 'also', 'each', 'every', 'all', 'student', 'students', 'kids', 'kid', 'them', 'they', 'he', 'she', 'his', 'her', 'their', 'up', 'close', 'other', 'separate', 'pair', 'partners', 'partner', 'spread', 'out', 'helper', 'one', 'two', 'class', 'chart']);

// ── 1. The pattern reader ──
const RX = {
  apart: /\b(apart|separat\w*|split (them )?up|away from( each other)?|not (sit|be|seated)? ?(together|next to|near|with|beside)|(don'?t|do not|never|shouldn'?t|should not|can'?t|cannot|must not) (\w+ ){0,4}(together|next to|near|with|beside|by|close)|keep \w+( \w+)? from)\b/,
  partners: /\b(same (group|table|pod|team)|in a group|group(ed)? (them )?together|partners?|pair(ed)? (up )?(with|together)|work together)\b/,
  near: /\b(near|next to|close to|beside|by each other|together|sit with|seat(ed)? with)\b/,
  front: /\b(front|up close|close to the board|near the board|first row|preferential)\b/,
  back: /\b(back( row| of the (room|class))?|last row|in the back|at the back)\b/,
  spread: /\b(spread( \w+)? out|different (groups|tables)|not (all )?(at|in) the same (group|table)|split (them )?up|apart|separat\w*)\b/,
  helper: /\b(with an?|next to an?|paired with an?|sit with an?)\b/,
};

function sentences(text) {
  return String(text).split(/(?<=[.!?;\n])\s*|\s+(?:also|then)\s+/i).map(s => s.trim()).filter(Boolean);
}

// Read what we can; return { rules, leftover: [sentence], unclear }
export function parseRules(text, cls) {
  const index = rosterIndex(cls.students || []);
  const tags = classTags(cls);
  const rules = [], leftover = [], unclear = [];
  sentences(text).forEach(sent => {
    const low = norm(sent);
    const { found, unclear: u } = findStudents(sent, index);
    unclear.push(...u.map(x => ({ ...x, sentence: sent })));
    const people = [...new Map(found.map(f => [f.student.id, f.student])).values()];
    // "Liam can't sit next to Owen or Jayden" → Liam with each of them; "Keep Ana, Liam and Owen apart" → every pair
    const pairs = rx => {
      const hit = rx.exec(low);
      const kwAt = hit ? low.slice(0, hit.index).split(' ').filter(Boolean).length : 0;
      const firstAt = new Map(); found.forEach(f => { if (!firstAt.has(f.student.id)) firstAt.set(f.student.id, f.at); });
      const beforeKw = people.filter(p => firstAt.get(p.id) < kwAt);
      const out = [];
      if (beforeKw.length === 1 && people.length > 2) people.slice(1).forEach(p => out.push([people[0], p]));
      else for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) out.push([people[i], people[j]]);
      return out;
    };
    const tagHits = tags.filter(t => new RegExp(`\\b${escRx(norm(t))}\\b`).test(low));
    const before = rules.length;

    if (!people.length && tagHits.length) {
      // rules about tags: "spread out the IEP students", "each ELL student sits with a strong reader"
      if (tagHits.length >= 2 && RX.helper.test(low)) {
        const [first, second] = tagHits.sort((a, b) => low.indexOf(norm(a)) - low.indexOf(norm(b)));
        rules.push({ type: 'helper', tag: first, helperTag: second });
      } else if (RX.spread.test(low)) tagHits.forEach(t => rules.push({ type: 'spread', tag: t }));
    } else if (people.length >= 2 && RX.apart.test(low)) {
      pairs(RX.apart).forEach(([a, b]) => rules.push({ type: 'separate', a, b }));
    } else if (people.length >= 2 && RX.partners.test(low)) {
      pairs(RX.partners).forEach(([a, b]) => rules.push({ type: 'partners', a, b }));
    } else if (people.length >= 2 && RX.near.test(low) && !RX.front.test(low) && !RX.back.test(low)) {
      for (let i = 1; i < people.length; i++) rules.push({ type: 'near', a: people[0], b: people[i] });
    } else if (people.length >= 1 && RX.back.test(low) && !/\bback to\b/.test(low)) {
      people.forEach(p => rules.push({ type: 'back', a: p }));
    } else if (people.length >= 1 && RX.front.test(low)) {
      people.forEach(p => rules.push({ type: 'front', a: p }));
    }
    // a sentence with an unclear name waits for the teacher to pick who they meant
    if (rules.length === before && !u.length && (people.length || tagHits.length || sent.split(' ').length > 2)) leftover.push(sent);
  });
  return { rules, leftover, unclear };
}
const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function planRules(rules, existing) {
  const key = r => r.type === 'spread' ? `spread|${tagKey(r.tag)}` : r.type === 'helper' ? `helper|${tagKey(r.tag)}|${tagKey(r.helperTag)}`
    : ['separate', 'near', 'partners'].includes(r.type) ? `${r.type}|${[r.studentA, r.studentB].map(norm).sort().join('|')}` : `${r.type}|${norm(r.studentA)}`;
  const pairKey = r => [r.studentA, r.studentB].map(norm).sort().join('|');
  const stored = rules.map(toStored);
  const seen = new Set(existing.map(key));
  const out = [];
  stored.forEach((r, i) => {
    const k = key(r);
    if (out.some(o => key(o.rule) === k)) return;            // said twice in the same message
    let status = 'new', note = '';
    if (seen.has(k)) { status = 'duplicate'; note = 'already a rule'; }
    else if (['separate', 'near', 'partners'].includes(r.type)) {
      const clash = [...existing, ...stored.slice(0, i)].find(x => x !== r && ['separate', 'near', 'partners'].includes(x.type) && pairKey(x) === pairKey(r) && (x.type === 'separate') !== (r.type === 'separate'));
      if (clash) { status = 'conflict'; note = `clashes with “${RULE_LABEL[clash.type]}” for the same two students`; }
    } else if (r.type === 'front' || r.type === 'back') {
      const other = r.type === 'front' ? 'back' : 'front';
      if ([...existing, ...stored].some(x => x.type === other && norm(x.studentA) === norm(r.studentA))) { status = 'conflict'; note = `also set to the ${other}`; }
    }
    out.push({ rule: r, text: describe(r), status, note });
  });
  return out;
}

// The shape rules are saved in (same as the Rules tab)
export function toStored(r) {
  if (r.type === 'spread') return { type: 'spread', tag: r.tag };
  if (r.type === 'helper') return { type: 'helper', tag: r.tag, helperTag: r.helperTag };
  return { type: r.type, studentA: r.a.name, studentB: r.b ? r.b.name : '' };
}
export function describe(r) {
  if (r.type === 'spread') return `Spread out everyone tagged “${r.tag}”`;
  if (r.type === 'helper') return `Each “${r.tag}” student sits with a “${r.helperTag}” student`;
  if (r.type === 'front') return `Seat ${r.studentA} toward the front`;
  if (r.type === 'back') return `Seat ${r.studentA} toward the back`;
  if (r.type === 'separate') return `Keep ${r.studentA} and ${r.studentB} apart`;
  if (r.type === 'near') return `Seat ${r.studentA} near ${r.studentB}`;
  return `Put ${r.studentA} and ${r.studentB} in the same group`;
}
