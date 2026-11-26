// ═══════════════════════════════════════════════
//  Gallery: every artwork on this device, new artwork, and backups.
//  The art lives only in this browser, so backing up is right here, not buried in a menu.
// ═══════════════════════════════════════════════
import { listArtwork, loadArtwork, saveArtwork, deleteArtwork, renameArtwork, allProjectsJSON, listVersions, loadVersion } from './storage/db.js';
import { walk } from './core/layers.js';
import { createSprite, MAX_SIDE, uid } from './core/sprite.js';
import { encodeBackup, decodeBackup } from './core/format.js';
import { BUILT_IN } from './core/palettes.js';
import { readAseprite } from './core/aseprite.js';
import { pxToSprite } from './core/px.js';
import { ICONS } from './ui/icons.js';
import { openDialog, confirmBox, promptBox, toast, popover, esc, seg, bindControls } from './ui/dialogs.js';
import { thumbnail, download, openExport } from './ui/export.js';
import { loadLibrary, saveLibrary } from './ui/palette.js';
import { state, saveSettings, TOOL_DEFAULTS } from './editor/state.js';

let root, openArt;
const sortKey = 'pixel:sort';
const lastBackupKey = 'pixel:lastBackup';
const DAY = 864e5;

export function initGallery(el, onOpen) {
  root = el; openArt = onOpen;
  root.innerHTML = `
    <div class="px-gal-head">
      <div>
        <h1>Your artwork</h1>
        <p class="px-gal-sub">Saved on this device only. <a href="/privacy/">Nothing is uploaded.</a></p>
      </div>
      <div class="px-gal-actions">
        <select class="px-sort" aria-label="Sort artwork">
          <option value="updatedAt-desc">Last edited</option>
          <option value="name-asc">Name A–Z</option>
          <option value="createdAt-desc">Newest</option>
          <option value="size-desc">Largest</option>
        </select>
        <button type="button" class="px-btn px-btn-ghost px-backup">${ICONS.download}<span>Back up everything</span></button>
        <button type="button" class="px-btn px-btn-ghost px-restore">${ICONS.upload}<span>Restore</span></button>
        <button type="button" class="px-btn px-btn-ghost px-open">${ICONS.open}<span>Open file</span></button>
        <button type="button" class="px-btn px-btn-primary px-new">${ICONS.plus}<span>New artwork</span></button>
      </div>
    </div>
    <div class="px-remind" hidden></div>
    <div class="px-grid" aria-live="polite"></div>
    <input type="file" class="px-restore-file" hidden>
    <input type="file" class="px-open-file" accept=".aseprite,.ase,.px,image/*" hidden>`;
  const sort = root.querySelector('.px-sort');
  try { sort.value = localStorage.getItem(sortKey) || 'updatedAt-desc'; } catch { /* keep default */ }
  sort.addEventListener('change', () => { try { localStorage.setItem(sortKey, sort.value); } catch { /* */ } render(); });
  root.querySelector('.px-new').addEventListener('click', newArtwork);
  root.querySelector('.px-backup').addEventListener('click', backupAll);
  const file = root.querySelector('.px-restore-file');
  root.querySelector('.px-restore').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) restore(file.files[0]); file.value = ''; });
  root.querySelector('.px-grid').addEventListener('click', onGridClick);
  const open = root.querySelector('.px-open-file');
  root.querySelector('.px-open').addEventListener('click', () => open.click());
  open.addEventListener('change', () => { if (open.files[0]) importFile(open.files[0]); open.value = ''; });
}

const ago = t => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
};

export async function render() {
  const grid = root.querySelector('.px-grid');
  let items = [];
  try { items = await listArtwork(); } catch { grid.innerHTML = '<p class="px-empty-msg">This browser is blocking storage (private mode?). Artwork can\'t be saved here.</p>'; return; }
  const [k, dir] = root.querySelector('.px-sort').value.split('-');
  const val = m => (k === 'size' ? m.width * m.height : k === 'name' ? m.name.toLowerCase() : m[k]);
  items.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  grid.innerHTML = items.length ? items.map(m => `
    <article class="px-card" data-id="${m.id}">
      <button type="button" class="px-card-open" aria-label="Open ${esc(m.name)}">
        <span class="px-thumb"><img src="${m.thumb || ''}" alt=""></span>
        <span class="px-card-name">${esc(m.name)}</span>
        <span class="px-card-meta">${m.width} × ${m.height} · ${ago(m.updatedAt)}</span>
      </button>
      <button type="button" class="px-icon-btn px-card-more" aria-label="More for ${esc(m.name)}">${ICONS.more}</button>
    </article>`).join('') : `
    <div class="px-empty">
      <img src="/art/wren-card.webp" alt="" width="180">
      <p class="px-empty-hand">A blank page, ready for pixels.</p>
      <button type="button" class="px-btn px-btn-primary px-empty-new">${ICONS.plus}<span>New artwork</span></button>
    </div>`;
  grid.querySelector('.px-empty-new')?.addEventListener('click', newArtwork);
  remind(items.length);
}

