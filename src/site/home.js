// Fonts are bundled with the site (no calls to Google Fonts)
import '@fontsource/nunito/latin-500.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/caveat/latin-700.css';
// ═══════════════════════════════════════════════
//  ClassMap home page: scroll effects and the little demos
//  · hero layers move at different speeds (parallax)
//  · "How it works" is pinned while the room builds itself
//  · paper planes fly out of the laptop and always come home
//  · Try it: paste names → a chart → carry it into the app
//  Everything here runs in the browser; nothing is sent anywhere.
// ═══════════════════════════════════════════════
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const lerp = (a, b, t) => a + (b - a) * t;
// progress of a sub-range inside 0…1
const seg = (p, a, b) => clamp((p - a) / (b - a));

document.getElementById('year').textContent = new Date().getFullYear();

// ── Reveal on scroll ──
const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  e.target.classList.add('in');
  io.unobserve(e.target);
}), { threshold: 0.15 });
$$('.reveal').forEach((el, i) => { el.style.transitionDelay = `${(i % 3) * 90}ms`; io.observe(el); });

// ═══ The room builds itself ═══
const ROOM = { w: 600, h: 430 };
// four tables, four seats each (in room coordinates, top-left of each name card)
const DESKS = [[72, 86], [348, 86], [72, 258], [348, 258]];
const SEAT_OFF = [[14, 14], [100, 14], [14, 62], [100, 62]];
const NAMES = ['Liam', 'Ava', 'Zoe', 'Owen', 'Mia', 'Jay', 'Sam', 'Ivy', 'Noah', 'Cleo', 'Gus', 'Rae', 'Eli', 'Lia', 'Max', 'Sol'];
// first arrangement: Liam and Owen share table 1 (the clash), then Owen swaps with Max
const seatOf = i => { const d = Math.floor(i / 4), s = i % 4; return [DESKS[d][0] + SEAT_OFF[s][0], DESKS[d][1] + SEAT_OFF[s][1]]; };
const pile = i => [8 + (i % 3) * 4, 360 - i * 3];
const SWAP_A = NAMES.indexOf('Owen'), SWAP_B = NAMES.indexOf('Max');
const namesBox = $('.room .names');
const nameEls = NAMES.map((n, i) => {
  const el = document.createElement('div');
  el.className = 'name ' + (i % 2 ? 'g2' : 'g1');
  el.textContent = n;
  namesBox.appendChild(el);
  return el;
});
const desks = $$('.room .desk');
const steps = $$('.steps li');
const ruleNote = $('.rule-note'), doneNote = $('.done-note');
const pct = (x, y) => ({ left: (x / ROOM.w * 100) + '%', top: (y / ROOM.h * 100) + '%' });

function drawBuilder(p) {
  // 1. tables drop in
  const t1 = seg(p, 0.02, 0.24);
  desks.forEach((d, i) => {
    const k = ease(seg(t1, i * 0.18, i * 0.18 + 0.46));
    d.style.opacity = k;
    d.style.transform = `translateY(${(1 - k) * -40}px) rotate(${(1 - k) * -6}deg)`;
  });
  // 2. names fly from the pile into seats
  const t2 = seg(p, 0.26, 0.56);
  // 3. the rule, then Owen and Max swap
  const t3 = seg(p, 0.6, 0.8);
  const swap = ease(seg(t3, 0.4, 1));
  nameEls.forEach((el, i) => {
    const k = ease(seg(t2, i * 0.035, i * 0.035 + 0.45));
    let [x, y] = seatOf(i);
    if (i === SWAP_A || i === SWAP_B) {
      const [ox, oy] = seatOf(i === SWAP_A ? SWAP_B : SWAP_A);
      x = lerp(x, ox, swap); y = lerp(y, oy, swap) - Math.sin(swap * Math.PI) * 40;
    }
    const [px, py] = pile(i);
    Object.assign(el.style, pct(lerp(px, x, k), lerp(py, y, k)));
    el.style.opacity = t2 > 0 || p > 0.26 ? 1 : 0;
    el.style.transform = `rotate(${(1 - k) * (i % 2 ? 14 : -10)}deg) scale(${lerp(0.9, 1, k)})`;
    el.classList.toggle('clash', (i === SWAP_A || i === NAMES.indexOf('Liam')) && t3 > 0.05 && swap < 0.5);
  });
  ruleNote.style.opacity = ease(seg(t3, 0, 0.3));
  ruleNote.style.transform = `translateY(${(1 - ease(seg(t3, 0, 0.3))) * 20}px)`;
  // 4. every rule kept
  const t4 = seg(p, 0.84, 0.96);
  doneNote.style.opacity = ease(t4);
  desks.forEach(d => d.classList.toggle('ok', t4 > 0.5));
  const step = p < 0.25 ? 0 : p < 0.58 ? 1 : p < 0.82 ? 2 : 3;
  steps.forEach((s, i) => { s.classList.toggle('on', i === step); s.classList.toggle('done', i < step); });
}

