// ═══════════════════════════════════════════════
//  Sprite sheets: frames laid out on one image, plus JSON in the same shape Aseprite
//  exports ("hash" keyed by file name, or "array"), so game engines that read Aseprite
//  sheets read ours too.
// ═══════════════════════════════════════════════

// layout: 'rows' (one row), 'columns' (one column), 'packed' (as square as possible), 'custom' (cols)
export function sheetLayout(n, w, h, { layout = 'packed', cols = 4, border = 0, spacing = 0, padding = 0 } = {}) {
  const c = layout === 'rows' ? n : layout === 'columns' ? 1 : layout === 'custom' ? Math.max(1, Math.min(n, cols)) : Math.ceil(Math.sqrt(n));
  const r = Math.ceil(n / c);
  const cw = w + padding * 2, ch = h + padding * 2;
  const pos = Array.from({ length: n }, (_, i) => ({ x: border + (i % c) * (cw + spacing) + padding, y: border + Math.floor(i / c) * (ch + spacing) + padding }));
  return { cols: c, rows: r, width: border * 2 + c * cw + (c - 1) * spacing, height: border * 2 + r * ch + (r - 1) * spacing, pos };
}

// frames: [{ pixels (w*h*4, already scaled), delayMs, name }]
export function buildSheet(frames, w, h, opts = {}) {
  const L = sheetLayout(frames.length, w, h, opts);
  const out = new Uint8ClampedArray(L.width * L.height * 4);
  frames.forEach((f, i) => {
    const { x, y } = L.pos[i];
    for (let r = 0; r < h; r++) out.set(f.pixels.subarray(r * w * 4, (r + 1) * w * 4), ((y + r) * L.width + x) * 4);
  });
  return { width: L.width, height: L.height, pixels: out, pos: L.pos };
}

export function sheetJSON(frames, pos, w, h, sheetW, sheetH, { image = 'sheet.png', format = 'hash', tags = [], layers = [], scale = 1 } = {}) {
  const entries = frames.map((f, i) => ({
    filename: f.name,
    frame: { x: pos[i].x, y: pos[i].y, w, h },
    rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w, h },
    sourceSize: { w, h },
    duration: f.delayMs,
  }));
  const framesOut = format === 'array' ? entries : Object.fromEntries(entries.map(({ filename, ...e }) => [filename, e]));
  return {
    frames: framesOut,
    meta: {
      app: 'https://classmap.dev/pixel', version: '1.0', image, format: 'RGBA8888',
      size: { w: sheetW, h: sheetH }, scale: String(scale),
      frameTags: tags.map(t => ({ name: t.name, from: t.from, to: t.to, direction: t.direction, ...(t.repeat ? { repeat: String(t.repeat) } : {}), color: t.color })),
      layers,
    },
  };
}
