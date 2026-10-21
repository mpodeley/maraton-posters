// Convert data/cities/<id>.geojson into quantized TopoJSON for the browser.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { topology } from "topojson-server";

const dir = new URL("../data/cities/", import.meta.url);
const only = process.argv[2];
for (const file of readdirSync(dir)) {
  if (!file.endsWith(".geojson")) continue;
  const id = file.replace(/\.geojson$/, "");
  if (only && id !== only) continue;
  const fc = JSON.parse(readFileSync(new URL(file, dir)));
  // Buildings need less precision: 1 m is far below what prints.
  const topo = topology({ city: fc }, id.endsWith(".buildings") ? 4e4 : 2e5);
  topo.bbox = fc.bbox;
  const out = new URL(`${id}.topo.json`, dir);
  writeFileSync(out, JSON.stringify(topo));
  console.log(`${id}: ${(JSON.stringify(topo).length / 1e6).toFixed(1)} MB`);
}
