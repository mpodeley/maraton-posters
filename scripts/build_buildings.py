"""Building footprints as an optional layer: data/cities/<id>.buildings.geojson.

Adjacent footprints are merged into blocks (dilate, union, erode) and tiny
ones dropped, which keeps the texture of the city at poster scale with a
fraction of the polygons.
"""
import argparse
import json
import math
import time
from multiprocessing import Pool

import numpy as np
import osmium
import shapely
import shapely.wkb
from shapely.geometry import MultiPolygon, Polygon, mapping

from common import DATA, get_race, load_races
from fetch_osm import ensure_pbf

MERGE_M = 4        # gap closed between neighboring buildings (streets are wider)
MIN_AREA_M2 = 150  # smaller footprints vanish at poster scale
TOLERANCE_M = 3
TILE_M = 600


def merge_tile(wkbs):
    g = shapely.buffer(shapely.from_wkb(wkbs), MERGE_M, quad_segs=2)
    merged = shapely.union_all(g, grid_size=0.5)
    merged = shapely.buffer(merged, -MERGE_M, quad_segs=2, join_style="mitre")
    merged = shapely.simplify(merged, TOLERANCE_M, preserve_topology=True)
    keep = [p for p in shapely.get_parts(merged) if isinstance(p, Polygon) and p.area >= MIN_AREA_M2]
    return shapely.to_wkb(np.array(keep, dtype=object))


def build(race):
    city = json.loads((DATA / "cities" / f"{race['id']}.geojson").read_text())
    lat = (city["bbox"][1] + city["bbox"][3]) / 2
    k = math.cos(math.radians(lat))
    t0 = time.time()
    wkb = osmium.geom.WKBFactory()
    polys = []
    fp = (osmium.FileProcessor(str(ensure_pbf(race["osm"]))).with_locations().with_areas()
          .with_filter(osmium.filter.KeyFilter("building")))
    w, s, e, n = city["bbox"]
    for obj in fp:
        if not obj.is_area():
            continue
        try:
            g = shapely.wkb.loads(wkb.create_multipolygon(obj), hex=True)
        except RuntimeError:
            continue
        x0, y0, x1, y1 = g.bounds
        if x1 < w or x0 > e or y1 < s or y0 > n:
            continue
        polys.append(g)
    print(f"{race['id']}: {len(polys)} footprints read in {time.time() - t0:.0f}s")

    # Work in a local metric frame and merge per 600 m tile, in parallel:
    # a global union is quadratic-ish and takes minutes per city.
    geoms = shapely.make_valid(np.array(polys, dtype=object))
    m = shapely.transform(geoms, lambda c: c * [k * 111320, 111320])
    cents = shapely.get_coordinates(shapely.centroid(m))
    keys = np.floor(cents / TILE_M).astype(int)
    groups = {}
    for key, g in zip(map(tuple, keys), m):
        groups.setdefault(key, []).append(g)
    with Pool() as pool:
        tiles = pool.map(merge_tile, [shapely.to_wkb(np.array(v, dtype=object)) for v in groups.values()],
                         chunksize=4)
    parts = [p for t in tiles for p in shapely.from_wkb(t)]
    # Parts from neighboring tiles may overlap; clip each one instead of the union.
    parts = shapely.transform(np.array(parts, dtype=object), lambda c: c / [k * 111320, 111320])
    parts = shapely.clip_by_rect(parts, *city["bbox"])
    out = MultiPolygon([p for g in parts for p in shapely.get_parts(g)
                        if isinstance(p, Polygon) and not p.is_empty])
    print(f"  {len(parts)} blocks after merge, {time.time() - t0:.0f}s")
    path = DATA / "cities" / f"{race['id']}.buildings.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "bbox": city["bbox"], "features": [
        {"type": "Feature", "properties": {"layer": "buildings"}, "geometry": mapping(out)}]}))
    print(f"  wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--race", help="race id; all races when omitted")
    args = ap.parse_args()
    for race in ([get_race(args.race)] if args.race else load_races()):
        build(race)


if __name__ == "__main__":
    main()
