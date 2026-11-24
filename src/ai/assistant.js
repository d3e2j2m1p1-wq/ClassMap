// ═══════════════════════════════════════════════
//  CLASSMAP HELPER — the round button in the lower right.
//  With the AI off: help search, and seating rules typed in plain English (pattern reader only).
//  With the on-device AI on: rules it can't read on its own, parent email polish,
//  and accommodation summaries. Everything runs in this browser; nothing about students is sent anywhere.
//  Anything that changes the class shows "Here's what I'll do" and waits for Apply.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc, state } from '../core/state.js';
import { confirmDialog, plural, showToast, undoToast } from '../core/ui.js';
import { saveLandingData } from '../storage/landingData.js';
import { editorOpen } from '../storage/autosave.js';
import { renderLdRules } from '../landing/rules.js';
import { renderHardRules } from '../editor/rules.js';
import { classTags, hasTag, PRESET_TAGS, tagKey } from '../landing/tags.js';
import { DEFAULT_MODEL, MODELS, loadPrefs, savePrefs } from './config.js';
import { checkDevice, downloadSize, fmtGB } from './device.js';
import { getEngine, isDownloaded, removeModelFiles } from './engine.js';
import { describe, parseRules, planRules, readModelRules, rulesPrompt } from './rulesNL.js';
import { FAQ, searchHelp } from './help.js';
import { commandPrompt, context, planCommands, readCommand, readModelCommand, restore, snapshot } from './commands.js';

let prefs = loadPrefs();
let root, bubble, panel, tip;
let view = 'home';            // home · info · loading · rules · email · accom · help
let device = null;
let progress = { loaded: 0, total: 0 };
let loadError = '';
let busy = false;

const engine = () => getEngine();
const aiReady = () => engine().state === 'ready';
const aiOn = () => prefs.enabled;
const set = patch => { prefs = { ...prefs, ...patch }; savePrefs(prefs); };

export function currentClass() {
  const id = editorOpen() ? window._currentChartClassId : store.activeClassId;
  return (store.landingData?.classes || []).find(c => c.id === id) || null;
}

// ── Start-up ──
export async function initAssistant() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'ai-root';
  root.innerHTML = `
    <button type="button" class="ai-bubble" aria-label="ClassMap helper" title="Help and on-device AI">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.3 1.2 4.4 3.2 5.8L4.5 21l4.3-2.4c1 .3 2.1.4 3.2.4 5.5 0 10-3.6 10-8s-4.5-8-10-8Z"/><circle cx="8" cy="11" r="1.3" fill="var(--ai-dot)"/><circle cx="12" cy="11" r="1.3" fill="var(--ai-dot)"/><circle cx="16" cy="11" r="1.3" fill="var(--ai-dot)"/></svg>
    </button>
    <div class="ai-panel" role="dialog" aria-label="ClassMap helper" hidden></div>`;
  document.body.appendChild(root);
  bubble = root.querySelector('.ai-bubble');
  panel = root.querySelector('.ai-panel');
  placeBubble();
  initDrag();
  window.addEventListener('resize', () => { placeBubble(); placePanel(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden && !document.querySelector('.cm-dialog-backdrop, .ar-backdrop')) closePanel(); });
  document.addEventListener('pointerdown', e => {
    if (!panel.hidden && !root.contains(e.target) && !e.target.closest('.cm-dialog-backdrop, .cm-undo-toast, .tm-menu')) closePanel();
  });

  device = await checkDevice();
  if (!device.webgpu && prefs.enabled) set({ enabled: false });
  // Larger model by default on laptops with 8 GB+ (it's much more reliable); the teacher's own choice wins
  if (!prefs.modelPicked && !prefs.enabled) set({ model: device.memoryGB >= 8 && !device.mobile ? 'large' : 'small' });
  // First visit on a device that can run it: a one-time tip, then just the quiet button
  if (device.webgpu && !prefs.tipSeen && !prefs.enabled) setTimeout(showTip, 1500);
}

// ── The button: drag it anywhere, it remembers ──
function placeBubble() {
  const pos = prefs.pos || { r: 20, b: 20 };
  const max = (v, lim) => Math.max(8, Math.min(v, lim));
  bubble.style.right = max(pos.r, innerWidth - 60) + 'px';
  bubble.style.bottom = max(pos.b, innerHeight - 60) + 'px';
}
function initDrag() {
  let start = null, moved = false;
  bubble.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, r: parseFloat(bubble.style.right), b: parseFloat(bubble.style.bottom) };
    moved = false;
    bubble.setPointerCapture(e.pointerId);
  });
  bubble.addEventListener('pointermove', e => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    bubble.classList.add('dragging');
    bubble.style.right = Math.max(8, Math.min(start.r - dx, innerWidth - 60)) + 'px';
    bubble.style.bottom = Math.max(8, Math.min(start.b - dy, innerHeight - 60)) + 'px';
    placePanel();
  });
  bubble.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    bubble.classList.remove('dragging');
    if (moved) set({ pos: { r: parseFloat(bubble.style.right), b: parseFloat(bubble.style.bottom) } });
    else togglePanel();
  });
  bubble.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); } });
}
function placePanel() {
  if (!panel || panel.hidden) return;
  const r = bubble.getBoundingClientRect();
  const w = Math.min(380, innerWidth - 16);
  panel.style.width = w + 'px';
  const left = r.left + r.width / 2 > innerWidth / 2 ? Math.max(8, r.right - w) : Math.min(r.left, innerWidth - w - 8);
  panel.style.left = left + 'px';
  const above = r.top > innerHeight / 2;
  panel.style.maxHeight = Math.max(260, (above ? r.top - 16 : innerHeight - r.bottom - 16)) + 'px';
  panel.style.top = above ? '' : (r.bottom + 8) + 'px';
  panel.style.bottom = above ? (innerHeight - r.top + 8) + 'px' : '';
}

