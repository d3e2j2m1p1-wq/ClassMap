// ═══════════════════════════════════════════════
//  LANGUAGE — English (as written in the code) or Spanish.
//  The app is written in English; in Spanish a dictionary translates what's on screen as it
//  appears (text and placeholder/title/aria-label), and puts the English back when you switch.
//  Never translated: names you typed (students, classes, charts, tables), anything you type,
//  the room drawing, and the projector/print copies of the chart.
// ═══════════════════════════════════════════════
import { store } from '../core/store.js';
import ES from './es.js';

const KEY = 'cm-lang';
let lang = 'en';
let compiled = null;          // { exact: Map, templates: [{ re, out }] }
const cache = new Map();      // text → translation (or null)
const original = new WeakMap(); // text node → English
const originalAttr = new WeakMap(); // element → { attr: English }
const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = '[data-no-i18n], script, style, textarea, input, .seat-chip, .table-name, .table-name-pill, .chip-pill, .ai-me, .print-stage, .tp-page, .csp-name, .group-name, .tools-here-panel .tools-chip, .ld-student-name, .class-item-name, .chart-name';

export const getLang = () => lang;
export const isSpanish = () => lang === 'es';

export function initLanguage() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* none */ }
  lang = saved || (/^es\b/i.test(navigator.language || '') ? 'es' : 'en');
  document.documentElement.lang = lang;
  new MutationObserver(onMutations).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (lang === 'es') walk(document.body);
}

export function setLanguage(l) {
  lang = l === 'es' ? 'es' : 'en';
  try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  document.documentElement.lang = lang;
  if (lang === 'es') walk(document.body); else restoreAll(document.body);
}

// ── Dictionary ──
function compile() {
  const exact = new Map(), templates = [];
  Object.entries(ES).forEach(([en, es]) => {
    const k = norm(en);
    if (!/\{(n|name)?\}/.test(k)) { exact.set(k, es); return; }
    // {n} matches a number only; {name} only a student's or class's name; {} anything
    const kinds = [];
    const src = k.split(/(\{(?:n|name)?\})/).map(p => {
      if (p === '{}' || p === '{name}') { kinds.push(p); return '(.+?)'; }
      if (p === '{n}') { kinds.push(p); return '(\\d+(?:[.,]\\d+)?)'; }
      return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    templates.push({ re: new RegExp('^' + src + '$'), out: es, kinds, weight: k.replace(/\{(n|name)?\}/g, '').length + (k.includes('{n}') ? 0.5 : 0) });
  });
  templates.sort((a, b) => b.weight - a.weight);       // most specific first
  return { exact, templates };
}
const norm = s => String(s).replace(/\s+/g, ' ').trim();

// Names the teacher typed: never translated, even if a name is also a word ("May", "Reading")
let namesCache = { ref: null, set: new Set() };
function names() {
  const d = store.landingData;
  if (namesCache.ref !== d || namesCache.n !== (d?.classes || []).reduce((n, c) => n + (c.students || []).length, 0)) {
    const set = new Set();
    (d?.classes || []).forEach(c => { set.add(c.name); (c.students || []).forEach(s => { set.add(s.name); set.add(s.name.split(' ')[0]); }); });
    (d?.charts || []).forEach(c => c.name && set.add(c.name));
    namesCache = { ref: d, n: (d?.classes || []).reduce((n, c) => n + (c.students || []).length, 0), set };
  }
  return namesCache.set;
}

export function translate(text) {
  if (lang !== 'es') return text;
  const k = norm(text);
  if (!k || !/[A-Za-z]/.test(k)) return text;
  if (names().has(k)) return text;          // checked before the cache: names can be added any time
  if (cache.has(k)) return cache.get(k) ?? text;
  compiled ||= compile();
  let out = lookup(k, 0);
  // "a · b · c": translate each part
  if (out == null && k.includes(' · ')) {
    const parts = k.split(' · ').map(p => lookup(p, 0) ?? p);
    if (parts.some((p, i) => p !== k.split(' · ')[i])) out = parts.join(' · ');
  }
  cache.set(k, out);
  return out ?? text;
}
function lookup(k, depth) {
  if (names().has(k)) return null;
  const hit = compiled.exact.get(k);
  if (hit != null) return hit;
  if (depth > 1) return null;
  for (const t of compiled.templates) {
    const m = t.re.exec(k);
    if (!m) continue;
    if (t.kinds.some((kind, i) => kind === '{name}' && !names().has(norm(m[i + 1])))) continue;
    // the parts that change: translate them too if they're app words; "A, B and C" lists get "y"
    const vals = m.slice(1).map(v => lookup(norm(v), depth + 1) ?? (names().has(norm(v)) ? v : v.replace(/ and (?=[^,]+$)/, ' y ')));
    let i = 0;
    return t.out.replace(/\{(\d*|n|name)\}/g, (_, n) => (/^\d+$/.test(n) ? vals[+n] : vals[i++]) ?? '');
  }
  return null;
}

// ── The page ──
function skip(el) { return !el || el.nodeType !== 1 ? false : !!el.closest(SKIP); }
const skipAttrs = el => !!el.closest('[data-no-i18n], script, style');

function doText(node) {
  if (skip(node.parentElement)) return;
  const cur = node.data;
  const known = original.get(node);
  // the app changed this text since we translated it → that's the new English
  const en = known && known.out === cur ? known.en : cur;
  const tr = translate(en);
  if (tr === en) { if (known && known.out !== cur) original.delete(node); return; }
  const lead = en.match(/^\s*/)[0], trail = en.match(/\s*$/)[0];
  const out = lead + tr + trail;
  original.set(node, { en, out });
  if (node.data !== out) node.data = out;
}
function doAttrs(el) {
  if (skipAttrs(el)) return;
  let rec = originalAttr.get(el);
  ATTRS.forEach(a => {
    const cur = el.getAttribute(a);
    if (cur == null) return;
    const known = rec && rec[a];
    const en = known && known.out === cur ? known.en : cur;
    const tr = translate(en);
    if (tr === en) return;
    rec ||= {};
    rec[a] = { en, out: tr };
    originalAttr.set(el, rec);
    if (cur !== tr) el.setAttribute(a, tr);
  });
}
function walk(root) {
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  doAttrs(root);
  if (skip(root)) { root.querySelectorAll('[title],[aria-label],[placeholder]').forEach(doAttrs); return; }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.nodeType === 1 && skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let n;
  while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  // tooltips inside the parts we don't translate (the room, names) still get translated
  root.querySelectorAll(SKIP).forEach(z => { doAttrs(z); z.querySelectorAll('[title],[aria-label],[placeholder]').forEach(doAttrs); });
}
function onMutations(list) {
  if (lang !== 'es') return;
  for (const m of list) {
    if (m.type === 'childList') m.addedNodes.forEach(walk);
    else if (m.type === 'characterData') doText(m.target);
    else if (m.type === 'attributes') doAttrs(m.target);
  }
}
function restoreAll(root) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    if (n.nodeType === 3) { const k = original.get(n); if (k && n.data === k.out) n.data = k.en; original.delete(n); }
    else { const rec = originalAttr.get(n); if (rec) { Object.entries(rec).forEach(([a, v]) => { if (n.getAttribute(a) === v.out) n.setAttribute(a, v.en); }); originalAttr.delete(n); } }
  }
}
