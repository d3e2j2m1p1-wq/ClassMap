import { store } from '../core/store.js';
import { DEFAULT_GROUPS, GROUP_BOYS_ID, GROUP_GIRLS_ID, defaultGroups, migrateGroupKinds } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { askPersistentStorage, idbAvailable, idbGet, idbSet } from './db.js';

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════

// ════════════════════════════════════════════════
//  LANDING PAGE & CLASS MANAGEMENT
// ════════════════════════════════════════════════

export const STORAGE_KEY = 'classmap_data';
export const CLASS_COLORS = ['#4f8ef7','#34d07e','#f7567c','#f5a623','#a78bfa','#38bdf8','#fb923c','#4ade80'];
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ═══════════════════════════════════════════════════════════════
//  LANDING DATA  —  classes own roster + hardRules; charts own layout + assignments
// ═══════════════════════════════════════════════════════════════
// Schema:
//   landingData.classes[]  = { id, name, color, students[], hardRules[], genderMode }
//   landingData.charts[]   = { id, classId, name, savedAt, data: { layoutItems, assignments, tempRules, sessionNotes, layoutImg, nextId } }

store.landingData = { classes: [], charts: [] };
store.activeClassId = null;
store.activeLandingTab = 'charts';

// ── simple landing typeaheads for rule adding ──
export let ldTaA = null, ldTaB = null;

// "2026-10-09" in local time (toISOString() is UTC, which shows tomorrow's date on evenings in California)
export function localDateStr(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Where the data lives ──
// IndexedDB (key 'landingData'). Data from older versions (localStorage 'classmap_data') is moved
// over the first time. If IndexedDB isn't available at all, localStorage is used as before.
let _useIdb = false;
let _initialized = false;

// Called once at start-up, before anything is shown
export async function initStorage() {
  _initialized = true;
  if (!idbAvailable()) { loadFromLocalStorage(); return; }
  try {
    const saved = await idbGet('landingData');
    _useIdb = true;
    if (saved) {
      store.landingData = saved;
    } else {
      loadFromLocalStorage();                       // first run of this version: move old data over
      if (store.landingData.classes.length || store.landingData.charts.length) {
        await idbSet('landingData', store.landingData);
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('IndexedDB unavailable, using localStorage', e);
    _useIdb = false;
    loadFromLocalStorage();
  }
  normalizeLandingData();
  askPersistentStorage();
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) store.landingData = JSON.parse(raw);
  } catch(e) {}
  normalizeLandingData();
}

export function loadLandingData() {
  if (!_initialized) loadFromLocalStorage();   // (initStorage normally ran first)
  normalizeLandingData();
}

// Fill in missing fields and migrate data from older versions (also used for restored backups)
export function normalizeLandingData() {
  if (!store.landingData || typeof store.landingData !== 'object' || Array.isArray(store.landingData)) store.landingData = { classes: [], charts: [] };
  if (!Array.isArray(store.landingData.classes)) store.landingData.classes = [];
  if (!Array.isArray(store.landingData.charts)) store.landingData.charts = [];
  // Each chart has its own date (set by the teacher), separate from savedAt (last autosave)
  store.landingData.charts.forEach(ch => { if (!/^\d{4}-\d{2}-\d{2}$/.test(ch.date || '')) ch.date = localDateStr(ch.savedAt || Date.now()); });
  // Migrate old charts that have students/hardRules inside data → move to class
  store.landingData.charts.forEach(ch => {
    if (!ch.data) return;
    const cls = store.landingData.classes.find(c => c.id === ch.classId);
    if (!cls) return;
    if (!cls.students && ch.data.students) { cls.students = ch.data.students; cls.genderMode = ch.data.genderMode || false; }
    if (!cls.hardRules && ch.data.hardRules) cls.hardRules = ch.data.hardRules;
  });
  // Migrate roster/group data from older versions
  store.landingData.classes.forEach(cls => {
    if (!cls.students) cls.students = [];
    if (!cls.hardRules) cls.hardRules = [];
    if (cls.genderMode === undefined) cls.genderMode = false;

    // Old 'boy'/'girl'/'none' strings → stable group ids
    cls.students.forEach(s => {
      if (s.gender === 'boy') s.gender = GROUP_BOYS_ID;
      else if (s.gender === 'girl') s.gender = GROUP_GIRLS_ID;
      else if (s.gender === 'none' || s.gender === '') s.gender = null;
    });

    // Untouched unnamed white groups from the previous version
    if (cls.genderGroups && cls.genderGroups.length === 2 &&
        cls.genderGroups.every(g => !g.label && String(g.color || '').toLowerCase() === '#ffffff')) {
      const used = cls.students.some(s => cls.genderGroups.some(g => g.id === s.gender));
      if (!used) {
        cls.genderGroups = defaultGroups();
      } else {
        cls.genderGroups[0].label = 'Group 1'; cls.genderGroups[0].color = '#4f8ef7';
        cls.genderGroups[1].label = 'Group 2'; cls.genderGroups[1].color = '#f7567c';
      }
    }

    // Students pointing at Boys/Girls but the class has no such group → add it back
    const needs = [GROUP_BOYS_ID, GROUP_GIRLS_ID].filter(id => cls.students.some(s => s.gender === id));
    if (needs.length) {
      if (!cls.genderGroups) cls.genderGroups = [];
      needs.forEach(id => {
        if (!cls.genderGroups.some(g => g.id === id)) cls.genderGroups.push({ ...DEFAULT_GROUPS.find(g => g.id === id) });
      });
    }
    migrateGroupKinds(cls.genderGroups);
  });
}

// Save everything. Writes are queued (one at a time, newest data wins) and the in-memory copy
// stays the source of truth, so a failed write never loses what's on screen.
// Returns false if the last write failed. { fromSync: true } = data just came from Google Drive.
let _writing = null, _again = false, _lastFailed = false;
export const saveListeners = [];

export function saveLandingData({ fromSync = false } = {}) {
  if (!fromSync) store.landingData.updatedAt = Date.now();
  if (_useIdb) queueWrite();
  else {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store.landingData)); _lastFailed = false; }
    catch (e) { _lastFailed = true; storageFullToast(); }
  }
  if (!fromSync) saveListeners.forEach(fn => { try { fn(); } catch (e) {} });
  return !_lastFailed;
}

function queueWrite() {
  if (_writing) { _again = true; return; }
  _writing = idbSet('landingData', store.landingData)
    .then(() => { _lastFailed = false; })
    .catch(e => { console.error(e); _lastFailed = true; storageFullToast(); })
    .finally(() => {
      _writing = null;
      if (_again) { _again = false; queueWrite(); }
    });
}

// Resolves when every queued write has finished
export async function whenSaved() {
  while (_writing) await _writing;
}

// What's actually stored (for tests and checks)
export async function readStored() {
  await whenSaved();
  if (_useIdb) return idbGet('landingData');
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
}

function storageFullToast() {
  showToast('⚠️ Not saved — the browser refused to store more. Use "Back up everything" on the home page, then delete old charts or classroom photos.', 8000);
}

// Deleted classes/charts are remembered for a while, so syncing with another device
// doesn't bring them back. Undo un-deletes by giving the item a newer timestamp.
export function markDeleted(ids) {
  const at = Date.now();
  const list = store.landingData.deleted || (store.landingData.deleted = []);
  ids.forEach(id => { if (!list.some(d => d.id === id)) list.push({ id, at }); });
}
export function unmarkDeleted(ids) {
  store.landingData.deleted = (store.landingData.deleted || []).filter(d => !ids.includes(d.id));
}
