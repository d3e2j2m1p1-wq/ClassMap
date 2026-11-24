// ═══════════════════════════════════════════════
//  Can this device run the AI? (checked before offering it, and shown in "Learn more")
// ═══════════════════════════════════════════════
import { FALLBACK_DTYPE, MODELS, MODEL_HOST } from './config.js';

let cached = null;

// { webgpu, gpu, storageFreeGB, memoryGB, mobile, promptApi }
export async function checkDevice(force = false) {
  if (cached && !force) return cached;
  if (typeof window !== 'undefined' && window.__cmAiDevice) return (cached = window.__cmAiDevice);   // tests
  const out = { webgpu: false, gpu: '', storageFreeGB: null, memoryGB: navigator.deviceMemory || null, mobile: /Android|iPhone|iPad|Mobile/.test(navigator.userAgent), promptApi: 'none' };
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        out.webgpu = true;
        const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
        out.gpu = [info.vendor, info.architecture || info.description].filter(Boolean).join(' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    }
  } catch { /* no WebGPU */ }
  try {
    const est = await navigator.storage.estimate();
    out.storageFreeGB = Math.max(0, (est.quota - est.usage) / 1e9);
  } catch { /* unknown */ }
  // Chrome's own built-in model (the Prompt API). ClassMap doesn't use it yet; we just report it.
  try {
    if (typeof self.LanguageModel !== 'undefined' && self.LanguageModel.availability) out.promptApi = await self.LanguageModel.availability();
  } catch { /* not there */ }
  cached = out;
  return out;
}

// The real download size of a model, measured from the file list (falls back to an estimate)
const sizes = {};
export async function downloadSize(key) {
  if (sizes[key]) return sizes[key];
  const m = MODELS[key];
  try {
    const cfgRes = await fetch(`${MODEL_HOST()}${m.id}/resolve/${m.revision}/config.json`);
    const cfg = cfgRes.ok ? await cfgRes.json() : {};
    const dtype = dtypeFrom(cfg);
    const res = await fetch(`${MODEL_HOST()}api/models/${m.id}/tree/${m.revision}/onnx`);
    if (!res.ok) throw new Error('no list');
    const list = await res.json();
    let bytes = 0;
    Object.entries(dtype).forEach(([part, dt]) => {
      const stem = `onnx/${part}${dt === 'fp32' ? '' : '_' + dt}.onnx`;
      list.filter(f => f.path === stem || f.path.startsWith(stem + '_data')).forEach(f => { bytes += (f.lfs && f.lfs.size) || f.size || 0; });
    });
    if (!bytes) throw new Error('no files');
    sizes[key] = { gb: (bytes + 12e6) / 1e9, measured: true };   // + tokenizer and config files
  } catch {
    sizes[key] = { gb: m.approxGB, measured: false };
  }
  return sizes[key];
}

// The parts of the model and which file version each uses
export function dtypeFrom(cfg) {
  const d = cfg && cfg['transformers.js_config'] && cfg['transformers.js_config'].dtype;
  if (d && typeof d === 'object') return { ...FALLBACK_DTYPE, ...d };
  if (typeof d === 'string') return Object.fromEntries(Object.keys(FALLBACK_DTYPE).map(k => [k, d]));
  return { ...FALLBACK_DTYPE };
}

export const fmtGB = gb => gb >= 1 ? `${(Math.round(gb * 10) / 10).toFixed(1)} GB` : `${Math.round(gb * 1000)} MB`;
