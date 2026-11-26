// ═══════════════════════════════════════════════
//  The artwork ("sprite"): size, palette, layers, frames and cels.
//  Phase 1 draws on one layer and one frame, but the shape is already the full one,
//  so layers and animation slot in later without changing saved files.
// ═══════════════════════════════════════════════
import { hexToRgba } from './color.js';

export const MAX_SIDE = 2048;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function createSprite({ name = 'Untitled', width = 32, height = 32, palette = [] } = {}) {
  width = Math.max(1, Math.min(MAX_SIDE, Math.round(width)));
  height = Math.max(1, Math.min(MAX_SIDE, Math.round(height)));
  const layer = { id: uid(), kind: 'regular', name: 'Layer 1', visible: true, locked: false, opacity: 255, blend: 'normal', autoLinkOnDuplicate: false };
  const frame = { id: uid(), durationMs: 100 };
  const now = Date.now();
  return {
    id: uid(), name, width, height, colorMode: 'rgba',
    palette: palette.map(c => (typeof c === 'string' ? hexToRgba(c) : [...c])).filter(Boolean),
    layers: [layer], frames: [frame], tags: [], tilesets: [], references: [],
    grid: { w: 16, h: 16, offsetX: 0, offsetY: 0 },
    cels: [{ layerId: layer.id, frameId: frame.id, x: 0, y: 0, w: width, h: height, pixels: new Uint8ClampedArray(width * height * 4) }],
    createdAt: now, updatedAt: now,
  };
}

export const celAt = (sprite, layerId, frameId) => sprite.cels.find(c => c.layerId === layerId && c.frameId === frameId) || null;

// The picture as it will be seen (all visible layers of one frame), as RGBA bytes
export function compositeFrame(sprite, frameId = sprite.frames[0].id) {
  const { width: W, height: H } = sprite;
  const out = new Uint8ClampedArray(W * H * 4);
  for (const layer of sprite.layers) {
    if (!layer.visible || layer.kind !== 'regular') continue;
    const cel = celAt(sprite, layer.id, frameId);
    if (!cel) continue;
    const lo = layer.opacity / 255;
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
      const tx = cel.x + x, ty = cel.y + y;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const s = (y * cel.w + x) * 4, d = (ty * W + tx) * 4;
      const sa = cel.pixels[s + 3] / 255 * lo;
      if (!sa) continue;
      const da = out[d + 3] / 255, oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) out[d + k] = (cel.pixels[s + k] * sa + out[d + k] * da * (1 - sa)) / oa;
      out[d + 3] = oa * 255;
    }
  }
  return out;
}

// Smallest rectangle holding every non-transparent pixel (null if the picture is empty)
export function contentBounds(pixels, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (pixels[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
