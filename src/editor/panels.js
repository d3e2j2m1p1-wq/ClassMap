import { renderAssignPanel } from '../assign/panel.js';
import { initRuleTypeaheads, populateRuleSelects } from './rules.js';

// ═══════════════════════════════════════════════
//  PANEL SWITCHING
// ═══════════════════════════════════════════════
export function switchPanel(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  btn.classList.add('active');

  if (name === 'rules') { populateRuleSelects(); initRuleTypeaheads(); }
  if (name === 'assign') renderAssignPanel();
}

// Header "⋯" menu (Save now, Export / Import chart file)
export function toggleMoreMenu(e) {
  e.stopPropagation();
  const dd = document.getElementById('moreDD');
  dd.classList.remove('suppress');
  const open = !dd.classList.contains('open');
  dd.classList.toggle('open', open);
  if (open) {
    const outside = ev => {
      if (dd.contains(ev.target)) return;
      dd.classList.remove('open');
      document.removeEventListener('pointerdown', outside, true);
    };
    document.addEventListener('pointerdown', outside, true);
  }
}
export function closeMoreMenu() {
  const dd = document.getElementById('moreDD');
  dd.classList.remove('open');
  if (window.matchMedia('(hover: hover)').matches) dd.classList.add('suppress');
}
