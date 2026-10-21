// Poster renderer: builds a self-contained SVG in millimeters.
import { THEMES, FONT_PAIRS } from "./themes.js";
import { fitText } from "./text.js";

const NS = "http://www.w3.org/2000/svg";

export const SIZES = {
  a4: { name: "A4 · 21 × 29.7 cm", w: 210, h: 297 },
  a3: { name: "A3 · 29.7 × 42 cm", w: 297, h: 420 },
  a2: { name: "A2 · 42 × 59.4 cm", w: 420, h: 594 },
  "30x40": { name: "30 × 40 cm", w: 300, h: 400 },
  "40x50": { name: "40 × 50 cm", w: 400, h: 500 },
  "50x70": { name: "50 × 70 cm", w: 500, h: 700 },
  "61x91": { name: "61 × 91 cm", w: 610, h: 914 },
  "70x100": { name: "70 × 100 cm", w: 700, h: 1000 },
};

export const SHAPES = {
  full: "Página completa",
  marco: "Recuadro",
  cuadrado: "Cuadrado",
  circulo: "Círculo",
  hexagono: "Hexágono",
  arco: "Arco",
};

export const BLEED = 3;
export const SAFE = 10;
const MIN_PRINT_MM = 0.1;

export function pageSize(state) {
  const s = SIZES[state.size];
  return state.orient === "landscape" ? { W: s.h, H: s.w } : { W: s.w, H: s.h };
}

export function colors(state) {
  return { ...THEMES[state.theme], ...state.colorOverrides };
}

// Geometry of the map window and the text block.
export function layout(state) {
  const { W, H } = pageSize(state);
  const b = state.bleed ? BLEED : 0;
  const min = Math.min(W, H);
  const showText = state.text.show;
  const m = 0.075 * min;
  // Landscape posters with a shaped map put the text in a column on the right.
  const side = showText && state.orient === "landscape" && state.shape !== "full";
  const th = showText && !side ? (state.orient === "landscape" ? 0.25 : state.shape === "full" ? 0.2 : 0.23) * H : 0;
  const A = side
    ? { x: m, y: m, w: W * 0.6 - m, h: H - 2 * m }
    : { x: m, y: m, w: W - 2 * m, h: H - m - (showText ? th : m) };
  let shape;
  let fit;
  if (state.shape === "full") {
    shape = { kind: "rect", x: -b, y: -b, w: W + 2 * b, h: H + 2 * b };
    const bottom = showText ? H - th - 0.07 * H : H - 0.06 * H;
    fit = { x: 0.08 * W, y: 0.06 * H, w: 0.84 * W, h: bottom - 0.06 * H };
  } else if (state.shape === "marco") {
    shape = { kind: "rect", ...A };
    fit = inset(A, 0.08);
  } else if (state.shape === "cuadrado" || state.shape === "circulo") {
    const s = Math.min(A.w, A.h);
    const box = { x: A.x + (A.w - s) / 2, y: A.y + (A.h - s) / 2, w: s, h: s };
    shape = state.shape === "circulo"
      ? { kind: "circle", cx: box.x + s / 2, cy: box.y + s / 2, r: s / 2, ...box }
      : { kind: "rect", ...box };
    fit = inset(box, state.shape === "circulo" ? 0.17 : 0.08);
  } else if (state.shape === "hexagono") {
    const R = Math.min(A.w / Math.sqrt(3), A.h / 2);
    const cx = A.x + A.w / 2;
    const cy = A.y + A.h / 2;
    const pts = d3.range(6).map((i) => {
      const a = Math.PI / 3 * i - Math.PI / 2;
      return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
    });
    const box = { x: cx - R * Math.sqrt(3) / 2, y: cy - R, w: R * Math.sqrt(3), h: 2 * R };
    shape = { kind: "poly", pts, ...box };
    fit = inset({ x: cx - R * 0.75, y: cy - R * 0.75, w: R * 1.5, h: R * 1.5 }, 0.02);
  } else {
    const aw = Math.min(A.w, A.h * 0.78);
    const x = A.x + (A.w - aw) / 2;
    shape = { kind: "arch", x, y: A.y, w: aw, h: A.h };
    fit = inset({ x, y: A.y + aw * 0.22, w: aw, h: A.h - aw * 0.22 }, 0.08);
  }
  let text;
  if (side) {
    text = { x: W * 0.6, y: m, w: W * 0.4 - m, h: H - 2 * m };
  } else {
    const top = state.shape === "full" ? H - th : shape.y + shape.h + 0.02 * H;
    text = { x: 0, y: top, w: W, h: H - top - (state.shape === "full" ? 0.035 * H : m * 0.6) };
  }
  return { W, H, b, min, m, th, shape, fit, text, side };
}

