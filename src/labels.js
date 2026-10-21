// Place-name labels: districts, water, rivers (along the line), parks and
// landmarks. Greedy placement by priority with collision boxes, keeping clear
// of the course line and the text block.
import { mix } from "./themes.js";
import { fitText, shapeGlyphs, needsCjk } from "./text.js";

const NS = "http://www.w3.org/2000/svg";

// [kind, rank] in placement order, with size (fraction of the short side),
// tracking (em), uppercase and font role.
const STYLES = [
  ["district", 1, 0.02, 0.28, true, "bodyStrong"],
  ["water", 1, 0.0115, 0.32, true, "body"],
  ["river", 1, 0.0085, 0.18, false, "body"],
  ["district", 2, 0.0125, 0.2, true, "bodyStrong"],
  ["park", 1, 0.0085, 0.08, false, "body"],
  ["landmark", 1, 0.0068, 0.04, false, "body"],
  ["water", 2, 0.0092, 0.24, true, "body"],
  ["district", 3, 0.0092, 0.16, true, "body"],
  ["park", 2, 0.0072, 0.06, false, "body"],
  ["river", 2, 0.0072, 0.14, false, "body"],
  ["landmark", 2, 0.006, 0.04, false, "body"],
  ["district", 4, 0.0072, 0.14, true, "body"],
  ["park", 3, 0.0062, 0.05, false, "body"],
  ["water", 3, 0.0068, 0.18, false, "body"],
];

