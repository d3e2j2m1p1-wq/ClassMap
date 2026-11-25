// ═══════════════════════════════════════════════
//  Light / dark switch: a little scene in a window.
//  A glass lens slides across; the sky goes day → sunset → night,
//  the sun sets into the lake, the moon rises, the schoolhouse windows light up
//  and the wren tucks in to sleep. Tap to switch, or drag the lens to scrub.
//  All drawing is driven by CSS variables (--t, --a, --b) on the switch.
// ═══════════════════════════════════════════════
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

// window openings of the schoolhouse picture (% of the image), lit at night
const OPENINGS = [[24.6, 58.6, 4.0, 11], [33.2, 59.6, 4.2, 11.2], [42.3, 60.5, 4.1, 11.6], [62.4, 58.8, 7.7, 23.6], [55.5, 13.2, 3, 7.2], [61.5, 12.8, 5, 7]];

function sceneHTML() {
  const stars = [[8, 14], [18, 30], [27, 9], [38, 22], [52, 8], [61, 27], [70, 12], [80, 24], [90, 9], [44, 36]]
    .map(([x, y], i) => `<i class="ts-star" style="left:${x}%;top:${y}%;animation-delay:${(i % 5) * 0.4}s"></i>`).join('');
  const lights = OPENINGS.map(([x, y, w, h]) => `<i style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"></i>`).join('');
  return `
    <div class="ts-sky"></div>
    ${stars}
    <i class="ts-sun"></i><i class="ts-moon"></i>
    <i class="ts-hill"></i>
    <div class="ts-lake"><i class="ts-glint"></i><i class="ts-ripple r1"></i><i class="ts-ripple r2"></i></div>
    <div class="ts-school"><div class="ts-lights">${lights}</div><img src="/art/scene-school.webp" alt="" draggable="false"></div>
    <img class="ts-bridge ts-art" src="/art/scene-bridge.webp" alt="" draggable="false">
    <img class="ts-tree ts-art" src="/art/scene-sakura.webp" alt="" draggable="false">
    <img class="ts-wren ts-art" src="/art/wren.webp" alt="" draggable="false">
    <img class="ts-wren-nap ts-art" src="/art/wren-nap.webp" alt="" draggable="false">
    <i class="ts-petal p1"></i><i class="ts-petal p2"></i><i class="ts-petal p3"></i>`;
}

const switches = [];
let t = 0;            // 0 = day (light), 1 = night (dark)
let anim = null;

function paint() {
  const a = clamp(t * 2), b = clamp(t * 2 - 1);
  for (const el of switches) {
    const W = el.clientWidth, H = el.clientHeight, D = H - 8;
    const kx = 4 + t * (W - D - 8);
    el.style.setProperty('--t', t.toFixed(4));
    el.style.setProperty('--a', a.toFixed(4));
    el.style.setProperty('--b', b.toFixed(4));
    el.style.setProperty('--kx', kx + 'px');
    el.style.setProperty('--W', W + 'px');
    el.style.setProperty('--H', H + 'px');
    el.style.setProperty('--D', D + 'px');
    el.setAttribute('aria-checked', String(t > 0.5));
  }
}

const isDark = () => !document.body.classList.contains('light');

// Switch the whole app's colours; a circle of the new theme grows from the lens
function applyTheme(dark, from) {
  if (dark === isDark()) return;
  const set = () => {
    document.body.classList.toggle('light', !dark);
    try { localStorage.setItem('classmap_theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
  };
  if (!document.startViewTransition || reduce() || !from) { set(); return; }
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.classList.add('ts-reveal');
  const vt = document.startViewTransition(set);
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] },
      { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
  vt.finished.finally(() => document.documentElement.classList.remove('ts-reveal'));
}

// Move the lens; the app's colours flip as it passes the middle (sunset)
function setT(next, el) {
  const before = t;
  t = next;
  paint();
  if ((before < 0.5) !== (t < 0.5) || (before === 0.5 && t !== 0.5)) applyTheme(t > 0.5, el?.querySelector('.ts-lens'));
}

function slideTo(target, el) {
  cancelAnimationFrame(anim);
  if (reduce()) { t = target; paint(); applyTheme(target === 1, null); return; }
  const start = t, dist = Math.abs(target - start);
  if (!dist) { applyTheme(target === 1, el?.querySelector('.ts-lens')); return; }
  const dur = 900 * dist, t0 = performance.now();
  const step = now => {
    const k = clamp((now - t0) / dur);
    setT(start + (target - start) * ease(k), el);
    if (k < 1) anim = requestAnimationFrame(step);
    else applyTheme(target === 1, el?.querySelector('.ts-lens'));   // in case it never crossed (already there)
  };
  anim = requestAnimationFrame(step);
}

export function toggleTheme(el) {
  slideTo(isDark() ? 0 : 1, el instanceof Element ? el : switches.find(s => s.offsetParent) || switches[0]);
}

function wire(el) {
  el.innerHTML = `<span class="ts-window">${sceneHTML()}</span>
    <span class="ts-lens"><span class="ts-mag">${sceneHTML()}</span><i class="ts-shine"></i></span>`;
  el.setAttribute('role', 'switch');
  el.removeAttribute('onclick');
  switches.push(el);
  // tap to switch, drag the lens to scrub
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    cancelAnimationFrame(anim);
    drag = { x: e.clientX, t, moved: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (!drag.moved) return;
    const span = el.clientWidth - el.clientHeight;
    setT(clamp(drag.t + dx / span), el);
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) slideTo(t > 0.5 ? 1 : 0, el);
    else slideTo(isDark() ? 0 : 1, el);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); slideTo(isDark() ? 0 : 1, el); }
    if (e.key === 'ArrowRight') { e.preventDefault(); slideTo(1, el); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); slideTo(0, el); }
  });
}

export function initThemeSwitch() {
  document.querySelectorAll('.theme-switch').forEach(wire);
  t = isDark() ? 1 : 0;
  paint();
  addEventListener('resize', paint);
  // switches hidden at start (e.g. the editor header) get their size once shown
  new ResizeObserver(paint).observe(document.body);
}
