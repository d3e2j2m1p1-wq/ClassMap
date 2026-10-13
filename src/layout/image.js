import { store } from '../core/store.js';
import { renderLayoutCanvas } from './canvas.js';
import { markDirty } from '../storage/autosave.js';
import { saveLandingData } from '../storage/landingData.js';

export function layoutUploadImg() {
  document.getElementById('layoutImgInput').click();
}

export function handleLayoutImg(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    shrinkImage(ev.target.result).then(img => {
      store.layoutImg = img;
      renderLayoutCanvas();
      markDirty();
    });
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

// Photos are shrunk before they are saved: one full-size phone photo can fill the browser's
// ~5 MB storage by itself, and then nothing else saves. Only the width is capped (2000px is wider
// than the canvas on nearly every screen), so the photo still lines up with seats placed on it.
export const IMG_MAX_W = 2000;
export function shrinkImage(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl || !/^data:image\//.test(dataUrl)) return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      try {
        const w0 = img.naturalWidth, h0 = img.naturalHeight;
        if (!w0 || !h0) return resolve(dataUrl);
        const scale = Math.min(1, IMG_MAX_W / w0);
        const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let out = c.toDataURL('image/jpeg', 0.72);
        if (out.length > 1200000) out = c.toDataURL('image/jpeg', 0.55);
        resolve(out.length < dataUrl.length ? out : dataUrl);
      } catch (err) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Shrink big photos saved by older versions (runs once at start-up)
export async function shrinkStoredImages() {
  let changed = 0;
  for (const ch of store.landingData.charts) {
    const orig = ch.data && ch.data.layoutImg;
    if (!orig || orig.length < 1500000) continue;
    const small = await shrinkImage(orig);
    if (small === orig || !ch.data || ch.data.layoutImg !== orig) continue;
    ch.data.layoutImg = small;
    if (window._currentChartId === ch.id && store.layoutImg === orig) store.layoutImg = small;
    changed++;
  }
  if (changed) saveLandingData();
}
