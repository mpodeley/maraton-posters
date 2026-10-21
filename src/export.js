// Print exports: vector PDF, SVG and 300 dpi PNG.
import { BLEED } from "./render.js";

const SLUG = 10; // mm of paper around the bleed that holds the crop marks
const MARK = 6;

// Clone the poster for export: drop guides and optionally add crop marks.
export function exportSvg(svg, { W, H, b, cropMarks }) {
  const out = svg.cloneNode(true);
  out.querySelectorAll(".guides").forEach((n) => n.remove());
  if (!cropMarks) return { svg: out, w: W + 2 * b, h: H + 2 * b };
  const pad = b + SLUG;
  out.setAttribute("viewBox", `${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`);
  out.setAttribute("width", `${W + 2 * pad}mm`);
  out.setAttribute("height", `${H + 2 * pad}mm`);
  const ns = "http://www.w3.org/2000/svg";
  const paper = document.createElementNS(ns, "rect");
  Object.entries({ x: -pad, y: -pad, width: W + 2 * pad, height: H + 2 * pad, fill: "#ffffff" })
    .forEach(([k, v]) => paper.setAttribute(k, v));
  out.insertBefore(paper, out.querySelector("defs").nextSibling);
  const g = document.createElementNS(ns, "g");
  g.setAttribute("stroke", "#000000");
  g.setAttribute("stroke-width", "0.25");
  const gap = Math.max(b, BLEED);
  const lines = [];
  for (const x of [0, W]) {
    lines.push([x, -gap - MARK, x, -gap], [x, H + gap, x, H + gap + MARK]);
  }
  for (const y of [0, H]) {
    lines.push([-gap - MARK, y, -gap, y], [W + gap, y, W + gap + MARK, y]);
  }
  for (const [x1, y1, x2, y2] of lines) {
    const l = document.createElementNS(ns, "line");
    Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => l.setAttribute(k, v));
    g.appendChild(l);
  }
  out.appendChild(g);
  return { svg: out, w: W + 2 * pad, h: H + 2 * pad };
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

function serialize(svg) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}

export function saveSvg(svg, opts, name) {
  const { svg: out } = exportSvg(svg, opts);
  download(new Blob([serialize(out)], { type: "image/svg+xml" }), `${name}.svg`);
}

export async function savePdf(svg, opts, name, meta) {
  const { svg: out, w, h } = exportSvg(svg, opts);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: [w, h], orientation: w > h ? "landscape" : "portrait", compress: true, putOnlyUsedFonts: true });
  doc.setProperties({ title: meta.title, subject: meta.subject, creator: "maraton-posters" });
  // svg2pdf reads computed styles, so the clone must live in the document.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden";
  host.appendChild(out);
  document.body.appendChild(host);
  try {
    await doc.svg(out, { x: 0, y: 0, width: w, height: h });
  } finally {
    host.remove();
  }
  download(doc.output("blob"), `${name}.pdf`);
}

export async function savePng(svg, opts, name, dpi = 300) {
  const { svg: out, w, h } = exportSvg(svg, opts);
  const pxW = Math.round(w / 25.4 * dpi);
  const pxH = Math.round(h / 25.4 * dpi);
  out.setAttribute("width", pxW);
  out.setAttribute("height", pxH);
  const url = URL.createObjectURL(new Blob([serialize(out)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`El navegador no pudo crear un lienzo de ${pxW} × ${pxH} px.`);
    ctx.drawImage(img, 0, 0, pxW, pxH);
    const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(`El navegador no pudo generar un PNG de ${pxW} × ${pxH} px. Probá con menos dpi.`))), "image/png"));
    download(await withDpi(blob, dpi), `${name}-${dpi}dpi.png`);
    return { pxW, pxH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Insert a pHYs chunk so print software reads the intended resolution.
async function withDpi(blob, dpi) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // Insert right after IHDR (8-byte signature + 25-byte IHDR chunk).
  const at = 33;
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(buf.subarray(at), at + chunk.length);
  return new Blob([out], { type: "image/png" });
}

let CRC_TABLE;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