// ── One-time tip ──
function showTip() {
  if (tip || prefs.tipSeen || !panel.hidden || document.body.classList.contains('presenting')) return;
  tip = document.createElement('div');
  tip.className = 'ai-tip';
  tip.setAttribute('role', 'status');
  tip.innerHTML = `<b>New: an AI helper that runs on this device</b>
    <p>Type seating rules in plain English, polish parent emails, and summarize accommodations. Student information never leaves this device.</p>
    <div class="ai-row"><button type="button" class="rc-btn primary ai-tip-more">Learn more</button><button type="button" class="rc-btn ai-tip-no">Not now</button></div>`;
  root.appendChild(tip);
  const r = bubble.getBoundingClientRect();
  tip.style.right = Math.max(8, innerWidth - r.right) + 'px';
  tip.style.bottom = (innerHeight - r.top + 10) + 'px';
  const done = () => { set({ tipSeen: true }); tip.remove(); tip = null; };
  tip.querySelector('.ai-tip-more').onclick = () => { done(); openPanel('info'); };
  tip.querySelector('.ai-tip-no').onclick = done;
}

// ── Panel ──
export function openPanel(v = null) {
  if (tip) { set({ tipSeen: true }); tip.remove(); tip = null; }
  panel.hidden = false;
  bubble.classList.add('open');
  if (v) view = v;
  else if (view === 'info' || view === 'loading') view = 'home';
  if (aiOn() && !aiReady() && engine().state !== 'loading') startEngine();
  render();
  placePanel();
}
export function closePanel() {
  panel.hidden = true;
  bubble.classList.remove('open');
}
function togglePanel() { panel.hidden ? openPanel() : closePanel(); }

function render() {
  const head = `<div class="ai-head">
      ${view !== 'home' && view !== 'loading' ? '<button type="button" class="ai-icon ai-back" aria-label="Back">‹</button>' : ''}
      <div class="ai-title">${{ home: 'ClassMap helper', info: 'On-device AI', loading: 'On-device AI', email: 'Parent email', accom: 'Accommodation summary' }[view]}
        <small>${status()}</small></div>
      <button type="button" class="ai-icon ai-menu-btn" aria-label="AI settings">⋮</button>
      <button type="button" class="ai-icon ai-close" aria-label="Close">✕</button>
    </div>`;
  const typed = panel.querySelector('.ai-ask-in')?.value || '';     // keep what's being typed across redraws
  panel.innerHTML = head + `<div class="ai-body">${VIEWS[view]()}</div>`;
  const askIn = panel.querySelector('.ai-ask-in');
  if (askIn && typed) askIn.value = typed;
  panel.querySelector('.ai-close').onclick = closePanel;
  panel.querySelector('.ai-back')?.addEventListener('click', () => { view = 'home'; render(); });
  panel.querySelector('.ai-menu-btn').onclick = e => settingsMenu(e.currentTarget);
  (WIRE[view] || (() => {}))();
  placePanel();
}

const status = () => !aiOn() ? 'AI off' : view === 'loading' ? (progress.cached ? 'Starting…' : 'Downloading…') : aiReady() ? '● AI on · ' + MODELS[prefs.model].label : engine().state === 'loading' ? 'Starting the AI…' : loadError ? 'AI couldn’t start' : 'AI on';
// Re-draw only screens that hold nothing the teacher typed; elsewhere just update the status line
function refresh() {
  if (panel.hidden) return;
  if (['home', 'info', 'loading'].includes(view)) render();
  else { const small = panel.querySelector('.ai-title small'); if (small) small.textContent = status(); }
}

