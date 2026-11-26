// ═══════════════════════════════════════════════
//  Timeline: layers are rows, frames are columns, each square is a cel.
//  ● = the cel has pixels, ○ = empty; a bar joins linked cels. Coloured bars above the frame
//  numbers are tags (tap one to edit it or play only that part).
//  Tap a frame number to go there; Shift-tap selects a run, Ctrl/⌘-tap adds one;
//  drag a frame number sideways to move frames; double-tap it to set how long it shows.
// ═══════════════════════════════════════════════
import { state, on, emit, saveSettings } from '../editor/state.js';
import { displayRows, isGroup, find } from '../core/layers.js';
import * as anim from '../editor/anim.js';
import { setActive } from '../editor/doc.js';
import { ICONS } from './icons.js';
import { popover, seg, toggle, range, bindControls, esc, toast, openDialog } from './dialogs.js';

const CELL = 30;
let root, body, actions;
let empty = new WeakMap();

const isEmpty = px => {
  if (empty.has(px)) return empty.get(px);
  let e = true;
  for (let i = 3; i < px.length; i += 4) if (px[i]) { e = false; break; }
  empty.set(px, e);
  return e;
};

export function initTimeline(el, acts) {
  root = el; actions = acts;
  root.innerHTML = `
    <div class="px-tl-bar">
      <button type="button" class="px-tl-btn" data-a="first" aria-label="First frame" title="First frame">${ICONS.first}</button>
      <button type="button" class="px-tl-btn" data-a="prev" aria-label="Previous frame" title="Previous frame (,)">${ICONS.prev}</button>
      <button type="button" class="px-tl-btn px-tl-play" data-a="play" aria-label="Play" title="Play / pause (Enter)">${ICONS.play}</button>
      <button type="button" class="px-tl-btn" data-a="next" aria-label="Next frame" title="Next frame (.)">${ICONS.next}</button>
      <button type="button" class="px-tl-btn" data-a="last" aria-label="Last frame" title="Last frame">${ICONS.last}</button>
      <span class="px-tl-count"></span>
      <span class="px-tl-sep"></span>
      <button type="button" class="px-tl-btn" data-a="add" aria-label="New frame" title="New frame (Alt+N)">${ICONS.frameAdd}</button>
      <button type="button" class="px-tl-btn" data-a="dup" aria-label="Duplicate frames" title="Duplicate the selected frames">${ICONS.copy}</button>
      <button type="button" class="px-tl-btn" data-a="del" aria-label="Delete frames" title="Delete the selected frames">${ICONS.trash}</button>
      <span class="px-tl-sep"></span>
      <button type="button" class="px-tl-btn px-tl-onion" data-a="onion" aria-label="Onion skin" title="Onion skin — tap again for options">${ICONS.onion}</button>
      <button type="button" class="px-tl-btn" data-a="tag" aria-label="New tag" title="Tag the selected frames">${ICONS.tag}</button>
      <button type="button" class="px-tl-btn" data-a="link" aria-label="Link cels" title="Link the selected frames' cels on this layer">${ICONS.link}</button>
      <button type="button" class="px-tl-btn" data-a="more" aria-label="More" title="More">${ICONS.more}</button>
      <span class="px-tl-spacer"></span>
      <button type="button" class="px-tl-btn" data-a="preview" aria-label="Preview window" title="Preview window">${ICONS.film}</button>
      <button type="button" class="px-tl-btn px-tl-fold" data-a="fold" aria-label="Show or hide the timeline" title="Show / hide the timeline">${ICONS.chevron}</button>
    </div>
    <div class="px-tl-body"></div>`;
  body = root.querySelector('.px-tl-body');
  root.querySelector('.px-tl-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (b) bar(b.dataset.a, b);
  });
  wireGrid();
  for (const ev of ['frames', 'frame', 'layers', 'sprite', 'play', 'settings']) on(ev, render);
  let t = 0;
  on('changed', () => { empty = new WeakMap(); clearTimeout(t); t = setTimeout(render, 250); });
  render();
}

