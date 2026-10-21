import { THEMES, FONT_PAIRS, COLOR_KEYS, contrast } from "./themes.js";
import { SIZES, SHAPES, layout, renderPoster, warnings, colors, projectMap } from "./render.js";
import { loadFont } from "./text.js";
import { saveSvg, savePdf, savePng } from "./export.js";

const DEFAULTS = {
  race: "nyc-2026",
  size: "50x70",
  orient: "portrait",
  shape: "full",
  theme: "papel",
  colorOverrides: {},
  fonts: "editorial",
  layers: { water: true, green: true, rail: true, roads_1: true, roads_2: true, roads_3: true },
  roadScale: 1,
  zoom: 1,
  offset: [0, 0],
  rotation: 0,
  route: { width: 1, halo: true, marks: true, labels: true, startFinish: true },
  text: { show: true, title: "", subtitle: "", time: "", titleScale: 1, date: true, distance: true, coords: true },
  frame: false,
  bleed: true,
  cropMarks: false,
  guides: true,
};

const STORE_KEY = "maraton-posters:v1";
let races = [];
let state;
const dataCache = new Map();
let current = null; // { data, fonts }

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function merge(base, extra) {
  const out = clone(base);
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && !Array.isArray(out[k])
      ? { ...out[k], ...v } : v;
  }
  return out;
}

function loadState() {
  let saved = {};
  try {
    if (location.hash.length > 1) saved = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
    else saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    saved = {};
  }
  return merge(DEFAULTS, saved);
}

function persist() {
  const json = JSON.stringify(state);
  try {
    localStorage.setItem(STORE_KEY, json);
  } catch { /* storage unavailable */ }
  history.replaceState(null, "", "#" + btoa(unescape(encodeURIComponent(json))));
}

async function loadRace(id) {
  if (!dataCache.has(id)) {
    const race = races.find((r) => r.id === id);
    dataCache.set(id, Promise.all([
      fetch(`data/cities/${id}.topo.json`).then((r) => r.json()),
      fetch(`data/courses/${id}.geojson`).then((r) => r.json()),
    ]).then(([topo, course]) => ({
      race,
      city: topojson.feature(topo, topo.objects.city),
      course,
    })));
  }
  return dataCache.get(id);
}

async function loadFonts() {
  const pair = FONT_PAIRS[state.fonts];
  const [title, body, bodyStrong] = await Promise.all([loadFont(pair.title), loadFont(pair.body), loadFont(pair.bodyStrong)]);
  return { title, body, bodyStrong };
}

// ---------- rendering ----------

const stage = document.getElementById("stage");
const status = document.getElementById("status");
let renderToken = 0;

async function render() {
  const token = ++renderToken;
  status.textContent = "Dibujando…";
  const [data, fonts] = await Promise.all([loadRace(state.race), loadFonts()]);
  if (token !== renderToken) return;
  current = { data, fonts };
  const svg = renderPoster(state, data, fonts, { guides: state.guides });
  svg.id = "poster";
  stage.replaceChildren(svg);
  attachPan(svg);
  updateInfo(data);
  persist();
}

function scheduleRender() {
  clearTimeout(scheduleRender.t);
  scheduleRender.t = setTimeout(render, 30);
}

function updateInfo(data) {
  const L = layout(state);
  const c = colors(state);
  const warn = warnings(state, L, c);
  const ratio = contrast(c.text, c.bg);
  if (ratio < 3) warn.push(`Contraste texto/fondo ${ratio.toFixed(1)}:1, bajo para impresión (mínimo recomendado 3:1).`);
  const map = projectMap(state, data, L);
  const b = state.bleed ? 3 : 0;
  const page = `${L.W + 2 * b} × ${L.H + 2 * b} mm${b ? " con sangrado" : ""}`;
  const scale = `1 cm ≈ ${(map.kmPerMm * 10).toFixed(2)} km`;
  status.innerHTML = `<span>${page}</span><span>${scale}</span>`;
  const box = document.getElementById("warnings");
  box.replaceChildren(...warn.map((w) => Object.assign(document.createElement("li"), { textContent: w })));
  box.hidden = warn.length === 0;
  const src = document.getElementById("source");
  src.textContent = `Recorrido: ${data.race.course.source}. Mapa: © colaboradores de OpenStreetMap (ODbL).`;
}

// Drag to pan, wheel to zoom. While dragging the map group is translated in
// place and re-projected on release.
function attachPan(svg) {
  const content = svg.querySelector("#map-content");
  let start = null;
  const mmPerPx = () => svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, k: mmPerPx() };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging");
  });
  svg.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = (e.clientX - start.x) * start.k;
    const dy = (e.clientY - start.y) * start.k;
    content.setAttribute("transform", `translate(${dx},${dy})`);
  });
  const end = (e) => {
    if (!start) return;
    const L = layout(state);
    const dx = (e.clientX - start.x) * start.k;
    const dy = (e.clientY - start.y) * start.k;
    start = null;
    svg.classList.remove("dragging");
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    state.offset = [state.offset[0] + dx / L.min, state.offset[1] + dy / L.min];
    scheduleRender();
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    state.zoom = Math.min(8, Math.max(0.3, state.zoom * f));
    state.offset = state.offset.map((v) => v * f);
    syncControls();
    scheduleRender();
  }, { passive: false });
}

