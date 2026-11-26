// ═══════════════════════════════════════════════
//  ASK CLASSMAP — the round button in the lower right.
//  No AI: a careful reader for the usual ways of asking (English and Spanish, typos forgiven),
//  answers from the help and the guides, and answers from the real class data.
//  Anything that changes the class shows "Here's what I'll do" and waits for Apply.
//  When it doesn't understand, it shows the closest help answers and phrasings it does know.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import { esc, state } from '../core/state.js';
import { plural, showToast, undoToast } from '../core/ui.js';
import { saveLandingData } from '../storage/landingData.js';
import { editorOpen } from '../storage/autosave.js';
import { renderLdRules } from '../landing/rules.js';
import { renderHardRules } from '../editor/rules.js';
import { hasTag } from '../landing/tags.js';
import { describe, parseRules, planRules } from './rulesNL.js';
import { FAQ, searchHelp } from './help.js';
import { fixTypos, rephrase } from './understand.js';
import { fromSpanish } from '../i18n/spanishCommands.js';
import { context, planCommands, readCommand, restore, snapshot } from './commands.js';

// What the helper remembers on this device: where the button was dragged to
const PREFS_KEY = 'cm-ai';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } };
let prefs = loadPrefs();
const set = patch => { prefs = { ...prefs, ...patch }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };

let root, bubble, panel;
let busy = false;

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
    <button type="button" class="ai-bubble" aria-label="Ask ClassMap" title="Ask ClassMap: questions, and things to do">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.3 1.2 4.4 3.2 5.8L4.5 21l4.3-2.4c1 .3 2.1.4 3.2.4 5.5 0 10-3.6 10-8s-4.5-8-10-8Z"/><circle cx="8" cy="11" r="1.3" fill="var(--ai-dot)"/><circle cx="12" cy="11" r="1.3" fill="var(--ai-dot)"/><circle cx="16" cy="11" r="1.3" fill="var(--ai-dot)"/></svg>
    </button>
    <div class="ai-panel" role="dialog" aria-label="Ask ClassMap" hidden></div>`;
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

// ── Panel ──
export function openPanel() {
  panel.hidden = false;
  bubble.classList.add('open');
  render();
  placePanel();
}
export function closePanel() {
  panel.hidden = true;
  bubble.classList.remove('open');
}
function togglePanel() { panel.hidden ? openPanel() : closePanel(); }

function render() {
  const typed = panel.querySelector('.ai-ask-in')?.value || '';     // keep what's being typed across redraws
  panel.innerHTML = `<div class="ai-head">
      <div class="ai-title">Ask ClassMap<small>Questions, or things to do</small></div>
      <button type="button" class="ai-icon ai-close" aria-label="Close">✕</button>
    </div>
    <div class="ai-body">
      <div class="ai-chat-slot"></div>
      <div class="ai-compose">
        <textarea class="ai-ask-in" rows="1" placeholder="Ask or tell ClassMap…" aria-label="Ask or tell ClassMap"></textarea>
        <button type="button" class="ai-send" aria-label="Send">➤</button>
      </div>
    </div>`;
  const askIn = panel.querySelector('.ai-ask-in');
  if (askIn && typed) askIn.value = typed;
  panel.querySelector('.ai-close').onclick = closePanel;
  wireChat();
  placePanel();
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
function sayings(n = 3) {
  const ctx = context();
  const ss = ctx.editing ? state.students : (ctx.cls?.students || []);
  const first = i => (ss[i]?.name || ['Liam', 'Ana', 'Owen', 'Mia'][i]).split(' ')[0];
  const ex = !ctx.cls ? ['Make a class called Period 4', 'What classes do I have?', 'How do I print a chart?', '5 minute timer']
    : ctx.editing ? [`Swap ${first(0)} and ${first(1)}`, `Who sits next to ${first(2)}?`, 'Check the rules', `Keep ${first(0)} and ${first(3)} apart`, 'Who doesn’t have a seat?', 'Auto-assign seats']
    : [`Keep ${first(0)} and ${first(1)} apart`, 'Who’s tagged IEP?', 'Add students: Jo Smith, Sam Lee', 'Start a new chart', 'Pick a random student', 'Take attendance'];
  return ex.slice(0, n);
}
function examples() {
  const d = document.createElement('div');
  d.className = 'ai-examples';
  d.innerHTML = `<p class="ai-fine">Ask a question or tell ClassMap what to do. Nothing changes until you press Apply.</p>` +
    sayings(5).map(t => `<button type="button" class="ai-chip ai-ex">${esc(t)}</button>`).join('');
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

// Try the reader on the words as typed, then in Spanish, then with typos fixed and common
// phrasings rewritten. The first reading that isn't just "look it up in the help" wins.
function understand(text, ctx) {
  const tries = [text, fromSpanish(text)].filter(Boolean);
  tries.slice().forEach(t => { const f = fixTypos(t, ctx); if (f !== t) tries.push(f); });
  tries.slice().forEach(t => { const r = rephrase(t); if (r !== t) tries.push(r); });
  let help = null;
  for (const t of tries) {
    const c = readCommand(t, ctx);
    if (!c) continue;
    if (c[0].action === 'help') { help = help || c; continue; }
    return c;
  }
  return help;
}

export async function send(text) {
  say('me', esc(text));
  const box = say('bot', '');
  const cmds = understand(text, context());
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
    const fixed = fixTypos(r.query || text, context());
    let hits = await searchHelp(fixed, 3);
    const top = hits[0];
    // a clear match: show the answer itself (a second one only if it's as good)
    if (top && (r.kind === 'help' ? top.score >= 2 : top.score >= 5)) {
      hits = hits.filter((h, i) => i === 0 || h.score >= top.score * 0.8).slice(0, 2);
      part.innerHTML = hits.map(helpHTML).join('');
      wireHelp(part);
      return;
    }
    // not sure: the closest help answers to pick from, and ways of asking that work
    const near = (await searchHelp(fixed, 3, 1));
    part.innerHTML = `<p>I’m not sure what you mean.${near.length ? ' Is it one of these?' : ''}</p>
      ${near.length ? `<div class="ai-near">${near.map((h, i) => `<button type="button" class="ai-chip ai-near-q" data-i="${i}">${esc(h.title)}</button>`).join('')}</div>` : ''}
      <p class="ai-fine">Or try saying it like this:</p>
      <div class="ai-near">${sayings().map(t => `<button type="button" class="ai-chip ai-ex">${esc(t)}</button>`).join('')}</div>
      <p class="ai-fine">Still stuck? <a href="/contact/" target="_blank" rel="noopener">Tell us what you were looking for</a>, and we’ll teach ClassMap to understand it.</p>`;
    part.querySelectorAll('.ai-near-q').forEach(b => b.onclick = () => {
      const h = near[+b.dataset.i];
      const ans = document.createElement('div');
      ans.className = 'ai-part';
      ans.innerHTML = helpHTML(h);
      wireHelp(ans);
      part.after(ans);
      b.disabled = true;
      chatEl().scrollTop = chatEl().scrollHeight;
    });
    part.querySelectorAll('.ai-ex').forEach(b => b.onclick = () => { const i = panel.querySelector('.ai-ask-in'); i.value = b.textContent; i.focus(); });
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

// Help answers are shown exactly as written
function helpHTML(h) {
  const faq = FAQ.find(f => f.q === h.title);
  return `<div class="ai-hit"><b>${esc(h.title)}</b><p>${esc(h.text.length > 320 ? h.text.slice(0, 320) + '…' : h.text)}</p>
    ${faq && faq.do ? `<button type="button" class="ai-link ai-doit" data-do="${esc(faq.do)}">Or I can do it: “${esc(faq.do.trim())}…”</button>` : ''}
    ${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">Read the guide ↗</a>` : ''}</div>`;
}
function wireHelp(el) {
  el.querySelectorAll('.ai-doit').forEach(b => b.onclick = () => { const i = panel.querySelector('.ai-ask-in'); i.value = b.dataset.do; i.focus(); });
}