function inset(r, f) {
  const dx = r.w * f;
  const dy = r.h * f;
  return { x: r.x + dx, y: r.y + dy, w: r.w - 2 * dx, h: r.h - 2 * dy };
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function shapePath(s) {
  if (s.kind === "rect") return `M${s.x},${s.y}h${s.w}v${s.h}h${-s.w}Z`;
  if (s.kind === "circle") {
    return `M${s.cx - s.r},${s.cy}a${s.r},${s.r} 0 1,0 ${2 * s.r},0a${s.r},${s.r} 0 1,0 ${-2 * s.r},0Z`;
  }
  if (s.kind === "poly") return `M${s.pts.map((p) => p.join(",")).join("L")}Z`;
  const r = s.w / 2;
  return `M${s.x},${s.y + r}A${r},${r} 0 0,1 ${s.x + s.w},${s.y + r}V${s.y + s.h}H${s.x}Z`;
}

// Projection and projected path strings are cached: text and color edits
// should not re-project a whole city.
let mapCache = { key: null, value: null };

export function projectMap(state, data, L) {
  const key = JSON.stringify([state.race, state.size, state.orient, state.shape, state.bleed,
    state.text.show, state.zoom, state.offset, state.rotation]);
  if (mapCache.key === key) return mapCache.value;

  const course = data.course.features.find((f) => f.properties.kind === "course");
  const proj = d3.geoMercator().angle(state.rotation)
    .fitExtent([[L.fit.x, L.fit.y], [L.fit.x + L.fit.w, L.fit.y + L.fit.h]], course);
  const cx = L.fit.x + L.fit.w / 2;
  const cy = L.fit.y + L.fit.h / 2;
  const [tx, ty] = proj.translate();
  proj.scale(proj.scale() * state.zoom)
    .translate([cx + (tx - cx) * state.zoom + state.offset[0] * L.min,
      cy + (ty - cy) * state.zoom + state.offset[1] * L.min]);
  const s = L.shape;
  proj.clipExtent([[s.x - 2, s.y - 2], [s.x + s.w + 2, s.y + s.h + 2]]);
  const path = d3.geoPath(proj).digits(2);

  const layers = {};
  for (const f of data.city.features) layers[f.properties.layer] = path(f) || "";
  const value = {
    layers,
    course: d3.geoPath(proj.clipExtent(null)).digits(2)(course),
    marks: data.course.features.filter((f) => f.geometry.type === "Point")
      .map((f) => ({ ...f.properties, xy: proj(f.geometry.coordinates) })),
    // Km per mm at the map center, for the scale readout.
    kmPerMm: d3.geoDistance(proj.invert([cx, cy]), proj.invert([cx + 10, cy])) * 6371 / 10,
  };
  mapCache = { key, value };
  return value;
}

export function strokeWidths(state, L) {
  const k = Math.sqrt(L.min / 500);
  const r = k * state.roadScale;
  return {
    road1: 0.8 * r, road2: 0.45 * r, road3: 0.2 * r, rail: 0.28 * r,
    route: 2.2 * k * state.route.width,
  };
}

export function warnings(state, L, c) {
  const w = strokeWidths(state, L);
  const out = [];
  const names = { road1: "Avenidas", road2: "Calles", road3: "Calles menores", rail: "Vías" };
  const visible = { road1: state.layers.roads_1, road2: state.layers.roads_2, road3: state.layers.roads_3, rail: state.layers.rail };
  for (const [k, on] of Object.entries(visible)) {
    if (on && w[k] < MIN_PRINT_MM) out.push(`${names[k]}: ${w[k].toFixed(2)} mm, por debajo de ${MIN_PRINT_MM} mm puede no imprimir.`);
  }
  return out;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];

export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

export function formatCoords([lon, lat]) {
  const f = (v) => Math.abs(v).toFixed(4) + "°";
  return `${f(lat)} ${lat >= 0 ? "N" : "S"} · ${f(lon)} ${lon >= 0 ? "E" : "O"}`;
}

export function courseCenter(data) {
  const course = data.course.features.find((f) => f.properties.kind === "course");
  const [[w, s], [e, n]] = d3.geoBounds(course);
  return [(w + e) / 2, (s + n) / 2];
}

// Build the poster SVG. fonts: { title, body, bodyStrong } opentype fonts.
export function renderPoster(state, data, fonts, { guides = true } = {}) {
  const L = layout(state);
  const c = colors(state);
  const sw = strokeWidths(state, L);
  const map = projectMap(state, data, L);
  const { W, H, b } = L;

  const svg = el("svg", {
    xmlns: NS, viewBox: `${-b} ${-b} ${W + 2 * b} ${H + 2 * b}`,
    width: `${W + 2 * b}mm`, height: `${H + 2 * b}mm`,
  });
  const defs = el("defs", {}, svg);
  const clip = el("clipPath", { id: "map-clip" }, defs);
  el("path", { d: shapePath(L.shape) }, clip);

  el("rect", { x: -b, y: -b, width: W + 2 * b, height: H + 2 * b, fill: c.bg }, svg);

  const mapG = el("g", { id: "map", "clip-path": "url(#map-clip)" }, svg);
  const content = el("g", { id: "map-content" }, mapG);
  el("path", { d: shapePath(L.shape), fill: c.bg }, content);
  if (state.layers.green && map.layers.green) el("path", { d: map.layers.green, fill: c.green }, content);
  if (state.layers.water && map.layers.water) el("path", { d: map.layers.water, fill: c.water }, content);
  const line = { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (state.layers.rail && map.layers.rail) {
    el("path", { d: map.layers.rail, ...line, stroke: c.rail, "stroke-width": sw.rail, "stroke-dasharray": `${sw.rail * 6} ${sw.rail * 3}`, "stroke-linecap": "butt" }, content);
  }
  for (const [layer, key] of [["roads_3", "road3"], ["roads_2", "road2"], ["roads_1", "road1"]]) {
    if (state.layers[layer] && map.layers[layer]) {
      el("path", { d: map.layers[layer], ...line, stroke: c[key], "stroke-width": sw[key] }, content);
    }
  }

  const rw = sw.route;
  if (state.route.halo) {
    el("path", { d: map.course, ...line, stroke: c.bg, "stroke-width": rw * 2.4, "stroke-opacity": 0.85 }, content);
  }
  el("path", { d: map.course, ...line, stroke: c.route, "stroke-width": rw }, content);

  if (state.route.marks) {
    for (const mk of map.marks.filter((p) => p.kind === "km" || p.kind === "half")) {
      const [x, y] = mk.xy;
      el("circle", { cx: x, cy: y, r: rw * 0.95, fill: c.bg, stroke: c.route, "stroke-width": rw * 0.45 }, content);
      if (state.route.labels) {
        const label = mk.kind === "half" ? "21.1" : String(mk.km);
        const t = fitText(fonts.bodyStrong, label, rw * 2.6, 0.02, 1e9);
        el("path", { d: t.d, fill: c.text, transform: `translate(${x + rw * 1.9},${y + t.ascent * 0.35})` }, content);
      }
    }
  }
  if (state.route.startFinish) {
    const start = map.marks.find((p) => p.kind === "start");
    const finish = map.marks.find((p) => p.kind === "finish");
    if (start) el("circle", { cx: start.xy[0], cy: start.xy[1], r: rw * 1.5, fill: c.bg, stroke: c.route, "stroke-width": rw * 0.6 }, content);
    if (finish) {
      el("circle", { cx: finish.xy[0], cy: finish.xy[1], r: rw * 1.6, fill: c.route }, content);
      el("circle", { cx: finish.xy[0], cy: finish.xy[1], r: rw * 0.6, fill: c.bg }, content);
    }
  }

  if (state.shape !== "full" && state.frame) {
    el("path", { d: shapePath(L.shape), fill: "none", stroke: c.text, "stroke-width": 0.35 * Math.sqrt(L.min / 500) * 1.5 }, svg);
  }

  if (state.text.show) {
    if (state.shape === "full") fadeBand(svg, L, c.bg);
    drawText(svg, state, data, fonts, L, c);
  }

  if (guides) drawGuides(svg, L);
  return svg;
}

// Vertical fade from transparent to the background, made of stacked rects
// so it survives svg2pdf (which does not handle stop-opacity reliably).
function fadeBand(svg, L, bg) {
  const top = L.H - L.th - 0.1 * L.H;
  const solid = L.H - L.th + 0.04 * L.H;
  const steps = 28;
  const g = el("g", { id: "fade" }, svg);
  const h = (solid - top) / steps;
  for (let i = 0; i < steps; i++) {
    el("rect", { x: -L.b, y: top + i * h, width: L.W + 2 * L.b, height: h + 0.05, fill: bg, "fill-opacity": ((i + 1) / steps) ** 1.6 }, g);
  }
  el("rect", { x: -L.b, y: solid, width: L.W + 2 * L.b, height: L.H + L.b - solid, fill: bg }, g);
}

function drawText(svg, state, data, fonts, L, c) {
  const race = data.race;
  const t = state.text;
  const pair = FONT_PAIRS[state.fonts];
  const cx = L.text.x + L.text.w / 2;
  const maxW = L.side ? L.text.w - L.m * 0.5 : L.text.w - 2 * Math.max(L.m, SAFE + 2);
  const base = L.side ? L.text.w * 1.3 : Math.min(L.W, L.H * 0.75);
  const lines = [];

  const title = (t.title || race.city).toUpperCase();
  lines.push({ font: fonts.title, str: title, size: base * 0.115 * t.titleScale, tracking: pair.titleTracking, gapAfter: 0.55 });
  lines.push({ rule: true, gapAfter: 0.5 });
  const sub = t.subtitle || race.name;
  if (sub) lines.push({ font: fonts.bodyStrong, str: sub.toUpperCase(), size: base * 0.019, tracking: 0.28, gapAfter: 0.9 });
  const details = [t.date ? formatDate(race.date) : null, t.distance ? `${race.distance_km ?? 42.195} km` : null, t.time || null].filter(Boolean).join("   ·   ");
  if (details) lines.push({ font: fonts.body, str: details, size: base * 0.017, tracking: 0.08, gapAfter: 0.9 });
  if (t.coords) lines.push({ font: fonts.body, str: formatCoords(courseCenter(data)), size: base * 0.0125, tracking: 0.18, opacity: 0.65, gapAfter: 0 });

  const shapeAll = (k) => lines.map((ln) => (ln.rule ? { ...ln, k } : { ...ln, k, t: fitText(ln.font, ln.str, ln.size * k, ln.tracking, maxW) }));
  const heightOf = (ln) => (ln.rule ? base * 0.004 * ln.k : ln.t.size * 0.78);
  const gapOf = (ln) => (ln.rule ? base * 0.03 * ln.gapAfter * ln.k : ln.t.size * ln.gapAfter);
  const measure = (sh) => sh.reduce((s, ln) => s + heightOf(ln) + gapOf(ln), 0);
  let shaped = shapeAll(1);
  let total = measure(shaped);
  // Shrink the whole block when it does not fit the space under the map.
  if (total > L.text.h * 0.94) {
    shaped = shapeAll((L.text.h * 0.94) / total);
    total = measure(shaped);
  }
  let y = L.text.y + (L.text.h - total) / 2;
  const g = el("g", { id: "text" }, svg);
  for (const ln of shaped) {
    if (ln.rule) {
      const rw = base * 0.07 * ln.k;
      el("line", { x1: cx - rw, x2: cx + rw, y1: y, y2: y, stroke: c.route, "stroke-width": base * 0.0022 * ln.k }, g);
      y += heightOf(ln) + gapOf(ln);
      continue;
    }
    const h = heightOf(ln);
    // Cap height ~ 0.72 em for these faces: baseline sits at y + cap height.
    el("path", { d: ln.t.d, fill: c.text, "fill-opacity": ln.opacity ?? 1, transform: `translate(${cx - ln.t.width / 2},${y + h})` }, g);
    y += h + gapOf(ln);
  }
}

function drawGuides(svg, L) {
  const g = el("g", { class: "guides", "pointer-events": "none" }, svg);
  const common = { fill: "none", "vector-effect": "non-scaling-stroke", "stroke-width": 1 };
  if (L.b > 0) el("rect", { x: 0, y: 0, width: L.W, height: L.H, stroke: "#e5007d", "stroke-dasharray": "6 4", ...common }, g);
  el("rect", { x: SAFE, y: SAFE, width: L.W - 2 * SAFE, height: L.H - 2 * SAFE, stroke: "#00a3e0", "stroke-dasharray": "3 4", ...common }, g);
}
