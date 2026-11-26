// Runs RotSprite (8× Scale2x, then rotate) off the main thread so the page stays responsive
import { rasterize } from './transform.js';

self.onmessage = e => {
  const { id, src, w, h, m, W, H } = e.data;
  const r = rasterize(src, w, h, m, W, H, { rotsprite: true });
  self.postMessage({ id, r }, r ? [r.pixels.buffer] : []);
};