function bar(a, btn) {
  const S = state.settings;
  ({
    first: anim.firstFrame, last: anim.lastFrame, prev: () => anim.stepFrame(-1), next: () => anim.stepFrame(1),
    play: anim.togglePlay, add: anim.addFrame, dup: anim.duplicateFrames, del: anim.deleteFrames,
    onion: () => { if (!S.onion.on) { S.onion.on = true; saveSettings(); emit('settings'); } else onionOptions(btn); },
    tag: () => { const id = anim.addTag(); setTimeout(() => { const el = root.querySelector(`[data-tag="${id}"]`); if (el) tagOptions(el, id); }, 30); },
    link: () => anim.linkCels(),
    more: () => moreMenu(btn),
    preview: () => { S.preview.open = !S.preview.open; saveSettings(); emit('preview'); render(); },
    fold: () => { S.timeline = !S.timeline; saveSettings(); emit('timeline'); render(); },
  })[a]?.();
}

export function render() {
  const sp = state.sprite;
  if (!root || !sp) return;
  const S = state.settings, fr = sp.frames, cur = anim.frameIndex();
  root.classList.toggle('folded', !S.timeline);
  root.querySelector('.px-tl-play').innerHTML = state.playing ? ICONS.pause : ICONS.play;
  root.querySelector('.px-tl-play').classList.toggle('on', state.playing);
  root.querySelector('.px-tl-onion').classList.toggle('on', S.onion.on);
  root.querySelector('[data-a="preview"]').classList.toggle('on', S.preview.open);
  root.querySelector('.px-tl-count').textContent = `${cur + S.numberFrom} / ${fr.length - 1 + S.numberFrom}`;
  if (!S.timeline) { body.innerHTML = ''; emit('timeline-size'); return; }

  const rows = displayRows(sp);
  const sel = state.selectedFrames;
  const head = fr.map((f, i) => `<div class="px-tl-head${i === cur ? ' cur' : ''}${sel.has(f.id) ? ' sel' : ''}" data-f="${f.id}" title="Frame ${i + S.numberFrom} · ${f.durationMs} ms"><b>${i + S.numberFrom}</b><small>${f.durationMs}</small></div>`).join('');
  const tags = sp.tags.map(t => `<button type="button" class="px-tl-tag${state.playTag === t.id ? ' playing' : ''}" data-tag="${t.id}" style="left:${t.from * CELL}px;width:${(t.to - t.from + 1) * CELL - 2}px;--c:${t.color}" title="${esc(t.name)} · ${t.direction}">${esc(t.name)}</button>`).join('');
  const rowHTML = rows.map(({ node: n, depth }) => {
    const g = isGroup(n), act = n.id === state.layerId;
    const name = `<div class="px-tl-name${act ? ' active' : ''}${n.visible ? '' : ' hidden-layer'}" data-l="${n.id}" style="--d:${depth}">${g ? ICONS.folder : ''}<span>${esc(n.name)}</span></div>`;
    if (g) return `<div class="px-tl-row group">${name}<div class="px-tl-cells">${fr.map(() => '<i class="px-tl-cel none"></i>').join('')}</div></div>`;
    const cels = fr.map((f, i) => {
      const c = sp.cels.find(c => c.layerId === n.id && c.frameId === f.id);
      const e = !c || isEmpty(c.pixels);
      const prev = i > 0 && sp.cels.find(x => x.layerId === n.id && x.frameId === fr[i - 1].id);
      const nxt = i < fr.length - 1 && sp.cels.find(x => x.layerId === n.id && x.frameId === fr[i + 1].id);
      const linkL = c?.link && prev?.link === c.link, linkR = c?.link && nxt?.link === c.link;
      return `<button type="button" class="px-tl-cel${e ? ' empty' : ''}${act && i === cur ? ' cur' : ''}${i === cur ? ' curcol' : ''}${sel.has(f.id) ? ' selcol' : ''}${linkL ? ' ll' : ''}${linkR ? ' lr' : ''}${c?.link ? ' linked' : ''}" data-l="${n.id}" data-f="${f.id}" aria-label="${esc(n.name)}, frame ${i + S.numberFrom}"></button>`;
    }).join('');
    return `<div class="px-tl-row">${name}<div class="px-tl-cells">${cels}</div></div>`;
  }).join('');
  const sx = body.querySelector('.px-tl-scroll')?.scrollLeft || 0, sy = body.querySelector('.px-tl-scroll')?.scrollTop || 0;
  body.innerHTML = `<div class="px-tl-scroll" style="--cell:${CELL}px">
    <div class="px-tl-top"><div class="px-tl-corner"></div><div class="px-tl-heads"><div class="px-tl-tags">${tags}</div><div class="px-tl-nums">${head}</div></div></div>
    ${rowHTML}</div>`;
  const sc = body.querySelector('.px-tl-scroll');
  sc.scrollLeft = sx; sc.scrollTop = sy;
  // keep the current frame in view
  const left = cur * CELL, vis = sc.clientWidth - 130;
  if (left < sc.scrollLeft) sc.scrollLeft = left; else if (left + CELL > sc.scrollLeft + vis) sc.scrollLeft = left + CELL - vis;
  emit('timeline-size');
}