// A gentle nudge when nothing has been backed up for 30 days
function remind(count) {
  const box = root.querySelector('.px-remind');
  let since = 0, last = 0;
  try {
    last = Number(localStorage.getItem(lastBackupKey)) || 0;
    since = Number(localStorage.getItem('pixel:since')) || 0;
    if (!since) { since = Date.now(); localStorage.setItem('pixel:since', since); }
  } catch { /* */ }
  const due = count > 0 && Date.now() - Math.max(last, since) > 30 * DAY;
  box.hidden = !due;
  if (due) {
    box.innerHTML = `<span>${last ? 'No backup in over a month.' : 'Your artwork has never been backed up.'} Clearing this browser's data would erase it.</span><button type="button" class="px-btn px-btn-primary">Back up now</button>`;
    box.querySelector('button').addEventListener('click', backupAll);
  }
}

async function onGridClick(e) {
  const card = e.target.closest('.px-card'); if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('.px-card-open')) { openArt(id); return; }
  const more = e.target.closest('.px-card-more'); if (!more) return;
  const m = document.createElement('div');
  m.className = 'px-menu';
  m.innerHTML = `<button type="button" data-a="info">Info and versions…</button><button type="button" data-a="rename">Rename</button><button type="button" data-a="dup">Duplicate</button>
    <button type="button" data-a="png">Export PNG…</button><button type="button" data-a="del" class="danger">Delete</button>`;
  const pop = popover(more, m, { side: 'below' });
  m.addEventListener('click', async ev => {
    const a = ev.target.closest('button')?.dataset.a; if (!a) return;
    pop.close();
    try {
      const sp = await loadArtwork(id);
      if (a === 'rename') {
        const name = await promptBox('Rename artwork', sp.name);
        if (name) { await renameArtwork(id, name); render(); }
      }
      if (a === 'dup') {
        sp.id = uid(); sp.name = sp.name + ' copy'; sp.createdAt = sp.updatedAt = Date.now();
        await saveArtwork(sp, thumbnail(sp)); render(); toast('Duplicated');
      }
      if (a === 'png') openExport(sp);
      if (a === 'info') infoSheet(sp);
      if (a === 'del' && await confirmBox('Delete artwork?', `"${sp.name}" will be deleted from this device. This can't be undone.`, { ok: 'Delete', danger: true })) {
        await deleteArtwork(id); render(); toast('Deleted');
      }
    } catch (err) { toast(err.message); }
  });
}

