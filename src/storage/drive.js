// ═══════════════════════════════════════════════
//  GOOGLE SIGN-IN + DRIVE SYNC (optional)
//
//  • Signing in asks for one narrow permission (drive.file): ClassMap can only see files it
//    created. It keeps one file, "ClassMap data.json", in the teacher's own Drive.
//  • There is no ClassMap server. The browser talks to Google directly with a short-lived
//    access token (about 1 hour). When it runs out, the home page shows "Reconnect".
//  • The device copy (IndexedDB) stays the main copy, so ClassMap still works offline.
//    Changes are uploaded a few seconds after saving; Drive is checked for changes from other
//    devices when you sign in, return to the tab, or go back to the home page.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { confirmDialog, showToast } from '../core/ui.js';
import { DRIVE_FILE_NAME, GOOGLE_CLIENT_ID } from '../config.js';
import { mergeData } from './merge.js';
import { normalizeLandingData, saveLandingData, saveListeners } from './landingData.js';
import { editorOpen } from './autosave.js';

const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SYNC_KEY = 'classmap_sync';

// What we remember between visits (no token is ever stored)
let sync = readSync();          // { email, fileId, lastSyncedAt, lastRemoteModified }
let token = null, tokenExpires = 0;
let status = 'idle';            // idle | syncing | synced | error
let _timer = null, _running = null, _again = false, _tokenClient = null, _tokenWaiter = null;

function readSync() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } }
function writeSync() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) {} }

export const driveEnabled = () => !!GOOGLE_CLIENT_ID;
const hasToken = () => !!token && Date.now() < tokenExpires - 60000;
const wasSignedIn = () => !!sync.email;

// ── Google Identity Services ──
function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}

// Must run from a click (the browser blocks the Google pop-up otherwise)
async function requestToken() {
  await loadGis();
  if (!_tokenClient) {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: resp => {
        const w = _tokenWaiter; _tokenWaiter = null;
        if (!w) return;
        if (resp.error) w.reject(new Error(resp.error));
        else w.resolve(resp);
      },
      error_callback: err => { const w = _tokenWaiter; _tokenWaiter = null; if (w) w.reject(new Error(err.type || 'popup_closed')); },
    });
  }
  const resp = await new Promise((resolve, reject) => {
    _tokenWaiter = { resolve, reject };
    _tokenClient.requestAccessToken({ prompt: wasSignedIn() ? '' : 'consent', hint: sync.email || undefined });
  });
  token = resp.access_token;
  tokenExpires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
}

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  if (res.status === 401) { token = null; throw new Error('expired'); }
  if (!res.ok) throw new Error('Google Drive error ' + res.status);
  return res;
}

