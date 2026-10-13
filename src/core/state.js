import { store } from './store.js';

// ═══════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════
export let state = {
  students: [],        // { id, name, gender: 'boy'|'girl'|'none' }
  hardRules: [],       // { id, type, studA, studB? }
  tempRules: [],       // { id, type, studA, studB? }
  sessionNotes: '',
  genderMode: false,
  layoutItems: [],     // { id, type, x, y, w?, h?, seats?, label? }
  assignments: {},     // { seatId: studentId }
  tableDefaults: { seats: 4, groups: 1 },   // what the Table tool places (per chart)
  pins: [],            // student ids that stay in their seat when auto-assigning (per chart)
};

store.nextId = 1;
export const uid = () => String(store.nextId++);

// Escape text before putting it into innerHTML (names can contain < > & ")
export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Default groups. Stable ids so auto-sort and old "boy"/"girl" data can find them.
export const GROUP_BOYS_ID = 'g_boys', GROUP_GIRLS_ID = 'g_girls';
// Every group has a kind: 'boys' | 'girls' | 'custom'.
// Only Boys/Girls groups teach the name list and receive auto-sorted students.
export const DEFAULT_GROUPS = [
  { id: GROUP_BOYS_ID,  label: 'Boys',  color: '#4f8ef7', kind: 'boys' },
  { id: GROUP_GIRLS_ID, label: 'Girls', color: '#f7567c', kind: 'girls' },
];
export const KIND_DEFAULTS = { boys: DEFAULT_GROUPS[0], girls: DEFAULT_GROUPS[1] };
export const CUSTOM_COLORS = ['#f59e0b','#10b981','#8b5cf6','#06b6d4','#f97316','#ef4444'];
export const defaultGroups = () => DEFAULT_GROUPS.map(g => ({ ...g }));

export function groupOfKind(cls, kind) {
  return ((cls && cls.genderGroups) || []).find(g => g.kind === kind) || null;
}

// Give old groups a kind; a class can have only one Boys and one Girls group.
export function migrateGroupKinds(groups) {
  const seen = {};
  (groups || []).forEach(g => {
    if (!['boys','girls','custom'].includes(g.kind)) {
      g.kind = g.id === GROUP_BOYS_ID ? 'boys' : g.id === GROUP_GIRLS_ID ? 'girls' : 'custom';
    }
    if (g.kind !== 'custom') {
      if (seen[g.kind]) g.kind = 'custom'; else seen[g.kind] = true;
    }
  });
}

export function getGenderGroups() {
  const cls = store.landingData.classes.find(c => c.id === (window._currentChartClassId || store.activeClassId));
  return (cls && cls.genderGroups && cls.genderGroups.length) ? cls.genderGroups : DEFAULT_GROUPS;
}

export function getGroupById(gid) {
  return getGenderGroups().find(g => g.id === gid) || null;
}

export const NEUTRAL_COLOR = '#64748b';
export function groupColor(student) {
  if (!student || !student.gender || !state.genderMode) return NEUTRAL_COLOR;
  const g = getGroupById(student.gender);
  return g ? g.color : NEUTRAL_COLOR;
}
export const AVATAR_COLORS_NONE = ['#4f46e5','#6366f1','#7c3aed','#5b21b6'];

export function avatarColor(s) {
  return groupColor(s);
}

export function initials(name) {
  return name.trim().split(/\s+/).map(w=>w[0]).join('').substring(0,2).toUpperCase();
}
