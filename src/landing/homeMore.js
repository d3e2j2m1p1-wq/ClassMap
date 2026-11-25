// Home header "⋯ More" menu (Back up, Import, Name list)
const box = () => document.getElementById('homeMore');

export function closeHomeMore() {
  const b = box(); if (!b) return;
  b.querySelector('.home-more-menu').hidden = true;
  b.querySelector('[aria-haspopup]').setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onKey, true);
}
function outside(e) { if (!box()?.contains(e.target)) closeHomeMore(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeHomeMore(); box()?.querySelector('[aria-haspopup]').focus(); } }

export function toggleHomeMore(e) {
  e?.stopPropagation();
  const menu = box().querySelector('.home-more-menu');
  if (!menu.hidden) { closeHomeMore(); return; }
  menu.hidden = false;
  box().querySelector('[aria-haspopup]').setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
}