// ── Home: what the helper can do ──
const VIEWS = {
  home() {
    const can = device && device.webgpu;
    return `
      <div class="ai-chat-slot"></div>
      <div class="ai-compose">
        <textarea class="ai-ask-in" rows="1" placeholder="Ask or tell ClassMap…" aria-label="Ask or tell ClassMap"></textarea>
        <button type="button" class="ai-send" aria-label="Send">➤</button>
      </div>
      <div class="ai-tools">
        ${tool('email', '✉', 'Polish a parent email', aiOn() ? 'Clearer, warmer, or in Spanish' : 'Needs the on-device AI', !aiOn())}
        ${tool('accom', '☰', 'Accommodation summary', aiOn() ? 'Short seating notes from an IEP or 504' : 'Needs the on-device AI', !aiOn())}
      </div>
      ${aiOn() ? (loadError ? `<div class="ai-note warn">${esc(loadError)} <button type="button" class="ai-link ai-retry">Try again</button></div>` : '')
        : can ? `<div class="ai-card"><b>Turn on the on-device AI</b><p>Understands more ways of asking, polishes emails and sums up accommodations. Runs in this browser; student information never leaves this device.</p><button type="button" class="rc-btn primary ai-learn">Learn more</button></div>`
        : `<p class="ai-fine">The on-device AI needs a browser with WebGPU (recent Chrome or Edge on a laptop). The helper still understands the usual ways of asking.</p>`}`;
  },
  info() {
    const m = MODELS[prefs.model] || MODELS[DEFAULT_MODEL];
    const d = device || {};
    const memLow = d.memoryGB && d.memoryGB < 8;
    return `
      <p class="ai-lead">A small AI model that runs on this computer, inside your browser.</p>
      <h4>What it does</h4>
      <ul><li>Understands what you ask in your own words, and ClassMap does it: “Make a class called Period 4”, “Swap Ana and Mia”, “Who’s tagged IEP?”</li>
        <li>Turns seating wishes into rules: “Keep Liam and Owen apart, Ana needs the front.”</li>
        <li>Polishes emails to parents, or puts them in Spanish.</li>
        <li>Sums up an IEP or 504 into short seating notes and suggested tags.</li>
        <li>Answers come from your real class data, not the AI’s memory. It never changes anything on its own: you see what it will do and press Apply.</li>
        <li>Like any AI, it can make mistakes. Read what it writes before you use it.</li></ul>
      <h4>Privacy</h4>
      <p>The model runs in this browser. What you type, and your students’ names and information, never leave this device. The only thing downloaded is the model itself, once, from classmap.dev.</p>
      <h4>What it costs this device</h4>
      <ul><li>A one-time download of <b class="ai-size">about ${fmtGB(m.approxGB)}</b>, kept in the browser. Remove it any time from ⋮.</li>
        <li>It uses the graphics chip while it works. Expect some battery use and warmth, and a few seconds per answer.</li>
        <li>Works best on newer laptops (2020 or later) with 8 GB of memory or more.</li></ul>
      <div class="ai-check">
        <div><span>Graphics</span><b>${d.webgpu ? '✓ ' + esc(d.gpu || 'WebGPU ready') : '✕ No WebGPU'}</b></div>
        <div><span>Free space</span><b>${d.storageFreeGB == null ? 'Unknown' : (d.storageFreeGB < m.approxGB * 1.5 ? '⚠ ' : '✓ ') + fmtGB(d.storageFreeGB)}</b></div>
        <div><span>Memory</span><b>${d.memoryGB ? (memLow ? '⚠ ' : '✓ ') + (d.memoryGB >= 8 ? '8 GB or more' : d.memoryGB + ' GB') : 'Unknown'}</b></div>
        ${d.promptApi && d.promptApi !== 'none' && d.promptApi !== 'unavailable' ? `<div><span>Browser AI</span><b>${esc(d.promptApi)}</b></div>` : ''}
      </div>
      ${d.mobile ? '<p class="ai-note warn">Phones and tablets may be too slow or run out of memory. A laptop works best.</p>' : ''}
      ${memLow ? '<p class="ai-note warn">This device has less than 8 GB of memory. The Small model may still work; close other tabs first.</p>' : ''}
      <h4>Model</h4>
      <div class="ai-models">${Object.entries(MODELS).map(([k, x]) => `
        <label class="ai-model"><input type="radio" name="aiModel" value="${k}" ${k === prefs.model ? 'checked' : ''}>
          <span><b>${x.label}</b> <small class="ai-msize" data-k="${k}">about ${fmtGB(x.approxGB)}</small><br><small>${esc(x.blurb)}</small></span></label>`).join('')}</div>
      <div class="ai-row end">
        <button type="button" class="rc-btn ai-notnow">Not now</button>
        <button type="button" class="rc-btn primary ai-turnon" ${d.webgpu ? '' : 'disabled'}>${aiOn() && aiReady() ? 'Switch model' : 'Turn on'}</button>
      </div>`;
  },
  loading() {
    const m = MODELS[prefs.model];
    const pct = progress.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : 0;
    return `
      <p class="ai-lead">${progress.cached ? 'Starting the AI…' : `Downloading the ${m.label} model. This happens once; after that it starts in seconds, even offline.`}</p>
      <div class="ai-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>
      <p class="ai-fine ai-progress-text">${progress.total ? `${fmtGB(progress.loaded / 1e9)} of ${fmtGB(progress.total / 1e9)}` : 'Getting ready…'}</p>
      <p class="ai-fine">You can keep working; it continues in the background while this tab is open.</p>
      <div class="ai-row end"><button type="button" class="rc-btn ai-cancel">Cancel</button></div>`;
  },
  email() {
    return `
      <p class="ai-lead">Paste your draft. Names and facts stay as you wrote them.</p>
      <textarea class="ai-input" rows="7" placeholder="Hi Ms. Garcia, I wanted to let you know…"></textarea>
      <div class="ai-chips">
        ${[['clear', 'Clearer'], ['warm', 'Warmer'], ['formal', 'More formal'], ['short', 'Shorter'], ['es', 'In Spanish']].map(([k, l], i) => `<label class="ai-chip"><input type="radio" name="aiTone" value="${k}" ${i === 0 ? 'checked' : ''}>${l}</label>`).join('')}
      </div>
      <div class="ai-row end"><button type="button" class="rc-btn primary ai-go">Polish</button></div>
      <div class="ai-out"></div>
      <p class="ai-fine">Always read it before you send it.</p>`;
  },
  accom() {
    const cls = currentClass();
    if (!cls) return '<p class="ai-lead">Pick a class on the home page first, then come back here.</p>';
    const kids = [...(cls.students || [])].sort((a, b) => a.name.localeCompare(b.name));
    return `
      <p class="ai-lead">Paste the accommodations (for example, the “at a glance” page). You get short notes for class and suggested tags. The text you paste isn’t saved.</p>
      <select class="ai-student" aria-label="Student"><option value="">Which student?</option>${kids.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
      <textarea class="ai-input" rows="6" placeholder="Preferential seating near instruction. Extended time (1.5x). Check for understanding…"></textarea>
      <div class="ai-row end"><button type="button" class="rc-btn primary ai-go">Summarize</button></div>
      <div class="ai-out"></div>`;
  },
};
const tool = (v, icon, title, sub, off = false) =>
  `<button type="button" class="ai-tool" data-v="${v}" ${off ? 'data-off="1"' : ''}><span class="ai-tool-i">${icon}</span><span><b>${title}</b><small>${sub}</small></span></button>`;