let lastHead = { id: null, t: 0 };
function wireGrid() {
  let drag = null;
  body.addEventListener('click', e => {
    if (drag?.moved) return;
    const tag = e.target.closest('[data-tag]');
    if (tag) { tagOptions(tag, tag.dataset.tag); return; }
    const cel = e.target.closest('.px-tl-cel[data-f]');
    if (cel) {
      if (e.shiftKey) { anim.selectFrame(cel.dataset.f, 'range'); return; }
      if (cel.dataset.l !== state.layerId) setActive(cel.dataset.l);
      if (cel.dataset.f !== state.frameId) anim.goToFrame(cel.dataset.f);
      else if (!e.ctrlKey && !e.metaKey) celOptions(cel, cel.dataset.l, cel.dataset.f);
      return;
    }
    const h = e.target.closest('.px-tl-head');
    if (h) {
      // the timeline redraws on every click, so a double-tap is spotted here rather than by dblclick
      const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey;
      const now = performance.now(), again = plain && lastHead.id === h.dataset.f && now - lastHead.t < 400;
      lastHead = plain && !again ? { id: h.dataset.f, t: now } : { id: null, t: 0 };
      if (again) { durationDialog(); return; }
      anim.selectFrame(h.dataset.f, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : null);
      return;
    }
    const nm = e.target.closest('.px-tl-name');
    if (nm && find(state.sprite, nm.dataset.l)) setActive(nm.dataset.l);
  });
  // drag frame numbers sideways to reorder
  body.addEventListener('pointerdown', e => {
    const h = e.target.closest('.px-tl-head'); if (!h) return;
    drag = { id: h.dataset.f, x: e.clientX, moved: false };
  });
  body.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 10) return;
    if (!drag.moved) { drag.moved = true; try { body.setPointerCapture(e.pointerId); } catch { /* */ } }
    const nums = body.querySelector('.px-tl-nums').getBoundingClientRect();
    drag.to = Math.max(0, Math.round((e.clientX - nums.left) / CELL));
    body.querySelectorAll('.px-tl-head').forEach((el, i) => el.classList.toggle('drop', i === drag.to));
  });
  const end = () => {
    if (!drag) return;
    const d = drag;
    setTimeout(() => { drag = null; }, 0);
    if (!d.moved || d.to == null) return;
    const ids = state.selectedFrames.has(d.id) ? [...state.selectedFrames] : [d.id];
    const fr = state.sprite.frames, before = fr.slice(0, d.to).filter(f => !ids.includes(f.id)).length;
    anim.moveFrames(ids, before);
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
}

