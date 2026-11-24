// ═══════════════════════════════════════════════
//  ON-DEVICE AI — settings
//  The model runs in the browser (Transformers.js + WebGPU). Its files come from classmap.dev
//  (see worker/index.js) and are kept in the browser's cache, shared by the whole site.
// ═══════════════════════════════════════════════
export const MODELS = {
  small: {
    id: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',
    // pinned so a cached copy never mixes with newer files
    revision: '969350d5f4647ec9ac277110f8974c65d8c10e4b',
    label: 'Small',
    params: '0.8B',
    approxGB: 0.8,
    blurb: 'Faster, smaller download. Good for rules and short text.',
  },
  large: {
    id: 'onnx-community/Qwen3.5-2B-ONNX-OPT',
    revision: 'main',
    label: 'Larger',
    params: '2B',
    approxGB: 1.8,
    blurb: 'Better writing. Best on newer laptops with 8 GB of memory or more.',
    minMemoryGB: 8,
  },
};
export const DEFAULT_MODEL = 'small';

// Which ONNX files each part of the model uses, when the model's own config doesn't say
export const FALLBACK_DTYPE = { embed_tokens: 'q4', vision_encoder: 'fp16', decoder_model_merged: 'q4' };

export const MODEL_HOST = () => `${location.origin}/models/`;
export const RUNTIME_HOST = () => `${location.origin}/ai-runtime/`;

// Per-viewer preferences (this device only)
const KEY = 'cm-ai';
export function loadPrefs() {
  try { return { enabled: false, model: DEFAULT_MODEL, tipSeen: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { enabled: false, model: DEFAULT_MODEL, tipSeen: false }; }
}
export function savePrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: the session still works */ }
}