// ═══ 1. Seating rules ═══
async function runRules(text, out, onPick) {
  const cls = currentClass();
  if (!cls || !text.trim()) return;
  if (!(cls.students || []).length) { out.innerHTML = '<p class="ai-note warn">This class has no students yet. Say “Add students: …” or use the Roster tab.</p>'; return; }
  const { rules, unclear, leftover } = parseRules(text, cls);
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
    ${leftover.length ? `<div class="ai-note">I couldn’t turn this into a rule: ${leftover.map(l => '“' + esc(l) + '”').join(' ')}<br><small>ClassMap rules can keep students apart, near each other, in the same group, at the front or back, or spread out a tag.</small></div>` : ''}
    ${!plan.length && !extra && !unclear.length && !leftover.length ? '<p class="ai-fine">I didn’t find a seating rule there. Try “Keep Ana and Liam apart.”</p>' : ''}
    ${plan.length && !fresh.length && !extra ? '<p class="ai-fine">Those rules are already set.</p>' : ''}`;
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

// ── Present mode and print: hide the helper ──
export function setPresenting(on) {
  document.body.classList.toggle('presenting', !!on);
  if (on && panel && !panel.hidden) closePanel();
}

export const _aiTest = { describe, get prefs() { return prefs; }, reloadPrefs() { prefs = loadPrefs(); } };
