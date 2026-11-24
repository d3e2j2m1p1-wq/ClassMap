// ═══════════════════════════════════════════════
//  WHAT THE TEACHER ASKED FOR → WHAT CLASSMAP DOES
//  The AI's only job is to understand the request. The answer, or the change, always comes from
//  ClassMap's own code and the real class data, so it can't make up facts.
//    1. readCommand()  — a careful pattern reader for the usual ways of asking (works with the AI off)
//    2. commandPrompt() / readModelCommand() — the on-device model, for everything else (JSON only)
//    3. planCommands() — turns requests into an answer, or a "Here's what I'll do" plan with Apply
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc, state } from '../core/state.js';
import { plural, showToast } from '../core/ui.js';
import { CLASS_COLORS, saveLandingData } from '../storage/landingData.js';
import { editorOpen, markDirty } from '../storage/autosave.js';
import { renderClassList, selectClass } from '../landing/landing.js';
import { renderLdStudentCols } from '../landing/roster.js';
import { renderLdRules } from '../landing/rules.js';
import { guessGroupForClass } from '../roster/nameList.js';
import { parseRosterText } from '../roster/parseRoster.js';
import { classTags, hasTag, PRESET_TAGS, tagKey } from '../landing/tags.js';
import { createNewChart } from '../landing/chartOpen.js';
import { getAllSeats } from '../assign/seats.js';
import { evaluateRules, frontInfo, getResolvedRules, seatsAreNeighbors, seatsArePartners, violationMessage } from '../assign/rulesEngine.js';
import { placeStudent } from '../assign/interactions.js';
import { autoAssign } from '../assign/autoAssign.js';
import { renderAssignPanel } from '../assign/panel.js';
import { renderRoster } from '../editor/roster.js';
import { describe, findStudents, parseRules, rosterIndex } from './rulesNL.js';

// ── Context: where the teacher is ──
export function context() {
  const editing = editorOpen();
  const classId = editing ? window._currentChartClassId : store.activeClassId;
  const classes = store.landingData?.classes || [];
  return { editing, classes, cls: classes.find(c => c.id === classId) || null };
}

