// ═══════════════════════════════════════════════
//  MODALS & UTILS
// ═══════════════════════════════════════════════
export function openModal(id) { document.getElementById(id).classList.add('open'); }
export function closeModal(id) { document.getElementById(id).classList.remove('open'); }

export function showToast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

// ═══════════════════════════════════════════════
//  IN-APP DIALOGS (instead of the browser's confirm())
//
//  const ok = await confirmDialog({ title, details, message, confirmLabel, cancelLabel, danger });
//    → true (confirm) or false (Cancel, Esc, click outside).
//    danger: red confirm button, and Cancel gets the focus so Enter can't delete by reflex.
//
//  const pick = await choiceDialog({ title, details, message, choices: [{ label, value, primary }] });
//    → the chosen value, or null (Cancel, Esc, click outside).
// ═══════════════════════════════════════════════
let _closeDialog = null;

function openDialog({ title, details = '', message = '', buttons, focus = 0, danger = false, cancelValue }) {
  if (_closeDialog) _closeDialog(cancelValue);
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'cm-dialog-backdrop';
    wrap.innerHTML = `
      <div class="cm-dialog${danger ? ' danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="cmDialogTitle" aria-describedby="cmDialogMsg">
        <div class="cm-dialog-icon" aria-hidden="true">${danger ? '!' : 'i'}</div>
        <h3 id="cmDialogTitle"></h3>
        <p class="cm-dialog-details"></p>
        <p class="cm-dialog-msg" id="cmDialogMsg"></p>
        <div class="cm-dialog-actions"></div>
      </div>`;
    const q = sel => wrap.querySelector(sel);
    q('h3').textContent = title;
    q('.cm-dialog-details').textContent = details;
    q('.cm-dialog-details').hidden = !details;
    q('.cm-dialog-msg').textContent = message;
    q('.cm-dialog-msg').hidden = !message;

    const done = value => {
      if (!wrap.isConnected || wrap.classList.contains('closing')) return;
      _closeDialog = null;
      document.removeEventListener('keydown', onKey, true);
      wrap.classList.add('closing');
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 180);
      if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus();
      resolve(value);
    };

    const btnEls = buttons.map(b => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cm-btn ' + (b.kind === 'secondary' ? 'cm-btn-cancel' : 'cm-btn-confirm');
      el.textContent = b.label;
      el.addEventListener('click', () => done(b.value));
      q('.cm-dialog-actions').appendChild(el);
      return el;
    });

    // While a dialog is open, keys belong to it (no app shortcuts like Delete = unseat)
    const onKey = e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(cancelValue); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const i = btnEls.indexOf(document.activeElement);
        btnEls[(i + (e.shiftKey ? -1 : 1) + btnEls.length) % btnEls.length].focus();
      }
    };
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) done(cancelValue); });

    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey, true);
    _closeDialog = done;
    btnEls[Math.max(0, Math.min(focus, btnEls.length - 1))].focus();
    requestAnimationFrame(() => wrap.classList.add('open'));
  });
}

export function confirmDialog({ title = 'Are you sure?', details = '', message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return openDialog({
    title, details, message, danger, cancelValue: false,
    buttons: [{ label: cancelLabel, value: false, kind: 'secondary' }, { label: confirmLabel, value: true }],
    focus: danger ? 0 : 1,
  });
}

export function choiceDialog({ title, details = '', message = '', choices, cancelLabel = 'Cancel' }) {
  const primary = Math.max(0, choices.findIndex(c => c.primary));
  return openDialog({
    title, details, message, cancelValue: null,
    buttons: [
      { label: cancelLabel, value: null, kind: 'secondary' },
      ...choices.map(c => ({ label: c.label, value: c.value, kind: c.primary ? 'primary' : 'secondary' })),
    ],
    focus: primary + 1,
  });
}

// ═══════════════════════════════════════════════
//  TOAST WITH AN ACTION (Undo, "Start empty", …)
//    actionToast('New chart · same room', 'Start empty', () => { … });
//    undoToast('Chart “6C” deleted', () => { …put it back… });
//  Stays `ms` (paused while the pointer is over it). One at a time: a new one closes
//  the old one, and that chance is over.
// ═══════════════════════════════════════════════
let _actionToast = null;
export function actionToast(message, actionLabel, onAction, ms = 8000) {
  if (_actionToast) _actionToast.close();
  const el = document.createElement('div');
  el.className = 'cm-undo-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="cm-undo-msg"></span>
    <button type="button" class="cm-undo-btn"></button>
    <button type="button" class="cm-undo-x" aria-label="Dismiss">✕</button>
    <div class="cm-undo-bar"></div>`;
  el.querySelector('.cm-undo-msg').textContent = message;
  el.querySelector('.cm-undo-btn').textContent = actionLabel;
  const bar = el.querySelector('.cm-undo-bar');
  let left = ms, startedAt = 0, timer = null;

  const close = () => {
    clearTimeout(timer);
    timer = null;
    if (_actionToast === api) _actionToast = null;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  };
  const run = () => {
    startedAt = Date.now();
    bar.style.transition = `transform ${left}ms linear`;
    bar.style.transform = 'scaleX(0)';
    timer = setTimeout(close, left);
  };
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    left = Math.max(0, left - (Date.now() - startedAt));
    bar.style.transition = 'none';
    bar.style.transform = `scaleX(${left / ms})`;
  };
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', () => { if (!timer && el.isConnected && _actionToast === api) run(); });
  el.querySelector('.cm-undo-btn').addEventListener('click', () => { close(); onAction(); });
  el.querySelector('.cm-undo-x').addEventListener('click', close);

  const api = { close };
  _actionToast = api;
  document.body.appendChild(el);
  bar.style.transform = 'scaleX(1)';
  requestAnimationFrame(() => { el.classList.add('show'); requestAnimationFrame(run); });
}

export function undoToast(message, onUndo, ms = 8000) {
  actionToast(message, 'Undo', onUndo, ms);
}

// "2026-10-10" → "Oct 10, 2026"
export function prettyDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd || '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// plural(3, 'chart') → "3 charts"; plural(2, 'class', 'classes') → "2 classes"
export function plural(n, word, many = word + 's') {
  return `${n} ${n === 1 ? word : many}`;
}
