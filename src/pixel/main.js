// ═══════════════════════════════════════════════
//  ClassMap Pixel — entry point (classmap.dev/pixel)
//  A pixel-art editor in the ClassMap look.
//  Phase 1: draw, palette, undo, gallery on this device, PNG export, backups, offline.
//  Phase 2: layers and groups, blend modes, selections, move / transform, clipboard,
//           symmetry, reference images, presets, settings, shortcuts.
// ═══════════════════════════════════════════════
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/caveat/latin-700.css';
import '../styles/theme-switch.css';
import './pixel.css';

import { state, on, emit, setTool, swapColors, saveSettings } from './editor/state.js';
import { View } from './editor/view.js';
import { initTools, TOOLS } from './editor/tools.js';
import { initInput } from './editor/input.js';
import { writeRect } from './core/history.js';
import { leafLayers } from './core/layers.js';
import { initDoc, applyStruct, addLayer, setActive } from './editor/doc.js';
import { initMove, applyMove, cancelMove, discardMove, nudge, update as updateMove, startMove } from './editor/move.js';
import { initClipboard, copy, pasteButton, onPasteEvent } from './editor/clipboard.js';
import { initSelectOps, selectAll, deselect, invertSelection, clearSelected, fillSelected, outlineSelected } from './editor/selectOps.js';
import { initToolbox, initSliders, initInfo, nudgeSize } from './ui/toolbar.js';
import { initPalette, render as renderPalette } from './ui/palette.js';
import { initLayers, render as renderLayers } from './ui/layers.js';
import { initContextBar, render as renderContext } from './ui/contextbar.js';
import { initTimeline, render as renderTimeline } from './ui/timeline.js';
import { initPreview } from './ui/preview.js';
import * as anim from './editor/anim.js';
import { initRefs, openRefMenu, addReference } from './ui/refs.js';
import { openSettings } from './ui/settings.js';
import { ICONS } from './ui/icons.js';
import { closePopover, toast } from './ui/dialogs.js';
import { openExport, thumbnail } from './ui/export.js';
import { initGallery, render as renderGallery, importFile } from './gallery.js';
import { loadArtwork, saveArtwork, persist } from './storage/db.js';
import { initThemeSwitch } from '../ui/themeSwitch.js';

// Light (cream paper) unless ClassMap was set to dark
document.body.classList.toggle('light', document.documentElement.classList.contains('pre-light'));
document.documentElement.classList.remove('pre-light');

const $ = s => document.querySelector(s);
const editor = $('#editor'), gallery = $('#gallery');
const phone = () => matchMedia('(max-width: 700px)').matches;

// ── header icons ──
$('.px-back').innerHTML = ICONS.back;
$('.px-settings').innerHTML = ICONS.gear;
$('.px-ui').innerHTML = ICONS.eye;
$('.px-show-ui').innerHTML = ICONS.eye;
$('.px-ex-ico').innerHTML = ICONS.download;
$('.px-layers-btn').innerHTML = ICONS.layers;
$('.px-refs-btn').innerHTML = ICONS.image;
$('.px-timeline-btn').innerHTML = ICONS.film;

// ── the canvas ──
const view = new View($('#stage'));
view.insets = () => {
  const r = $('#stage').getBoundingClientRect();
  if (phone()) {
    const bottom = r.bottom - Math.min($('.px-toolbox').getBoundingClientRect().top, $('.px-palette').getBoundingClientRect().top);
    return { left: 56, right: 0, top: 36, bottom: Math.max(0, bottom) };
  }
  const tl = $('.px-timeline').getBoundingClientRect();
  return { left: $('.px-sliders').getBoundingClientRect().right - r.left, right: r.right - $('.px-right').getBoundingClientRect().left, top: 0, bottom: (tl.height ? r.bottom - tl.top : 0) + 100 };   // room for the info and action bars
};

