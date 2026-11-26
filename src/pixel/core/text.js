// ═══════════════════════════════════════════════
//  Text → pixels with no anti-aliasing. Two pixel fonts drawn for ClassMap Pixel
//  ("Wren 5×7", proportional, and "Wren 3×5", tiny capitals), plus the device's own fonts
//  (drawn by the browser, then every pixel is either fully on or off).
//  Glyph rows are base-32 digits; the highest bit is the leftmost pixel.
// ═══════════════════════════════════════════════

const WREN5 = {
  " ": '0000000',
  "!": '4444404',
  "\"": 'aa00000',
  "#": 'avaava0',
  "$": '4fke5u4',
  "%": 'op248j3',
  "&": 'cik8lid',
  "'": '4400000',
  "(": '2488842',
  ")": '8422248',
  "*": '04lel40',
  "+": '044v440',
  ",": '0000c48',
  "-": '000v000',
  ".": '00000cc',
  "/": '122488g',
  "0": 'ehjlphe',
  "1": '4c4444e',
  "2": 'eh1248v',
  "3": 'u11e11u',
  "4": '26aiv22',
  "5": 'vgu11he',
  "6": '68guhhe',
  "7": 'v124888',
  "8": 'ehhehhe',
  "9": 'ehhf12c',
  ":": '0cc0cc0',
  ";": '0cc0c48',
  "<": '248g842',
  "=": '00v0v00',
  ">": '8421248',
  "?": 'eh12404',
  "@": 'ehnlngf',
  "A": 'ehhvhhh',
  "B": 'uhhuhhu',
  "C": 'ehggghe',
  "D": 'sihhhis',
  "E": 'vgguggv',
  "F": 'vgguggg',
  "G": 'ehgnhhf',
  "H": 'hhhvhhh',
  "I": 'e44444e',
  "J": '72222ic',
  "K": 'hikokih',
  "L": 'ggggggv',
  "M": 'hrllhhh',
  "N": 'hhpljhh',
  "O": 'ehhhhhe',
  "P": 'uhhuggg',
  "Q": 'ehhhlid',
  "R": 'uhhukih',
  "S": 'fgge11u',
  "T": 'v444444',
  "U": 'hhhhhhe',
  "V": 'hhhhha4',
  "W": 'hhhllla',
  "X": 'hha4ahh',
  "Y": 'hha4444',
  "Z": 'v1248gv',
  "[": 'e88888e',
  "\\": 'g884221',
  "]": 'e22222e',
  "^": '4ah0000',
  "_": '000000v',
  "`": '8400000',
  "a": '00e1fhf',
  "b": 'ggmphhu',
  "c": '00egghe',
  "d": '11djhhf',
  "e": '00ehvge',
  "f": '698s888',
  "g": '0fhhf1e',
  "h": 'ggmphhh',
  "i": '40c444e',
  "j": '20622ic',
  "k": 'ggikoki',
  "l": 'c44444e',
  "m": '00qllhh',
  "n": '00mphhh',
  "o": '00ehhhe',
  "p": '00uhugg',
  "q": '00djf11',
  "r": '00mpggg',
  "s": '00ege1u',
  "t": '88s8896',
  "u": '00hhhjd',
  "v": '00hhha4',
  "w": '00hhlla',
  "x": '00ha4ah',
  "y": '00hhf1e',
  "z": '00v248v',
  "{": '2448442',
  "|": '4444444',
  "}": '8442448',
  "~": '008l200',
};
const WREN3 = {
  " ": '00000',
  "!": '22202',
  "\"": '55000',
  "#": '57575',
  "$": '36236',
  "%": '41241',
  "&": '25253',
  "'": '22000',
  "(": '12221',
  ")": '42224',
  "*": '05250',
  "+": '02720',
  ",": '00024',
  "-": '00700',
  ".": '00002',
  "/": '11244',
  "0": '75557',
  "1": '26227',
  "2": '61247',
  "3": '61216',
  "4": '55711',
  "5": '74616',
  "6": '34757',
  "7": '71222',
  "8": '75757',
  "9": '75716',
  ":": '02020',
  ";": '02024',
  "<": '12421',
  "=": '07070',
  ">": '42124',
  "?": '61202',
  "@": '75543',
  "A": '25755',
  "B": '65656',
  "C": '34443',
  "D": '65556',
  "E": '74647',
  "F": '74644',
  "G": '34553',
  "H": '55755',
  "I": '72227',
  "J": '11152',
  "K": '55655',
  "L": '44447',
  "M": '57755',
  "N": '65555',
  "O": '25552',
  "P": '65644',
  "Q": '25563',
  "R": '65655',
  "S": '34216',
  "T": '72222',
  "U": '55557',
  "V": '55552',
  "W": '55775',
  "X": '55255',
  "Y": '55222',
  "Z": '71247',
  "[": '64446',
  "\\": '44211',
  "]": '31113',
  "^": '25000',
  "_": '00007',
  "`": '42000',
  "{": '32623',
  "|": '22222',
  "}": '62326',
  "~": '03600',
};

