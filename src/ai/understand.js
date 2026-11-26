// ═══════════════════════════════════════════════
//  HELPING THE READER UNDERSTAND MORE (no AI)
//  fixTypos(): "auto asign the seets" → "auto assign the seats" — only for words ClassMap knows,
//              and never a student's or class's name.
//  rephrase(): common ways of asking rewritten to a form the reader knows,
//              e.g. "Don't let Liam sit with Owen" → "Keep Liam and Owen apart".
// ═══════════════════════════════════════════════

// Words the reader and the help understand (a typo is only fixed toward one of these)
const VOCAB = `
assign auto automatic automatically seat seats seated seating everyone shuffle randomize random scramble
separate apart together away next near beside front back spread partner partners pair group groups table tables
swap switch move change pin unpin lock keep remove delete rename add create make start open new chart charts
class classes student students roster names name tag tags tagged rule rules check broken
timer minute minutes second seconds countdown attendance absent present late tardy here missing roll
picker pick choose call voice level noise quiet print printer printing present projector substitute
backup back restore import export file send receive share code device teacher google drive
layout room desk desks board door window walls arrange tidy undo help settings language spanish english
participation points tents labels label who which what where how many count list show tell
everyone everybody nobody somebody without unseated unplaced placed
checking assigning separated swapping shuffling printing presenting starting making
`.split(/\s+/).filter(Boolean);
const VOCAB_SET = new Set(VOCAB);

// Edit distance with swapped letters counted as one mistake ("teh" → "the").
// Stops early once it's clear the words are further apart than `max`.
export function dist(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      cur[j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    pp = prev;
    prev = cur;
  }
  return prev[b.length];
}

export function closestWord(w, words = VOCAB) {
  const low = w.toLowerCase();
  if (low.length < 5 || VOCAB_SET.has(low)) return null;   // short words are too easy to mistake
  const max = low.length >= 8 ? 2 : 1;
  let best = null, bestD = max + 1;
  for (const v of words) {
    if (Math.abs(v.length - low.length) > max) continue;
    const d = dist(low, v, max);
    if (d < bestD) { best = v; bestD = d; }
  }
  return bestD <= max ? best : null;
}