// ── Wiring for each view ──
const WIRE = {
  home() {
    panel.querySelectorAll('.ai-tool').forEach(b => b.onclick = () => {
      if (b.dataset.off) { device?.webgpu ? openPanel('info') : showToast('This needs the on-device AI, which this browser can’t run'); return; }
      view = b.dataset.v; render(); panel.querySelector('.ai-input')?.focus();
    });
    panel.querySelector('.ai-learn')?.addEventListener('click', () => openPanel('info'));
    panel.querySelector('.ai-retry')?.addEventListener('click', () => { loadError = ''; startEngine(); });
    wireChat();
  },
  info() {
    const notnow = panel.querySelector('.ai-notnow');
    notnow.onclick = () => { view = 'home'; render(); };
    panel.querySelectorAll('input[name=aiModel]').forEach(r => r.onchange = () => { set({ model: r.value, modelPicked: true }); sizeLabel(); });
    panel.querySelector('.ai-turnon').onclick = () => {
      const pick = panel.querySelector('input[name=aiModel]:checked')?.value || DEFAULT_MODEL;
      set({ enabled: true, model: pick, tipSeen: true });
      startEngine(true);
    };
    sizeLabel();
    // real sizes, measured from the file list
    Object.keys(MODELS).forEach(async k => {
      const s = await downloadSize(k);
      const el = panel.querySelector(`.ai-msize[data-k="${k}"]`);
      if (el) el.textContent = (s.measured ? '' : 'about ') + fmtGB(s.gb);
      sizeLabel();
    });
  },
  loading() { panel.querySelector('.ai-cancel').onclick = () => { engine().unload(); set({ enabled: false }); view = 'info'; render(); }; },
  email() {
    const go = panel.querySelector('.ai-go');
    go.onclick = () => runEmail();
    ctrlEnter(go);
  },
  accom() {
    const go = panel.querySelector('.ai-go');
    if (!go) return;
    go.onclick = () => runAccom();
    ctrlEnter(go);
  },
};
function ctrlEnter(btn) {
  panel.querySelector('.ai-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); btn.click(); } });
}
async function sizeLabel() {
  const el = panel.querySelector('.ai-size');
  if (!el) return;
  const s = await downloadSize(prefs.model);
  const have = await isDownloaded(prefs.model);
  el.textContent = have ? 'already downloaded' : (s.measured ? '' : 'about ') + fmtGB(s.gb);
}

// ── Turn on / load ──
async function startEngine(fromInfo = false) {
  if (!device?.webgpu) return;
  loadError = '';
  const key = prefs.model in MODELS ? prefs.model : DEFAULT_MODEL;
  const cached = await isDownloaded(key);
  const expected = cached ? 0 : (await downloadSize(key)).gb * 1e9;
  progress = { loaded: 0, total: expected, cached };
  // From "Turn on", show the download screen. Otherwise (opening the panel later) don't take over
  // whatever the teacher is doing; the progress shows in the header.
  if (fromInfo) view = 'loading';
  refresh();
  let last = 0;
  try {
    await engine().load(key, p => {
      progress = { loaded: p.loaded, total: Math.max(p.total, expected), cached };
      if (Date.now() - last < 150) return;
      last = Date.now();
      const small = panel.querySelector('.ai-title small');
      if (small && progress.total && view !== 'loading') small.textContent = `${cached ? 'Starting' : 'Downloading'} the AI… ${Math.min(99, Math.round(progress.loaded / progress.total * 100))}%`;
      const bar = panel.querySelector('.ai-progress > div');
      if (bar && progress.total) {
        bar.style.width = Math.min(100, progress.loaded / progress.total * 100) + '%';
        panel.querySelector('.ai-progress-text').textContent = `${fmtGB(progress.loaded / 1e9)} of ${fmtGB(progress.total / 1e9)}`;
      }
    });
    if (view === 'loading') { view = 'home'; if (!cached) showToast('✓ The on-device AI is ready'); }
  } catch (e) {
    loadError = e.message || 'The AI couldn’t start on this device.';
    if (view === 'loading') view = 'home';
  }
  refresh();
}
async function needAI(box = null) {
  if (aiReady()) return true;
  if (!aiOn()) { openPanel('info'); return false; }
  if (box) box.innerHTML = '<p class="ai-fine typing">Starting the AI…</p>';
  if (engine().state !== 'loading') await startEngine();
  else await new Promise(r => { const t = setInterval(() => { if (engine().state !== 'loading') { clearInterval(t); r(); } }, 200); });
  return aiReady();
}

// ── ⋮ settings ──
function settingsMenu(anchor) {
  document.querySelector('.ai-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'ai-menu tm-menu';
  const items = [];
  if (aiOn()) {
    const other = prefs.model === 'small' ? 'large' : 'small';
    items.push(['switch', `Use the ${MODELS[other].label} model`, MODELS[other].params + ' · ' + MODELS[other].blurb]);
    items.push(['off', 'Turn off the AI', 'keeps the download for next time']);
  } else if (device?.webgpu) items.push(['on', 'Turn on the on-device AI…', '']);
  items.push(['about', 'About the on-device AI', '']);
  items.push(['remove', 'Remove AI from this device', 'deletes the downloaded model']);
  m.innerHTML = items.map(([k, l, s]) => `<button type="button" class="tm-item" data-k="${k}"><span>${l}</span>${s ? `<small>${esc(s)}</small>` : ''}</button>`).join('');
  root.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px';
  m.style.right = Math.max(8, innerWidth - r.right) + 'px';
  if (r.bottom + m.offsetHeight > innerHeight) { m.style.top = ''; m.style.bottom = (innerHeight - r.top + 4) + 'px'; }
  const close = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true));
  m.onclick = async e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    m.remove();
    document.removeEventListener('pointerdown', close, true);
    if (k === 'switch') { set({ model: prefs.model === 'small' ? 'large' : 'small', modelPicked: true }); openPanel('info'); }
    else if (k === 'on' || k === 'about') openPanel('info');
    else if (k === 'off') { engine().unload(); set({ enabled: false }); loadError = ''; view = 'home'; render(); showToast('AI turned off'); }
    else if (k === 'remove') removeAI();
  };
}
export async function removeAI() {
  const ok = await confirmDialog({
    title: 'Remove the AI from this device?',
    message: 'This deletes the downloaded model and turns the AI off. Your classes and charts aren’t touched. You can turn it on again later (it downloads again).',
    confirmLabel: 'Remove', danger: true,
  });
  if (!ok) return;
  engine().unload();
  set({ enabled: false });
  loadError = '';
  const freed = await removeModelFiles();
  view = 'home';
  if (!panel.hidden) render();
  showToast(freed > 1e6 ? `AI removed · ${fmtGB(freed / 1e9)} freed` : 'AI removed from this device');
}