// ── Drive file ──
async function findFile() {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const r = await api(`${API}?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime)`);
  return (await r.json()).files?.[0] || null;
}
async function fileMeta(id) {
  try {
    const r = await api(`${API}/${id}?fields=id,modifiedTime,trashed`);
    const m = await r.json();
    return m.trashed ? null : m;
  } catch (e) {
    if (e.message === 'expired') throw e;
    return null;   // deleted or no longer ours
  }
}
async function download(id) {
  const r = await api(`${API}/${id}?alt=media`);
  return r.json();
}
async function upload(data) {
  const body = JSON.stringify(data);
  if (sync.fileId) {
    const r = await api(`${UPLOAD}/${sync.fileId}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    return r.json();
  }
  const boundary = 'classmap' + Date.now();
  const meta = { name: DRIVE_FILE_NAME, mimeType: 'application/json', description: 'Classes and seating charts saved by ClassMap' };
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await api(`${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  });
  return r.json();
}

// ── Sync ──
// Replace what's on this device with merged/remote data and refresh the home page
function applyIncoming(data) {
  store.landingData = data;
  normalizeLandingData();
  saveLandingData({ fromSync: true });
  if (!editorOpen() && window.__cm_refreshLanding) window.__cm_refreshLanding();
}

export function syncNow() {
  if (_running) { _again = true; return _running; }
  _running = doSync().finally(() => {
    _running = null;
    if (_again) { _again = false; syncNow(); }
  });
  return _running;
}

async function doSync() {
  if (!driveEnabled() || !wasSignedIn()) return;
  if (!hasToken()) { renderSyncArea(); return; }
  setStatus('syncing');
  try {
    let meta = sync.fileId ? await fileMeta(sync.fileId) : null;
    if (!meta) { meta = await findFile(); sync.fileId = meta ? meta.id : null; }
    const local = store.landingData;
    const localChanged = (local.updatedAt || 0) > (sync.lastSyncedAt || 0) || !sync.lastSyncedAt;
    const localReplaced = (local.replacedAt || 0) > (sync.lastSyncedAt || 0);
    let result;

    if (!meta) {
      result = await upload(local);                                   // first time: create the file
    } else if (meta.modifiedTime !== sync.lastRemoteModified) {       // another device saved since
      const remote = await download(meta.id);
      if (localReplaced) {
        result = await upload(local);                                 // a restored backup wins
      } else if (localChanged) {
        const merged = mergeData(local, remote);
        applyIncoming(merged);
        result = await upload(store.landingData);
      } else {
        applyIncoming(remote);
        result = meta;
      }
    } else if (localChanged) {
      result = await upload(local);
    } else {
      result = meta;
    }
    sync.fileId = result.id || sync.fileId;
    sync.lastRemoteModified = result.modifiedTime;
    sync.lastSyncedAt = Date.now();
    writeSync();
    setStatus('synced');
  } catch (e) {
    console.warn('Drive sync:', e);
    setStatus(e.message === 'expired' ? 'idle' : 'error');
  }
}

// After every save: upload a few seconds later (several quick saves → one upload)
function scheduleSync() {
  if (!wasSignedIn() || !hasToken()) return;
  clearTimeout(_timer);
  _timer = setTimeout(syncNow, 4000);
}

export async function signIn() {
  try {
    await requestToken();
    const r = await api('https://www.googleapis.com/oauth2/v3/userinfo');
    const info = await r.json();
    if (sync.email && info.email !== sync.email) sync = {};          // a different account: start fresh
    sync.email = info.email;
    writeSync();
    renderSyncArea();
    await syncNow();
    if (status === 'synced') showToast('☁ Your classes are now saved to Google Drive too');
  } catch (e) {
    console.warn('Google sign-in:', e);
    if (!/popup_closed|access_denied/.test(e.message)) showToast('Google sign-in didn\'t work. Please try again.');
    renderSyncArea();
  }
}

export async function signOut() {
  const ok = await confirmDialog({
    title: 'Stop syncing with Google Drive?',
    message: 'Your classes stay on this device, and the copy in your Google Drive stays there too. You can sign in again any time.',
    confirmLabel: 'Sign out',
  });
  if (!ok) return;
  try { if (token && window.google) window.google.accounts.oauth2.revoke(token, () => {}); } catch (e) {}
  token = null; tokenExpires = 0;
  sync = {};
  writeSync();
  setStatus('idle');
}

function setStatus(s) { status = s; renderSyncArea(); }

// ── Home page sign-in / status ──
export function renderSyncArea() {
  const el = document.getElementById('syncArea');
  if (!el) return;
  if (!driveEnabled()) { el.innerHTML = ''; return; }
  if (!wasSignedIn()) {
    el.innerHTML = `<button type="button" class="sync-btn" onclick="driveSignIn()" title="Keep your classes in your own Google Drive and use them on any device">
      <span class="g-mark" aria-hidden="true">G</span> Sign in with Google</button>`;
    return;
  }
  if (!hasToken()) {
    el.innerHTML = `<button type="button" class="sync-btn warn" onclick="driveSignIn()" title="${esc(sync.email)} — Google sign-ins last about an hour">☁ Reconnect Google Drive</button>`;
    return;
  }
  const text = status === 'syncing' ? 'Syncing…' : status === 'error' ? 'Sync problem — retry' : 'Saved to Drive';
  el.innerHTML = `<div class="sync-pill ${status}">
      <button type="button" class="sync-main" onclick="driveSyncNow()" title="Sync now">☁ ${text}</button>
      <span class="sync-email">${esc(sync.email)}</span>
      <button type="button" class="sync-out" onclick="driveSignOut()" title="Sign out" aria-label="Sign out of Google">✕</button>
    </div>`;
}

export function initDrive() {
  if (!driveEnabled()) return;
  saveListeners.push(scheduleSync);
  // Back to the tab / window: look for changes made on other devices
  document.addEventListener('visibilitychange', () => { if (!document.hidden && hasToken()) syncNow(); });
  renderSyncArea();
}

// Going back to the home page is a good moment to check Drive
export function syncOnHome() { if (hasToken()) syncNow(); }

// For tests
export const _driveTest = { get status() { return status; }, get sync() { return sync; } };
