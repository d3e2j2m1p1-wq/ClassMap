// ═══════════════════════════════════════════════
//  ClassMap Pixel — entry point (classmap.dev/pixel)
//  A pixel-art editor in the ClassMap look. Phase 1: draw (brush, eraser, line, shape,
//  bucket, eye dropper), palette, undo, gallery on this device, PNG export, backups, offline.
// ═══════════════════════════════════════════════
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/caveat/latin-700.css';
import '../styles/theme-switch.css';
import './pixel.css';

import { state, on, emit, setTool, swapColors } from './editor/state.js';
import { View } from './editor/view.js';
import { initTools, TOOLS } from './editor/tools.js';
import { initInput } from './editor/input.js';
import { writeRect } from './core/history.js';
import { initToolbox, initSliders, initInfo, openSettings, nudgeSize } from './ui/toolbar.js';
import { initPalette, render as renderPalette } from './ui/palette.js';
import { ICONS } from './ui/icons.js';
import { closePopover, toast } from './ui/dialogs.js';
import { openExport, thumbnail } from './ui/export.js';
import { initGallery, render as renderGallery } from './gallery.js';
import { loadArtwork, saveArtwork, persist } from './storage/db.js';
import { initThemeSwitch } from '../ui/themeSwitch.js';

// Light (cream paper) unless ClassMap was set to dark
document.body.classList.toggle('light', document.documentElement.classList.contains('pre-light'));
document.documentElement.classList.remove('pre-light');

const $ = s => document.querySelector(s);
const editor = $('#editor'), gallery = $('#gallery');

// ── header icons ──
$('.px-back').innerHTML = ICONS.back;
$('.px-settings').innerHTML = ICONS.gear;
$('.px-ui').innerHTML = ICONS.eye;
$('.px-show-ui').innerHTML = ICONS.eye;
$('.px-ex-ico').innerHTML = ICONS.download;

// ── the canvas ──
const view = new View($('#stage'));
view.insets = () => {
  const r = $('#stage').getBoundingClientRect();
  if (matchMedia('(max-width: 700px)').matches) {
    const bottom = r.bottom - Math.min($('.px-toolbox').getBoundingClientRect().top, $('.px-palette').getBoundingClientRect().top);
    return { left: 56, right: 0, top: 36, bottom: Math.max(0, bottom) };
  }
  return { left: $('.px-sliders').getBoundingClientRect().right - r.left, right: r.right - $('.px-palette').getBoundingClientRect().left, top: 0, bottom: 40 };
};

// ── undo / redo ──
function commit(patch) {
  state.history.push(patch);
  emit('history');
  markDirty();
}
function applyStep(step, which) {
  if (step.kind !== 'pixels') return;
  const cel = state.sprite.cels.find(c => c.layerId === step.target.layerId && c.frameId === step.target.frameId);
  if (!cel) return;
  const { x, y, w, h } = step.rect;
  writeRect(cel.pixels, cel.w, x, y, w, h, step[which]);
  view.invalidate(x, y, x + w - 1, y + h - 1);
}
const busy = () => !!document.querySelector('#stage.drawing');
const actions = {
  undo: () => { if (state.history.undo(applyStep)) { emit('history'); markDirty(); } },
  redo: () => { if (state.history.redo(applyStep)) { emit('history'); markDirty(); } },
  toggleUI,
  setTool,
  swap: swapColors,
  nudgeSize,
  closePopovers: closePopover,
};

initTools(view, commit);
initInput(view, actions);
initToolbox($('.px-toolbox'));
initSliders($('.px-sliders'), actions);
initPalette($('.px-palette'), () => markDirty());
initInfo($('.px-info'), view);

// eye dropper → back to the tool you were using
let lastTool = state.settings.tool === 'dropper' ? 'brush' : state.settings.tool;
TOOLS.dropper.prev = lastTool;
on('tool', () => {
  if (state.settings.tool !== 'dropper') lastTool = state.settings.tool;
  TOOLS.dropper.prev = lastTool;
  $('#stage').dataset.tool = state.tool;
});
on('back-to-tool', () => setTool(lastTool));
$('#stage').dataset.tool = state.tool;
on('options', () => view.request());

// ── hide / show the panels ──
function toggleUI() {
  state.noUI = !state.noUI;
  document.body.classList.toggle('px-noui', state.noUI);
  $('.px-show-ui').hidden = !state.noUI;
  closePopover();
}
$('.px-ui').addEventListener('click', toggleUI);
$('.px-show-ui').addEventListener('click', toggleUI);
$('.px-settings').addEventListener('click', e => openSettings(e.currentTarget, view));
$('.px-export-btn').addEventListener('click', () => state.sprite && openExport(state.sprite));

// ── saving: a moment after every change, and when the page is hidden ──
let saveT = 0, saving = null, again = false;
const saved = $('.px-saved');
function markDirty() {
  if (!state.sprite) return;
  state.sprite.updatedAt = Date.now();
  saved.textContent = '';
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 700);
}
async function saveNow() {
  clearTimeout(saveT);
  const sp = state.sprite;
  if (!sp) return;
  if (saving) { again = true; return saving; }
  saving = (async () => {
    try {
      await saveArtwork(sp, thumbnail(sp));
      saved.textContent = 'Saved';
    } catch (err) {
      const full = /quota/i.test(err?.name + err?.message);
      toast(full ? "Couldn't save: this device's storage is full. Export a backup and delete old artwork." : "Couldn't save: " + (err?.message || 'storage error'), 6000);
      saved.textContent = 'Not saved';
    }
  })();
  await saving;
  saving = null;
  if (again) { again = false; return saveNow(); }
}
addEventListener('visibilitychange', () => { if (document.hidden && saveT) saveNow(); });
addEventListener('pagehide', () => { if (saveT) saveNow(); });

const nameInput = $('.px-name');
nameInput.addEventListener('input', () => { if (state.sprite) { state.sprite.name = nameInput.value.trim() || 'Untitled'; markDirty(); } });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

// ── gallery ⇄ editor (the address keeps which one is open, so reloading stays put) ──
async function openArt(id) {
  try {
    const sp = await loadArtwork(id);
    state.sprite = sp; state.layerId = sp.layers[0].id; state.frameId = sp.frames[0].id;
    state.history.clear();
    document.body.classList.add('px-editing');
    gallery.hidden = true; editor.hidden = false;
    nameInput.value = sp.name;
    saved.textContent = '';
    if (location.hash !== '#/art/' + id) history.pushState(null, '', '#/art/' + id);
    view.resize();
    view.setSprite();
    emit('sprite'); emit('history'); emit('tool');
    renderPalette();
  } catch (err) {
    toast(err.message || "Couldn't open that artwork");
    showGallery(true);
  }
}
async function showGallery(replace) {
  if (saveT || saving) await saveNow();
  closePopover();
  state.sprite = null;
  document.body.classList.remove('px-editing', 'px-noui');
  state.noUI = false;
  editor.hidden = true; gallery.hidden = false;
  if (location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', location.pathname);
  renderGallery();
}
$('.px-back').addEventListener('click', () => showGallery());
function route() {
  const m = location.hash.match(/^#\/art\/([\w-]+)/);
  if (m) { if (state.sprite?.id !== m[1]) openArt(m[1]); } else if (state.sprite || gallery.hidden) showGallery(true);
}
addEventListener('popstate', route);

initGallery(gallery, openArt);
initThemeSwitch();
route();
if (!location.hash) renderGallery();
persist();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// tests reach the editor through this
if (import.meta.env.DEV) window.__px = { state, view, actions, openArt, showGallery, saveNow, busy };
