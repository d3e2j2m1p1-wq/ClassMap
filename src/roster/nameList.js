import { groupOfKind } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { ensureGenderGroups } from '../landing/roster.js';
import { GENDER_NAMES, firstNameOf } from './builtinNames.js';

// ═══════════════════════════════════════════════
//  NAME LIST — learns from the students you sort by hand
//  votes: { studentId: [normalisedFirstName, 'boy'|'girl', displayName] }
//  pins:  { normalisedFirstName: 'boy'|'girl'|'ask' }
//  Only first names are stored. Counts are always derived from the votes,
//  so moving one student between groups replaces their vote (never doubles it).
// ═══════════════════════════════════════════════
export const NAMELIST_KEY = 'classmap_names';

export function loadNameListFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(NAMELIST_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      return {
        v: 1,
        votes: (raw.votes && typeof raw.votes === 'object') ? raw.votes : {},
        pins:  (raw.pins  && typeof raw.pins  === 'object') ? raw.pins  : {},
      };
    }
  } catch (e) {}
  return { v: 1, votes: {}, pins: {} };
}
export let nameList = loadNameListFromStorage();
export let _nameIdx = null;

export function saveNameList() {
  _nameIdx = null;
  try { localStorage.setItem(NAMELIST_KEY, JSON.stringify(nameList)); return true; }
  catch (e) { showToast('Could not save the name list (storage full)'); return false; }
}

// "José" and "Jose" are the same name; punctuation/case ignored
export function normalizeName(n) {
  return String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}
export function capName(n) { n = String(n || ''); return n.charAt(0).toUpperCase() + n.slice(1); }

export function nameIdx() {
  if (_nameIdx) return _nameIdx;
  const idx = {};
  Object.values(nameList.votes).forEach(v => {
    if (!Array.isArray(v) || (v[1] !== 'boy' && v[1] !== 'girl')) return;
    (idx[v[0]] = idx[v[0]] || { boy: 0, girl: 0 })[v[1]]++;
  });
  return (_nameIdx = idx);
}

export function builtinKind(n) {
  const b = GENDER_NAMES.boy.has(n), g = GENDER_NAMES.girl.has(n);
  return b && g ? 'both' : b ? 'boy' : g ? 'girl' : null;
}

// What does the software know about a first name?
//   kind: 'boys' | 'girls' | null      flagged: seen as both (or pinned "ask")
// The built-in list counts as ONE weak vote, so a single contradiction from you flags the name.
export function nameStatus(first) {
  const n = normalizeName(first);
  const st = { name: n, kind: null, flagged: false, boy: 0, girl: 0, learnedBoy: 0, learnedGirl: 0, builtin: null, pin: null };
  if (!n) return st;
  const c = nameIdx()[n] || { boy: 0, girl: 0 };
  st.builtin = builtinKind(n);
  st.learnedBoy = c.boy; st.learnedGirl = c.girl;
  st.boy  = c.boy  + (st.builtin === 'boy'  || st.builtin === 'both' ? 1 : 0);
  st.girl = c.girl + (st.builtin === 'girl' || st.builtin === 'both' ? 1 : 0);
  st.pin = nameList.pins[n] || null;
  if (st.pin === 'boy') st.kind = 'boys';
  else if (st.pin === 'girl') st.kind = 'girls';
  else if (st.pin === 'ask') st.flagged = true;
  else if (st.boy && st.girl) st.flagged = true;
  else if (st.boy) st.kind = 'boys';
  else if (st.girl) st.kind = 'girls';
  return st;
}

// Group a name would be sorted into for this class (null if unknown / flagged / no such group)
export function guessGroupForClass(cls, name) {
  if (!cls || !cls.genderMode) return null;
  const st = nameStatus(firstNameOf(name));
  if (!st.kind) return null;
  const g = groupOfKind(cls, st.kind);
  return g ? g.id : null;
}

