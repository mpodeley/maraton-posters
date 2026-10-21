// Text rendered as outlines with opentype.js, so SVG, PDF and PNG carry the
// exact glyphs without depending on installed or embedded fonts.
const cache = new Map();

export async function loadFont(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`fonts/${name}.ttf`)
      .then((r) => r.arrayBuffer())
      .then((buf) => opentype.parse(buf)));
  }
  return cache.get(name);
}

// Lay out a single line. tracking is in em. Returns path data and width in mm.
export function shapeText(font, str, size, tracking = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(str);
  let x = 0;
  const parts = [];
  glyphs.forEach((g, i) => {
    const p = g.getPath(x, 0, size);
    parts.push(p.toPathData(3));
    x += g.advanceWidth * scale;
    if (i < glyphs.length - 1) {
      x += font.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
    }
  });
  return { d: parts.join(""), width: x, ascent: font.ascender * scale };
}

// Shape and fit inside maxWidth by shrinking the size if needed.
export function fitText(font, str, size, tracking, maxWidth) {
  let t = shapeText(font, str, size, tracking);
  if (t.width > maxWidth && t.width > 0) {
    const s = size * (maxWidth / t.width);
    t = shapeText(font, str, s, tracking);
    t.size = s;
  } else {
    t.size = size;
  }
  return t;
}

// Per-glyph layout for labels that follow a path. Each glyph's outline is at
// the origin; x is its offset along the line and adv its advance.
export function shapeGlyphs(font, str, size, tracking = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(str);
  let x = 0;
  const out = glyphs.map((g, i) => {
    const adv = g.advanceWidth * scale;
    const item = { d: g.getPath(0, 0, size).toPathData(3), x, adv };
    x += adv;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
    return item;
  });
  return { glyphs: out, width: x };
}

const CJK = /[　-ヿ㐀-鿿豈-﫿＀-￯]/;
export function needsCjk(str) {
  return CJK.test(str);
}
