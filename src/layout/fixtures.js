// ═══════════════════════════════════════════════
//  ROOM FIXTURES — board, teacher's desk, door, window, outlet, "no seats here" area
//  One renderer for the Layout tab and the Assign tab (Present and Print copy Assign).
// ═══════════════════════════════════════════════
import { esc } from '../core/state.js';

// Size of each fixture in px (used to place it centred on a click and to measure distances).
// The no-seat area is resizable: its size lives on the item (w, h).
export const FIXTURE_SIZE = {
  board: [148, 28],
  teacher: [48, 48],
  door: [56, 16],
  window: [112, 14],
  outlet: [24, 24],
  zone: [168, 112],
  room: [840, 560],
};
export const ZONE_MIN = 56;

// Which fixtures can be resized, and how: 'w' = longer/shorter only, 'wh' = both ways. Smallest size.
export const RESIZE = { board: 'w', door: 'w', window: 'w', teacher: 'wh', zone: 'wh', room: 'wh' };
export const MIN_SIZE = { board: 84, door: 28, window: 28, teacher: 28, zone: ZONE_MIN, room: 168 };

export const isFixture = item => ['board', 'teacher', 'door', 'window', 'outlet', 'zone', 'room'].includes(item.type);

// Current size: resized fixtures keep theirs on the item (w, h)
export function fixtureSize(item) {
  const [w, h] = FIXTURE_SIZE[item.type] || [0, 0];
  const mode = RESIZE[item.type];
  return [mode ? item.w || w : w, mode === 'wh' ? item.h || h : h];
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
    el.className = 'canvas-zone';
    el.innerHTML = `<span class="zone-label">${esc(item.label || 'No seats')}</span>`;
  } else if (item.type === 'room') {
    // Walls: only the four edges can be grabbed, so clicks inside reach the floor (box select, placing)
    el.className = 'canvas-room';
    el.innerHTML = '<i class="room-edge t"></i><i class="room-edge r"></i><i class="room-edge b"></i><i class="room-edge l"></i>';
  }
  sizeFixture(el, item);
  return el;
}

// Apply a fixture's size to its element (after creating it, and while resizing)
export function sizeFixture(el, item) {
  if (!FIXTURE_SIZE[item.type] || item.type === 'outlet') return;
  const [w, h] = fixtureSize(item);
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.setProperty('--w', w + 'px');
}
