// Curated palettes. Every key is overridable from the panel.
export const COLOR_KEYS = [
  ["bg", "Fondo"],
  ["water", "Agua"],
  ["green", "Verde"],
  ["building", "Edificios"],
  ["road1", "Avenidas"],
  ["road2", "Calles"],
  ["road3", "Calles menores"],
  ["rail", "Vías"],
  ["route", "Recorrido"],
  ["text", "Texto"],
];

export const THEMES = {
  papel: {
    name: "Papel",
    bg: "#f3ede2", water: "#bcd0d3", green: "#dcdfc6",
    road1: "#3b3631", road2: "#5d564e", road3: "#9a9185", rail: "#8a8174",
    route: "#d9480f", text: "#2b2724",
  },
  noche: {
    name: "Noche",
    bg: "#0e1621", water: "#1c2e42", green: "#14251f",
    road1: "#ece5d5", road2: "#aaa497", road3: "#545c68", rail: "#6b7280",
    route: "#ffb000", text: "#ede6d6",
  },
  plano: {
    name: "Plano azul",
    bg: "#12355b", water: "#0b2643", green: "#164069",
    road1: "#e1ecf7", road2: "#a7c0dc", road3: "#6489b2", rail: "#8eabcc",
    route: "#ff6b6b", text: "#eaf2fb",
  },
  terracota: {
    name: "Terracota",
    bg: "#ead9c5", water: "#9db5b1", green: "#d1c7a3",
    road1: "#6b3e2e", road2: "#8c5a45", road3: "#b5927e", rail: "#9a7562",
    route: "#1f3b4d", text: "#4a2a1f",
  },
  mono: {
    name: "Monocromo",
    bg: "#ffffff", water: "#e4e4e4", green: "#f1f1f1",
    road1: "#111111", road2: "#3d3d3d", road3: "#9c9c9c", rail: "#7a7a7a",
    route: "#000000", text: "#111111",
  },
  tinta: {
    name: "Tinta",
    bg: "#121212", water: "#242424", green: "#1b1b1b",
    road1: "#ffffff", road2: "#bdbdbd", road3: "#5f5f5f", rail: "#7d7d7d",
    route: "#e63946", text: "#f5f5f5",
  },
  sepia: {
    name: "Sepia",
    bg: "#ecdfcc", water: "#cfc1aa", green: "#ddd0b5",
    road1: "#5b4636", road2: "#7a6552", road3: "#a99682", rail: "#8f7a66",
    route: "#8b1e1e", text: "#3e2c20",
  },
  menta: {
    name: "Menta",
    bg: "#e8f1ec", water: "#9cc7c0", green: "#cfe3c9",
    road1: "#234e52", road2: "#3e6e6f", road3: "#8db2ac", rail: "#5d8b88",
    route: "#ee6c4d", text: "#1d3b3f",
  },
  rosa: {
    name: "Rosa",
    bg: "#f7e6e2", water: "#bccbe6", green: "#e4e8cc",
    road1: "#5d3a52", road2: "#80607a", road3: "#b9a0b0", rail: "#9c8195",
    route: "#2e5bba", text: "#4a2a40",
  },
  contraste: {
    name: "Alto contraste",
    bg: "#000000", water: "#06386b", green: "#0a0a0a",
    road1: "#ffffff", road2: "#d0d0d0", road3: "#7a7a7a", rail: "#9a9a9a",
    route: "#ffd400", text: "#ffffff",
  },
};

// Font pairs: [title font, body font]. Files live in /fonts.
export const FONT_PAIRS = {
  editorial: { name: "Editorial", title: "PlayfairDisplay-700", body: "Inter-400", bodyStrong: "Inter-600", titleTracking: 0.04 },
  moderna: { name: "Moderna", title: "Montserrat-800", body: "Montserrat-300", bodyStrong: "Montserrat-500", titleTracking: 0.18 },
  condensada: { name: "Condensada", title: "Oswald-700", body: "Oswald-400", bodyStrong: "Oswald-700", titleTracking: 0.12 },
  tecnica: { name: "Técnica", title: "SpaceGrotesk-700", body: "IBMPlexMono-400", bodyStrong: "IBMPlexMono-600", titleTracking: 0.06 },
  clasica: { name: "Clásica", title: "CormorantGaramond-700", body: "CormorantGaramond-500", bodyStrong: "CormorantGaramond-700", titleTracking: 0.16 },
  display: { name: "Display", title: "DMSerifDisplay-400", body: "Montserrat-300", bodyStrong: "Montserrat-500", titleTracking: 0.03 },
};

// WCAG relative luminance contrast, used for the print warning.
export function contrast(a, b) {
  const lum = (hex) => {
    const v = hex.replace("#", "").match(/../g).map((h) => parseInt(h, 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function mix(a, b, t) {
  const pa = a.replace("#", "").match(/../g).map((h) => parseInt(h, 16));
  const pb = b.replace("#", "").match(/../g).map((h) => parseInt(h, 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
