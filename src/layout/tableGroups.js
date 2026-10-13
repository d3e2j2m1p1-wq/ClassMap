import { SEAT_SIZE } from '../assign/panel.js';
import { esc, state } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { renderLayoutCanvas, setTool } from './canvas.js';
import { markDirty } from '../storage/autosave.js';

// ═══════════════════════════════════════════════
//  TABLE GROUPS
//  A table can be split into groups ("2 groups" at a table of 4 = two pairs).
//  item.groups     : 1 (whole table) | 2, 3, 4 … | 'solo' (every seat on its own)
//  item.groupShift : which way the split goes (changed by "Switch who's grouped together")
//  Groups are worked out from the seat positions every time, so adding, removing or
//  dragging a seat just regroups: 4 seats in 2 groups → remove one → 2 + 1.
// ═══════════════════════════════════════════════
export const GROUP_COLORS = ['#2dd4bf', '#a78bfa', '#fbbf24', '#f472b6', '#60a5fa', '#a3e635'];

export function groupCountOf(groups, n) {
  if (groups === 'solo') return n;
  return Math.max(1, Math.min(parseInt(groups) || 1, n));
}

export function groupsText(groups, n) {
  if (groups === 'solo') return 'solo';
  const k = parseInt(groups) || 1;
  if (n !== undefined && n > 1 && k >= n) return 'solo';
  return k === 1 ? '1 group' : k + ' groups';
}

// Sizes as even as possible, bigger groups first: 5 seats in 2 groups → [3, 2]
export function groupSizes(n, k) {
  const base = Math.floor(n / k), extra = n % k;
  return Array.from({ length: k }, (_, g) => base + (g < extra ? 1 : 0));
}

// Seats are ordered around the table's centre and cut into k neighbouring runs,
// so pairs are always seats that sit next to each other, whatever the table's shape.
export function partitionSeats(pos, k, shift) {
  const n = pos.length;
  if (!n) return [];
  if (k <= 1) return [pos.map((_, i) => i)];
  if (k >= n) return pos.map((_, i) => [i]);
  const cx = pos.reduce((t, p) => t + p.x, 0) / n, cy = pos.reduce((t, p) => t + p.y, 0) / n;
  const order = pos.map((p, i) => ({ i, a: Math.atan2(p.y - cy, p.x - cx) }))
    .sort((a, b) => (a.a - b.a) || (a.i - b.i)).map(o => o.i);
  const sh = (((shift || 0) % n) + n) % n;
  const ring = order.slice(sh).concat(order.slice(0, sh));
  const out = [];
  let at = 0;
  groupSizes(n, k).forEach(size => { out.push(ring.slice(at, at + size).sort((a, b) => a - b)); at += size; });
  return out.sort((a, b) => a[0] - b[0]);
}

export function tableGroupsOf(item) {
  const pos = item.seatPositions || [];
  return partitionSeats(pos, groupCountOf(item.groups, pos.length), item.groupShift);
}

export const _splitKey = groups => groups.map(g => g.join(',')).sort().join('|');

// The next different way to split this table (null if there's only one way)
export function nextGroupShift(item) {
  const pos = item.seatPositions || [];
  const n = pos.length, k = groupCountOf(item.groups, n);
  if (k <= 1 || k >= n) return null;
  const cur = _splitKey(tableGroupsOf(item));
  for (let step = 1; step < n; step++) {
    const shift = ((item.groupShift || 0) + step) % n;
    if (_splitKey(partitionSeats(pos, k, shift)) !== cur) return shift;
  }
  return null;
}