// Names in the class (and class names) are never "fixed"
function protectedWords(ctx) {
  const out = new Set();
  const add = s => String(s || '').toLowerCase().split(/[^a-z0-9áéíóúñü'-]+/i).forEach(w => w && out.add(w));
  (ctx?.classes || []).forEach(c => { add(c.name); (c.students || []).forEach(s => add(s.name)); });
  (window.__cm?.state?.students || []).forEach(s => add(s.name));
  return out;
}

// Short words are too easy to mistake for names, so only these known slips are fixed
const SHORT_TYPOS = { clas: 'class', calss: 'class', clss: 'class', clase: 'class', chrt: 'chart', chrat: 'chart', cahrt: 'chart',
  seta: 'seat', saet: 'seat', staes: 'seats', tgas: 'tags', tagg: 'tag', rulse: 'rules', rlues: 'rules', tiem: 'time', ruels: 'rules',
  swpa: 'swap', sawp: 'swap', mvoe: 'move', pciK: 'pick', pikc: 'pick', grup: 'group', gruop: 'group', grops: 'groups' };

export function fixTypos(text, ctx = null) {
  const keep = protectedWords(ctx);
  return String(text).replace(/[A-Za-zÀ-ÿ]+/g, (w, at) => {
    const low = w.toLowerCase();
    if (keep.has(low)) return w;
    // a capitalized word in the middle of a sentence is probably a name
    if (at > 0 && /^[A-ZÀ-Ý]/.test(w) && !/[.!?]\s*$/.test(text.slice(0, at))) return w;
    const fix = SHORT_TYPOS[low] || closestWord(low);
    if (!fix) return w;
    return /^[A-Z]/.test(w) ? fix[0].toUpperCase() + fix.slice(1) : fix;
  });
}

// Common ways of asking → a form the reader knows. First match wins; names are kept as typed.
// a first name, or first and last — but never swallowing the verb that follows ("Liam sit")
const NOT_NAME = String.raw`(?:sit|sits|be|go|work|with|and|next|near|by|beside|from|away|together|can|cant|can't|cannot|should|shouldnt|shouldn't|must|mustn't|won't|doesn't|does|don't|dont|need|needs|have|has|to|apart)\b`;
const N = String.raw`((?!${NOT_NAME})[A-Za-zÀ-ÿ'’.-]+(?:\s+(?!${NOT_NAME})[A-Za-zÀ-ÿ'’.-]+)?)`;
const REPHRASE = [
  // polite openings
  [/^\s*(?:please|pls|hey|hi|ok|okay)[,!\s]+/i, ''],
  [/^\s*(?:can|could|would|will) you(?: please)?\s+/i, ''],
  [/^\s*(?:i (?:want|need|would like|'d like) (?:you )?to|help me|let'?s|i wanna)\s+/i, ''],
  [/[?.!\s]*please[?.!]*\s*$/i, ''],
  // keeping two students apart
  [new RegExp(String.raw`^(?:don'?t|do not|never) (?:let|have|put|seat) ${N} (?:sit|be|go)?\s*(?:with|next to|near|by|beside|together with) ${N}[.!]?$`, 'i'), 'Keep $1 and $2 apart'],
  [new RegExp(String.raw`^${N} (?:can'?t|cannot|can not|shouldn'?t|should not|mustn'?t|must not|won'?t|doesn'?t|does not) (?:sit|be|work)\s*(?:with|next to|near|by|beside|together with) ${N}[.!]?$`, 'i'), 'Keep $1 and $2 apart'],
  [new RegExp(String.raw`^${N} and ${N} (?:can'?t|cannot|shouldn'?t|should not|mustn'?t|must not|don'?t|do not) (?:sit|be|work) (?:together|next to each other|near each other|by each other)[.!]?$`, 'i'), 'Keep $1 and $2 apart'],
  [new RegExp(String.raw`^(?:split up|split|break up|separate|move apart) ${N} (?:and|from) ${N}[.!]?$`, 'i'), 'Keep $1 and $2 apart'],
  [new RegExp(String.raw`^(?:move|seat|put) ${N} away from ${N}[.!]?$`, 'i'), 'Keep $1 and $2 apart'],
  // keeping two students together
  [new RegExp(String.raw`^(?:let|have|put|seat) ${N} (?:sit )?(?:with|next to|near|beside) ${N}[.!]?$`, 'i'), 'Seat $1 near $2'],
  [new RegExp(String.raw`^${N} and ${N} (?:can|should|need to|have to|must) (?:sit|be|work) together[.!]?$`, 'i'), 'Seat $1 near $2'],
  // seating everyone
  [/^(?:randomi[sz]e|scramble|mix up|jumble|shake up|redo|re-?do|re-?arrange) (?:the |my |all the )?(?:seats|seating|chart|class|students|kids)(?: randomly)?[.!]?$/i, 'Auto-assign seats'],
  [/^(?:seat|place|sit) (?:them|everyone|everybody|the class|my class|the students|the kids|all the students)(?: down)?(?: randomly| automatically| for me)?[.!]?$/i, 'Auto-assign seats'],
  [/^(?:new|random|different) seats(?: for everyone)?[.!]?$/i, 'Auto-assign seats'],
  [/^(?:make|do|create) (?:the |a )?seating(?: chart)?(?: for me)?[.!]?$/i, 'Auto-assign seats'],
  // timers
  [/^(?:set|start|put on|give me|run)\s+(?:a\s+)?(?:timer|countdown)\s+(?:for\s+)?(\d+)\s*(min|mins|minutes?|sec|secs|seconds?)\b.*$/i, '$1 $2 timer'],
  [/^(?:timer|countdown)\s+(?:for\s+)?(\d+)\s*(min|mins|minutes?|sec|secs|seconds?)\b.*$/i, '$1 $2 timer'],
  [/^(\d+)\s*(min|mins|minutes?|sec|secs|seconds?)\s+(?:on the )?(?:clock|countdown)[.!]?$/i, '$1 $2 timer'],
  // light and dark (a how-to answer; the switch is at the top)
  [/^(?:make it|switch to|change to|turn on|use|go|put it (?:on|in))?\s*(?:the\s+)?(dark|night|light|day)(?:\s+(?:mode|theme|colors?))?[.!]?$/i, 'How do I switch between light and dark?'],
  [/^(?:make it|turn it) (?:darker|lighter|brighter)[.!]?$/i, 'How do I switch between light and dark?'],
  // name picker, attendance
  [/^(?:who(?:'s| is| should)?\s+(?:next|up next|goes next|answer(?:s)?(?: next)?)|pick (?:someone|somebody|a kid|a name)|spin the wheel|random pick)[?.!]?$/i, 'Pick a random student'],
  [/^(?:mark|do|record) (?:the )?(?:attendance|roll)[.!]?$/i, 'Take attendance'],
  [/^(?:who(?:'s| is)? (?:gone|not here|away|out today))[?.!]?$/i, 'Who is absent?'],
];

export function rephrase(text) {
  let t = String(text).trim();
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [rx, to] of REPHRASE) {
      if (rx.test(t)) {
        const next = t.replace(rx, to).trim();
        if (next && next !== t) { t = next; changed = true; }
      }
    }
    if (!changed) break;
  }
  return t;
}