// ── undo / redo ──
function commit(step) {
  state.history.push(step);
  emit('history');
  emit('changed');
  markDirty();
}
function applyStep(step, which) {
  if (step.kind === 'multi') { const list = which === 'before' ? [...step.steps].reverse() : step.steps; list.forEach(s => applyStep(s, which)); return; }
  if (step.kind === 'struct') { applyStruct(step[which]); return; }
  if (step.kind !== 'pixels') return;
  const cel = state.sprite.cels.find(c => c.layerId === step.target.layerId && c.frameId === step.target.frameId);
  if (!cel) return;
  const { x, y, w, h } = step.rect;
  writeRect(cel.pixels, cel.w, x, y, w, h, step[which]);
  view.invalidate(x, y, x + w - 1, y + h - 1);
}
function undo() {
  if (state.transform) { cancelMove(); return; }
  if (TOOLS.select.poly) { TOOLS.select.cancel(); return; }
  if (state.history.undo(applyStep)) { emit('history'); emit('changed'); markDirty(); }
}
function redo() {
  if (state.transform) return;
  if (state.history.redo(applyStep)) { emit('history'); emit('changed'); markDirty(); }
}

// Switching tools puts down a move in progress and drops an unfinished polygon
function chooseTool(name) {
  if (state.transform && name !== 'move') applyMove();
  if (TOOLS.select.poly && name !== 'select') TOOLS.select.cancel();
  setTool(name);
}
on('set-tool', name => { setTool(name); });
on('before-change', () => { if (state.transform) applyMove(); });

const actions = {
  undo, redo, toggleUI, swap: swapColors, nudgeSize,
  setTool: chooseTool,
  closePopovers: closePopover,
  polyActive: () => !!TOOLS.select.poly,
  nudge: (dx, dy) => { if (state.transform || state.selection || state.tool === 'move') nudge(dx, dy); },
  run(id) {
    if (id.startsWith('tool.')) { chooseTool(id.slice(5)); return; }
    ({
      swap: swapColors, undo, redo,
      copy: () => copy(), copyMerged: () => copy({ merged: true }), cut: () => copy({ cut: true }), paste: pasteButton,
      selectAll, deselect, invert: invertSelection, clear: clearSelected,
      apply: () => { if (state.transform) applyMove(); else if (TOOLS.select.poly) TOOLS.select.finishPolygon(); else anim.togglePlay(); },
      prevFrame: () => anim.stepFrame(-1), nextFrame: () => anim.stepFrame(1), newFrame: anim.addFrame,
      onion: () => { state.settings.onion.on = !state.settings.onion.on; saveSettings(); emit('settings'); },
      cancel: () => { if (state.transform) cancelMove(); else if (TOOLS.select.poly) TOOLS.select.cancel(); else if (state.selection) deselect(); closePopover(); },
      sizeDown: () => nudgeSize(-1), sizeUp: () => nudgeSize(1),
      zoomIn: () => view.step(1), zoomOut: () => view.step(-1), fit: () => view.fit(), actual: () => view.setZoom(1),
      toggleUI, newLayer: () => addLayer(),
      symmetry: () => { state.settings.symmetry.on = !state.settings.symmetry.on; saveSettings(); emit('symmetry'); },
    })[id]?.();
  },
  context(a) {
    const T = state.transform, p = T?.p;
    ({
      apply: () => applyMove(), cancel: () => cancelMove(),
      flipH: () => updateMove({ flipH: !p.flipH }), flipV: () => updateMove({ flipV: !p.flipV }),
      rotL: () => updateMove({ rot: p.rot - Math.PI / 2 }), rotR: () => updateMove({ rot: p.rot + Math.PI / 2 }),
      skew: () => { T.skew = !T.skew; renderContext(); },
      rotsprite: () => { const m = state.settings.tools.move; m.rotsprite = !m.rotsprite; saveSettings(); renderContext(); },
      left: () => nudge(-1, 0), right: () => nudge(1, 0), up: () => nudge(0, -1), down: () => nudge(0, 1),
      polyDone: () => TOOLS.select.finishPolygon(), polyCancel: () => TOOLS.select.cancel(),
      deselect, invert: invertSelection, copy: () => copy(), cut: () => copy({ cut: true }), paste: pasteButton,
      fill: fillSelected, outline: outlineSelected, clear: clearSelected,
      move: () => { setTool('move'); startMove(); },
    })[a]?.();
  },
};

