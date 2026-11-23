// ═══════════════════════════════════════════════
//  SEND & RECEIVE — the dialog, what gets sent, and adding it on the other device
//  Send: a class (roster, rules, tags and its charts), one chart with its class, or everything.
//  Receive: type the code, scan the QR with the device's camera, or open the link.
//  Received classes are added (or, when it's the same class from your other device, updated:
//  the newest copy of each chart wins). Nothing on the receiving device is deleted. Undo works.
// ═══════════════════════════════════════════════
import qrcode from 'qrcode-generator';
import { store } from '../core/store.js';
import { esc } from '../core/state.js';
import { confirmDialog, plural, showToast, undoToast } from '../core/ui.js';
import { showLanding } from '../landing/landing.js';
import { mergeNameList, nameList } from '../roster/nameList.js';
import { mergeData } from '../storage/merge.js';
import { CLASS_COLORS, normalizeLandingData, saveLandingData } from '../storage/landingData.js';
import { editorOpen, flushSave } from '../storage/autosave.js';
import { CODE_LEN, CODE_MINUTES, cleanCode, deviceName, formatCode, receiveLink, startReceiving, startSending } from './transfer.js';

const clone = o => JSON.parse(JSON.stringify(o));

// ── What gets sent ──
export function classPayload(classId, chartIds = null) {
  if (editorOpen()) flushSave();
  const L = store.landingData;
  const cls = L.classes.find(c => c.id === classId);
  if (!cls) return null;
  const charts = L.charts.filter(ch => ch.classId === classId && (!chartIds || chartIds.includes(ch.id)));
  return { app: 'ClassMap', kind: 'class', v: 1, from: deviceName(), sentAt: Date.now(), class: clone(cls), charts: clone(charts), nameList: clone(nameList) };
}
export function everythingPayload() {
  if (editorOpen()) flushSave();
  return { app: 'ClassMap', kind: 'everything', v: 1, from: deviceName(), sentAt: Date.now(), landingData: clone(store.landingData), nameList: clone(nameList) };
}
const describe = p => p.kind === 'everything'
  ? `${plural(p.landingData.classes.length, 'class', 'classes')} · ${plural(p.landingData.charts.length, 'chart')}`
  : `“${p.class.name}” · ${plural((p.class.students || []).length, 'student')} · ${plural(p.charts.length, 'chart')}`;