// ═══ Privacy: planes fly out and loop home ═══
const planes = $$('.ps-plane');
function drawPlanes(p) {
  const art = $('.ps-art');
  const R = Math.min(art.clientWidth, art.clientHeight) * 0.46;
  planes.forEach((pl, i) => {
    const base = (i / planes.length) * Math.PI * 2;
    const t = clamp(p * 1.1 - i * 0.03);
    const r = R * Math.sin(Math.PI * t);                  // out… and back in
    const a = base + t * Math.PI * 1.6;
    const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.8;
    // nose along the direction of travel
    const dx = -Math.sin(a) * r + Math.cos(a) * R * Math.PI * Math.cos(Math.PI * t) * 0.35;
    const dy = Math.cos(a) * r * 0.8 + Math.sin(a) * R * Math.PI * Math.cos(Math.PI * t) * 0.28;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const s = 0.4 + 0.6 * Math.sin(Math.PI * t);
    pl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${ang}deg) scale(${s})`;
    pl.style.opacity = t <= 0 || t >= 1 ? 0 : 1;
  });
}

// ═══ Parallax + pinned sections, one frame at a time ═══
const layers = $$('.hero-art [data-speed]');
const builder = $('.builder'), privacy = $('.privacy-story');
const pinned = el => { const r = el.getBoundingClientRect(); return clamp(-r.top / (r.height - innerHeight)); };
let ticking = false;
function frame() {
  ticking = false;
  const y = scrollY;
  if (y < innerHeight * 1.2) layers.forEach(l => { l.style.transform = `translate3d(0, ${y * parseFloat(l.dataset.speed)}px, 0)`; });
  drawBuilder(pinned(builder));
  drawPlanes(pinned(privacy));
}
if (reduce) {
  drawBuilder(1);
  drawPlanes(0.5);
} else {
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
  addEventListener('resize', frame);
  frame();
}

// ═══ Try it ═══
const tryIn = $('#tryNames'), tryTables = $('.try-tables'), tryGo = $('#tryGo'), tryShuffle = $('#tryShuffle');
let tryList = [];
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function readNames() {
  // one name per line ("Chen, Noah" → "Noah Chen"); a single line of commas is a list
  const text = tryIn.value.trim();
  const lines = text.includes('\n') ? text.split(/\n/) : text.split(/,|\t/);
  return lines.map(s => s.split('\t')[0].replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map(s => s.replace(/^([^,]+),\s*([^,]+)$/, '$2 $1')).slice(0, 40);
}
function seatThem() {
  tryList = readNames();
  if (!tryList.length) { tryIn.focus(); return; }
  const order = shuffle(tryList);
  tryTables.innerHTML = '';
  for (let i = 0; i < order.length; i += 4) {
    const t = document.createElement('div');
    t.className = 'try-table';
    t.style.animationDelay = (i / 4) * 70 + 'ms';
    const four = order.slice(i, i + 4);
    while (four.length < 4) four.push('');
    t.innerHTML = four.map(n => n ? `<i title="${n.replace(/"/g, '&quot;')}">${n.split(' ')[0].replace(/[<>&]/g, '')}</i>` : '<i class="empty"></i>').join('');
    tryTables.appendChild(t);
  }
  tryShuffle.hidden = false;
  tryGo.hidden = false;
}
$('#tryMake').addEventListener('click', seatThem);
tryShuffle.addEventListener('click', seatThem);
// Carry the names into the app (same browser, never sent anywhere): the app picks them up on start
tryGo.addEventListener('click', () => {
  try { localStorage.setItem('cm-handoff', JSON.stringify({ names: tryList, at: Date.now() })); } catch { /* private mode: the app opens empty */ }
});

// ═══ Little classroom tools ═══
const kids = ['Ava', 'Leo', 'Mia', 'Noah', 'Zoe', 'Eli', 'Sofia', 'Owen'];
let left = [];
const nameBox = $('#toyName');
$('#toyPick').addEventListener('click', () => {
  if (!left.length) left = shuffle(kids);
  const pick = left.pop();
  if (reduce) { nameBox.textContent = pick; return; }
  let n = 0;
  const spin = setInterval(() => {
    nameBox.textContent = kids[Math.floor(Math.random() * kids.length)];
    if (++n > 9) { clearInterval(spin); nameBox.textContent = pick; }
  }, 60);
});
let tLeft = 60, tRun = null;
const timeBox = $('#toyTime'), timerBtn = $('#toyTimer');
const showTime = () => { timeBox.textContent = tLeft > 0 ? `${Math.floor(tLeft / 60)}:${String(tLeft % 60).padStart(2, '0')}` : 'Time’s up!'; timeBox.classList.toggle('done', tLeft <= 0); };
timerBtn.addEventListener('click', () => {
  if (tRun) { clearInterval(tRun); tRun = null; timerBtn.textContent = 'Resume'; return; }
  if (tLeft <= 0) tLeft = 60;
  timerBtn.textContent = 'Pause';
  tRun = setInterval(() => { tLeft--; showTime(); if (tLeft <= 0) { clearInterval(tRun); tRun = null; timerBtn.textContent = 'Again'; } }, 1000);
  showTime();
});
const LEVELS = [['🤫', 'Silent'], ['💬', 'Whisper'], ['👥', 'Table talk'], ['📣', 'Presenting']];
$$('.toy-levels button').forEach(b => b.addEventListener('click', () => {
  const v = +b.dataset.v;
  $$('.toy-levels button').forEach(x => x.classList.toggle('on', x === b));
  $('#toyVoice').innerHTML = `<span>${LEVELS[v][0]}</span> ${v} · ${LEVELS[v][1]}`;
}));
