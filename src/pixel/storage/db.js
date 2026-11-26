// ═══════════════════════════════════════════════
//  The gallery on this device (IndexedDB). Two stores, so the gallery can list artwork
//  without loading any pixels:
//    meta: { id, name, width, height, createdAt, updatedAt, bytes, thumb }
//    data: { id, bytes: Uint8Array }   ← the compressed project
//  Since Phase 5 also:
//    versions: { key: id:time, art, at, bytes, thumb }  ← automatic snapshots (keep the last N)
//    lapse:    { key: id:n, art, n, w, h, bytes }        ← timelapse pictures, one per change
// ═══════════════════════════════════════════════
import { encodeProject, decodeProject, gunzip } from '../core/format.js';

const DB = 'pixel:gallery';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions', { keyPath: 'key' }).createIndex('art', 'art');
      if (!db.objectStoreNames.contains('lapse')) db.createObjectStore('lapse', { keyPath: 'key' }).createIndex('art', 'art');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onabort = tx.onerror = () => rej(tx.error || new Error('Storage error')); });
const get = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function listArtwork() {
  const db = await open();
  return get(db.transaction('meta').objectStore('meta').getAll());
}

export async function loadArtwork(id) {
  const db = await open();
  const row = await get(db.transaction('data').objectStore('data').get(id));
  if (!row) throw new Error('This artwork is no longer on this device.');
  return decodeProject(row.bytes);
}

export async function saveArtwork(sprite, thumb) {
  const bytes = await encodeProject(sprite);
  const db = await open();
  const tx = db.transaction(['meta', 'data'], 'readwrite');
  tx.objectStore('data').put({ id: sprite.id, bytes });
  tx.objectStore('meta').put({
    id: sprite.id, name: sprite.name, width: sprite.width, height: sprite.height,
    createdAt: sprite.createdAt, updatedAt: sprite.updatedAt, bytes: bytes.length, thumb,
  });
  await done(tx);
}

export async function renameArtwork(id, name) {
  const db = await open();
  const sp = await loadArtwork(id);
  sp.name = name;
  const meta = await get(db.transaction('meta').objectStore('meta').get(id));
  await saveArtwork(sp, meta?.thumb);
}

export async function deleteArtwork(id) {
  const db = await open();
  const tx = db.transaction(['meta', 'data', 'versions', 'lapse'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('data').delete(id);
  for (const s of ['versions', 'lapse']) tx.objectStore(s).delete(IDBKeyRange.bound(id + ':', id + ':\uffff'));
  await done(tx);
}

// ── version backups ──
const pad = n => String(n).padStart(15, '0');
export async function saveVersion(sprite, thumb, keep = 5) {
  const bytes = await encodeProject(sprite);
  const db = await open();
  const at = Date.now();
  const tx = db.transaction('versions', 'readwrite'), st = tx.objectStore('versions');
  st.put({ key: sprite.id + ':' + pad(at), art: sprite.id, at, bytes, thumb, name: sprite.name });
  const keys = await get(st.index('art').getAllKeys(sprite.id));
  keys.sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) st.delete(k);
  await done(tx);
}
export async function listVersions(id) {
  const db = await open();
  const rows = await get(db.transaction('versions').objectStore('versions').index('art').getAll(id));
  return rows.map(({ key, at, thumb, bytes }) => ({ key, at, thumb, size: bytes.length })).sort((a, b) => b.at - a.at);
}
export async function loadVersion(key) {
  const db = await open();
  const row = await get(db.transaction('versions').objectStore('versions').get(key));
  if (!row) throw new Error('That version is gone.');
  return decodeProject(row.bytes);
}

// ── timelapse ──
export async function addLapse(id, n, w, h, bytes) {
  const db = await open();
  const tx = db.transaction('lapse', 'readwrite');
  tx.objectStore('lapse').put({ key: id + ':' + pad(n), art: id, n, w, h, bytes });
  await done(tx);
}
export async function lapseCount(id) {
  const db = await open();
  return get(db.transaction('lapse').objectStore('lapse').index('art').count(id));
}
export async function loadLapse(id) {
  const db = await open();
  const rows = await get(db.transaction('lapse').objectStore('lapse').index('art').getAll(id));
  return rows.sort((a, b) => a.n - b.n);
}
export async function clearLapse(id) {
  const db = await open();
  const tx = db.transaction('lapse', 'readwrite');
  tx.objectStore('lapse').delete(IDBKeyRange.bound(id + ':', id + ':\uffff'));
  await done(tx);
}

// Every project as its saved JSON (for backups), without building pixel arrays
export async function allProjectsJSON() {
  const db = await open();
  const rows = await get(db.transaction('data').objectStore('data').getAll());
  const dec = new TextDecoder();
  return Promise.all(rows.map(async r => JSON.parse(dec.decode(await gunzip(r.bytes)))));
}

// Ask the browser not to clear the gallery when space runs low (Safari may still say no)
export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