// ── Adding what arrived ──
export async function addReceived(p) {
  if (!p || p.app !== 'ClassMap' || !['class', 'everything'].includes(p.kind)) { showToast('❌ That wasn’t something ClassMap can open.', 5000); return false; }
  const before = clone(store.landingData);
  const L = store.landingData;
  let msg, selectId = null;
  if (p.kind === 'everything') {
    const R = p.landingData || {};
    const ok = await confirmDialog({
      title: 'Add everything that was sent?',
      details: `${plural((R.classes || []).length, 'class', 'classes')} · ${plural((R.charts || []).length, 'chart')} · from ${p.from || 'another device'}`,
      message: 'Nothing on this device is deleted. When a chart is on both devices, the newest copy is kept.',
      confirmLabel: 'Add everything',
    });
    if (!ok) return false;
    store.landingData = mergeData(L, { ...R, deleted: [] });
    msg = 'Everything from the other device was added';
  } else {
    const cls = p.class, charts = p.charts || [];
    const mine = L.classes.find(c => c.id === cls.id);
    if (mine) {
      // the same class from your other device (or sent back to you): update it
      const ok = await confirmDialog({
        title: `Update “${mine.name}” with what was sent?`,
        details: `${plural((cls.students || []).length, 'student')} · ${plural(charts.length, 'chart')} · from ${p.from || 'another device'}`,
        message: 'The roster and rules become the ones that were sent. Charts are added; when a chart is on both devices, the newest copy is kept.',
        confirmLabel: 'Update class',
      });
      if (!ok) return false;
      Object.assign(mine, clone(cls), { color: mine.color || cls.color });
      charts.forEach(ch => {
        const i = L.charts.findIndex(x => x.id === ch.id);
        if (i < 0) L.charts.push(ch);
        else if ((ch.savedAt || 0) > (L.charts[i].savedAt || 0)) L.charts[i] = ch;
      });
      msg = `Updated “${mine.name}”`;
    } else {
      const taken = new Set(L.classes.map(c => c.name.toLowerCase()));
      let name = cls.name || 'Shared class';
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${cls.name} (${n})`;
      const ok = await confirmDialog({
        title: `Add “${name}” as a new class?`,
        details: `${plural((cls.students || []).length, 'student')} · ${plural(charts.length, 'chart')} · from ${p.from || 'another device'}`,
        message: 'Nothing else on this device changes.',
        confirmLabel: 'Add class',
      });
      if (!ok) return false;
      L.classes.push({ ...clone(cls), name, color: cls.color || CLASS_COLORS[L.classes.length % CLASS_COLORS.length] });
      charts.forEach(ch => { if (!L.charts.some(x => x.id === ch.id)) L.charts.push(ch); });
      msg = `Added “${name}”`;
    }
    selectId = cls.id;
  }
  // a class or chart deleted on this device earlier must not stay hidden now that it was sent again
  const sentIds = new Set(p.kind === 'everything' ? [] : [p.class.id, ...(p.charts || []).map(c => c.id)]);
  if (store.landingData.deleted) store.landingData.deleted = store.landingData.deleted.filter(d => !sentIds.has(d.id));
  normalizeLandingData();
  if (p.nameList) mergeNameList(p.nameList);
  saveLandingData();
  if (selectId) store.activeClassId = selectId;
  showLanding();
  undoToast(msg, () => {
    store.landingData = before;
    normalizeLandingData();
    saveLandingData();
    if (selectId && !before.classes.some(c => c.id === selectId)) store.activeClassId = null;
    showLanding();
  }, 10000);
  return true;
}

// ── Dialog ──
let session = null;      // the transfer in progress (send or receive)
let tick = null;

function dialog(html) {
  let d = document.getElementById('shareDialog');
  if (!d) {
    d = document.createElement('div');
    d.id = 'shareDialog';
    d.className = 'ar-backdrop';
    d.innerHTML = '<div class="ar-dialog sh-dialog" role="dialog" aria-modal="true" aria-labelledby="shTitle"></div>';
    d.addEventListener('pointerdown', e => { if (e.target === d) closeShare(); });
    document.addEventListener('keydown', shareKeys, true);
    document.body.appendChild(d);
  }
  const box = d.querySelector('.sh-dialog');
  box.innerHTML = `<button class="ar-x" aria-label="Close">✕</button>${html}`;
  box.querySelector('.ar-x').onclick = closeShare;
  return box;
}
function shareKeys(e) { if (e.key === 'Escape') { e.stopPropagation(); closeShare(); } }
export function closeShare() {
  if (session) { session.cancel(); session = null; }
  clearInterval(tick);
  const d = document.getElementById('shareDialog');
  if (d) d.remove();
  document.removeEventListener('keydown', shareKeys, true);
}

// Home page "⇄ Send & receive"
export function openShare() {
  closeShare();
  const box = dialog(`
    <h2 id="shTitle">Send &amp; receive</h2>
    <p class="sh-lead">Move classes and charts to another device or another teacher — no files. Both need ClassMap open.</p>
    <div class="sh-choices">
      <button class="sh-choice" id="shPickSend"><b>⇡ Send</b><span>from this device</span></button>
      <button class="sh-choice" id="shPickRecv"><b>⇣ Receive</b><span>with a code from the other device</span></button>
    </div>
    <p class="sh-fine">Locked on this device before it leaves, and only the other device can unlock it. ClassMap's server just passes it along and keeps nothing.</p>`);
  box.querySelector('#shPickSend').onclick = pickWhatToSend;
  box.querySelector('#shPickRecv').onclick = () => openReceive();
}

function pickWhatToSend() {
  const L = store.landingData;
  if (!L.classes.length) { showToast('There are no classes on this device yet'); return; }
  const rows = L.classes.map(c => {
    const n = L.charts.filter(ch => ch.classId === c.id).length;
    return `<label class="sh-row"><input type="radio" name="shWhat" value="${esc(c.id)}"${c.id === store.activeClassId ? ' checked' : ''}>
      <span><b>${esc(c.name)}</b><small>${plural((c.students || []).length, 'student')} · ${plural(n, 'chart')}</small></span></label>`;
  }).join('');
  const box = dialog(`
    <h2 id="shTitle">What do you want to send?</h2>
    <div class="sh-list">${rows}
      <label class="sh-row"><input type="radio" name="shWhat" value="*"><span><b>Everything on this device</b><small>${plural(L.classes.length, 'class', 'classes')} · ${plural(L.charts.length, 'chart')} — handy for your own other device</small></span></label>
    </div>
    <div class="sh-actions"><button class="rc-btn" id="shBack">Back</button><button class="rc-btn primary" id="shGo">Get a code</button></div>`);
  if (!box.querySelector('input:checked')) box.querySelector('input').checked = true;
  box.querySelector('#shBack').onclick = openShare;
  box.querySelector('#shGo').onclick = () => {
    const v = box.querySelector('input:checked').value;
    startSendFlow(v === '*' ? everythingPayload() : classPayload(v));
  };
}

// Chart menu "⇄ Send to another device…": this chart and its class
export function sendCurrentChart() {
  const p = classPayload(window._currentChartClassId, window._currentChartId ? [window._currentChartId] : null);
  if (!p) { showToast('Save this chart first'); return; }
  startSendFlow(p);
}

export function startSendFlow(payload) {
  if (!payload) return;
  if (session) session.cancel();
  const what = describe(payload);
  const box = dialog(`<h2 id="shTitle">Send ${esc(what.split(' · ')[0])}</h2><div class="sh-body"><p class="sh-wait">Getting a code…</p></div>`);
  const body = box.querySelector('.sh-body');
  let expiresAt = 0;
  const showCode = () => {
    const link = receiveLink(session.code);
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    body.innerHTML = `
      <div class="sh-codebox">
        <div class="sh-qr" aria-hidden="true">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
        <div>
          <p>On the other device, open ClassMap → <b>Send &amp; receive</b> → <b>Receive</b> and type:</p>
          <div class="sh-code" aria-label="Code ${esc(session.code.split('').join(' '))}">${esc(formatCode(session.code))}</div>
          <p class="sh-fine">Or scan the QR code with its camera. <button class="sh-link" id="shCopy">Copy link</button></p>
          <p class="sh-fine" id="shTimer"></p>
        </div>
      </div>
      <p class="sh-what">Sending ${esc(what)}</p>`;
    body.querySelector('#shCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(link); showToast('Link copied — it only works while this window stays open'); }
      catch { showToast(link, 8000); }
    };
    clearInterval(tick);
    const t = () => {
      const s = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      const el = document.getElementById('shTimer');
      if (el) el.textContent = `Code works for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} — keep this window open.`;
    };
    t(); tick = setInterval(t, 1000);
  };
  session = startSending(payload, {
    code: (code, at) => { expiresAt = at; showCode(); },
    peer: (name, words) => {
      clearInterval(tick);
      body.innerHTML = `
        <p><b>${esc(name)}</b> connected.</p>
        <p>Check that <b>both screens</b> show the same words:</p>
        <div class="sh-words">${esc(words)}</div>
        <p class="sh-what">Sending ${esc(what)}</p>
        <div class="sh-actions"><button class="rc-btn" id="shNo">Cancel</button><button class="rc-btn primary" id="shSend">Send</button></div>`;
      body.querySelector('#shNo').onclick = closeShare;
      body.querySelector('#shSend').onclick = async () => {
        body.innerHTML = '<p>Sending… <span id="shPct">0%</span></p><div class="sh-bar"><i id="shBar"></i></div>';
        const ok = await session.approve();
        if (!ok) body.innerHTML = '<p class="sh-err">The other device disconnected before it could be sent.</p>';
      };
    },
    progress: f => {
      const p = document.getElementById('shPct'), b = document.getElementById('shBar');
      if (p) p.textContent = Math.round(f * 100) + '%';
      if (b) b.style.width = Math.round(f * 100) + '%';
    },
    left: () => { body.insertAdjacentHTML('afterbegin', '<p class="sh-err">The other device left. Waiting for someone to use the code again…</p>'); showCode(); },
    declined: () => { body.innerHTML = '<p class="sh-err">They chose not to receive it.</p><div class="sh-actions"><button class="rc-btn" id="shOk">Close</button></div>'; body.querySelector('#shOk').onclick = closeShare; },
    sent: () => {
      session = null;
      body.innerHTML = `<p class="sh-ok">✓ Sent. It's on the other device now.</p><div class="sh-actions"><button class="rc-btn primary" id="shOk">Done</button></div>`;
      body.querySelector('#shOk').onclick = closeShare;
    },
    error: msg => {
      clearInterval(tick);
      session = null;
      body.innerHTML = `<p class="sh-err">${esc(msg)}</p><div class="sh-actions"><button class="rc-btn" id="shOk">Close</button><button class="rc-btn primary" id="shAgain">Try again</button></div>`;
      body.querySelector('#shOk').onclick = closeShare;
      body.querySelector('#shAgain').onclick = () => startSendFlow(payload);
    },
  });
}

export function openReceive(prefill = '') {
  if (session) session.cancel();
  session = null;
  if (editorOpen()) { flushSave(); showLanding(); }
  const box = dialog(`
    <h2 id="shTitle">Receive</h2>
    <p class="sh-lead">Type the code shown on the other device.</p>
    <form class="sh-enter" autocomplete="off">
      <input id="shCode" class="sh-input" inputmode="text" autocapitalize="characters" spellcheck="false" maxlength="7" placeholder="ABC-123" aria-label="Code from the other device" value="${esc(prefill ? formatCode(cleanCode(prefill)) : '')}">
      <button class="rc-btn primary" type="submit">Connect</button>
    </form>
    <div class="sh-body"></div>`);
  const input = box.querySelector('#shCode'), body = box.querySelector('.sh-body');
  input.addEventListener('input', () => {
    const c = cleanCode(input.value);
    input.value = c.length > 3 ? formatCode(c) : c;
  });
  const go = () => {
    const code = cleanCode(input.value);
    if (code.length !== CODE_LEN) { body.innerHTML = `<p class="sh-err">Codes have ${CODE_LEN} letters and numbers.</p>`; return; }
    body.innerHTML = '<p class="sh-wait">Connecting…</p>';
    session = startReceiving(code, {
      connected: (name, words) => {
        body.innerHTML = `
          <p>Connected to <b>${esc(name)}</b>.</p>
          <p>Check that <b>both screens</b> show the same words:</p>
          <div class="sh-words">${esc(words)}</div>
          <p class="sh-wait">Waiting for them to tap Send…</p>`;
      },
      progress: f => { body.innerHTML = `<p>Receiving… ${Math.round(f * 100)}%</p><div class="sh-bar"><i style="width:${Math.round(f * 100)}%"></i></div>`; },
      data: async payload => {
        session = null;
        closeShare();
        await addReceived(payload);
      },
      error: msg => { session = null; body.innerHTML = `<p class="sh-err">${esc(msg)}</p>`; },
    });
  };
  box.querySelector('form').addEventListener('submit', e => { e.preventDefault(); go(); });
  input.focus();
  if (prefill) go();
}

// Opening a "…/app/#receive=CODE" link (or scanning the QR) goes straight to receiving
export function receiveFromLink() {
  const m = /^#receive=([A-Za-z0-9-]+)/.exec(location.hash || '');
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  openReceive(m[1]);
}