// A student was placed by hand into `group` (null = Ungrouped). Boys/Girls groups teach the
// list; Ungrouped/Custom retract whatever this student had taught.
export function recordPlacement(student, group) {
  const first = firstNameOf(student.name);
  const n = normalizeName(first);
  const prev = nameList.votes[student.id];
  const kind = (group && n) ? (group.kind === 'boys' ? 'boy' : group.kind === 'girls' ? 'girl' : null) : null;
  if (!kind) {
    if (prev) { delete nameList.votes[student.id]; saveNameList(); return true; }
    return false;
  }
  if (prev && prev[0] === n && prev[1] === kind) return false;
  nameList.votes[student.id] = [n, kind, first];
  saveNameList();
  return true;
}

// Sort other ungrouped students in this class who share a first name that now resolves
export function sortSameName(cls, norm, exceptId) {
  if (!cls.genderMode) return 0;
  let moved = 0;
  cls.students.forEach(s => {
    if (s.id === exceptId) return;
    if (s.gender && cls.genderGroups.some(g => g.id === s.gender)) return;
    if (normalizeName(firstNameOf(s.name)) !== norm) return;
    const gid = guessGroupForClass(cls, s.name);
    if (gid) { s.gender = gid; moved++; }
  });
  return moved;
}

// Call after a manual placement. Returns a message to toast (or '').
export function afterManualPlacement(cls, student, group, before) {
  const first = firstNameOf(student.name);
  const after = nameStatus(first);
  if (after.flagged && !before.flagged) {
    return `⚑ ${first} is now flagged — sorted as both boy and girl, so it will be left for you`;
  }
  if (after.kind && after.kind !== before.kind) {
    const n = sortSameName(cls, after.name, student.id);
    return `Learned: ${first} → ${group.label || (group.kind === 'boys' ? 'Boys' : 'Girls')}` + (n ? `, sorted ${n} more` : '');
  }
  return '';
}

// Put every ungrouped student into Boys/Girls when the name is known. Flagged names are left alone.
export function autoSortClass(cls, onlyUngrouped = true) {
  ensureGenderGroups(cls);
  let moved = 0, flagged = 0;
  cls.students.forEach(s => {
    const hasValid = s.gender && cls.genderGroups.some(g => g.id === s.gender);
    if (onlyUngrouped && hasValid) return;
    const st = nameStatus(firstNameOf(s.name));
    const g = st.kind ? groupOfKind(cls, st.kind) : null;
    if (g) { if (s.gender !== g.id) { s.gender = g.id; moved++; } }
    else if (st.flagged) flagged++;
  });
  return { moved, flagged };
}

export function classFlaggedCount(cls) {
  return cls.students.filter(s =>
    !(s.gender && (cls.genderGroups || []).some(g => g.id === s.gender)) &&
    nameStatus(firstNameOf(s.name)).flagged).length;
}

// Merge another name list (backup / other computer). Votes are keyed by student id, so
// merging the same file twice never double-counts.
export function mergeNameList(other) {
  if (!other || typeof other !== 'object') return 0;
  let added = 0;
  const votes = (other.votes && typeof other.votes === 'object') ? other.votes : {};
  Object.keys(votes).forEach(sid => {
    const v = votes[sid];
    if (nameList.votes[sid]) return;
    if (Array.isArray(v) && typeof v[0] === 'string' && (v[1] === 'boy' || v[1] === 'girl')) {
      nameList.votes[sid] = [normalizeName(v[0]), v[1], String(v[2] || v[0]).slice(0, 40)];
      added++;
    }
  });
  const pins = (other.pins && typeof other.pins === 'object') ? other.pins : {};
  Object.keys(pins).forEach(n => {
    if (!nameList.pins[n] && ['boy','girl','ask'].includes(pins[n])) { nameList.pins[n] = pins[n]; added++; }
  });
  if (added) saveNameList();
  return added;
}
