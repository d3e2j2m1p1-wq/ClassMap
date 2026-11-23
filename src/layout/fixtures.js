// ═══════════════════════════════════════════════
//  ROOM FIXTURES — board, teacher's desk, door, window, outlet, "no seats here" area
//  One renderer for the Layout tab and the Assign tab (Present and Print copy Assign).
// ═══════════════════════════════════════════════
import { esc } from '../core/state.js';
import { roomPoints } from './roomShape.js';

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
// (Walls are shaped by dragging their corners instead.)
export const RESIZE = { board: 'w', door: 'w', window: 'w', teacher: 'wh', zone: 'wh' };
export const MIN_SIZE = { board: 84, door: 28, window: 28, teacher: 28, zone: ZONE_MIN, room: 168 };

export const isFixture = item => ['board', 'teacher', 'door', 'window', 'outlet', 'zone', 'room'].includes(item.type);

// Current size: resized fixtures keep theirs on the item (w, h)
export function fixtureSize(item) {
  if (item.type === 'room') return [item.w || FIXTURE_SIZE.room[0], item.h || FIXTURE_SIZE.room[1]];
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
    // Walls: an outline of any shape. Only the wall lines can be grabbed, so clicks inside reach
    // the floor (box select, placing tables).
    el.className = 'canvas-room';
    el.innerHTML = roomSvg(item);
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

// The walls as an SVG outline (corners relative to the walls item)
export function roomSvg(item) {
  const [w, h] = fixtureSize(item);
  const pts = roomPoints(item).map(([x, y]) => `${x - item.x},${y - item.y}`).join(' ');
  return `<svg class="room-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible" aria-hidden="true"><polygon class="room-wall" points="${pts}"/></svg>`;
}
