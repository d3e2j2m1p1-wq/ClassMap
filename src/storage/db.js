// ═══════════════════════════════════════════════
//  INDEXEDDB — the app's main storage
//  Much more room than localStorage (~5 MB): classroom photos and many classes fit.
//  A tiny key → value store; values are stored as objects (no JSON step).
// ═══════════════════════════════════════════════
const DB_NAME = 'classmap', STORE = 'kv';
let _db = null;

export const idbAvailable = () => typeof indexedDB !== 'undefined';

// For tests: make writes fail, like a full disk
export const _dbTest = { failWrites: false };

function openDb() {
  if (!_db) {
    _db = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }
  return _db;
}

export async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key, value) {
  if (_dbTest.failWrites) throw new Error('QuotaExceededError (test)');
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);   // the value is copied right here, so later edits don't leak in
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

// Ask the browser not to clear our data when the device runs low on space
export function askPersistentStorage() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
}