// Coloured outline + letter around each group of 2 or more
export function appendGroupOutlines(container, item) {
  const groups = tableGroupsOf(item);
  if (groups.length < 2) return;            // whole table: the table outline is enough
  groups.forEach((g, gi) => {
    if (g.length < 2) return;               // a seat on its own needs no outline
    const ps = g.map(i => item.seatPositions[i]);
    const x0 = Math.min(...ps.map(p => p.x)) - 3, y0 = Math.min(...ps.map(p => p.y)) - 3;
    const x1 = Math.max(...ps.map(p => p.x)) + SEAT_SIZE + 3, y1 = Math.max(...ps.map(p => p.y)) + SEAT_SIZE + 3;
    const col = GROUP_COLORS[gi % GROUP_COLORS.length];
    const o = document.createElement('div');
    o.className = 'table-group-outline';
    o.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;border-color:${col}b0;background:${col}14;`;
    const tag = document.createElement('span');
    tag.className = 'table-group-tag';
    tag.textContent = String.fromCharCode(65 + gi);
    tag.style.color = col;
    o.appendChild(tag);
    container.insertBefore(o, container.firstChild);
  });
}

// Choices for a table with n seats: 1 group, 2 … (n−1) groups (up to 4), solo
export function groupOptions(n) {
  const opts = [{ v: 1, label: '1 group', sub: 'whole table' }];
  for (let k = 2; k <= Math.min(4, n - 1); k++) opts.push({ v: k, label: k + ' groups', sub: groupSizes(n, k).join(' + ') });
  if (n >= 2) opts.push({ v: 'solo', label: 'Solo', sub: 'independent work' });
  return opts;
}
export const sameGroups = (a, b, n) => groupsText(a, n) === groupsText(b, n);

export function tmItem(label, sub, active, onPick) {
  const b = document.createElement('button');
  b.className = 'tm-item' + (active ? ' active' : '');
  b.innerHTML = `<span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}`;
  b.addEventListener('click', e => { e.stopPropagation(); onPick(); });
  return b;
}
export function tmDiv(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  return d;
}

export function normTableDefaults(d) {
  d = d || {};
  const seats = Math.max(1, Math.min(12, parseInt(d.seats) || 4));
  let groups = d.groups === 'solo' ? 'solo' : Math.max(1, parseInt(d.groups) || 1);
  if (groups !== 'solo' && groups >= seats) groups = seats > 1 ? 'solo' : 1;
  return { seats, groups };
}

// ── Table tool menu (toolbar). Picking a group count makes it the default for this chart. ──
export function updateTableToolBadge() {
  state.tableDefaults = normTableDefaults(state.tableDefaults);
  const d = state.tableDefaults;
  const badge = document.getElementById('tableToolBadge');
  if (badge) badge.textContent = `${d.seats} · ${groupsText(d.groups, d.seats)}`;
  renderTableToolMenu();
}

export function renderTableToolMenu() {
  const box = document.getElementById('tableToolMenu');
  if (!box) return;
  const d = state.tableDefaults;
  box.innerHTML = '';
  box.appendChild(tmDiv('tm-label', 'Seats per table'));
  const row = tmDiv('tm-row');
  [2, 3, 4, 5, 6, 8].forEach(n => {
    const c = document.createElement('button');
    c.className = 'tm-chip' + (d.seats === n ? ' active' : '');
    c.textContent = n;
    c.addEventListener('click', e => {
      e.stopPropagation();
      state.tableDefaults = normTableDefaults({ seats: n, groups: d.groups });
      markDirty();
      setTool('table');
      updateTableToolBadge();             // menu stays open so groups can be picked next
    });
    row.appendChild(c);
  });
  box.appendChild(row);
  box.appendChild(tmDiv('tm-label', 'Groups at each table'));
  groupOptions(d.seats).forEach(o => box.appendChild(tmItem(o.label, o.sub, sameGroups(d.groups, o.v, d.seats), () => {
    state.tableDefaults = normTableDefaults({ seats: d.seats, groups: o.v });
    markDirty();
    setTool('table');
    updateTableToolBadge();
    closeTableToolMenu();
    showToast(`New tables: ${d.seats} seats · ${groupsText(o.v, d.seats)}`);
  })));
}

export function toggleTableToolMenu(e) {
  e.stopPropagation();
  const dd = document.getElementById('tableToolDD');
  dd.classList.remove('suppress');
  const open = !dd.classList.contains('open');
  dd.classList.toggle('open', open);
  if (open) {
    renderTableToolMenu();
    const outside = ev => {
      if (dd.contains(ev.target)) return;
      dd.classList.remove('open');
      document.removeEventListener('pointerdown', outside, true);
    };
    document.addEventListener('pointerdown', outside, true);
  }
}
export function closeTableToolMenu() {
  const dd = document.getElementById('tableToolDD');
  dd.classList.remove('open');
  if (window.matchMedia('(hover: hover)').matches) dd.classList.add('suppress');   // hide until the mouse leaves
}

// ── Per-table menu (click a table's label) ──
export let _floatMenu = null;
export function closeFloatMenu() {
  if (_floatMenu) { _floatMenu.remove(); _floatMenu = null; }
  document.removeEventListener('pointerdown', _floatMenuOutside, true);
  document.removeEventListener('keydown', _floatMenuKey, true);
}
export function _floatMenuOutside(e) { if (_floatMenu && !_floatMenu.contains(e.target)) closeFloatMenu(); }
export function _floatMenuKey(e) { if (e.key === 'Escape') closeFloatMenu(); }

export function openTableGroupsMenu(item, anchor) {
  closeFloatMenu();
  const n = (item.seatPositions || []).length;
  const m = tmDiv('float-menu tm-inner');
  m.appendChild(tmDiv('tm-label', `Groups at this table (${n} seat${n !== 1 ? 's' : ''})`));
  groupOptions(n).forEach(o => m.appendChild(tmItem(o.label, o.sub, sameGroups(item.groups || 1, o.v, n), () => {
    setTableGroups(item, o.v);
    closeFloatMenu();
  })));
  const next = nextGroupShift(item);
  m.appendChild(tmDiv('tm-sep'));
  if (next !== null) {
    m.appendChild(tmItem("Switch who's grouped together", '', false, () => {
      item.groupShift = next;
      afterTableGroupsChange();
      closeFloatMenu();
    }));
  }
  const tables = state.layoutItems.filter(i => i.type === 'table');
  if (tables.length > 1) {
    m.appendChild(tmItem(`Use “${groupsText(item.groups || 1, n)}” for all tables`, '', false, () => {
      tables.forEach(t => { t.groups = item.groups || 1; t.groupShift = 0; });
      state.tableDefaults = normTableDefaults({ seats: state.tableDefaults.seats, groups: item.groups || 1 });
      afterTableGroupsChange();
      updateTableToolBadge();
      closeFloatMenu();
      showToast(`All ${tables.length} tables: ${groupsText(item.groups || 1)}`);
    }));
  }
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  _floatMenu = m;
  document.addEventListener('pointerdown', _floatMenuOutside, true);
  document.addEventListener('keydown', _floatMenuKey, true);
}

export function setTableGroups(item, groups) {
  item.groups = groups;
  item.groupShift = 0;
  afterTableGroupsChange();
}
export function afterTableGroupsChange() {
  renderLayoutCanvas();
  markDirty();
}
