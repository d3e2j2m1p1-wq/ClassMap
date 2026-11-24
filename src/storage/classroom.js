// ═══════════════════════════════════════════════
//  IMPORT FROM GOOGLE CLASSROOM
//  Reads the teacher's own Classroom class lists (course names and student names only) straight
//  into this browser, using Google sign-in. Nothing goes through ClassMap's server, the sign-in
//  isn't stored, and nothing is written back to Classroom. Shown only when Google sign-in is set up
//  (VITE_GOOGLE_CLIENT_ID); the Classroom permissions need to be added to the Google project too.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { plural, showToast, undoToast } from '../core/ui.js';
import { GOOGLE_CLIENT_ID } from '../config.js';
import { CLASS_COLORS, saveLandingData } from './landingData.js';
import { guessGroupForClass } from '../roster/nameList.js';
import { renderClassList, selectClass } from '../landing/landing.js';

const SCOPES = 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.rosters.readonly';
const API = 'https://classroom.googleapis.com/v1';
export const classroomEnabled = () => !!GOOGLE_CLIENT_ID;

let token = null, tokenExpires = 0, client = null, waiter = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}
// Must start from a click (browsers block the Google pop-up otherwise)
async function signIn() {
  if (token && Date.now() < tokenExpires - 60000) return;
  await loadGis();
  client ||= window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: r => { const w = waiter; waiter = null; if (w) r.error ? w.reject(new Error(r.error)) : w.resolve(r); },
    error_callback: e => { const w = waiter; waiter = null; if (w) w.reject(new Error(e.type || 'popup_closed')); },
  });
  const r = await new Promise((resolve, reject) => { waiter = { resolve, reject }; client.requestAccessToken({ prompt: '' }); });
  token = r.access_token;
  tokenExpires = Date.now() + (Number(r.expires_in) || 3600) * 1000;
}
async function get(path) {
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401) { token = null; throw new Error('expired'); }
  if (res.status === 403) throw new Error('forbidden');
  if (!res.ok) throw new Error('Google Classroom error ' + res.status);
  return res.json();
}
async function all(path, key) {
  const out = [];
  let page = '';
  do {
    const r = await get(`${path}${path.includes('?') ? '&' : '?'}pageSize=100${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
    out.push(...(r[key] || []));
    page = r.nextPageToken || '';
  } while (page && out.length < 2000);
  return out;
}
export const listCourses = () => all('/courses?teacherId=me&courseStates=ACTIVE', 'courses');
export async function listStudents(courseId) {
  const s = await all(`/courses/${encodeURIComponent(courseId)}/students`, 'students');
  return s.map(x => x.profile?.name || {}).filter(n => n.fullName || n.givenName)
    .map(n => ({ first: (n.givenName || n.fullName.split(' ')[0]).trim(), last: (n.familyName || n.fullName.split(' ').slice(1).join(' ')).trim() }));
}

// ── The dialog ──
let opts = { names: 'full' };
const courseName = c => [c.name, c.section].filter(Boolean).join(' — ');
const shown = (p, style = opts.names) => style === 'initial' && p.last ? `${p.first} ${p.last[0]}.` : `${p.first} ${p.last}`.trim();

export async function openClassroomImport() {
  if (!classroomEnabled()) return;
  const d = dialog(`
    <div class="ar-head"><div><h2>Import from Google Classroom</h2>
      <p>Your Classroom class lists come straight into this browser: class names and student names only. Nothing is sent to ClassMap, and nothing changes in Classroom.</p></div>
      <button type="button" class="ar-x" aria-label="Close">✕</button></div>
    <div class="gc-body"><p class="gc-status">Connecting to Google…</p></div>`);
  try {
    await signIn();
    d.body.innerHTML = '<p class="gc-status">Loading your classes…</p>';
    const courses = await listCourses();
    if (!courses.length) { d.body.innerHTML = '<p class="gc-status">No active classes found where you’re a teacher.</p>'; return; }
    const rosters = {};
    await Promise.all(courses.map(async c => { try { rosters[c.id] = await listStudents(c.id); } catch { rosters[c.id] = null; } }));
    showCourses(d, courses, rosters);
  } catch (e) {
    d.body.innerHTML = `<p class="gc-status warn">${esc(
      e.message === 'forbidden' ? 'Google didn’t allow ClassMap to read Classroom. Your school may need to allow it, or the ClassMap Google project needs the Classroom permissions (see GOOGLE_SETUP.md).'
      : /popup|access_denied/i.test(e.message) ? 'Google sign-in was closed or declined. Nothing was imported.'
      : 'Couldn’t reach Google Classroom. Check the internet connection and try again.')}</p>`;
  }
}

function dialog(html) {
  document.querySelector('.gc-backdrop')?.remove();
  const bd = document.createElement('div');
  bd.className = 'ar-backdrop gc-backdrop';
  bd.innerHTML = `<div class="ar-dialog gc-dialog" role="dialog" aria-modal="true" aria-label="Import from Google Classroom">${html}</div>`;
  document.body.appendChild(bd);
  const close = () => { bd.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('.ar-x').onclick = close;
  return { el: bd, body: bd.querySelector('.gc-body'), close };
}

function showCourses(d, courses, rosters) {
  const existing = new Map((store.landingData.classes || []).map(c => [c.name.trim().toLowerCase(), c]));
  d.body.innerHTML = `
    <div class="gc-list">${courses.map(c => {
      const r = rosters[c.id];
      const have = existing.get(courseName(c).toLowerCase());
      return `<label class="gc-course"><input type="checkbox" data-id="${esc(c.id)}" ${r && r.length ? 'checked' : 'disabled'}>
        <span><b>${esc(courseName(c))}</b><small>${r == null ? 'Couldn’t read the class list' : plural(r.length, 'student')}${have ? ' · already in ClassMap: adds anyone new' : ''}</small></span></label>`;
    }).join('')}</div>
    <div class="gc-opts">
      <span>Names:</span>
      <label><input type="radio" name="gcNames" value="full" ${opts.names === 'full' ? 'checked' : ''}> First and last</label>
      <label><input type="radio" name="gcNames" value="initial" ${opts.names === 'initial' ? 'checked' : ''}> First name + last initial</label>
    </div>
    <div class="ar-actions"><button type="button" class="rc-btn gc-cancel">Cancel</button><button type="button" class="rc-btn primary gc-next">Next</button></div>`;
  d.body.querySelectorAll('input[name=gcNames]').forEach(r => r.onchange = () => { opts.names = r.value; });
  d.body.querySelector('.gc-cancel').onclick = d.close;
  d.body.querySelector('.gc-next').onclick = () => {
    const picked = courses.filter(c => d.body.querySelector(`input[data-id="${CSS.escape(c.id)}"]`)?.checked);
    if (!picked.length) { showToast('Pick at least one class'); return; }
    showPlan(d, picked, rosters, existing);
  };
}

// "Here's what I'll do" — then Apply
function showPlan(d, picked, rosters, existing) {
  const plan = picked.map(c => {
    const names = [...new Set(rosters[c.id].map(p => shown(p)))].sort((a, b) => a.localeCompare(b));
    const cls = existing.get(courseName(c).toLowerCase());
    if (!cls) return { name: courseName(c), names, add: names, cls: null };
    const have = new Set(cls.students.map(s => s.name.toLowerCase()));
    return { name: cls.name, names, add: names.filter(n => !have.has(n.toLowerCase())), cls };
  });
  const changes = plan.filter(p => p.add.length);
  d.body.innerHTML = `
    <div class="ai-plan gc-plan"><b>Here’s what I’ll do:</b><ul>${plan.map(p => `<li>${p.cls
      ? (p.add.length ? `Add ${plural(p.add.length, 'new student')} to <b>${esc(p.name)}</b>` : `<b>${esc(p.name)}</b> is already up to date`)
      : `Create <b>${esc(p.name)}</b> with ${plural(p.add.length, 'student')}`}</li>`).join('')}</ul>
      <small>Students already in ClassMap are left as they are, with their tags and seats. Nobody is removed.</small></div>
    <div class="ar-actions"><button type="button" class="rc-btn gc-back">Back</button><button type="button" class="rc-btn primary gc-apply" ${changes.length ? '' : 'disabled'}>Import</button></div>`;
  d.body.querySelector('.gc-back').onclick = () => showCourses(d, picked.concat(), rosters);
  d.body.querySelector('.gc-apply').onclick = () => {
    const before = structuredClone(store.landingData);
    let first = null;
    changes.forEach((p, i) => {
      let cls = p.cls;
      if (!cls) {
        cls = { id: 'cls_' + Date.now() + '_' + i, name: p.name, color: CLASS_COLORS[store.landingData.classes.length % CLASS_COLORS.length], students: [], hardRules: [], genderMode: false };
        store.landingData.classes.push(cls);
      }
      p.add.forEach(n => cls.students.push({ id: 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: n, gender: guessGroupForClass(cls, n) || null }));
      first ||= cls.id;
    });
    saveLandingData();
    renderClassList();
    if (first) selectClass(first);
    d.close();
    const n = changes.reduce((k, p) => k + p.add.length, 0);
    undoToast(`Imported ${plural(n, 'student')} from Google Classroom`, () => {
      store.landingData = before;
      saveLandingData();
      renderClassList();
      if (store.landingData.classes[0]) selectClass(store.landingData.classes[0].id);
    });
  };
}