initTools(view, commit);
initDoc({ commit, view });
initMove(view, commit);
initClipboard(view, commit);
initSelectOps(view, commit);
initInput(view, actions);
initToolbox($('.px-toolbox'));
initSliders($('.px-sliders'), actions);
initPalette($('.px-palette'), () => markDirty());
initLayers($('.px-layers'), view, { importImage: kind => pickFile(f => importLayerImage(f, kind)) });
initContextBar($('.px-context'), actions);
initRefs(editor);
initInfo($('.px-info'), view);
anim.initAnim(view, commit);
initTimeline($('.px-timeline'), actions);
initPreview(editor, view);
// drawing stops playback; the panels sit above the timeline
$('#stage').addEventListener('pointerdown', () => { if (state.playing) anim.stop(); }, true);
new ResizeObserver(() => editor.style.setProperty('--tl', $('.px-timeline').offsetHeight + 'px')).observe($('.px-timeline'));
on('timeline', () => { if (state.sprite) setTimeout(() => view.request(), 0); });
$('.px-timeline-btn').addEventListener('click', () => { document.body.classList.toggle('px-show-timeline'); document.body.classList.remove('px-show-layers'); });
on('transform', () => view.animateAnts());
on('changed', () => {});
on('dirty', () => markDirty());
on('symmetry', () => view.request());
document.addEventListener('paste', onPasteEvent);

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

// ── images in: file picker, drag and drop ──
const fileInput = $('.px-file');
let onFile = null;
function pickFile(fn) { onFile = fn; fileInput.value = ''; fileInput.click(); }
fileInput.addEventListener('change', () => { const f = fileInput.files[0]; if (f && onFile) onFile(f); onFile = null; });