// ---------- controls ----------

const panel = document.getElementById("panel");

function get(path) {
  return path.split(".").reduce((o, k) => o[k], state);
}

function set(path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], state)[last] = value;
}

function syncControls() {
  panel.querySelectorAll("[data-bind]").forEach((input) => {
    const v = get(input.dataset.bind);
    if (input.type === "checkbox") input.checked = !!v;
    else if (input.type === "radio") input.checked = input.value === v;
    else input.value = v;
    const out = panel.querySelector(`output[for="${input.id}"]`);
    if (out) out.textContent = formatOut(input);
  });
  const c = colors(state);
  panel.querySelectorAll("[data-color]").forEach((input) => {
    input.value = c[input.dataset.color];
    input.closest("label").classList.toggle("overridden", input.dataset.color in state.colorOverrides);
  });
  document.querySelectorAll(".theme-chip").forEach((chip) => chip.setAttribute("aria-pressed", chip.dataset.theme === state.theme));
  panel.querySelector("#frame-row").hidden = state.shape === "full";
}

function formatOut(input) {
  const v = Number(input.value);
  if (input.dataset.bind === "rotation") return `${v}°`;
  return `${v.toFixed(2)}×`;
}

function options(select, entries) {
  select.replaceChildren(...entries.map(([value, label]) => Object.assign(document.createElement("option"), { value, textContent: label })));
}

function buildControls() {
  options(document.getElementById("race"), races.map((r) => [r.id, `${r.city} ${r.date.slice(0, 4)}${r.distance_km && r.distance_km < 42 ? " · 21K" : ""}`]));
  options(document.getElementById("size"), Object.entries(SIZES).map(([k, s]) => [k, s.name]));
  options(document.getElementById("shape"), Object.entries(SHAPES));
  options(document.getElementById("fonts"), Object.entries(FONT_PAIRS).map(([k, f]) => [k, f.name]));

  const chips = document.getElementById("themes");
  chips.replaceChildren(...Object.entries(THEMES).map(([key, t]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "theme-chip";
    b.dataset.theme = key;
    b.title = t.name;
    b.innerHTML = `<span class="sw" style="background:${t.bg}"><i style="background:${t.water}"></i><i style="background:${t.road1}"></i><i style="background:${t.route}"></i></span><span>${t.name}</span>`;
    b.addEventListener("click", () => {
      state.theme = key;
      state.colorOverrides = {};
      syncControls();
      scheduleRender();
    });
    return b;
  }));

  const colorsBox = document.getElementById("colors");
  colorsBox.replaceChildren(...COLOR_KEYS.map(([key, label]) => {
    const l = document.createElement("label");
    l.className = "color";
    l.innerHTML = `<input type="color" data-color="${key}"><span>${label}</span>`;
    l.querySelector("input").addEventListener("input", (e) => {
      state.colorOverrides[key] = e.target.value;
      l.classList.add("overridden");
      scheduleRender();
    });
    return l;
  }));

  panel.querySelectorAll("[data-bind]").forEach((input) => {
    const evt = input.type === "range" || input.type === "text" ? "input" : "change";
    input.addEventListener(evt, () => {
      let v;
      if (input.type === "checkbox") v = input.checked;
      else if (input.type === "range") v = Number(input.value);
      else v = input.value;
      set(input.dataset.bind, v);
      if (input.dataset.bind === "race") {
        state.offset = [0, 0];
        state.zoom = 1;
        const race = races.find((r) => r.id === v);
        state.rotation = race.rotation || 0;
        state.text.title = "";
        state.text.subtitle = "";
        state.text.time = race.time || "";
      }
      syncControls();
      scheduleRender();
    });
  });

  document.getElementById("reset-colors").addEventListener("click", () => {
    state.colorOverrides = {};
    syncControls();
    scheduleRender();
  });
  document.getElementById("recenter").addEventListener("click", () => {
    state.offset = [0, 0];
    state.zoom = 1;
    syncControls();
    scheduleRender();
  });

  const fileName = () => {
    const L = layout(state);
    return `maraton-${state.race}-${state.size}${state.orient === "landscape" ? "-h" : ""}-${L.W}x${L.H}mm`;
  };
  const exportOpts = () => {
    const L = layout(state);
    return { W: L.W, H: L.H, b: L.b, cropMarks: state.cropMarks };
  };
  const busy = async (btn, label, fn) => {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try {
      await fn();
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  };
  const posterForExport = () => renderPoster(state, current.data, current.fonts, { guides: false });
  document.getElementById("export-pdf").addEventListener("click", (e) => busy(e.target, "Generando PDF…", () =>
    savePdf(posterForExport(), exportOpts(), fileName(), { title: `${current.data.race.name} · ${current.data.race.city}`, subject: "Póster de maratón" })));
  document.getElementById("export-svg").addEventListener("click", () => saveSvg(posterForExport(), exportOpts(), fileName()));
  document.getElementById("export-png").addEventListener("click", (e) => busy(e.target, "Generando PNG…", () =>
    savePng(posterForExport(), exportOpts(), fileName(), Number(document.getElementById("dpi").value))));
}

async function init() {
  races = await fetch("data/races.json").then((r) => r.json());
  state = loadState();
  if (!races.some((r) => r.id === state.race)) state.race = races[0].id;
  buildControls();
  syncControls();
  await render();
}

init();
