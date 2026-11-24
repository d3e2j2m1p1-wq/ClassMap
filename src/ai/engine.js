// ═══════════════════════════════════════════════
//  AI ENGINE — the page's side: starts the Web Worker, loads the model with progress,
//  streams answers, and removes the downloaded files when asked.
//  Tests swap in a stand-in engine with setEngineForTests().
// ═══════════════════════════════════════════════
import { MODELS, MODEL_HOST, RUNTIME_HOST } from './config.js';

const CACHE = 'transformers-cache';   // where Transformers.js keeps downloaded files (shared by the whole site)

class WorkerEngine {
  constructor() { this.worker = null; this.state = 'off'; this.model = null; this.pending = new Map(); this.seq = 0; }

  load(key, onProgress = () => {}) {
    const m = MODELS[key];
    if (this.state === 'ready' && this.model === key) return Promise.resolve();
    this.unload();
    this.state = 'loading';
    this.model = key;
    this.worker = new Worker(new URL('./aiWorker.js', import.meta.url), { type: 'module' });
    const files = {};
    return new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data: d }) => {
        if (d.type === 'progress') {
          files[d.file] = d;
          const loaded = Object.values(files).reduce((n, f) => n + f.loaded, 0);
          const total = Object.values(files).reduce((n, f) => n + f.total, 0);
          onProgress({ loaded, total, file: d.file });
        } else if (d.type === 'ready') { this.state = 'ready'; resolve(); }
        else if (d.type === 'error' && !d.id) { this.state = 'error'; reject(new Error(d.message)); }
        else this.route(d);
      };
      this.worker.onerror = e => { this.state = 'error'; reject(new Error(e.message || 'The AI stopped unexpectedly.')); };
      this.worker.postMessage({ type: 'load', model: m.id, revision: m.revision, host: MODEL_HOST(), runtime: RUNTIME_HOST() });
    });
  }

  route(d) {
    const p = this.pending.get(d.id);
    if (!p) return;
    if (d.type === 'token') p.onToken(d.text);
    else if (d.type === 'done') { this.pending.delete(d.id); p.resolve(d.text); }
    else if (d.type === 'error') { this.pending.delete(d.id); p.reject(new Error(d.message)); }
  }

  // messages: [{ role: 'system'|'user'|'assistant', content }]
  chat(messages, { onToken = () => {}, maxTokens = 400 } = {}) {
    if (this.state !== 'ready') return Promise.reject(new Error('The AI is not on.'));
    const id = 'g' + (++this.seq);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onToken });
      this.worker.postMessage({ type: 'generate', id, messages, maxTokens });
    });
  }
  stop() { if (this.worker) this.worker.postMessage({ type: 'stop' }); }
  unload() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.state = 'off';
    this.pending.forEach(p => p.reject(new Error('stopped')));
    this.pending.clear();
  }
}

let engine = new WorkerEngine();
export const getEngine = () => engine;
export function setEngineForTests(e) { engine = e; }

// Delete a model's downloaded files from this device. Returns bytes freed (best guess).
export async function removeModelFiles(key = null) {
  let freed = 0;
  try {
    const before = (await navigator.storage.estimate()).usage;
    const c = await caches.open(CACHE);
    const ids = key ? [MODELS[key].id] : Object.values(MODELS).map(m => m.id);
    const reqs = await c.keys();
    await Promise.all(reqs.filter(r => ids.some(id => r.url.includes(id)) || (!key && r.url.includes('/ai-runtime/'))).map(r => c.delete(r)));
    freed = Math.max(0, before - (await navigator.storage.estimate()).usage);
  } catch { /* nothing cached */ }
  return freed;
}

// Is a model already on this device? (so turning on doesn't mean a new download)
export async function isDownloaded(key) {
  try {
    const c = await caches.open(CACHE);
    const reqs = await c.keys();
    return reqs.some(r => r.url.includes(MODELS[key].id) && /decoder_model_merged/.test(r.url));
  } catch { return false; }
}
