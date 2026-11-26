// ═══════════════════════════════════════════════
//  Undo / redo. A drawing step keeps only the rectangle it changed (before and after),
//  not a copy of the whole picture, so 100 steps on a big canvas stay small.
// ═══════════════════════════════════════════════

export function readRect(pixels, W, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(pixels.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
  return out;
}

export function writeRect(pixels, W, x, y, w, h, data) {
  for (let r = 0; r < h; r++) pixels.set(data.subarray(r * w * 4, (r + 1) * w * 4), ((y + r) * W + x) * 4);
}

// A pixel patch: what a rectangle of one cel looked like before and after a step
export function makePatch(target, before, after, W, rect) {
  const { x, y, w, h } = rect;
  return { kind: 'pixels', target, rect: { x, y, w, h }, before: readRect(before, W, x, y, w, h), after: readRect(after, W, x, y, w, h) };
}

export class History {
  constructor(depth = 100) { this.depth = depth; this.done = []; this.undone = []; }
  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
  push(step) {
    this.done.push(step);
    if (this.done.length > this.depth) this.done.shift();
    this.undone.length = 0;
  }
  // `apply(step, 'before' | 'after')` puts the step's pixels (or other state) back
  undo(apply) {
    const s = this.done.pop();
    if (!s) return null;
    apply(s, 'before');
    this.undone.push(s);
    return s;
  }
  redo(apply) {
    const s = this.undone.pop();
    if (!s) return null;
    apply(s, 'after');
    this.done.push(s);
    return s;
  }
  clear() { this.done.length = 0; this.undone.length = 0; }
}