// ── The chat: understand → answer from real data, or show a plan to Apply ──
let chatLog = null;          // kept between redraws of the panel
function chatEl() {
  if (!chatLog) { chatLog = document.createElement('div'); chatLog.className = 'ai-chat'; }
  return chatLog;
}
function wireChat() {
  panel.querySelector('.ai-chat-slot').replaceWith(chatEl());
  if (!chatEl().children.length) chatEl().appendChild(examples());
  const input = panel.querySelector('.ai-ask-in');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
  const go = () => { const t = input.value.trim(); if (!t || busy) return; input.value = ''; grow(); send(t); };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  panel.querySelector('.ai-send').onclick = go;
  setTimeout(() => { input.focus(); chatEl().scrollTop = chatEl().scrollHeight; });
}
// Example requests, using real names from the class when there is one
function examples() {
  const ctx = context();
  const ss = ctx.editing ? state.students : (ctx.cls?.students || []);
  const first = i => (ss[i]?.name || ['Liam', 'Ana', 'Owen', 'Mia'][i]).split(' ')[0];
  const ex = !ctx.cls ? ['Make a class called Period 4', 'What classes do I have?', 'How do I print a chart?']
    : ctx.editing ? [`Swap ${first(0)} and ${first(1)}`, `Who sits next to ${first(2)}?`, 'Check the rules', `Keep ${first(0)} and ${first(3)} apart`, 'Who doesn’t have a seat?']
    : [`Keep ${first(0)} and ${first(1)} apart`, 'Who’s tagged IEP?', 'Add students: Jo Smith, Sam Lee', 'Make a class called Period 4', 'Start a new chart'];
  const d = document.createElement('div');
  d.className = 'ai-examples';
  d.innerHTML = `<p class="ai-fine">Ask a question or tell ClassMap what to do. Nothing changes until you press Apply.</p>` +
    ex.map(t => `<button type="button" class="ai-chip ai-ex">${esc(t)}</button>`).join('');
  d.querySelectorAll('.ai-ex').forEach(b => b.onclick = () => { const i = panel.querySelector('.ai-ask-in'); i.value = b.textContent; i.focus(); });
  return d;
}
function say(who, html) {
  const log = chatEl();
  log.querySelector('.ai-examples')?.remove();
  const d = document.createElement('div');
  d.className = `ai-say ai-${who}`;
  d.innerHTML = html;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

export async function send(text) {
  say('me', esc(text));
  const box = say('bot', '<span class="ai-fine typing">Thinking</span>');
  const ctx = context();
  let cmds = readCommand(text, ctx);
  // not one of the usual phrasings: the on-device model works out what was meant (and only that)
  if (!cmds && aiOn() && (await needAI(box))) {
    box.innerHTML = '<span class="ai-fine typing">Thinking</span>';
    busy = true;
    try { cmds = readModelCommand(await engine().chat(commandPrompt(ctx, text), { maxTokens: 220 })); } catch { cmds = null; }
    busy = false;
  }
  box.innerHTML = '';
  const results = cmds && cmds.length ? planCommands(cmds, context()) : [{ kind: 'none' }];
  for (const r of results) await showResult(r, box, text);
  chatEl().scrollTop = chatEl().scrollHeight;
}

async function showResult(r, box, text) {
  const part = document.createElement('div');
  part.className = 'ai-part';
  box.appendChild(part);
  if (r.kind === 'answer') { part.innerHTML = r.html; return; }
  if (r.kind === 'help' || r.kind === 'none') {
    let hits = await searchHelp(r.query || text, 2);
    hits = hits.filter((h, i) => i === 0 || h.score >= hits[0].score * 0.8);   // a second answer only if it's as good a match
    if (hits.length && (r.kind === 'help' || hits[0].score >= 4)) { part.innerHTML = hits.map(helpHTML).join(''); wireHelp(part); return; }
    part.innerHTML = r.kind === 'help' ? 'I couldn’t find that in the help. Try other words.'
      : `I can’t do that yet. I can make classes, add or tag students, set seating rules, swap or move seats, pin, auto-assign, and answer questions about your class and chart.${!aiOn() && device?.webgpu ? ' <button type="button" class="ai-link ai-learn">Turn on the AI</button> to understand more ways of asking.' : ''}`;
    part.querySelector('.ai-learn')?.addEventListener('click', () => openPanel('info'));
    return;
  }
  if (r.kind === 'pick') {
    part.innerHTML = `Which “${esc(r.text.replace(/\b\w/g, c => c.toUpperCase()))}”? ` + r.options.map(o => `<button type="button" class="ai-chip ai-pick" data-to="${esc(o.name)}">${esc(o.name)}</button>`).join(' ');
    part.querySelectorAll('.ai-pick').forEach(b => b.onclick = () => send(swapName(text, r.text, b.dataset.to)));
    return;
  }
  if (r.kind === 'rules') { await runRules(r.text, part, (from, to) => send(swapName(text, from, to))); return; }
  if (r.kind === 'plan') {
    part.innerHTML = `<div class="ai-plan"><b>Here’s what I’ll do:</b><ul>${r.items.map(t => `<li>${t}</li>`).join('')}</ul>${r.note || ''}
      <div class="ai-row end"><button type="button" class="rc-btn ai-cancel">Cancel</button><button type="button" class="rc-btn primary ai-apply">Apply</button></div></div>`;
    part.querySelector('.ai-cancel').onclick = () => { part.innerHTML = '<span class="ai-fine">Canceled. Nothing changed.</span>'; };
    part.querySelector('.ai-apply').onclick = () => {
      const snap = snapshot();
      try { r.apply(); } catch (e) { part.innerHTML = `<span class="ai-err">That didn’t work: ${esc(e.message)}</span>`; return; }
      const undone = () => { part.innerHTML = '<span class="ai-fine">Undone.</span>'; };
      part.innerHTML = `<span class="ai-note ok">✓ ${esc(r.done || 'Done.')} <button type="button" class="ai-link ai-undo">Undo</button></span>`;
      const back = () => { if (r.undo) { r.undo(); showToast('Undone'); } else restore(snap); undone(); };
      part.querySelector('.ai-undo').onclick = back;
      if (!r.quiet) undoToast(r.done || 'Done', back);
    };
  }
}
const swapName = (text, from, to) => text.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), to);

