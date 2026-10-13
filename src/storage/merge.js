// ═══════════════════════════════════════════════
//  MERGE two copies of everything (this device + Google Drive)
//  Used when both changed since the last sync, e.g. edits on a laptop and on an iPad.
//   • Charts: each chart keeps whichever copy was saved last.
//   • Classes: all classes from both; for a class on both sides, the side changed most recently wins.
//   • Deletions win over older copies (a deleted chart doesn't come back from the other device),
//     but an item changed after it was deleted (Undo) stays.
// ═══════════════════════════════════════════════
const KEEP_DELETIONS_MS = 120 * 86400000;   // forget deletions after ~4 months

export function mergeData(local, remote) {
  const L = local || {}, R = remote || {};
  const lc = L.classes || [], rc = R.classes || [], lch = L.charts || [], rch = R.charts || [];
  const localNewer = (L.updatedAt || 0) >= (R.updatedAt || 0);

  const dead = new Map();
  [...(L.deleted || []), ...(R.deleted || [])].forEach(d => {
    if (d && d.id && (!dead.has(d.id) || dead.get(d.id) < d.at)) dead.set(d.id, d.at);
  });
  const alive = (id, changedAt) => !dead.has(id) || (changedAt || 0) > dead.get(id);

  // Classes: older side first, newer side overwrites; order = newer side's order, then extras
  const [older, newer] = localNewer ? [rc, lc] : [lc, rc];
  const byId = new Map();
  older.forEach(c => byId.set(c.id, c));
  newer.forEach(c => byId.set(c.id, c));
  const order = [...newer.map(c => c.id), ...older.map(c => c.id).filter(id => !newer.some(c => c.id === id))];
  const classes = order.map(id => byId.get(id)).filter(c => alive(c.id, c.restoredAt));
  const classIds = new Set(classes.map(c => c.id));

  const chartById = new Map();
  [...lch, ...rch].forEach(ch => {
    const cur = chartById.get(ch.id);
    if (!cur || (ch.savedAt || 0) > (cur.savedAt || 0)) chartById.set(ch.id, ch);
  });
  const charts = [...chartById.values()].filter(ch => alive(ch.id, ch.savedAt) && classIds.has(ch.classId));

  const cutoff = Date.now() - KEEP_DELETIONS_MS;
  const deleted = [...dead].filter(([, at]) => at > cutoff).map(([id, at]) => ({ id, at }));

  return {
    ...(localNewer ? R : L), ...(localNewer ? L : R),
    classes, charts, deleted,
    updatedAt: Math.max(L.updatedAt || 0, R.updatedAt || 0),
  };
}
