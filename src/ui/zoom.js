// ═══════════════════════════════════════════════
//  ZOOM for the Layout and Assign canvases
//  Phones open the room zoomed to fit the screen's width. − / Fit / + buttons in the corner,
//  and two-finger pinch on touch screens. The room's coordinates never change: drag code
//  converts pointer movement with toCanvas() / zoomOf().
// ═══════════════════════════════════════════════
const VIEWS = {
  layout: { wrap: 'layoutCanvasWrap', canvas: 'layoutCanvas', host: () => document.querySelector('#panel-layout .layout-stage') },
  assign: { wrap: 'assignMain', canvas: 'assignCanvas', host: () => document.getElementById('panel-assign') },
};
const MIN = 0.3, MAX = 2;
const scale = { layout: 1, assign: 1 };
const follow = { layout: true, assign: true };    // keep fitting until the teacher zooms by hand
const NARROW = 760;

export const zoomOf = which => scale[which] || 1;
const els = which => ({ wrap: document.getElementById(VIEWS[which].wrap), canvas: document.getElementById(VIEWS[which].canvas) });

// Pointer position → room coordinates
export function toCanvas(which, clientX, clientY) {
  const { canvas } = els(which);
  const r = canvas.getBoundingClientRect();     // already includes scrolling and any padding
  const z = zoomOf(which);
  return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
}

function apply(which) {
  const { canvas } = els(which);
  if (!canvas) return;
  const z = scale[which];
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = z === 1 ? '' : `scale(${z})`;
  // a scaled element still takes its full size in the page; pull the extra space back in
  canvas.style.marginRight = z === 1 ? '' : `${-(canvas.offsetWidth * (1 - z))}px`;
  canvas.style.marginBottom = z === 1 ? '' : `${-(canvas.offsetHeight * (1 - z))}px`;
  const label = document.querySelector(`.zoom-bar[data-view="${which}"] .zoom-pct`);
  if (label) label.textContent = Math.round(z * 100) + '%';
}

export function setZoom(which, z, { cx = null, cy = null, byHand = true } = {}) {
  const { wrap } = els(which);
  if (!wrap) return;
  z = Math.max(MIN, Math.min(MAX, Math.round(z * 100) / 100));
  const old = scale[which];
  // keep the point under the fingers (or the middle of the view) where it is
  const r = wrap.getBoundingClientRect();
  const px = cx == null ? wrap.clientWidth / 2 : cx - r.left;
  const py = cy == null ? wrap.clientHeight / 2 : cy - r.top;
  const roomX = (wrap.scrollLeft + px) / old, roomY = (wrap.scrollTop + py) / old;
  scale[which] = z;
  if (byHand) follow[which] = false;
  apply(which);
  wrap.scrollLeft = roomX * z - px;
  wrap.scrollTop = roomY * z - py;
}

// The room's drawn extent, in room coordinates
function extent(which) {
  const { canvas } = els(which);
  const cr = canvas.getBoundingClientRect();
  const z = zoomOf(which);
  let x1 = 0, y1 = 0;
  for (const el of canvas.children) {
    if (el.classList.contains('drop-zone-hint') || el.classList.contains('layout-marquee')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    x1 = Math.max(x1, (r.right - cr.left) / z);
    y1 = Math.max(y1, (r.bottom - cr.top) / z);
  }
  return { x1, y1 };
}

// Fit the room's width to the screen (never bigger than 100%)
export function fitZoom(which, byHand = true) {
  const { wrap } = els(which);
  if (!wrap || !wrap.clientWidth) return;
  const { x1 } = extent(which);
  const z = x1 ? Math.min(1, (wrap.clientWidth - 12) / (x1 + 12)) : 1;
  setZoom(which, z, { byHand: false });
  follow[which] = true;
  wrap.scrollLeft = 0;
}

// Called after each redraw of a canvas: re-apply the zoom, and on small screens keep the room fitted
export function afterRender(which) {
  const { wrap } = els(which);
  if (!wrap) return;
  if (follow[which] && wrap.clientWidth && wrap.clientWidth < NARROW) {
    const { x1 } = extent(which);
    const want = x1 ? Math.min(1, (wrap.clientWidth - 12) / (x1 + 12)) : 1;
    if (Math.abs(want - scale[which]) > 0.02) { scale[which] = Math.max(MIN, Math.round(want * 100) / 100); }
  }
  apply(which);
}

// ── Controls ──
export function initZoom() {
  Object.keys(VIEWS).forEach(which => {
    const host = VIEWS[which].host();
    const { wrap } = els(which);
    if (!host || !wrap || host.querySelector('.zoom-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'zoom-bar';
    bar.dataset.view = which;
    bar.innerHTML = `<button type="button" aria-label="Zoom out">−</button><button type="button" class="zoom-pct" aria-label="Fit to screen" title="Fit to screen">100%</button><button type="button" aria-label="Zoom in">+</button>`;
    const [out, fit, inn] = bar.querySelectorAll('button');
    out.onclick = () => setZoom(which, zoomOf(which) / 1.2);
    inn.onclick = () => setZoom(which, zoomOf(which) * 1.2);
    fit.onclick = () => fitZoom(which);
    host.appendChild(bar);
    initPinch(which, wrap);
    // Ctrl/⌘ + wheel (and trackpad pinch) zooms the room instead of the page
    wrap.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(which, zoomOf(which) * Math.exp(-e.deltaY / 300), { cx: e.clientX, cy: e.clientY });
    }, { passive: false });
  });
  // turning the phone: fit again (unless the teacher zoomed by hand)
  window.addEventListener('resize', () => Object.keys(VIEWS).forEach(w => { if (follow[w]) afterRender(w); }));
}

function initPinch(which, wrap) {
  let start = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) start = { d: dist(e.touches), z: zoomOf(which) };
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (!start || e.touches.length !== 2) return;
    e.preventDefault();     // our zoom, not the whole page's
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    setZoom(which, start.z * dist(e.touches) / start.d, { cx, cy });
  }, { passive: false });
  wrap.addEventListener('touchend', e => { if (e.touches.length < 2) start = null; });
}