export async function durationDialog() {
  const ids = state.sprite.frames.filter(f => state.selectedFrames.has(f.id));
  const cur = (ids[0] || state.sprite.frames[anim.frameIndex()]).durationMs;
  const bodyEl = document.createElement('div');
  bodyEl.innerHTML = `<p>${ids.length > 1 ? `${ids.length} frames` : 'This frame'}</p>
    <div class="px-wh"><label class="px-field"><span>Milliseconds</span><input type="number" class="px-du-ms" min="10" max="65535" value="${cur}"></label>
    <span class="px-wh-x">or</span><label class="px-field"><span>Frames per second</span><input type="number" class="px-du-fps" min="1" max="100" value="${Math.round(1000 / cur)}"></label></div>`;
  const ms = bodyEl.querySelector('.px-du-ms'), fps = bodyEl.querySelector('.px-du-fps');
  ms.addEventListener('input', () => { fps.value = Math.round(1000 / Math.max(1, ms.value)); });
  fps.addEventListener('input', () => { ms.value = Math.round(1000 / Math.max(1, fps.value)); });
  const ok = await openDialog({ title: 'Frame duration', body: bodyEl, actions: [{ label: 'Cancel', value: false }, { label: 'Set', kind: 'primary', value: true }], onOpen: o => setTimeout(() => o.querySelector('.px-du-ms').select(), 0) });
  if (ok) anim.setDuration(Number(ms.value));
}

function onionOptions(anchor) {
  const O = state.settings.onion;
  const el = document.createElement('div');
  el.className = 'px-opts';
  el.innerHTML = `<div class="px-pop-title">Onion skin</div>
    ${toggle('on', O.on, 'Show neighbouring frames')}
    ${range('before', O.before, 0, 5, 'Frames before')}
    ${range('after', O.after, 0, 5, 'Frames after')}
    ${range('opacity', O.opacity, 10, 90, 'Strength', '%')}
    ${range('falloff', O.falloff, 20, 100, 'Each further frame keeps', '%')}
    <div class="px-onion-tints"><label class="px-field"><span>Before tint</span><input type="color" data-tint="tintBefore" value="${O.tintBefore}"></label>
    <label class="px-field"><span>After tint</span><input type="color" data-tint="tintAfter" value="${O.tintAfter}"></label></div>
    <p class="px-hint">White = no tint.</p>
    ${toggle('tagOnly', O.tagOnly, 'Only frames inside the current tag')}
    ${toggle('wrap', O.wrap, 'Wrap around at the ends')}`;
  bindControls(el, (k, v) => { O[k] = v; saveSettings(); emit('settings'); });
  el.querySelectorAll('[data-tint]').forEach(i => i.addEventListener('input', () => { O[i.dataset.tint] = i.value; saveSettings(); emit('settings'); }));
  popover(anchor, el, { side: 'top', className: 'px-opts-pop' });
}