// ══ 1. The pattern reader ══
const clean = t => String(t).trim()
  .replace(/^(hey|hi|ok(ay)?|so)[,!]?\s+/i, '')
  .replace(/^(please|pls|can you|could you|would you|will you|i want you to|i'?d like you to|i need you to|help me)\s+/i, '')
  .replace(/^(please)\s+/i, '')
  .replace(/\s*(,?\s*please|,?\s*thanks|,?\s*thank you)[.!]*$/i, '')
  .replace(/\s+/g, ' ').trim();
const unquote = s => String(s || '').trim().replace(/^["“'‘]+|["”'’.!?]+$/g, '').trim();
const RULE_WORDS = /\b(apart|separate|away from|together|next to|near|beside|same (group|table)|front|back|spread|partners?|pair)\b/i;

// "Liam, Ana and Mia" / a pasted list → ["Liam", "Ana", "Mia"]
export function splitNames(s) {
  const text = String(s || '').trim();
  if (/\n/.test(text)) return parseRosterText(text).map(n => n.replace(/^([^,]+),\s*(.+)$/, '$2 $1').trim()).filter(Boolean);
  return text.split(/\s*(?:,|;|\band\b|&|\+)\s*/i).map(unquote).filter(n => n && n.length < 60);
}

// → [{ action, ... }] or null when it isn't one of the usual phrasings
export function readCommand(raw, ctx) {
  const text = clean(raw);
  const low = text.toLowerCase();
  let m;

  // how-to questions are for the help pages, never actions
  if (/^(how (do|can|would|should) (i|you|we)|how to|where (do|can|is the)|what (does|is) the|is there a way|can i)\b/i.test(text)) return [{ action: 'help', query: text }];

  // ── classes ──
  if ((m = /^(?:create|make|add|start|set up|setup|new)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?class(?:es)?\b\s*(?:called|named|for|titled)?\s*[:\-]?\s*([\s\S]*)$/i.exec(text))) {
    let rest = m[1].trim(), students = [];
    const w = /^([\s\S]*?)\s*(?:\bwith\b(?:\s+(?:students?|kids))?|:\n|\n)\s*([\s\S]+)$/i.exec(rest);
    if (w) { rest = w[1]; students = splitNames(w[2]); }
    return [{ action: 'create_class', name: unquote(rest), students }];
  }
  if ((m = /^(?:open|go to|switch to|show me|show)\s+(?:the\s+)?(?:class\s+)?(.+?)(?:\s+class)?$/i.exec(text)) && classByName(ctx, m[1])) return [{ action: 'open_class', name: unquote(m[1]) }];
  if (/^(what|which|list|show)\b.*\bclasses\b|^how many classes/i.test(text)) return [{ action: 'list_classes' }];

  // ── roster ──
  if ((m = /^add\s+(?:these\s+|the\s+following\s+|new\s+)?(?:students?|kids|names)?\s*to\s+(?:the\s+)?(?:class\s+)?(.+?)\s*:\s*([\s\S]+)$/i.exec(text))) return [{ action: 'add_students', names: splitNames(m[2]), className: unquote(m[1]) }];
  if (!RULE_WORDS.test(low) && (m = /^add\s+(?:these\s+|the\s+following\s+|new\s+)?(?:students?|kids|names)?\s*(?:named|called)?\s*:?\s*([\s\S]+?)(?:\s+to\s+(?:the\s+)?(?:(?:class|roster|list)|([^,\n]+?)(?:\s+(?:class|roster))?))?[.!]?$/i.exec(text))
      && !/^(a |an )?(rule|tag|class|chart|table|seat|door|window|board)\b/i.test(m[1])) {
    return [{ action: 'add_students', names: splitNames(m[1]), className: m[2] ? unquote(m[2]) : '' }];
  }
  if ((m = /^(?:un-?tag|remove (?:the )?(?:tag )?)\s*["“]?(.+?)["”]?\s+(?:tag\s+)?from\s+(.+?)[.!]?$/i.exec(text))) return [{ action: 'untag', tag: unquote(m[1]), names: splitNames(m[2]) }];
  if ((m = /^(?:tag|mark|label|flag)\s+(.+?)\s+(?:as|with)\s+(?:an?\s+)?["“]?(.+?)["”]?(?:\s+tag)?[.!]?$/i.exec(text))) return [{ action: 'tag', names: splitNames(m[1]), tag: unquote(m[2]) }];
  if ((m = /^(?:give|add)\s+(?:an?\s+)?["“]?(.+?)["”]?\s+tag\s+to\s+(.+?)[.!]?$/i.exec(text))) return [{ action: 'tag', names: splitNames(m[2]), tag: unquote(m[1]) }];

  // ── charts and seats ──
  if (/^(make|create|start|open|new)\s+(a\s+)?(new\s+)?(seating\s+)?chart\b/i.test(text)) return [{ action: 'new_chart' }];
  if (/\b(auto[- ]?assign|assign (the |all )?(the )?seats|seat everyone|fill (the |all )?(the )?seats|shuffle (the )?(class|seats)|reshuffle|mix (them|everyone|the class) up)\b/i.test(text)) return [{ action: 'auto_assign' }];
  if ((m = /^(?:swap|switch|trade)\s+(?:seats\s+(?:for\s+)?)?(.+?)\s+(?:and|with|&)\s+(.+?)(?:'s)?(?:\s+seats?)?[.!]?$/i.exec(text))) return [{ action: 'swap', a: unquote(m[1]), b: unquote(m[2]) }];
  if (ctx.editing && (m = /^(?:move|seat|put|sit|place)\s+(.+?)\s+(?:right\s+)?(?:next to|near|beside|by|with)\s+(.+?)[.!]?$/i.exec(text))) return [{ action: 'seat_near', a: unquote(m[1]), b: unquote(m[2]) }];
  if ((m = /^(?:un-?pin|unlock)\s+(.+?)[.!]?$/i.exec(text))) return [{ action: 'unpin', names: splitNames(m[1]) }];
  if ((m = /^(?:pin|lock)\s+(.+?)(?:\s+(?:in place|where (?:they|he|she) (?:is|are)|to (?:their|his|her) seats?))?[.!]?$/i.exec(text))) return [{ action: 'pin', names: splitNames(m[1]) }];
  if ((m = /^(?:un-?seat|take)\s+(.+?)(?:\s+out of (?:their|his|her|the) seats?)?[.!]?$/i.exec(text)) || (m = /^remove\s+(.+?)\s+from\s+(?:their|his|her|the|its)\s+seats?[.!]?$/i.exec(text))) return [{ action: 'unseat', names: splitNames(m[1]) }];

  // ── questions ──
  if (/how many (students|kids|people)|class size/i.test(text)) return [{ action: 'count' }];
  if (/\b(who('s| is| are)? (not seated|unplaced|left|without a seat|missing a seat|not placed|still unseated)|who (doesn'?t|does not|don'?t) have a seat|unseated students|who (isn'?t|is not|aren'?t|are not) (seated|placed|sitting))\b/i.test(text)) return [{ action: 'unplaced' }];
  if (/\b(check (the )?(rules|chart|seats)|(any|which) rules? (are )?(broken|not met)|break(s|ing)? (any )?rules|rule (problems|conflicts|issues)|(are|is) (the )?(rules|chart) (ok|okay|fine|met))\b/i.test(text)) return [{ action: 'check_rules' }];
  if (/^(what|which|show|list|tell me)\b.*\brules\b|^rules\??$/i.test(text)) return [{ action: 'list_rules' }];
  if ((m = /^who\s+(?:sits|is sitting|'s sitting|is seated|sat|is)\s+(?:next to|near|beside|by|with|around)\s+(.+?)\??$/i.exec(text))) return [{ action: 'neighbors', name: unquote(m[1]) }];
  if ((m = /^where\s+(?:is|does|'s)\s+(.+?)(?:\s+(?:sit|sitting|seated))?\??$/i.exec(text))) return [{ action: 'where', name: unquote(m[1]) }];
  if ((m = /^(?:who|which (?:students|kids))\s*(?:is|are|'s|has|have)\s+(tagged\s+|a\s+|an\s+)?["“]?(.+?)["”]?(?:\s+(?:tags?|students|kids))?\??$/i.exec(text)) && (m[1] === 'tagged ' || tagByName(ctx, m[2]) || isPreset(m[2]))) return [{ action: 'list_tag', tag: unquote(m[2]) }];
  if ((m = /^(?:list|show)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(?:students\s+(?:tagged|with)\s+)?["“]?(.+?)["”]?(?:\s+(?:students|kids))?$/i.exec(text)) && tagByName(ctx, m[1])) return [{ action: 'list_tag', tag: unquote(m[1]) }];
  if (/\b(who('s| is) in (the |this |my )?class|list (the |all )?(students|kids|roster)|show (me )?(the )?roster|class list)\b/i.test(text)) return [{ action: 'list_students' }];

  // ── seating rules ("Keep Liam and Owen apart") ──
  if (ctx.cls) {
    const r = parseRules(text, ctx.cls);
    if (r.rules.length || r.unclear.length) return [{ action: 'rules', text }];
  }
  return null;
}

// ══ 2. The model ══
const SHAPES = `{"action":"create_class","name":"Period 4","students":["Liam","Ana"]}
{"action":"add_students","names":["Liam Johnson","Ana Ruiz"]}
{"action":"tag","names":["Owen"],"tag":"IEP"}   {"action":"untag","names":["Owen"],"tag":"IEP"}
{"action":"rules","text":"Keep Liam and Owen apart"}   (seating rules for the class: apart, near, same group, front, back, spread out a tag)
{"action":"new_chart"}   {"action":"open_class","name":"Period 3"}
{"action":"swap","a":"Liam","b":"Ana"}   {"action":"seat_near","a":"Liam","b":"Ana"}
{"action":"pin","names":["Mia"]}   {"action":"unpin","names":["Mia"]}   {"action":"unseat","names":["Mia"]}
{"action":"auto_assign"}
{"action":"where","name":"Liam"}   {"action":"neighbors","name":"Liam"}   {"action":"unplaced"}
{"action":"check_rules"}   {"action":"list_rules"}   {"action":"list_tag","tag":"IEP"}
{"action":"count"}   {"action":"list_students"}   {"action":"list_classes"}
{"action":"help","query":"how to print"}   (questions about how to use the app)
{"action":"none"}   (anything else)`;

export function commandPrompt(ctx, text) {
  const names = ctx.cls ? (ctx.editing ? state.students : ctx.cls.students || []).map(s => s.name).join(', ') : '';
  return [
    { role: 'system', content:
`You are the command reader for ClassMap, a seating chart app for teachers. Turn the teacher's message into actions. Reply with a JSON array only, nothing else.
Actions:
${SHAPES}
Classes: ${ctx.classes.map(c => c.name).join(', ') || '(none yet)'}
Current class: ${ctx.cls ? ctx.cls.name : '(none)'}${ctx.editing ? ' (a seating chart is open)' : ''}
Students: ${names || '(none)'}
Tags: ${ctx.cls ? classTags(ctx.cls).join(', ') : ''}
Use names exactly as the teacher wrote them. Never invent students. If the message asks for several things, return several actions in order.` },
    { role: 'user', content: 'Can you make me a new class for 5th period and put Jo and Sam in it?' },
    { role: 'assistant', content: '[{"action":"create_class","name":"5th Period","students":["Jo","Sam"]}]' },
    { role: 'user', content: 'Jo keeps talking to Sam, they need to be split up' },
    { role: 'assistant', content: '[{"action":"rules","text":"Keep Jo and Sam apart"}]' },
    { role: 'user', content: text },
  ];
}

const KNOWN = new Set(['create_class', 'add_students', 'tag', 'untag', 'rules', 'new_chart', 'open_class', 'swap', 'seat_near', 'pin', 'unpin', 'unseat', 'auto_assign', 'where', 'neighbors', 'unplaced', 'check_rules', 'list_rules', 'list_tag', 'count', 'list_students', 'list_classes', 'help', 'none']);
export function readModelCommand(reply) {
  const m = String(reply).match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!m) return null;
  let v;
  try { v = JSON.parse(m[0]); } catch { return null; }
  const arr = (Array.isArray(v) ? v : [v]).filter(c => c && KNOWN.has(c.action));
  // keep only the fields each action uses, as plain strings
  const str = x => typeof x === 'string' ? x.trim().slice(0, 80) : '';
  const list = x => (Array.isArray(x) ? x : typeof x === 'string' ? splitNames(x) : []).map(str).filter(Boolean).slice(0, 60);
  return arr.map(c => ({ action: c.action, name: str(c.name), names: list(c.names), students: list(c.students), tag: str(c.tag), a: str(c.a), b: str(c.b), text: str(c.text), query: str(c.query) })).slice(0, 6);
}

// ══ 3. Plans ══
// Each result: { kind: 'answer', html } · { kind: 'plan', items: [html], apply(), done } ·
//              { kind: 'rules', text } · { kind: 'help', query } · { kind: 'pick', text, options }
const classByName = (ctx, name) => {
  const n = String(name || '').trim().toLowerCase().replace(/^(the|my)\s+/, '').replace(/\s+class$/, '');
  return ctx.classes.find(c => c.name.toLowerCase() === n) || ctx.classes.find(c => c.name.toLowerCase().replace(/\s+/g, '') === n.replace(/\s+/g, '')) || null;
};
const tagByName = (ctx, t) => {
  const tags = ctx.cls ? classTags(ctx.cls) : [];
  const k = tagKey(String(t || '').replace(/^(an?|the)\s+/i, '').replace(/\s+(students?|kids|tag)$/i, ''));
  return tags.find(x => tagKey(x) === k) || tags.find(x => tagKey(x).replace(/s$/, '') === k.replace(/s$/, '')) || null;
};
const isPreset = t => PRESET_TAGS.some(x => tagKey(x) === tagKey(String(t || '').replace(/^(an?|the)\s+/i, '')));
const roster = ctx => ctx.editing ? state.students : (ctx.cls?.students || []);
const needClass = () => ({ kind: 'answer', html: 'Pick a class on the home page first (or say “Make a class called Period 4”).' });
const needChart = () => ({ kind: 'answer', html: 'Open a seating chart first. Seats only exist inside a chart.' });
const list = arr => arr.map(esc).join(', ').replace(/, ([^,]*)$/, ' and $1');

// One name → { student } | { pick: [students] } | { missing: name }
function who(ctx, name) {
  const idx = rosterIndex(roster(ctx));
  const { found, unclear } = findStudents(name, idx);
  if (unclear.length) return { pick: unclear[0].options, text: unclear[0].text };
  if (found.length === 1) return { student: found[0].student };
  if (found.length > 1) return { student: found[0].student };
  return { missing: name };
}
function whoAll(ctx, names) {
  const out = { students: [], missing: [], pick: null };
  names.forEach(n => {
    const r = who(ctx, n);
    if (r.student) { if (!out.students.includes(r.student)) out.students.push(r.student); }
    else if (r.pick && !out.pick) out.pick = r;
    else if (r.missing) out.missing.push(n);
  });
  return out;
}
const missingNote = m => m.length ? `<small class="ai-warn-line">Not in this class: ${m.map(x => '“' + esc(x) + '”').join(', ')}</small>` : '';

// Where things are in the open chart
function seatMap() {
  const seats = getAllSeats();
  const byId = new Map(seats.map(s => [s.seatId, s]));
  const seatOf = {};
  Object.entries(state.assignments || {}).forEach(([seat, sid]) => { if (byId.has(seat)) seatOf[sid] = byId.get(seat); });
  return { seats, byId, seatOf };
}
function tableName(seat) {
  const tables = state.layoutItems.filter(i => i.type === 'table');
  const item = state.layoutItems.find(i => i.id === seat.itemId);
  if (!item || item.type !== 'table') return 'a single desk';
  return item.label ? `“${item.label}”` : `table ${tables.indexOf(item) + 1}`;
}
function rowWord(seats, seat) {
  const d = frontInfo(seats).depth[seat.seatId];
  return d == null ? '' : d < 0.34 ? 'toward the front' : d > 0.66 ? 'toward the back' : 'in the middle';
}
const nameOf = id => (state.students.find(s => s.id === id) || {}).name || '?';

export function planCommands(cmds, ctx) {
  // several actions become one plan when they all change things
  const results = cmds.map(c => planOne(c, ctx));
  const plans = results.filter(r => r.kind === 'plan');
  if (plans.length > 1 && plans.length === results.length) {
    return [{ kind: 'plan', items: plans.flatMap(p => p.items), apply: () => plans.forEach(p => p.apply()), done: plans.map(p => p.done).join(' ') }];
  }
  return results;
}

function planOne(c, ctx) {
  const cls = ctx.cls;
  switch (c.action) {
    case 'help': return { kind: 'help', query: c.query || '' };
    case 'none': return { kind: 'none' };
    case 'rules': return cls ? { kind: 'rules', text: c.text } : needClass();

    case 'list_classes':
      return { kind: 'answer', html: ctx.classes.length ? `You have ${plural(ctx.classes.length, 'class', 'classes')}: ${ctx.classes.map(x => `<b>${esc(x.name)}</b> (${plural((x.students || []).length, 'student')})`).join(', ')}.` : 'No classes yet. Say “Make a class called Period 4”.' };

    case 'create_class': {
      const name = c.name;
      if (!name) return { kind: 'answer', html: 'What should the class be called? Try “Make a class called Period 4”.' };
      if (classByName(ctx, name)) return { kind: 'answer', html: `You already have a class called <b>${esc(name)}</b>. Say “Open ${esc(name)}”.` };
      const names = dedupe(c.students || []);
      return {
        kind: 'plan',
        items: [`Create the class <b>${esc(name)}</b>`, ...(names.length ? [`Add ${plural(names.length, 'student')}: ${list(names)}`] : [])],
        apply: () => {
          const id = 'cls_' + Date.now();
          const color = CLASS_COLORS[store.landingData.classes.length % CLASS_COLORS.length];
          const nc = { id, name, color, students: [], hardRules: [], genderMode: false };
          store.landingData.classes.push(nc);
          names.forEach(n => nc.students.push(newStudent(nc, n)));
          saveLandingData();
          if (!ctx.editing) { renderClassList(); selectClass(id); }
        },
        done: `Created ${name}${names.length ? ' with ' + plural(names.length, 'student') : ''}.${ctx.editing ? ' Go Home to see it.' : ''}`,
      };
    }

    case 'open_class': {
      const target = classByName(ctx, c.name);
      if (!target) return { kind: 'answer', html: `I can’t find a class called “${esc(c.name)}”.` };
      if (ctx.editing) return { kind: 'answer', html: `Press 🏠 Home, then pick <b>${esc(target.name)}</b>.` };
      selectClass(target.id);
      return { kind: 'answer', html: `Opened <b>${esc(target.name)}</b>.` };
    }

    case 'add_students': {
      const target = c.className ? classByName(ctx, c.className) : cls;
      if (c.className && !target) return { kind: 'answer', html: `I can’t find a class called “${esc(c.className)}”.` };
      if (!target) return needClass();
      const have = new Set((target.students || []).map(s => s.name.toLowerCase()));
      const names = dedupe(c.names || []);
      const fresh = names.filter(n => !have.has(n.toLowerCase()));
      const dup = names.filter(n => have.has(n.toLowerCase()));
      if (!fresh.length) return { kind: 'answer', html: names.length ? `${list(dup)} ${dup.length === 1 ? 'is' : 'are'} already in ${esc(target.name)}.` : 'Who should I add? Try “Add Liam Johnson, Ana Ruiz and Mia Chen”.' };
      return {
        kind: 'plan',
        items: [`Add ${plural(fresh.length, 'student')} to <b>${esc(target.name)}</b>: ${list(fresh)}`, ...(dup.length ? [`<small>Already there: ${list(dup)}</small>`] : [])],
        apply: () => {
          fresh.forEach(n => {
            const s = newStudent(target, n);
            target.students.push(s);
            if (ctx.editing && window._currentChartClassId === target.id) state.students.push({ ...s });
          });
          saveLandingData();
          refreshViews(target);
        },
        done: `Added ${plural(fresh.length, 'student')} to ${target.name}.`,
      };
    }

    case 'tag': case 'untag': {
      if (!cls) return needClass();
      const r = whoAll(ctx, c.names || []);
      if (r.pick) return { kind: 'pick', text: r.pick.text, options: r.pick.pick };
      const tag = tagByName(ctx, c.tag) || PRESET_TAGS.find(t => tagKey(t) === tagKey(c.tag)) || c.tag;
      if (!tag) return { kind: 'answer', html: 'Which tag? Try “Tag Owen and Sofia as IEP”.' };
      const add = c.action === 'tag';
      const change = r.students.filter(s => add !== hasTag(classStudent(cls, s) || s, tag));
      if (!change.length) {
        const many = r.students.length > 1;
        const msg = !r.students.length ? 'I didn’t find those students.'
          : add ? `${list(r.students.map(s => s.name))} already ${many ? 'have' : 'has'} “${esc(tag)}”.`
          : `${list(r.students.map(s => s.name))} ${many ? 'don’t' : 'doesn’t'} have “${esc(tag)}”.`;
        return { kind: 'answer', html: msg + missingNote(r.missing) };
      }
      return {
        kind: 'plan',
        items: [add ? `Tag ${list(change.map(s => s.name))} “${esc(tag)}”` : `Remove the tag “${esc(tag)}” from ${list(change.map(s => s.name))}`, ...(add ? ['<small>Tags stay off the projector and the printed chart.</small>'] : [])],
        note: missingNote(r.missing),
        apply: () => {
          const ids = new Set(change.map(s => s.id));
          const edit = s => {
            if (!ids.has(s.id)) return;
            s.tags = s.tags || [];
            if (add && !hasTag(s, tag)) s.tags.push(tag);
            if (!add) s.tags = s.tags.filter(t => tagKey(t) !== tagKey(tag));
          };
          cls.students.forEach(edit);
          if (ctx.editing && window._currentChartClassId === cls.id) state.students.forEach(edit);
          saveLandingData();
          refreshViews(cls);
        },
        done: `${add ? 'Tagged' : 'Untagged'} ${plural(change.length, 'student')}.`,
      };
    }

    case 'new_chart':
      if (!cls) return needClass();
      if (ctx.editing) return { kind: 'answer', html: 'Press 🏠 Home, then <b>+ New Chart</b>. (Your chart is saved.)' };
      return { kind: 'plan', items: [`Start a new seating chart for <b>${esc(cls.name)}</b>`], apply: () => createNewChart(), done: 'New chart started.' };

    case 'count': {
      if (!cls) return needClass();
      const n = roster(ctx).length;
      let extra = '';
      if (ctx.editing) {
        const { seats, seatOf } = seatMap();
        const seated = Object.keys(seatOf).length;
        extra = ` ${seated} ${seated === 1 ? 'is' : 'are'} seated; the room has ${plural(seats.length, 'seat')}.`;
      }
      return { kind: 'answer', html: `<b>${esc(cls.name)}</b> has ${plural(n, 'student')}.${extra}` };
    }

    case 'list_students': {
      if (!cls) return needClass();
      const ss = [...roster(ctx)].sort((a, b) => a.name.localeCompare(b.name));
      return { kind: 'answer', html: ss.length ? `${esc(cls.name)} (${ss.length}): ${list(ss.map(s => s.name))}.` : `${esc(cls.name)} has no students yet. Say “Add Liam, Ana and Mia”.` };
    }

    case 'list_tag': {
      if (!cls) return needClass();
      const tag = tagByName(ctx, c.tag);
      if (!tag) return { kind: 'answer', html: `Nobody in ${esc(cls.name)} is tagged “${esc(c.tag)}”.${classTags(cls).length ? ' Tags in this class: ' + classTags(cls).map(t => '“' + esc(t) + '”').join(', ') + '.' : ''}` };
      const ss = roster(ctx).filter(s => hasTag(s, tag));
      return { kind: 'answer', html: ss.length ? `${plural(ss.length, 'student')} tagged “${esc(tag)}”: ${list(ss.map(s => s.name))}.` : `Nobody is tagged “${esc(tag)}”.` };
    }

    case 'list_rules': {
      if (!cls) return needClass();
      const rules = ctx.editing ? [...(state.hardRules || []), ...(state.tempRules || []).map(r => ({ ...r, _temp: true }))] : (cls.hardRules || []);
      if (!rules.length) return { kind: 'answer', html: `${esc(cls.name)} has no rules yet. Try “Keep Liam and Owen apart”.` };
      return { kind: 'answer', html: `<b>Rules for ${esc(cls.name)}:</b><ul>${rules.map(r => `<li>${esc(describe(r))}${r._temp ? ' <small>(this chart only)</small>' : ''}</li>`).join('')}</ul>` };
    }

    // ── about the open chart ──
    case 'where': case 'neighbors': {
      if (!cls) return needClass();
      if (!ctx.editing) return needChart();
      const r = who(ctx, c.name);
      if (r.pick) return { kind: 'pick', text: r.text, options: r.pick };
      if (!r.student) return { kind: 'answer', html: `“${esc(c.name)}” isn’t in ${esc(cls.name)}.` };
      const s = r.student;
      const { seats, seatOf } = seatMap();
      const seat = seatOf[s.id];
      if (!seat) return { kind: 'answer', html: `<b>${esc(s.name)}</b> doesn’t have a seat yet.` };
      const mates = Object.entries(seatOf).filter(([id, x]) => id !== s.id && seatsArePartners(seat, x)).map(([id]) => nameOf(id));
      const near = Object.entries(seatOf).filter(([id, x]) => id !== s.id && !mates.includes(nameOf(id)) && seatsAreNeighbors(seat, x)).map(([id]) => nameOf(id));
      const pinned = (state.pins || []).includes(s.id) ? ' 📌 Pinned.' : '';
      const where = `<b>${esc(s.name)}</b> sits at ${esc(tableName(seat))}${rowWord(seats, seat) ? ', ' + rowWord(seats, seat) : ''}.`;
      const group = mates.length ? ` In the same group: ${list(mates)}.` : ' Nobody else is in that group.';
      const also = near.length ? ` Also at the table: ${list(near)}.` : '';
      return { kind: 'answer', html: (c.action === 'where' ? where + group : (mates.length ? `Next to <b>${esc(s.name)}</b> (same group): ${list(mates)}.` : `Nobody shares a group with <b>${esc(s.name)}</b>.`)) + also + pinned };
    }

    case 'unplaced': {
      if (!cls) return needClass();
      if (!ctx.editing) return needChart();
      const { seats, seatOf } = seatMap();
      const left = state.students.filter(s => !seatOf[s.id]);
      const free = seats.length - Object.keys(seatOf).length;
      return { kind: 'answer', html: left.length ? `${plural(left.length, 'student')} without a seat: ${list(left.map(s => s.name))}. ${plural(free, 'empty seat')}.` : `Everyone has a seat. ${plural(free, 'empty seat')}.` };
    }

    case 'check_rules': {
      if (!cls) return needClass();
      if (!ctx.editing) return needChart();
      const { seats } = seatMap();
      const msgs = [...new Set(evaluateRules(state.assignments, seats, getResolvedRules()).map(violationMessage))];
      if (!getResolvedRules().length) return { kind: 'answer', html: 'This class has no rules to check.' };
      return { kind: 'answer', html: msgs.length ? `<b>${plural(msgs.length, 'rule')} not met:</b><ul>${msgs.map(m => `<li>${esc(m.replace(/^\S+\s+(Rule:\s*)?/, ''))}</li>`).join('')}</ul>Auto-assign can usually fix these.` : '✓ Every rule is met in this chart.' };
    }

    // ── changes to the open chart ──
    case 'swap': {
      if (!ctx.editing) return needChart();
      const a = who(ctx, c.a), b = who(ctx, c.b);
      const pick = [a, b].find(x => x.pick);
      if (pick) return { kind: 'pick', text: pick.text, options: pick.pick };
      const miss = [a, b].filter(x => x.missing).map(x => x.missing);
      if (miss.length) return { kind: 'answer', html: missingNote(miss) };
      const { seatOf } = seatMap();
      const sa = seatOf[a.student.id], sb = seatOf[b.student.id];
      if (!sa && !sb) return { kind: 'answer', html: `Neither ${esc(a.student.name)} nor ${esc(b.student.name)} has a seat yet.` };
      const [from, to] = sb ? [a.student, b.student] : [b.student, a.student];
      const target = seatOf[to.id];
      const items = sa && sb ? [`Swap seats: <b>${esc(a.student.name)}</b> ↔ <b>${esc(b.student.name)}</b>`]
        : [`Move <b>${esc(from.name)}</b> into ${esc(to.name)}’s seat`, `${esc(to.name)} goes to Unplaced`];
      return { kind: 'plan', items, note: pinNote([a.student, b.student]), apply: () => placeStudent(from.id, target.seatId), done: 'Swapped.' };
    }

    case 'seat_near': {
      if (!ctx.editing) return needChart();
      const a = who(ctx, c.a), b = who(ctx, c.b);
      const pick = [a, b].find(x => x.pick);
      if (pick) return { kind: 'pick', text: pick.text, options: pick.pick };
      const miss = [a, b].filter(x => x.missing).map(x => x.missing);
      if (miss.length) return { kind: 'answer', html: missingNote(miss) };
      const { seats, seatOf } = seatMap();
      const sb = seatOf[b.student.id], sa = seatOf[a.student.id];
      if (!sb) return { kind: 'answer', html: `${esc(b.student.name)} doesn’t have a seat yet.` };
      if (sa && seatsArePartners(sa, sb)) return { kind: 'answer', html: `${esc(a.student.name)} already sits next to ${esc(b.student.name)}.` };
      const occ = Object.fromEntries(Object.entries(state.assignments || {}));
      const pins = new Set(state.pins || []);
      const dist = s => Math.hypot(s.x - sb.x, s.y - sb.y);
      const cands = seats.filter(s => s.seatId !== sb.seatId && (seatsArePartners(s, sb) || seatsAreNeighbors(s, sb)))
        .filter(s => !occ[s.seatId] || (occ[s.seatId] !== a.student.id && !pins.has(occ[s.seatId])))
        .sort((x, y) => (seatsArePartners(y, sb) - seatsArePartners(x, sb)) || (!!occ[x.seatId] - !!occ[y.seatId]) || dist(x) - dist(y));
      const t = cands[0];
      if (!t) return { kind: 'answer', html: `There’s no free seat next to ${esc(b.student.name)} (the seats around them are pinned).` };
      const other = occ[t.seatId] ? nameOf(occ[t.seatId]) : '';
      return {
        kind: 'plan',
        items: [`Move <b>${esc(a.student.name)}</b> next to ${esc(b.student.name)} (${esc(tableName(t))})`,
          ...(other ? [sa ? `${esc(other)} takes ${esc(a.student.name)}’s old seat` : `${esc(other)} goes to Unplaced`] : [])],
        note: pinNote([a.student]),
        apply: () => placeStudent(a.student.id, t.seatId),
        done: 'Moved.',
      };
    }

    case 'pin': case 'unpin': case 'unseat': {
      if (!ctx.editing) return needChart();
      const r = whoAll(ctx, c.names || []);
      if (r.pick) return { kind: 'pick', text: r.pick.text, options: r.pick.pick };
      const { seatOf } = seatMap();
      const pins = new Set(state.pins || []);
      const subj = r.students.filter(s => c.action === 'unpin' ? pins.has(s.id) : !!seatOf[s.id] && (c.action === 'unseat' || !pins.has(s.id)));
      if (!subj.length) return { kind: 'answer', html: (r.students.length ? { pin: 'Nothing to pin: they’re already pinned or don’t have a seat.', unpin: 'They aren’t pinned.', unseat: 'They don’t have seats.' }[c.action] : 'I didn’t find those students.') + missingNote(r.missing) };
      const verb = { pin: 'Pin', unpin: 'Unpin', unseat: 'Take out of their seat' }[c.action];
      return {
        kind: 'plan',
        items: [`${verb}: ${list(subj.map(s => s.name))}`, ...(c.action === 'pin' ? ['<small>Pinned students stay put when you auto-assign.</small>'] : [])],
        note: missingNote(r.missing),
        apply: () => {
          if (c.action === 'unseat') { subj.forEach(s => { const seat = seatMap().seatOf[s.id]; if (seat) delete state.assignments[seat.seatId]; }); }
          const p = new Set(state.pins || []);
          subj.forEach(s => { if (c.action === 'pin') p.add(s.id); else p.delete(s.id); });
          state.pins = [...p];
          markDirty(); renderAssignPanel(); renderRoster();
        },
        done: { pin: 'Pinned.', unpin: 'Unpinned.', unseat: 'Moved to Unplaced.' }[c.action],
      };
    }

    case 'auto_assign': {
      if (!cls) return needClass();
      if (!ctx.editing) return needChart();
      const pinned = (state.pins || []).length;
      return {
        kind: 'plan',
        items: ['Auto-assign seats for everyone, following your rules and tags', ...(pinned ? [`Keep ${plural(pinned, 'pinned student')} where they are`] : [])],
        apply: () => autoAssign(),
        done: 'Seats assigned.',
        quiet: true,   // auto-assign shows its own summary
      };
    }
  }
  return { kind: 'none' };
}

function pinNote(students) {
  const p = students.filter(s => (state.pins || []).includes(s.id));
  return p.length ? `<small class="ai-warn-line">${list(p.map(s => s.name))} ${p.length === 1 ? 'is' : 'are'} pinned; moving them by hand is fine.</small>` : '';
}
function dedupe(names) {
  const seen = new Set();
  return names.map(n => n.replace(/\s+/g, ' ').trim()).filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}
function newStudent(cls, name) {
  return { id: 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name, gender: guessGroupForClass(cls, name) || null };
}
const classStudent = (cls, s) => cls.students.find(x => x.id === s.id);
function refreshViews(cls) {
  try {
    if (editorOpen()) { renderRoster(); renderAssignPanel(); }
    else if (store.activeClassId === cls.id) { renderClassList(); renderLdStudentCols(cls); renderLdRules(); }
    else renderClassList();
  } catch { /* not on screen */ }
}

// ── Undo for any plan: a snapshot of the classes and the open chart ──
export function snapshot() {
  return {
    data: structuredClone(store.landingData),
    active: store.activeClassId,
    chart: editorOpen() ? structuredClone({ assignments: state.assignments, pins: state.pins, students: state.students, hardRules: state.hardRules, tempRules: state.tempRules }) : null,
    chartClass: window._currentChartClassId,
  };
}
export function restore(snap) {
  store.landingData = snap.data;
  if (snap.chart && editorOpen() && window._currentChartClassId === snap.chartClass) {
    Object.assign(state, structuredClone(snap.chart));
    markDirty();
    try { renderAssignPanel(); renderRoster(); } catch { /* not on screen */ }
  }
  saveLandingData();
  if (!editorOpen()) {
    try {
      renderClassList();
      const id = store.landingData.classes.some(c => c.id === snap.active) ? snap.active : store.landingData.classes[0]?.id;
      if (id) selectClass(id);
    } catch { /* not on screen */ }
  }
  showToast('Undone');
}