// Help answers are shown exactly as written; the AI never rewords them
function helpHTML(h) {
  const faq = FAQ.find(f => f.q === h.title);
  return `<div class="ai-hit"><b>${esc(h.title)}</b><p>${esc(h.text.length > 320 ? h.text.slice(0, 320) + '…' : h.text)}</p>
    ${faq && faq.do ? `<button type="button" class="ai-link ai-doit" data-do="${esc(faq.do)}">Or I can do it: “${esc(faq.do.trim())}…”</button>` : ''}
    ${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">Read the guide ↗</a>` : ''}</div>`;
}
function wireHelp(el) {
  el.querySelectorAll('.ai-doit').forEach(b => b.onclick = () => { const i = panel.querySelector('.ai-ask-in'); i.value = b.dataset.do; i.focus(); });
}

// ── Streaming answer into a box ──
async function stream(messages, box, maxTokens) {
  busy = true;
  box.textContent = '';
  box.classList.add('typing');
  try {
    const text = await engine().chat(messages, { maxTokens, onToken: t => { box.textContent += t; } });
    box.textContent = text;
    return text;
  } catch (e) {
    box.innerHTML = `<span class="ai-err">${esc(e.message || 'Something went wrong.')}</span>`;
    return null;
  } finally {
    busy = false;
    box.classList.remove('typing');
  }
}

// ═══ 1. Seating rules ═══
async function runRules(text, out, onPick) {
  const cls = currentClass();
  if (!cls || !text.trim()) return;
  if (!(cls.students || []).length) { out.innerHTML = '<p class="ai-note warn">This class has no students yet. Say “Add students: …” or use the Roster tab.</p>'; return; }
  const parsed = parseRules(text, cls);
  let rules = parsed.rules, unclear = parsed.unclear, leftover = parsed.leftover;
  // what the pattern reader couldn't read goes to the AI (if it's on)
  if (leftover.length && aiOn()) {
    out.innerHTML = '<p class="ai-fine typing">Reading the rest with the AI…</p>';
    if (await needAI()) {
      busy = true;
      try {
        const reply = await engine().chat(rulesPrompt(cls, leftover.join(' ')), { maxTokens: 300 });
        const got = readModelRules(reply, cls);
        rules = [...rules, ...got.rules];
        unclear = [...unclear, ...got.unclear];
        if (got.rules.length) leftover = [];
      } catch { /* show what we have */ }
      busy = false;
    }
  }
  showRulePlan(out, cls, rules, { unclear, leftover, onPick });
}

// "Here's what I'll do — Apply?"
function showRulePlan(out, cls, rules, { unclear = [], leftover = [], extra = null, onPick = null } = {}) {
  const plan = planRules(rules, cls.hardRules || []);
  const fresh = plan.filter(p => p.status !== 'duplicate');
  const whichAna = unclear.filter(u => u.options.length > 1);
  const unknown = unclear.filter(u => !u.options.length);
  out.innerHTML = `
    ${plan.length || extra ? `<div class="ai-plan"><b>Here’s what I’ll do for ${esc(cls.name)}:</b>
      <ul>${extra ? extra.html : ''}${plan.map((p, i) => `<li class="${p.status}"><label><input type="checkbox" data-i="${i}" ${p.status === 'new' ? 'checked' : ''} ${p.status === 'duplicate' ? 'disabled' : ''}> ${esc(p.text)}</label>${p.note ? `<small>${esc(p.note)}</small>` : ''}</li>`).join('')}</ul>
      <div class="ai-row end"><button type="button" class="rc-btn ai-cancel">Cancel</button><button type="button" class="rc-btn primary ai-apply">Apply</button></div></div>` : ''}
    ${whichAna.map(u => `<div class="ai-note">Which “${esc(u.text.replace(/\b\w/g, c => c.toUpperCase()))}”? ${u.options.map(o => `<button type="button" class="ai-link ai-pick" data-from="${esc(u.text)}" data-to="${esc(o.name)}">${esc(o.name)}</button>`).join(' · ')}</div>`).join('')}
    ${unknown.length ? `<div class="ai-note warn">Not in this class: ${unknown.map(u => '“' + esc(u.text) + '”').join(', ')}</div>` : ''}
    ${leftover.length ? `<div class="ai-note">${aiOn() ? 'I couldn’t turn this into a rule' : 'I couldn’t read this without the on-device AI'}: ${leftover.map(l => '“' + esc(l) + '”').join(' ')}${!aiOn() && device?.webgpu ? ' <button type="button" class="ai-link ai-learn">Turn on the AI</button>' : ''}<br><small>ClassMap rules can keep students apart, near each other, in the same group, at the front or back, or spread out a tag.</small></div>` : ''}
    ${!plan.length && !extra && !unclear.length && !leftover.length ? '<p class="ai-fine">I didn’t find a seating rule there. Try “Keep Ana and Liam apart.”</p>' : ''}
    ${plan.length && !fresh.length && !extra ? '<p class="ai-fine">Those rules are already set.</p>' : ''}`;
  out.querySelector('.ai-learn')?.addEventListener('click', () => openPanel('info'));
  out.querySelectorAll('.ai-pick').forEach(b => b.onclick = () => onPick && onPick(b.dataset.from, b.dataset.to));
  out.querySelector('.ai-cancel')?.addEventListener('click', () => { out.innerHTML = ''; });
  const apply = out.querySelector('.ai-apply');
  if (!apply) return;
  const refresh = () => { apply.disabled = !out.querySelector('.ai-plan input:checked'); };
  out.querySelectorAll('.ai-plan input').forEach(c => c.onchange = refresh);
  refresh();
  apply.onclick = () => {
    const picked = [...out.querySelectorAll('.ai-plan input[data-i]:checked')].map(c => plan[+c.dataset.i].rule);
    const extraOn = extra && out.querySelector('.ai-plan input[data-extra]:checked');
    applyToClass(cls, { rules: picked, tags: extraOn ? extra.tags : null, studentId: extra?.studentId });
    out.innerHTML = '<p class="ai-note ok">✓ Done. You’ll find them in the Rules tab.</p>';
  };
}

// Change the class (and the open chart, if it's this class) — with Undo
function applyToClass(cls, { rules = [], tags = null, studentId = null }) {
  const before = { rules: structuredClone(cls.hardRules || []), students: structuredClone(cls.students || []) };
  const editing = editorOpen() && window._currentChartClassId === cls.id;
  const beforeState = editing ? { rules: structuredClone(state.hardRules || []), students: structuredClone(state.students || []) } : null;
  cls.hardRules = cls.hardRules || [];
  rules.forEach(r => cls.hardRules.push({ ...r }));
  if (tags && tags.length && studentId) {
    const add = s => { s.tags = s.tags || []; tags.forEach(t => { if (!hasTag(s, t)) s.tags.push(t); }); };
    const s = cls.students.find(x => x.id === studentId);
    if (s) add(s);
    if (editing) { const s2 = state.students.find(x => x.id === studentId); if (s2) add(s2); }
  }
  if (editing) state.hardRules = cls.hardRules.map(r => ({ ...r }));
  saveLandingData();
  rerender();
  const n = rules.length + (tags && tags.length ? 1 : 0);
  undoToast(`${rules.length ? plural(rules.length, 'rule') + ' added' : 'Tags added'}${rules.length && tags?.length ? ' · tags added' : ''}`, () => {
    cls.hardRules = before.rules;
    cls.students = before.students;
    if (beforeState && editorOpen() && window._currentChartClassId === cls.id) { state.hardRules = beforeState.rules; state.students = beforeState.students; }
    saveLandingData();
    rerender();
  });
  return n;
}
function rerender() {
  try { if (!editorOpen()) { renderLdRules(); window.__cm_refreshLanding?.(); } else { renderHardRules(); } } catch { /* view not on screen */ }
}

// ═══ 2. Parent email ═══
const TONE = {
  clear: 'Make it clear and easy to read.',
  warm: 'Make it warmer and more encouraging, while staying professional.',
  formal: 'Make it more formal and professional.',
  short: 'Make it shorter. Keep every important fact.',
  es: 'Translate it into clear, warm Spanish that a parent would understand. Use “usted”.',
};
async function runEmail() {
  const text = panel.querySelector('.ai-input').value.trim();
  const tone = panel.querySelector('input[name=aiTone]:checked')?.value || 'clear';
  const out = panel.querySelector('.ai-out');
  if (!text || busy) return;
  if (!(await needAI(out))) { if (aiOn()) out.innerHTML = `<p class="ai-note warn">${esc(loadError || 'The AI isn’t ready.')}</p>`; return; }
  out.innerHTML = '<div class="ai-msg ai-email"></div>';
  const box = out.querySelector('.ai-email');
  const result = await stream([
    { role: 'system', content: `You edit emails a teacher writes to a student's parent or guardian. ${TONE[tone]} Keep every name, date, time and fact exactly as written. Don't add facts, promises or details that aren't in the draft. Plain, respectful words; no jargon. Reply with the finished email only, with no notes before or after it.` },
    { role: 'user', content: text },
  ], box, 700);
  if (!result) return;
  box.insertAdjacentHTML('afterend', `<div class="ai-row end"><button type="button" class="rc-btn ai-again">Try again</button><button type="button" class="rc-btn primary ai-copy">Copy</button></div>`);
  out.querySelector('.ai-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(result); showToast('Copied'); } catch { showToast('Select the text and copy it'); }
  };
  out.querySelector('.ai-again').onclick = runEmail;
}

