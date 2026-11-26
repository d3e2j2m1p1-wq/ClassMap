// ═══════════════════════════════════════════════
//  Symmetry: lines through one centre that mirror (or rotate) every pixel a tool lays down.
//  mirror + 1 line = left/right mirror; mirror + 2 = four quarters; rotate + 6 = a snowflake.
// ═══════════════════════════════════════════════
import { state } from './state.js';

export const symCenter = (sym, W, H) => [Math.round(sym.cx * W * 2) / 2, Math.round(sym.cy * H * 2) / 2];

// The matrices (2×2) of every copy, the original first
export function symMatrices(sym) {
  const n = Math.max(1, Math.min(12, sym.count | 0));
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    out.push([Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t)]);
  }
  if (sym.mode === 'mirror') {
    const a = (sym.angle * Math.PI) / 180;
    for (let k = 0; k < n; k++) {
      const p = 2 * (a + (Math.PI * k) / n);
      out.push([Math.cos(p), Math.sin(p), Math.sin(p), -Math.cos(p)]);
    }
  }
  return out;
}

// A function giving every pixel a plotted pixel stands for, or null when symmetry is off
export function symmetryFor(W, H) {
  const sym = state.settings.symmetry;
  if (!sym.on || state.settings.features?.symmetry === false) return null;
  const [cx, cy] = symCenter(sym, W, H);
  const ms = symMatrices(sym);
  return (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const seen = new Set(), out = [];
    for (const m of ms) {
      const px = Math.floor(cx + m[0] * dx + m[2] * dy + 1e-9), py = Math.floor(cy + m[1] * dx + m[3] * dy + 1e-9);
      const k = px * 65536 + py;
      if (!seen.has(k)) { seen.add(k); out.push([px, py]); }
    }
    return out;
  };
}

// The line directions to draw on screen (unit vectors through the centre)
export function symLines(sym) {
  const n = Math.max(1, Math.min(12, sym.count | 0));
  const a = (sym.angle * Math.PI) / 180, out = [];
  if (sym.mode === 'mirror') for (let k = 0; k < n; k++) out.push(a + (Math.PI * k) / n);
  else for (let k = 0; k < n; k++) out.push(a + (2 * Math.PI * k) / n);
  return { angles: out, rays: sym.mode !== 'mirror' };
}