// ── Info sheet: details, plus the automatic version backups (restore one as a copy) ──
async function infoSheet(sp) {
  const meta = (await listArtwork()).find(m => m.id === sp.id);
  const versions = await listVersions(sp.id).catch(() => []);
  let layers = 0; walk(sp.layers, n => { if (n.kind !== 'group') layers++; });
  const when = t => new Date(t).toLocaleString();
  const kb = b => (b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
  const body = document.createElement('div');
  body.className = 'px-col-dialog';
  body.innerHTML = `
    <dl class="px-info-list">
      <dt>Size</dt><dd>${sp.width} × ${sp.height} pixels</dd>
      <dt>Layers</dt><dd>${layers}</dd><dt>Frames</dt><dd>${sp.frames.length}</dd>
      <dt>Colour mode</dt><dd>${sp.colorMode === 'indexed' ? 'Indexed' : 'RGBA'} · ${sp.palette.length} palette colours</dd>
      <dt>Created</dt><dd>${when(sp.createdAt)}</dd><dt>Changed</dt><dd>${when(sp.updatedAt)}</dd>
      <dt>On this device</dt><dd>${meta ? kb(meta.bytes) : '—'}</dd>
    </dl>
    <div class="px-mini-label">Version backups</div>
    ${versions.length ? `<div class="px-versions">${versions.map(v => `<div class="px-version"><img src="${v.thumb || ''}" alt=""><span><b>${when(v.at)}</b><br><span class="px-hint">${kb(v.size)}</span></span>
      <button type="button" class="px-btn px-btn-ghost" data-v="${esc(v.key)}">Restore as a copy</button></div>`).join('')}</div>`
    : '<p class="px-hint">None yet. A snapshot is taken when you open the artwork and every few minutes while you edit (Settings → General).</p>'}`;
  body.addEventListener('click', async e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    try {
      const old = await loadVersion(b.dataset.v);
      const at = versions.find(v => v.key === b.dataset.v).at;
      old.id = uid(); old.name = `${sp.name} (${new Date(at).toLocaleDateString()} ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      old.createdAt = old.updatedAt = Date.now();
      await saveArtwork(old, thumbnail(old));
      body.closest('.px-overlay')?.querySelector('.px-dialog-x')?.click();
      render(); toast(`Restored as "${old.name}"`);
    } catch (err) { toast(err.message || "Couldn't restore that version"); }
  });
  openDialog({ title: sp.name, body, className: 'px-col-dlg', actions: [{ label: 'Close', kind: 'primary' }] });
}

// ── New artwork ──
const PRESETS = [[16, 16], [32, 32], [64, 64], [128, 128], [256, 256], [160, 144], [320, 180], [640, 360]];

export function newArtwork() {
  let w = 32, h = 32;
  const lib = loadLibrary();
  const pals = [...BUILT_IN.map((p, i) => ['b' + i, p]), ...lib.map((p, i) => ['u' + i, p])];
  const body = document.createElement('div');
  body.className = 'px-new-art';
  body.innerHTML = `
    <label class="px-field"><span>Name</span><input type="text" class="px-na-name" maxlength="80" value="Untitled" autofocus></label>
    <div class="px-mini-label">Size</div>
    <div class="px-presets">${PRESETS.map(([a, b]) => `<button type="button" data-w="${a}" data-h="${b}">${a} × ${b}</button>`).join('')}</div>
    <div class="px-wh">
      <label class="px-field"><span>Width</span><input type="number" class="px-na-w" min="1" max="${MAX_SIDE}" value="32"></label>
      <span class="px-wh-x">×</span>
      <label class="px-field"><span>Height</span><input type="number" class="px-na-h" min="1" max="${MAX_SIDE}" value="32"></label>
    </div>
    <label class="px-field"><span>Starting palette</span><select class="px-na-pal">
      ${pals.map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}<option value="none">Empty</option></select></label>
    <div class="px-mini-label">Colour mode</div>
    ${seg('mode', 'rgba', [['rgba', 'RGBA (any colour)'], ['indexed', 'Indexed (palette colours only)']])}`;
  const paint = () => body.querySelectorAll('.px-presets button').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.w === w && +b.dataset.h === h)));
  body.querySelector('.px-presets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    w = +b.dataset.w; h = +b.dataset.h;
    body.querySelector('.px-na-w').value = w; body.querySelector('.px-na-h').value = h;
    paint();
  });
  for (const sel of ['.px-na-w', '.px-na-h']) body.querySelector(sel).addEventListener('input', () => {
    w = Number(body.querySelector('.px-na-w').value); h = Number(body.querySelector('.px-na-h').value); paint();
  });
  paint();
  let mode = 'rgba';
  bindControls(body, (k, v) => { if (k === 'mode') mode = v; });
  return openDialog({
    title: 'New artwork', body, className: 'px-new-dialog',
    onOpen: ov => setTimeout(() => ov.querySelector('.px-na-name').select(), 0),
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Create', kind: 'primary', onClick: async () => {
        if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE && Number.isInteger(w) && Number.isInteger(h))) { toast(`Size must be whole numbers from 1 to ${MAX_SIDE}`); return false; }
        const k = body.querySelector('.px-na-pal').value;
        const pal = k === 'none' ? [] : (k[0] === 'b' ? BUILT_IN : lib)[Number(k.slice(1))].colors;
        if (mode === 'indexed' && !pal.length) { toast('Indexed artwork needs a starting palette'); return false; }
        const sp = createSprite({ name: body.querySelector('.px-na-name').value.trim() || 'Untitled', width: w, height: h, palette: mode === 'indexed' ? pal.slice(0, 256) : pal, colorMode: mode });
        try { await saveArtwork(sp, thumbnail(sp)); } catch (err) { toast("Couldn't save: " + err.message); return false; }
        openArt(sp.id);
      },
    }],
  });
}

// Open an .aseprite / .ase file or an image as a new artwork
export async function importFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ase = /\.(aseprite|ase)$/i.test(file.name) || (bytes[4] === 0xE0 && bytes[5] === 0xA5);
  if (/\.px$/i.test(file.name)) {
    try {
      const { sprite, warnings } = await pxToSprite(bytes, file.name.replace(/\.[^.]+$/, '') || 'Imported');
      if (!sprite.palette.length) sprite.palette = BUILT_IN[0].colors.map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]);
      await saveArtwork(sprite, thumbnail(sprite));
      openArt(sprite.id);
      if (warnings.length) toast(warnings.join(' '), 6000);
    } catch (err) { toast(err instanceof RangeError ? "Couldn't read that .px file (it may be from a newer Pixquare)." : err.message || "Couldn't open that file", 6000); }
    return;
  }
  if (!ase) return newFromImage(file);
  try {
    const { sprite, warnings } = await readAseprite(bytes);
    sprite.name = file.name.replace(/\.[^.]+$/, '') || 'Imported';
    if (!sprite.palette.length) sprite.palette = BUILT_IN[0].colors.map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]);
    await saveArtwork(sprite, thumbnail(sprite));
    openArt(sprite.id);
    if (warnings.length) toast(warnings.join(' '), 6000);
  } catch (err) { toast(err.message || "Couldn't open that file", 5000); }
}

// An image dropped on the gallery becomes a new artwork of the same size
export async function newFromImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = k < 1; g.drawImage(bmp, 0, 0, w, h);
    const sp = createSprite({ name: (file.name || 'Image').replace(/\.[^.]+$/, ''), width: w, height: h, palette: BUILT_IN[0].colors });
    sp.cels[0].pixels.set(g.getImageData(0, 0, w, h).data);
    await saveArtwork(sp, thumbnail(sp));
    openArt(sp.id);
  } catch { toast("Couldn't open that image"); }
}

// ── Backup and restore ──
export async function backupAll() {
  try {
    const projects = await allProjectsJSON();
    if (!projects.length) { toast('Nothing to back up yet'); return; }
    let settings = {};
    try { settings = { palettes: loadLibrary(), settings: JSON.parse(localStorage.getItem('pixel:settings') || '{}') }; } catch { /* */ }
    const bytes = await encodeBackup(projects, settings);
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    download(new Blob([bytes], { type: 'application/octet-stream' }), `classmap-pixel-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.cmpixel`);
    try { localStorage.setItem(lastBackupKey, Date.now()); } catch { /* */ }
    toast(`Backed up ${projects.length} artwork${projects.length === 1 ? '' : 's'}`);
    render();
  } catch (err) { toast("Couldn't make the backup: " + err.message); }
}

export async function restore(file) {
  let data;
  try { data = await decodeBackup(new Uint8Array(await file.arrayBuffer())); } catch (err) { toast(err.message, 4000); return; }
  const have = new Map((await listArtwork()).map(m => [m.id, m]));
  const newer = data.projects.filter(p => !have.has(p.id) || have.get(p.id).updatedAt < p.updatedAt);
  const same = data.projects.length - newer.length;
  const ok = await confirmBox('Restore backup?',
    `${newer.length} artwork${newer.length === 1 ? '' : 's'} will be added or updated${same ? `; ${same} already up to date will be skipped` : ''}. Artwork not in the backup stays as it is.`,
    { ok: 'Restore' });
  if (!ok) return;
  for (const sp of newer) await saveArtwork(sp, thumbnail(sp));
  if (data.settings?.palettes?.length) {
    const lib = loadLibrary(), names = new Set(lib.map(p => p.name));
    saveLibrary([...lib, ...data.settings.palettes.filter(p => !names.has(p.name))]);
  }
  const st = data.settings?.settings;
  if (st && typeof st === 'object') {
    // keep the tools' option shapes even if the backup came from an older version
    const tools = Object.fromEntries(Object.entries(TOOL_DEFAULTS).map(([k, d]) => [k, { ...d, ...(st.tools?.[k] || {}) }]));
    Object.assign(state.settings, st, { tools });
    saveSettings();
  }
  toast(`Restored ${newer.length} artwork${newer.length === 1 ? '' : 's'}`);
  render();
}