// ═══ 3. Accommodation summary ═══
const TAG_HINTS = [
  [/\bIEP\b|individuali[sz]ed education/i, 'IEP'],
  [/\b504\b/, '504'],
  [/preferential seating|seat(ed|ing)? (near|close to) (the )?(teacher|instruction|board)/i, 'Preferential seating'],
  [/\bELL\b|\bEL\b|English (language )?learner|ELD\b/i, 'ELL'],
];
const PLACE_HINTS = [
  [/\b(front|near (the )?(board|instruction|teacher)|close to (the )?(board|instruction|teacher)|preferential seating)\b/i, 'front'],
  [/\b(back of the room|rear of the room|seat(ed)? in the back)\b/i, 'back'],
];
async function runAccom() {
  const cls = currentClass();
  const sid = panel.querySelector('.ai-student').value;
  const text = panel.querySelector('.ai-input').value.trim();
  const out = panel.querySelector('.ai-out');
  const s = (cls?.students || []).find(x => x.id === sid);
  if (!s) { out.innerHTML = '<p class="ai-note warn">Pick the student first.</p>'; return; }
  if (!text || busy) return;
  if (!(await needAI(out))) { if (aiOn()) out.innerHTML = `<p class="ai-note warn">${esc(loadError || 'The AI isn’t ready.')}</p>`; return; }
  out.innerHTML = '<div class="ai-msg ai-sum"></div>';
  const box = out.querySelector('.ai-sum');
  // the student's name isn't needed for the summary, so it isn't put in the prompt
  const summary = await stream([
    { role: 'system', content: 'You help a teacher plan seating and daily support for one student. From the accommodations below, write 3 to 5 short bullet points (start each with "- ") that a teacher can act on in class: where to seat the student, how to give directions, attention and breaks, materials. Use only what the text says. Don’t diagnose, guess, or add anything new. No heading, no notes before or after.' },
    { role: 'user', content: text },
  ], box, 300);
  if (!summary) return;
  box.innerHTML = '<ul>' + summary.split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).map(l => `<li>${esc(l)}</li>`).join('') + '</ul>';
  // suggestions come from the teacher's own text (not the model), so they're exact
  const tags = TAG_HINTS.filter(([rx]) => rx.test(text)).map(([, t]) => t).filter(t => !hasTag(s, t));
  const known = classTags(cls);
  const tagNames = tags.map(t => known.find(k => tagKey(k) === tagKey(t)) || PRESET_TAGS.find(k => tagKey(k) === tagKey(t)) || t);
  const place = (PLACE_HINTS.find(([rx]) => rx.test(text)) || [])[1];
  const rules = place ? [{ type: place, a: s }] : [];
  out.insertAdjacentHTML('beforeend', `<div class="ai-row end"><button type="button" class="rc-btn ai-copy">Copy notes</button></div><div class="ai-out2"></div>`);
  out.querySelector('.ai-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(`${s.name}\n${summary}`); showToast('Copied'); } catch { showToast('Select the text and copy it'); }
  };
  if (!tags.length && !rules.length) return;
  // reuse the rule plan, inside its own box, with the tag change as an extra line
  showRulePlan(out.querySelector('.ai-out2'), cls, rules, {
    extra: tagNames.length ? { html: `<li class="new"><label><input type="checkbox" data-extra="1" checked> Tag ${esc(s.name)}: ${tagNames.map(t => '“' + esc(t) + '”').join(', ')}</label><small>tags stay off the projector and printed chart</small></li>`, tags: tagNames, studentId: s.id } : null,
  });
}

// ── Present mode and print: hide the helper ──
export function setPresenting(on) {
  document.body.classList.toggle('presenting', !!on);
  if (on && panel && !panel.hidden) closePanel();
  if (on && tip) { tip.remove(); tip = null; }
}

export const _aiTest = { describe, get prefs() { return prefs; }, setDevice(d) { device = d; }, reloadPrefs() { prefs = loadPrefs(); } };
