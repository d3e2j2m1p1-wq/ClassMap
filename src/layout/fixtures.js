// ═══════════════════════════════════════════════
//  ROOM FIXTURES — board, teacher's desk, door, window, outlet, "no seats here" area
//  One renderer for the Layout tab and the Assign tab (Present and Print copy Assign).
// ═══════════════════════════════════════════════
import { esc } from '../core/state.js';

// Size of each fixture in px (used to place it centred on a click and to measure distances).
// The no-seat area is resizable: its size lives on the item (w, h).
export const FIXTURE_SIZE = {
  teacher: [48, 48],
  door: [56, 16],
  window: [112, 14],
  outlet: [24, 24],
  zone: [168, 112],
};
export const ZONE_MIN = 56;

export const isFixture = item => ['board', 'teacher', 'door', 'window', 'outlet', 'zone'].includes(item.type);

export function fixtureSize(item) {
  if (item.type === 'zone') return [item.w || FIXTURE_SIZE.zone[0], item.h || FIXTURE_SIZE.zone[1]];
  return FIXTURE_SIZE[item.type] || [0, 0];
}

// Centre of a fixture on the canvas (rotation turns it around its centre, so the centre stays put)
export function fixtureCenter(item) {
  const [w, h] = fixtureSize(item);
  return [item.x + w / 2, item.y + h / 2];
}

const PLUG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></svg>';

// The visible element for a fixture (without position / rotation)
export function makeFixture(item) {
  const el = document.createElement('div');
  if (item.type === 'board') {
    el.className = 'canvas-board';
    el.textContent = '▲ Board';
  } else if (item.type === 'teacher') {
    el.className = 'canvas-teacher';
    el.innerHTML = '★<span>Teacher</span>';
  } else if (item.type === 'door') {
    el.className = 'canvas-door';
    el.innerHTML = '<span>Door</span>';
  } else if (item.type === 'window') {
    el.className = 'canvas-window';
    el.innerHTML = '<span>Window</span>';
  } else if (item.type === 'outlet') {
    el.className = 'canvas-outlet';
    el.innerHTML = PLUG;
    el.setAttribute('aria-label', 'Outlet');
  } else if (item.type === 'zone') {
    const [w, h] = fixtureSize(item);
    el.className = 'canvas-zone';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.innerHTML = `<span class="zone-label">${esc(item.label || 'No seats')}</span>`;
  }
  return el;
}
