// ═══════════════════════════════════════════════
//  The layer tree. sprite.layers is ordered bottom → top; a group holds `children`
//  in the same order. Regular and reference layers have cels; groups don't.
// ═══════════════════════════════════════════════

export const isGroup = n => n.kind === 'group';

// Visit every node, bottom → top, depth first. fn(node, depth, parentGroup)
export function walk(nodes, fn, depth = 0, parent = null) {
  for (const n of nodes) {
    fn(n, depth, parent);
    if (isGroup(n)) walk(n.children, fn, depth + 1, n);
  }
}

export function find(sprite, id) {
  let hit = null;
  const go = (list, parent) => {
    for (let i = 0; i < list.length && !hit; i++) {
      if (list[i].id === id) hit = { node: list[i], list, index: i, parent };
      else if (isGroup(list[i])) go(list[i].children, list[i]);
    }
  };
  go(sprite.layers, null);
  return hit;
}

// Every drawable (non-group) layer, bottom → top
export function leafLayers(sprite) {
  const out = [];
  walk(sprite.layers, n => { if (!isGroup(n)) out.push(n); });
  return out;
}

// Rows for the layers panel: top of the stack first
export function displayRows(sprite) {
  const rows = [];
  const go = (list, depth, parent) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      rows.push({ node: n, depth, parent });
      if (isGroup(n) && !n.collapsed) go(n.children, depth + 1, n);
    }
  };
  go(sprite.layers, 0, null);
  return rows;
}

// Hidden or locked if the layer or any group around it is
export function chain(sprite, id) {
  const out = [];
  let f = find(sprite, id);
  while (f) { out.push(f.node); f = f.parent ? find(sprite, f.parent.id) : null; }
  return out;
}
export const shown = (sprite, id) => chain(sprite, id).every(n => n.visible);
export const locked = (sprite, id) => chain(sprite, id).some(n => n.locked);

export function remove(sprite, id) {
  const f = find(sprite, id);
  if (!f) return null;
  f.list.splice(f.index, 1);
  return f.node;
}

// Put `node` above / below the node `targetId`, or inside group `targetId` (at its top)
export function insert(sprite, node, targetId, where = 'above') {
  if (!targetId) { sprite.layers.push(node); return; }
  const f = find(sprite, targetId);
  if (!f) { sprite.layers.push(node); return; }
  if (where === 'into' && isGroup(f.node)) { f.node.children.push(node); return; }
  f.list.splice(where === 'below' ? f.index : f.index + 1, 0, node);
}

// Is `id` the group `groupId` or somewhere inside it? (a group can't move into itself)
export function within(sprite, id, groupId) {
  const g = find(sprite, groupId)?.node;
  if (!g) return false;
  if (g.id === id) return true;
  let hit = false;
  if (isGroup(g)) walk(g.children, n => { if (n.id === id) hit = true; });
  return hit;
}

// A deep copy of the tree's shape (no pixels: cels live in sprite.cels)
export const cloneTree = nodes => nodes.map(n => (isGroup(n) ? { ...n, children: cloneTree(n.children) } : { ...n }));
