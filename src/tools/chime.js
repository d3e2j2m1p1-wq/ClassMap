// ═══════════════════════════════════════════════
//  Timer sounds, made in the browser (no audio files, works offline)
//  Each sound plays once per "loop"; the teacher picks the sound and how many loops.
// ═══════════════════════════════════════════════
const KEY = 'cm-chime';
export const SOUNDS = [
  { id: 'chimes', name: 'Chimes', icon: '🎐' },
  { id: 'bell', name: 'Desk bell', icon: '🛎' },
  { id: 'marimba', name: 'Marimba', icon: '🎵' },
  { id: 'birds', name: 'Birdsong', icon: '🐦' },
  { id: 'bowl', name: 'Singing bowl', icon: '🥣' },
];
export const MAX_LOOPS = 10;

export function chimeSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* none */ }
  return {
    on: s.on !== false,
    sound: SOUNDS.some(x => x.id === s.sound) ? s.sound : 'chimes',
    loops: Math.min(MAX_LOOPS, Math.max(1, Math.round(s.loops) || 5)),
  };
}
export function saveChimeSettings(patch) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...chimeSettings(), ...patch })); } catch { /* private mode */ }
}

// One audio context, opened on a tap (browsers only allow sound after the user has interacted)
let ctx = null;
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
  return ctx;
}

function tone(c, { at, freq, type = 'sine', peak = 0.25, attack = 0.01, decay = 1, to = null, slide = 0.08, dest = c.destination }) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + slide);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + attack + decay + 0.05);
}

// Each sound: (context, start time, output) → plays once. LENGTH is how long one play lasts (seconds).
const PLAY = {
  chimes(c, t, dest) {
    [880, 988, 1175].forEach((f, i) => { tone(c, { at: t + i * 0.32, freq: f, peak: 0.22, decay: 0.7, dest }); tone(c, { at: t + i * 0.32, freq: f * 2, peak: 0.05, decay: 0.4, dest }); });
  },
  bell(c, t, dest) {
    [0, 0.28].forEach(d => [[1, 0.22], [2.4, 0.08], [3.9, 0.05]].forEach(([m, p]) => tone(c, { at: t + d, freq: 1318 * m, peak: p, attack: 0.003, decay: 1.1, dest })));
  },
  marimba(c, t, dest) {
    [523, 659, 784, 1047].forEach((f, i) => { tone(c, { at: t + i * 0.15, freq: f, peak: 0.3, attack: 0.004, decay: 0.45, dest }); tone(c, { at: t + i * 0.15, freq: f * 4, peak: 0.04, attack: 0.002, decay: 0.08, dest }); });
  },
  birds(c, t, dest) {
    [0, 0.12, 0.24, 0.6, 0.68, 0.76, 0.84].forEach((d, i) => tone(c, { at: t + d, freq: i < 3 ? 2600 : 3300, to: i < 3 ? 4100 : 2500, slide: 0.07, peak: 0.12, attack: 0.008, decay: 0.08, dest }));
  },
  bowl(c, t, dest) {
    tone(c, { at: t, freq: 220, peak: 0.22, attack: 0.04, decay: 3.2, dest });
    tone(c, { at: t, freq: 221.6, peak: 0.16, attack: 0.04, decay: 3.2, dest });
    tone(c, { at: t, freq: 594, peak: 0.07, attack: 0.04, decay: 2.2, dest });
  },
};
export const __play = PLAY;   // used to record previews
const LENGTH = { chimes: 1.4, bell: 1.4, marimba: 1.0, birds: 1.2, bowl: 3.0 };
const GAP = 0.45;

// Play a sound `loops` times. stop() cuts it off; onEnd runs when it finishes or is stopped.
let current = null;
export function playChime(soundId, loops, onEnd) {
  stopChime();
  const c = unlockAudio();
  if (!c) { onEnd?.(); return null; }
  const id = PLAY[soundId] ? soundId : 'chimes';
  const out = c.createGain();
  out.connect(c.destination);
  const timers = [];
  let ended = false;
  const finish = () => { if (ended) return; ended = true; if (current === handle) current = null; onEnd?.(); };
  const handle = {
    stop() {
      timers.forEach(clearTimeout);
      try { out.gain.setTargetAtTime(0.0001, c.currentTime, 0.04); setTimeout(() => out.disconnect(), 300); } catch { /* closed */ }
      finish();
    },
  };
  // each loop is scheduled just before it starts, so Stop silences what's left
  let at = 0;
  for (let i = 0; i < loops; i++) {
    timers.push(setTimeout(() => PLAY[id](c, c.currentTime + 0.02, out), at * 1000));
    at += LENGTH[id] + GAP;
  }
  timers.push(setTimeout(finish, at * 1000));
  current = handle;
  return handle;
}

export function stopChime() { if (current) current.stop(); }
export const isRinging = () => !!current;
