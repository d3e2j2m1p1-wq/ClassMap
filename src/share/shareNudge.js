// ═══════════════════════════════════════════════
//  Helping teachers find Send & receive
//  · a one-time hint once they have two charts
//  · a gentle nudge after a chart comes out clean (every rule kept)
//  Both stop for good once the teacher has sent something, or after "Not now" a few times.
// ═══════════════════════════════════════════════
import { esc } from '../core/state.js';

const KEY = 'cm-share';            // { sent, hint, dismissed }
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = patch => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch })); } catch { /* private mode */ } };
const nudgedCharts = new Set();     // once per chart per session

export function markSent() { write({ sent: true }); closeShareCard(); }

export function closeShareCard() {
  const c = document.getElementById('shareCard');
  if (c) { c.classList.add('out'); setTimeout(() => c.remove(), 250); }
}

function card({ title, text, action, onAction, onDismiss }) {
  if (document.getElementById('shareCard') || document.getElementById('shareDialog')) return false;
  const el = document.createElement('div');
  el.id = 'shareCard';
  el.className = 'share-card';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <img class="share-card-art" src="/art/wren-card.webp" width="600" height="495" alt="">
    <div class="share-card-body">
      <b>${esc(title)}</b>
      <p>${esc(text)}</p>
      <div class="share-card-actions">
        <button class="btn btn-primary btn-sm" data-act="go">${esc(action)}</button>
        <button class="btn btn-ghost btn-sm" data-act="no">Not now</button>
      </div>
    </div>`;
  el.querySelector('[data-act=go]').onclick = () => { closeShareCard(); onAction(); };
  el.querySelector('[data-act=no]').onclick = () => { closeShareCard(); onDismiss?.(); };
  document.body.appendChild(el);
  return true;
}

// After a second chart is made: point out that charts can travel
export function maybeShareHint(chartCount) {
  const s = read();
  if (s.sent || s.hint || chartCount < 2) return;
  setTimeout(() => {
    if (card({
      title: 'Share this chart',
      text: 'Send charts to a co-teacher, a sub, or your own phone — no files, no accounts.',
      action: 'Show me',
      onAction: () => window.sendCurrentChart?.(),
    })) write({ hint: true });
  }, 900);
}

// After Auto-Assign keeps every rule
export function maybeNudgeAfterAssign(chartId) {
  const s = read();
  if (s.sent || (s.dismissed || 0) >= 3 || !chartId || nudgedCharts.has(chartId)) return;
  setTimeout(() => {
    if (card({
      title: 'Every rule kept ✓',
      text: 'Want this chart on your co-teacher’s computer or your phone?',
      action: 'Send it',
      onAction: () => window.sendCurrentChart?.(),
      onDismiss: () => write({ dismissed: (read().dismissed || 0) + 1 }),
    })) nudgedCharts.add(chartId);
  }, 1800);
}
