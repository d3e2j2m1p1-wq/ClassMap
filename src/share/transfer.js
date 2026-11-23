// ═══════════════════════════════════════════════
//  SEND TO ANOTHER DEVICE — the transfer itself
//  Both browsers connect to the same short-lived room on ClassMap's Worker (/api/share/CODE).
//  They agree on a secret key between themselves (ECDH): the Worker passes the handshake along
//  but never learns the key. The chart is compressed, locked (AES-GCM) and sent in pieces; the
//  Worker only ever handles locked bytes and keeps nothing. Both screens show the same two
//  check words, so the teachers can see they're connected to each other and nobody else.
// ═══════════════════════════════════════════════
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // no 0/O, 1/I/L
export const CODE_LEN = 6;
export const CODE_MINUTES = 10;
const CHUNK = 192 * 1024;                              // characters per message

export function newCode() {
  const out = [];
  while (out.length < CODE_LEN) {
    const b = crypto.getRandomValues(new Uint8Array(1))[0];
    if (b < 248) out.push(ALPHABET[b % 31]);          // 248 = 8 × 31: no bias
  }
  return out.join('');
}
export const formatCode = c => c.slice(0, 3) + '-' + c.slice(3);
export const cleanCode = s => String(s || '').toUpperCase().replace(/[^23456789A-Z]/g, '').split('').filter(ch => ALPHABET.includes(ch)).join('').slice(0, CODE_LEN);