// An image as a reference layer: fitted into the canvas, for tracing over
async function importLayerImage(file, kind = 'reference') {
  try {
    const bmp = await createImageBitmap(file), sp = state.sprite;
    const k = Math.min(sp.width / bmp.width, sp.height / bmp.height);
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = sp.width; c.height = sp.height;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = k < 1;
    g.drawImage(bmp, Math.floor((sp.width - w) / 2), Math.floor((sp.height - h) / 2), w, h);
    addLayer(kind, (file.name || 'Image').replace(/\.[^.]+$/, ''), g.getImageData(0, 0, sp.width, sp.height).data);
  } catch { toast("Couldn't open that image"); }
}
for (const [el, fn] of [[$('#stage'), f => importLayerImage(f)], [gallery, f => importFile(f)]]) {
  el.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('drop-ready'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-ready'));
  el.addEventListener('drop', e => {
    el.classList.remove('drop-ready');
    const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/') || (el === gallery && /\.(aseprite|ase)$/i.test(x.name)));
    if (!f) return;
    e.preventDefault();
    if (el === gallery || state.sprite) fn(f);
  });
}

// ── header buttons ──
function toggleUI() {
  state.noUI = !state.noUI;
  document.body.classList.toggle('px-noui', state.noUI);
  $('.px-show-ui').hidden = !state.noUI;
  closePopover();
}
$('.px-ui').addEventListener('click', toggleUI);
$('.px-show-ui').addEventListener('click', toggleUI);
$('.px-settings').addEventListener('click', () => openSettings(view));
$('.px-export-btn').addEventListener('click', async () => { anim.stop(); if (state.transform) await applyMove(); if (state.sprite) openExport(state.sprite); });
$('.px-refs-btn').addEventListener('click', e => openRefMenu(e.currentTarget, { pickFile, importLayer: () => pickFile(f => importLayerImage(f)) }));
$('.px-layers-btn').addEventListener('click', () => { document.body.classList.toggle('px-show-layers'); document.body.classList.remove('px-show-timeline'); });
const features = () => { $('.px-refs-btn').hidden = state.settings.features?.references === false; };
on('settings', features); features();

// ── saving: a moment after every change (or with the Save button), and when the page is hidden ──
let saveT = 0, saving = null, again = false, unsaved = false;
const saved = $('.px-saved'), saveBtn = $('.px-save-btn');
const autosave = () => state.settings.autosave !== false;
function markDirty() {
  if (!state.sprite) return;
  state.sprite.updatedAt = Date.now();
  unsaved = true;
  saved.textContent = autosave() ? '' : 'Not saved';
  clearTimeout(saveT);
  if (autosave()) saveT = setTimeout(saveNow, 700);
}
async function saveNow() {
  clearTimeout(saveT); saveT = 0;
  const sp = state.sprite;
  if (!sp) return;
  if (state.transform) { saveT = setTimeout(saveNow, 700); return; }      // wait until the move is put down
  if (saving) { again = true; return saving; }
  saving = (async () => {
    try {
      await saveArtwork(sp, thumbnail(sp));
      unsaved = false;
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
saveBtn.addEventListener('click', saveNow);
on('autosave', () => { saveBtn.hidden = autosave(); if (autosave() && unsaved) saveNow(); });
saveBtn.hidden = autosave();
const flush = () => { if (state.transform) applyMove(); if (autosave() && (saveT || unsaved)) saveNow(); };
addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
addEventListener('pagehide', flush);
addEventListener('beforeunload', e => { if (!autosave() && unsaved) { e.preventDefault(); e.returnValue = ''; } });

const nameInput = $('.px-name');
nameInput.addEventListener('input', () => { if (state.sprite) { state.sprite.name = nameInput.value.trim() || 'Untitled'; markDirty(); } });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

// ── gallery ⇄ editor (the address keeps which one is open, so reloading stays put) ──
async function openArt(id) {
  try {
    const sp = await loadArtwork(id);
    anim.stop();
    state.sprite = sp; state.frameId = sp.frames[0].id; state.selectedFrames = new Set([state.frameId]); state.playTag = null;
    state.transform = null; view.floating = null; state.selection = null;
    const top = leafLayers(sp).at(-1);
    state.layerId = top.id; state.selectedLayers = new Set([top.id]);
    state.history.clear();
    unsaved = false;
    document.body.classList.add('px-editing');
    gallery.hidden = true; editor.hidden = false;
    nameInput.value = sp.name;
    saved.textContent = '';
    if (location.hash !== '#/art/' + id) history.pushState(null, '', '#/art/' + id);
    renderTimeline();
    view.resize();
    view.setSprite();
    emit('sprite'); emit('history'); emit('tool'); emit('selection'); emit('transform'); emit('frames');
    renderPalette(); renderLayers(); renderTimeline();
  } catch (err) {
    toast(err.message || "Couldn't open that artwork");
    showGallery(true);
  }
}
async function showGallery(replace) {
  anim.stop();
  if (state.transform) await applyMove();
  if (!autosave() && unsaved && state.sprite && !confirm('Leave without saving your changes?')) return;
  if (autosave() && (saveT || saving || unsaved)) await saveNow();
  closePopover();
  state.sprite = null;
  document.body.classList.remove('px-editing', 'px-noui', 'px-show-layers', 'px-show-timeline');
  state.noUI = false;
  editor.hidden = true; gallery.hidden = false;
  emit('sprite');
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
if (import.meta.env.DEV) window.__px = { state, view, actions, openArt, showGallery, saveNow, setActive, addReference, discardMove, anim };