const GROUP = { district: "districts", water: "water", river: "water", park: "parks", landmark: "landmarks" };

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function drawLabels(parent, state, data, map, L, c, fonts, inside) {
  if (!data.labels) return;
  const opts = state.labels;
  const k = L.min * opts.scale;
  const placed = [];
  const course = map.courseIndex;
  const routeClear = map.routeWidth * 1.6;
  const colors = {
    district: c.text,
    water: mix(c.water, c.text, 0.6),
    river: mix(c.water, c.text, 0.6),
    park: mix(c.green, c.text, 0.65),
    landmark: c.text,
  };
  const g = el("g", { id: "labels" }, parent);
  const halo = el("g", { fill: "none", stroke: c.bg, "stroke-linejoin": "round", "stroke-opacity": 0.85 }, g);
  const ink = el("g", {}, g);

  const free = (box) => {
    for (const b of placed) {
      if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return false;
    }
    if (course) {
      const hit = course.find((box[0] + box[2]) / 2, (box[1] + box[3]) / 2,
        Math.hypot(box[2] - box[0], box[3] - box[1]) / 2 + routeClear);
      if (hit) {
        // Precise check against the box expanded by the clearance.
        let blocked = false;
        course.visit((node, x0, y0, x1, y1) => {
          if (blocked) return true;
          if (!node.length) {
            do {
              const [x, y] = node.data;
              if (x > box[0] - routeClear && x < box[2] + routeClear && y > box[1] - routeClear && y < box[3] + routeClear) blocked = true;
            } while (!blocked && (node = node.next));
          }
          return x0 > box[2] + routeClear || x1 < box[0] - routeClear || y0 > box[3] + routeClear || y1 < box[1] - routeClear;
        });
        if (blocked) return false;
      }
    }
    return true;
  };
  const boxInside = (b) => inside(b[0], b[1]) && inside(b[2], b[1]) && inside(b[0], b[3]) && inside(b[2], b[3]);

  const water = data.city.features.find((f) => f.properties.layer === "water");
  const onWater = (b) => [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]], [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]]
    .every((q) => {
      const ll = map.proj.invert(q);
      return ll && d3.geoContains(water, ll);
    });
  const fontFor = (role, str) => (needsCjk(str) ? fonts.cjk : fonts[role]);

  for (const [kind, rank, size, tracking, upper, role] of STYLES) {
    if (!opts[GROUP[kind]]) continue;
    const items = data.labels.filter((lb) => lb.kind === kind && lb.rank === rank)
      .sort((a, b) => (b.pop || b.area || b.length || 0) - (a.pop || a.area || a.length || 0));
    for (const lb of items) {
      let str = opts.lang === "local" ? lb.name : lb.name_en;
      if (upper) str = str.toUpperCase();
      const font = fontFor(role, str);
      if (!font) continue;
      const sz = size * k * (lb.size || 1);
      const pad = sz * 0.6;
      if (kind === "river") {
        placeRiver(lb, str, font, sz, tracking, colors.river);
        continue;
      }
      const p0 = map.proj([lb.lon, lb.lat]);
      if (!p0) continue;
      const t = fitText(font, str, sz, tracking, 1e9);
      const h = sz * 0.72;
      const dot = kind === "landmark";
      const boxAt = (p) => {
        const x = dot ? p[0] + sz * 0.6 : p[0] - t.width / 2;
        const y = p[1] + h / 2;
        return { x, y, box: [Math.min(x, p[0]) - pad, y - h - pad, x + t.width + pad, y + pad * 0.6] };
      };
      // Big water names may sit off-frame or under other labels: search
      // nearby positions that stay over water.
      const candidates = [p0];
      if (kind === "water" && rank === 1 && water) {
        for (let ring = 1; ring <= 14; ring++) {
          for (let a = 0; a < 12; a++) {
            const ang = (a / 12) * 2 * Math.PI;
            candidates.push([p0[0] + Math.cos(ang) * ring * sz * 3, p0[1] + Math.sin(ang) * ring * sz * 3]);
          }
        }
      }
      let spot = null;
      for (const p of candidates) {
        const cand = boxAt(p);
        if (!boxInside(cand.box) || !free(cand.box)) continue;
        if (p !== p0 && !onWater(cand.box)) continue;
        spot = { p, ...cand };
        break;
      }
      if (!spot) continue;
      const { p, x, y, box } = spot;
      placed.push(box);
      el("path", { d: t.d, transform: `translate(${x},${y})`, "stroke-width": sz * 0.3 }, halo);
      el("path", { d: t.d, transform: `translate(${x},${y})`, fill: colors[kind], "fill-opacity": kind === "district" && rank > 1 ? 0.78 : 1 }, ink);
      if (dot) {
        el("circle", { cx: p[0], cy: p[1], r: sz * 0.22, fill: colors.landmark, stroke: c.bg, "stroke-width": sz * 0.12 }, ink);
      }
    }
  }

  function placeRiver(lb, str, font, sz, tracking, color) {
    const pts = lb.line.map((q) => map.proj(q)).filter(Boolean);
    if (pts.length < 2) return;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const shaped = shapeGlyphs(font, str, sz, tracking);
    const len = shaped.width;
    if (len * 1.15 > total) return;
    const at = (s) => {
      let i = d3.bisectRight(cum, s);
      i = Math.min(Math.max(i, 1), pts.length - 1);
      const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      const a = pts[i - 1];
      const b = pts[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
    };
    // Try windows from the middle outwards; keep the first straight, free one.
    const starts = d3.range(0, total - len, Math.max(len * 0.25, 1))
      .sort((a, b) => Math.abs(a + len / 2 - total / 2) - Math.abs(b + len / 2 - total / 2));
    for (const s0 of starts) {
      const a = at(s0);
      const b = at(s0 + len);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < len * 0.88) continue;
      const reverse = b[0] < a[0];
      const items = shaped.glyphs.map((gl) => {
        const s = reverse ? s0 + len - (gl.x + gl.adv / 2) : s0 + gl.x + gl.adv / 2;
        const [x, y, ang] = at(s);
        return { gl, x, y, ang: reverse ? ang + Math.PI : ang };
      });
      const boxes = items.map(({ x, y }) => [x - sz * 0.45, y - sz * 0.45, x + sz * 0.45, y + sz * 0.45]);
      if (!boxes.every(boxInside) || !boxes.every(free)) continue;
      placed.push(...boxes);
      const off = sz * 0.36; // center the x-height on the river line
      for (const { gl, x, y, ang } of items) {
        const tf = `translate(${x},${y}) rotate(${(ang * 180) / Math.PI}) translate(${-gl.adv / 2},${off})`;
        el("path", { d: gl.d, transform: tf, "stroke-width": sz * 0.3 }, halo);
        el("path", { d: gl.d, transform: tf, fill: color }, ink);
      }
      return;
    }
  }
}