export function relayUrl(code, role) {
  const base = (import.meta.env && import.meta.env.VITE_SHARE_URL) ||
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/share/`;
  return `${base}${code}?role=${role}`;
}
export const receiveLink = code => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}#receive=${code}`;

// "iPad · Safari", "Windows PC · Chrome" — what the other teacher sees
export function deviceName() {
  const ua = navigator.userAgent || '';
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const dev = /iPad/.test(ua) || touchMac ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'Chromebook' : /Windows/.test(ua) ? 'Windows PC' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Computer';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${dev} · ${br}` : dev;
}

// ── Crypto ──
const b64 = bytes => { let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = str => { const s = atob(str); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const enc = new TextEncoder(), dec = new TextDecoder();

async function newKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = b64(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { kp, pub };
}
async function sharedKey(kp, theirPub, code) {
  const theirs = await crypto.subtle.importKey('raw', unb64(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, kp.privateKey, 256);
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('classmap-share:' + code), info: enc.encode('v1') },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const ADJ = ['amber', 'brave', 'calm', 'clever', 'cozy', 'crisp', 'daring', 'eager', 'fancy', 'gentle', 'giant', 'golden', 'happy', 'jolly', 'kind', 'lively',
  'lucky', 'merry', 'mighty', 'misty', 'noble', 'proud', 'quick', 'quiet', 'rapid', 'royal', 'rusty', 'shiny', 'silver', 'sleepy', 'smart', 'snowy',
  'sunny', 'swift', 'tidy', 'tiny', 'velvet', 'witty', 'zesty', 'bold', 'bright', 'cheery', 'dusty', 'fuzzy', 'grand', 'humble', 'icy', 'jazzy',
  'keen', 'lazy', 'mellow', 'neat', 'polite', 'rosy', 'sandy', 'silly', 'sparkly', 'spicy', 'stormy', 'sweet', 'teal', 'wise', 'woolly', 'zippy'];
const ANIMAL = ['otter', 'tiger', 'panda', 'koala', 'eagle', 'falcon', 'fox', 'gecko', 'heron', 'jaguar', 'lemur', 'llama', 'moose', 'newt', 'owl', 'parrot',
  'puffin', 'quail', 'rabbit', 'raven', 'seal', 'sloth', 'swan', 'toucan', 'turtle', 'walrus', 'whale', 'wombat', 'yak', 'zebra', 'badger', 'beaver',
  'bison', 'camel', 'cheetah', 'crab', 'dolphin', 'donkey', 'duck', 'ferret', 'goat', 'goose', 'hamster', 'hedgehog', 'hippo', 'ibis', 'kitten', 'lion',
  'lobster', 'magpie', 'meerkat', 'mole', 'octopus', 'ostrich', 'pelican', 'penguin', 'pony', 'robin', 'salmon', 'shark', 'squid', 'stork', 'tapir', 'wolf'];
async function checkWords(code, pubA, pubB) {
  const [x, y] = [pubA, pubB].sort();
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${code}|${x}|${y}`)));
  return `${ADJ[h[0] % 64]} ${ANIMAL[h[1] % 64]}`;
}

async function gzip(bytes, how) {
  if (typeof CompressionStream === 'undefined') return { bytes, z: false };
  const s = new Blob([bytes]).stream().pipeThrough(new (how === 'd' ? DecompressionStream : CompressionStream)('gzip'));
  return { bytes: new Uint8Array(await new Response(s).arrayBuffer()), z: true };
}
async function lock(key, obj) {
  const { bytes, z } = await gzip(enc.encode(JSON.stringify(obj)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64(iv), z, data: b64(ct) };
}
async function unlock(key, { iv, z, data }) {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data)));
  const bytes = z ? (await gzip(plain, 'd')).bytes : plain;
  return JSON.parse(dec.decode(bytes));
}

const WHY = {
  4004: "That code isn't active. Check it, or ask for a new one.",
  4008: 'Someone else is already connected with this code.',
  4010: 'That code has expired. Ask for a new one.',
  4013: 'That is too big to send in one go.',
};
const NET = "Couldn't reach ClassMap's sharing service. Check the internet connection and try again.";

// ── Sender ──
// events: code(code, expiresAt) · peer(name, words) · left() · progress(0..1) · sent() · declined() · error(msg)
export function startSending(payload, on = {}) {
  let ws, key = null, keys, code, closed = false, done = false, expiry, tries = 0;
  const emit = (e, ...a) => on[e] && on[e](...a);
  const open = async () => {
    keys = keys || await newKeyPair();
    code = newCode();
    ws = new WebSocket(relayUrl(code, 'send'));
    let opened = false;
    ws.onopen = () => {
      opened = true;
      const at = Date.now() + CODE_MINUTES * 60000;
      clearTimeout(expiry);
      expiry = setTimeout(() => { if (!done) { emit('error', WHY[4010]); stop(); } }, CODE_MINUTES * 60000);
      emit('code', code, at);
    };
    ws.onmessage = async ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'hello' && m.pub) {
        key = await sharedKey(keys.kp, m.pub, code);
        ws.send(JSON.stringify({ t: 'hello', name: deviceName(), pub: keys.pub }));
        emit('peer', String(m.name || 'Another device').slice(0, 60), await checkWords(code, keys.pub, m.pub));
      } else if (m.t === 'left') { key = null; emit('left'); }
      else if (m.t === 'got') { done = true; emit('sent'); stop(); }
      else if (m.t === 'decline') { key = null; emit('declined'); }
    };
    ws.onclose = ev => {
      if (closed || done) return;
      if (ev.code === 4009 && tries++ < 3) { open(); return; }      // that code was taken: pick another
      emit('error', WHY[ev.code] || (opened ? 'The connection dropped. Try again.' : NET));
      closed = true;
    };
  };
  const stop = () => { closed = true; clearTimeout(expiry); try { ws && ws.close(1000); } catch { /* closed */ } };
  open().catch(() => emit('error', NET));
  return {
    // send the payload to whoever is connected (after the teacher compared the check words)
    async approve() {
      if (!key || !ws || ws.readyState !== 1) return false;
      const box = await lock(key, payload);
      const parts = Math.max(1, Math.ceil(box.data.length / CHUNK));
      ws.send(JSON.stringify({ t: 'begin', iv: box.iv, z: box.z, parts, size: box.data.length }));
      for (let i = 0; i < parts; i++) {
        ws.send(JSON.stringify({ t: 'part', i, d: box.data.slice(i * CHUNK, (i + 1) * CHUNK) }));
        emit('progress', (i + 1) / parts);
        // let the socket drain so progress is real and memory stays low
        while (ws.bufferedAmount > 4 * CHUNK) await new Promise(r => setTimeout(r, 20));
      }
      return true;
    },
    cancel: stop,
    get code() { return code; },
  };
}

// ── Receiver ──
// events: connected(name, words) · progress(0..1) · data(payload) · error(msg)
export function startReceiving(codeIn, on = {}) {
  const code = cleanCode(codeIn);
  let ws, key = null, keys, closed = false, done = false, incoming = null;
  const emit = (e, ...a) => on[e] && on[e](...a);
  (async () => {
    keys = await newKeyPair();
    ws = new WebSocket(relayUrl(code, 'recv'));
    let opened = false;
    ws.onopen = () => { opened = true; ws.send(JSON.stringify({ t: 'hello', name: deviceName(), pub: keys.pub })); };
    ws.onmessage = async ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'hello' && m.pub) {
        key = await sharedKey(keys.kp, m.pub, code);
        emit('connected', String(m.name || 'Another device').slice(0, 60), await checkWords(code, keys.pub, m.pub));
      } else if (m.t === 'begin') { incoming = { iv: m.iv, z: m.z, parts: m.parts, got: [] }; emit('progress', 0); }
      else if (m.t === 'part' && incoming) {
        incoming.got[m.i] = m.d;
        const n = incoming.got.filter(Boolean).length;
        emit('progress', n / incoming.parts);
        if (n === incoming.parts) {
          try {
            const payload = await unlock(key, { iv: incoming.iv, z: incoming.z, data: incoming.got.join('') });
            done = true;
            ws.send(JSON.stringify({ t: 'got' }));
            emit('data', payload);
            setTimeout(() => { try { ws.close(1000); } catch { /* closed */ } }, 300);
          } catch { emit('error', "Couldn't unlock what was sent. Ask them to send it again."); }
          incoming = null;
        }
      }
    };
    ws.onclose = ev => {
      if (closed || done) return;
      closed = true;
      if (ev.code === 1000 && opened) emit('error', 'They stopped sharing.');
      else emit('error', WHY[ev.code] || (opened ? 'The connection dropped. Try again.' : NET));
    };
  })().catch(() => emit('error', NET));
  return {
    decline() { try { ws.send(JSON.stringify({ t: 'decline' })); ws.close(1000); } catch { /* closed */ } closed = true; },
    cancel() { closed = true; try { ws && ws.close(1000); } catch { /* closed */ } },
  };
}