function tagOptions(anchor, id) {
  const t = state.sprite.tags.find(t => t.id === id);
  if (!t) return;
  const el = document.createElement('div');
  el.className = 'px-opts';
  const swatches = ['#F25F6B', '#0E8A9E', '#F5B544', '#6E4FC0', '#1C8C5E', '#D93F4C', '#2B1D1A', '#7FD0DC'];
  el.innerHTML = `<div class="px-pop-title">Tag</div>
    <label class="px-field"><span>Name</span><input type="text" class="px-tag-name" value="${esc(t.name)}" maxlength="40"></label>
    <div class="px-tag-colors">${swatches.map(c => `<button type="button" class="px-sw${c === t.color ? ' on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
    <div class="px-mini-label">Plays</div>
    ${seg('direction', t.direction, [['forward', 'Forward'], ['reverse', 'Reverse'], ['pingpong', 'Ping-pong']])}
    ${range('repeat', t.repeat || 0, 0, 10, 'Repeat (0 = always loop)')}
    <div class="px-lp-actions">
      <button type="button" class="px-btn px-btn-ghost" data-a="play">${state.playTag === id ? 'Stop looping this tag' : 'Loop only this tag'}</button>
      <button type="button" class="px-btn px-btn-danger" data-a="del">Delete tag</button>
    </div>`;
  const name = el.querySelector('.px-tag-name');
  name.addEventListener('change', () => { if (name.value.trim()) anim.updateTag(id, { name: name.value.trim() }); });
  bindControls(el, (k, v) => anim.updateTag(id, { [k]: v }));
  el.addEventListener('click', e => {
    const c = e.target.closest('[data-c]');
    if (c) { anim.updateTag(id, { color: c.dataset.c }); el.querySelectorAll('[data-c]').forEach(b => b.classList.toggle('on', b === c)); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'play') { state.playTag = state.playTag === id ? null : id; pop.close(); render(); }
    if (a === 'del') { pop.close(); anim.deleteTag(id); }
  });
  const pop = popover(anchor, el, { side: 'top', className: 'px-opts-pop' });
}

function celOptions(anchor, layerId, frameId) {
  const c = state.sprite.cels.find(c => c.layerId === layerId && c.frameId === frameId);
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'px-opts';
  const op = Math.round((c.opacity ?? 255) / 2.55);
  el.innerHTML = `<div class="px-pop-title">Cel</div>
    <label class="px-range"><span>Opacity (this frame only)</span><input type="range" class="px-cel-op" min="0" max="100" value="${op}"><output>${op}%</output></label>
    <label class="px-field"><span>Note for game engines (exported in the JSON)</span><input type="text" class="px-cel-data" value="${esc(c.userData || '')}" maxlength="200"></label>
    <div class="px-lp-actions">
      ${c.link ? '<button type="button" class="px-btn px-btn-ghost" data-a="unlink">Unlink</button>' : ''}
      <button type="button" class="px-btn px-btn-ghost" data-a="clear">Clear cel</button>
    </div>`;
  const r = el.querySelector('.px-cel-op');
  r.addEventListener('input', () => { r.nextElementSibling.textContent = r.value + '%'; });
  r.addEventListener('change', () => anim.setCelProps(layerId, frameId, { opacity: Math.round(r.value * 2.55) }));
  el.querySelector('.px-cel-data').addEventListener('change', e => anim.setCelProps(layerId, frameId, { userData: e.target.value.trim() || undefined }));
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    pop.close();
    if (a === 'unlink') anim.unlinkCels(layerId, [frameId]);
    if (a === 'clear') anim.clearCel(layerId, frameId);
  });
  const pop = popover(anchor, el, { side: 'top', className: 'px-opts-pop' });
}

function moreMenu(anchor) {
  const m = document.createElement('div');
  m.className = 'px-menu';
  const n = find(state.sprite, state.layerId)?.node;
  m.innerHTML = `
    <button type="button" data-a="dur">Frame duration…</button>
    <button type="button" data-a="unlink">Unlink cels</button>
    <button type="button" data-a="clear">Clear this cel</button>
    ${n && !isGroup(n) ? `<button type="button" data-a="auto">${n.autoLinkOnDuplicate ? '✓ ' : ''}Link this layer's cels when duplicating frames</button>` : ''}
    <hr><div class="px-menu-title">Frame numbers start at</div>
    <button type="button" data-a="n0">${state.settings.numberFrom === 0 ? '✓ ' : ''}0</button>
    <button type="button" data-a="n1">${state.settings.numberFrom === 1 ? '✓ ' : ''}1</button>`;
  const pop = popover(anchor, m, { side: 'top' });
  m.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    pop.close();
    if (a === 'dur') durationDialog();
    if (a === 'unlink') anim.unlinkCels();
    if (a === 'clear') anim.clearCel();
    if (a === 'auto') { n.autoLinkOnDuplicate = !n.autoLinkOnDuplicate; emit('dirty'); toast(n.autoLinkOnDuplicate ? 'Duplicated frames will share this layer\'s pixels' : 'Duplicated frames get their own copy'); }
    if (a === 'n0' || a === 'n1') { state.settings.numberFrom = a === 'n0' ? 0 : 1; saveSettings(); render(); }
  });
}

export { actions };
