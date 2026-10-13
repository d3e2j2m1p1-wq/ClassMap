import { SEAT_SIZE } from './panel.js';
import { state } from '../core/state.js';
import { tableGroupsOf } from '../layout/tableGroups.js';
import { tableBBox } from '../layout/tables.js';

// All seats with their position on the canvas. Table seats are rotated around
// the table centre, exactly like the table is drawn, so distances are real.
export function getAllSeats(items = state.layoutItems) {
  const seats = [];
  items.forEach(item => {
    if (item.type === 'seat') {
      seats.push({ seatId: item.id, itemId: item.id, x: item.x, y: item.y, tableId: null, podKey: null });
    } else if (item.type === 'table') {
      const bb = tableBBox(item);
      const cx = bb.w / 2, cy = bb.h / 2;
      const th = (item.rotation || 0) * Math.PI / 180;
      const c = Math.cos(th), sn = Math.sin(th);
      const groups = tableGroupsOf(item);
      const gOf = {};
      groups.forEach((g, gi) => g.forEach(i => { gOf[i] = gi; }));
      (item.seatPositions || []).forEach((pos, i) => {
        const lx = pos.x + SEAT_SIZE / 2 - cx, ly = pos.y + SEAT_SIZE / 2 - cy;
        const wx = item.x + cx + lx * c - ly * sn;
        const wy = item.y + cy + lx * sn + ly * c;
        seats.push({
          seatId: item.id + '_' + i,
          itemId: item.id,
          x: wx - SEAT_SIZE / 2,
          y: wy - SEAT_SIZE / 2,
          tableId: item.id,
          // shared group at the table (null = this seat works on its own: solo, or the odd one out)
          podKey: groups[gOf[i]] && groups[gOf[i]].length > 1 ? item.id + ':' + gOf[i] : null,
        });
      });
    }
  });
  return seats;
}

// Drop assignments that point at seats/students that no longer exist
export function cleanAssignments() {
  const validSeats = new Set(getAllSeats().map(s => s.seatId));
  const validStudents = new Set(state.students.map(s => s.id));
  const seen = new Set();
  let changed = false;
  Object.keys(state.assignments).forEach(k => {
    const sid = state.assignments[k];
    if (!validSeats.has(k) || !validStudents.has(sid) || seen.has(sid)) {
      delete state.assignments[k];
      changed = true;
    } else {
      seen.add(sid);
    }
  });
  return changed;
}