export const PIXEL_FONTS = {
  wren5: { name: 'Wren 5×7', glyphs: WREN5, w: 5, h: 7, line: 9, proportional: true },
  wren3: { name: 'Wren 3×5 (capitals)', glyphs: WREN3, w: 3, h: 5, line: 7, upper: true },
};
export const SYSTEM_FONTS = [['sans-serif', 'Sans'], ['serif', 'Serif'], ['monospace', 'Monospace'], ['cursive', 'Handwriting']];

const rowsOf = (font, ch) => {
  const g = font.glyphs[font.upper ? ch.toUpperCase() : ch] ?? font.glyphs['?'];
  return [...g].map(d => parseInt(d, 32));
};
// Columns a glyph uses (proportional fonts trim empty columns; a space keeps 3)
function span(font, ch) {
  if (!font.proportional) return [0, font.w];
  if (ch === ' ') return [0, 3];
  const rows = rowsOf(font, ch);
  let lo = font.w, hi = -1;
  for (const r of rows) for (let x = 0; x < font.w; x++) if (r & (1 << (font.w - 1 - x))) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  return hi < 0 ? [0, 3] : [lo, hi + 1];
}

// Lines of text in a pixel font → { w, h, pixels } in one colour. scale enlarges each pixel.
export function pixelText(text, fontId = 'wren5', color = [0, 0, 0, 255], { scale = 1, spacing = 1, align = 'left' } = {}) {
  const font = PIXEL_FONTS[fontId] || PIXEL_FONTS.wren5;
  const lines = String(text).split(/\r?\n/);
  const widths = lines.map(l => [...l].reduce((a, ch, i) => { const [s, e] = span(font, ch); return a + (e - s) + (i ? spacing : 0); }, 0));
  const W = Math.max(1, ...widths) * scale, H = Math.max(1, lines.length * font.line - (font.line - font.h)) * scale;
  const px = new Uint8ClampedArray(W * H * 4);
  lines.forEach((line, li) => {
    let cx = align === 'center' ? Math.floor((W / scale - widths[li]) / 2) : align === 'right' ? W / scale - widths[li] : 0;
    for (const ch of line) {
      const [s, e] = span(font, ch), rows = rowsOf(font, ch);
      rows.forEach((r, y) => {
        for (let x = s; x < e; x++) {
          if (!(r & (1 << (font.w - 1 - x)))) continue;
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const X = (cx + x - s) * scale + sx, Y = (li * font.line + y) * scale + sy;
            px.set(color, (Y * W + X) * 4);
          }
        }
      });
      cx += e - s + spacing;
    }
  });
  return { w: W, h: H, pixels: px };
}

// The device's fonts, drawn by the browser at `size` px and made crisp (alpha ≥ 50 % = on)
export function systemText(text, family = 'sans-serif', size = 12, color = [0, 0, 0, 255], { bold = false, align = 'left' } = {}) {
  const lines = String(text).split(/\r?\n/);
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = `${bold ? 'bold ' : ''}${size}px ${family}`;
  g.font = font;
  const lh = Math.ceil(size * 1.25);
  const W = Math.max(1, Math.ceil(Math.max(...lines.map(l => g.measureText(l).width))) + 2), H = Math.max(1, lh * lines.length + 2);
  c.width = W; c.height = H;
  g.font = font; g.textBaseline = 'top'; g.fillStyle = '#000'; g.textAlign = align;
  const x = align === 'center' ? W / 2 : align === 'right' ? W - 1 : 1;
  lines.forEach((l, i) => g.fillText(l, x, 1 + i * lh));
  const src = g.getImageData(0, 0, W, H).data, px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) if (src[i * 4 + 3] >= 128) px.set(color, i * 4);
  return trim({ w: W, h: H, pixels: px });
}

// Cut away empty rows and columns around a block
export function trim(b) {
  let x0 = b.w, y0 = b.h, x1 = -1, y1 = -1;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.pixels[(y * b.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return { w: 1, h: 1, pixels: new Uint8ClampedArray(4) };
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(b.pixels.subarray(((y0 + y) * b.w + x0) * 4, ((y0 + y) * b.w + x1 + 1) * 4), y * w * 4);
  return { w, h, pixels: out };
}
