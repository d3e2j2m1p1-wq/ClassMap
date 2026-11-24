// ═══════════════════════════════════════════════
//  The AI itself, in a Web Worker so the page never freezes while it thinks.
//  Messages in:  { type: 'load', model, revision, host, runtime }
//                { type: 'generate', id, messages, maxTokens }
//                { type: 'stop' } · { type: 'unload' }
//  Messages out: { type: 'progress', file, loaded, total } · { type: 'ready' }
//                { type: 'token', id, text } · { type: 'done', id, text } · { type: 'error', id?, message }
// ═══════════════════════════════════════════════
import { AutoProcessor, InterruptableStoppingCriteria, Qwen3_5ForConditionalGeneration, TextStreamer, env } from '@huggingface/transformers';
import { dtypeFrom } from './device.js';

let processor = null, model = null, stopper = null, busy = false;

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'load') await load(m);
    else if (m.type === 'generate') await generate(m);
    else if (m.type === 'stop') { if (stopper) stopper.interrupt(); }
    else if (m.type === 'unload') { try { await model?.dispose(); } catch { /* gone */ } model = null; processor = null; self.postMessage({ type: 'unloaded' }); }
  } catch (e) {
    self.postMessage({ type: 'error', id: m.id, message: friendly(e) });
  }
};

async function load({ model: id, revision, host, runtime }) {
  // everything comes from classmap.dev, never straight from a third party
  env.allowLocalModels = false;
  env.remoteHost = host;
  env.remotePathTemplate = '{model}/resolve/{revision}/';
  // the runtime's engine files, also from classmap.dev (and cached alongside the model)
  env.backends.onnx.wasm.wasmPaths = { mjs: runtime + 'ort-wasm-simd-threaded.asyncify.mjs', wasm: runtime + 'ort-wasm-simd-threaded.asyncify.wasm' };
  const progress_callback = p => {
    if (p.status === 'progress' && p.file) self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded || 0, total: p.total || 0 });
  };
  const cfg = await (await fetch(`${host}${id}/resolve/${revision}/config.json`)).json().catch(() => ({}));
  processor = await AutoProcessor.from_pretrained(id, { revision, progress_callback });
  model = await Qwen3_5ForConditionalGeneration.from_pretrained(id, { revision, device: 'webgpu', dtype: dtypeFrom(cfg), progress_callback });
  // a tiny warm-up so the first real answer isn't slow
  await generate({ id: '__warm', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 1, silent: true });
  self.postMessage({ type: 'ready' });
}

async function generate({ id, messages, maxTokens = 400, silent = false }) {
  if (!model) throw new Error('not loaded');
  if (busy) throw new Error('busy');
  busy = true;
  stopper = new InterruptableStoppingCriteria();
  let text = '';
  try {
    const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true, enable_thinking: false });
    const inputs = processor.tokenizer(prompt, { add_special_tokens: false });
    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true, skip_special_tokens: true,
      callback_function: t => { text += t; if (!silent) self.postMessage({ type: 'token', id, text: t }); },
    });
    await model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.05, streamer, stopping_criteria: stopper });
  } finally {
    busy = false;
    stopper = null;
  }
  if (!silent) self.postMessage({ type: 'done', id, text: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim() });
}

function friendly(e) {
  const s = String((e && e.message) || e);
  if (/out of memory|OOM|allocate|device lost|DeviceLost/i.test(s)) return 'This device ran out of graphics memory. Try the Small model, or close other tabs and try again.';
  if (/fetch|network|Failed to load|404/i.test(s)) return "Couldn't download the AI files. Check the internet connection and try again.";
  return s.slice(0, 200);
}
