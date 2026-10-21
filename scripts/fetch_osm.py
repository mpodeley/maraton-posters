"""Build the simplified city base map around a marathon course.

Reads an OpenStreetMap extract (BBBike city cut or Geofabrik region, cached
under data/raw/pbf/) and writes data/cities/<id>.geojson with one merged
feature per layer: water, green, rail, roads_1..roads_3.
"""
import argparse
import json
import math

import osmium
import requests
import shapely
import shapely.wkb
from shapely import affinity
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon, box, mapping
from shapely.prepared import prep
from shapely.ops import linemerge, polygonize, unary_union
from shapely.strtree import STRtree

from common import DATA, get_race, load_races

HEADERS = {"User-Agent": "maraton-posters/0.1 (personal print project)"}
PBF_SOURCES = {
    "bbbike": "https://download.bbbike.org/osm/bbbike/{name}/{name}.osm.pbf",
    "geofabrik": "https://download.geofabrik.de/{name}-latest.osm.pbf",
}

ROADS = {
    "roads_1": {"motorway", "trunk", "primary"},
    "roads_2": {"secondary", "tertiary"},
    "roads_3": {"residential", "unclassified", "living_street", "pedestrian"},
}
RAIL = {"rail", "light_rail", "subway", "tram", "narrow_gauge"}
WATER_AREA = {("natural", "water"), ("waterway", "riverbank"), ("landuse", "reservoir"),
              ("landuse", "basin")}
GREEN_AREA = {("leisure", v) for v in ("park", "garden", "golf_course", "nature_reserve", "pitch")}
GREEN_AREA |= {("landuse", v) for v in ("grass", "forest", "meadow", "recreation_ground",
                                         "cemetery", "village_green")}
GREEN_AREA |= {("natural", v) for v in ("wood", "scrub", "heath", "grassland")}
# Simplification tolerance in meters per layer.
TOLERANCE = {"water": 6, "green": 6, "rail": 4, "roads_1": 3, "roads_2": 3, "roads_3": 3}


def fetch_bbox(race, course):
    """Square-ish area around the course, wide enough for landscape or portrait framing."""
    pts = [c for f in course["features"] if f["geometry"]["type"] == "LineString"
           for c in f["geometry"]["coordinates"]]
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    clon, clat = (min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2
    kx = 111.32 * math.cos(math.radians(clat))
    w_km = (max(lons) - min(lons)) * kx
    h_km = (max(lats) - min(lats)) * 111.32
    half = max(w_km, h_km) / 2 * race.get("extent", 1.6) + 1.0
    return (clon - half / kx, clat - half / 111.32, clon + half / kx, clat + half / 111.32)


def ensure_pbf(spec):
    kind, name = spec.split(":", 1)
    path = DATA / "raw" / "pbf" / (name.replace("/", "_") + ".osm.pbf")
    # A failed download can leave a tiny HTML error page behind; refetch it.
    if path.exists() and path.stat().st_size < 1_000_000:
        path.unlink()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = PBF_SOURCES[kind].format(name=name)
        print(f"  downloading {url}")
        with requests.get(url, stream=True, headers=HEADERS, timeout=120) as r:
            r.raise_for_status()
            with open(path, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
    return path


def tagged(tags, pairs):
    return any(tags.get(k) == v for k, v in pairs)


def read_pbf(path, frame):
    """Collect raw shapely geometries per layer from an OSM extract."""
    wkb = osmium.geom.WKBFactory()
    fast = prep(frame)
    out = {k: [] for k in ("roads_1", "roads_2", "roads_3", "rail", "coast", "rivers", "water", "green")}
    keys = ("highway", "railway", "natural", "waterway", "landuse", "leisure")
    fp = (osmium.FileProcessor(str(path))
          .with_locations()
          .with_areas()
          .with_filter(osmium.filter.KeyFilter(*keys)))
    for obj in fp:
        tags = obj.tags
        try:
            if obj.is_area():
                if tagged(tags, WATER_AREA):
                    layer = "water"
                elif tagged(tags, GREEN_AREA):
                    layer = "green"
                else:
                    continue
                g = shapely.wkb.loads(wkb.create_multipolygon(obj), hex=True)
            elif obj.is_way():
                hw = tags.get("highway")
                tunnel = tags.get("tunnel") in ("yes", "building_passage")
                layer = None
                if hw and not tunnel and tags.get("area") != "yes":
                    layer = next((k for k, v in ROADS.items() if hw in v), None)
                elif tags.get("railway") in RAIL and not tunnel and tags.get("service") not in (
                        "yard", "siding", "spur", "crossover"):
                    layer = "rail"
                elif tags.get("natural") == "coastline":
                    layer = "coast"
                elif tags.get("waterway") in ("river", "canal") and not tunnel:
                    layer = "rivers"
                if layer is None:
                    continue
                g = shapely.wkb.loads(wkb.create_linestring(obj), hex=True)
            else:
                continue
        except (RuntimeError, ValueError, shapely.errors.GEOSException):
            continue
        # Coastline must stay whole to keep its direction for the sea test.
        if layer == "coast" or fast.intersects(g):
            out[layer].append(g)
    return out


def coastal_water(coast_lines, bbox):
    """Build sea polygons from coastline ways: water lies to the right of each way."""
    frame = box(*bbox)
    merged = linemerge(coast_lines) if len(coast_lines) > 1 else coast_lines[0]
    lines = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    clipped = [frame.intersection(l) for l in lines]
    noded = unary_union([frame.exterior] + [c for c in clipped if not c.is_empty])
    faces = list(polygonize(noded))
    segs = []
    for line in lines:
        cs = list(line.coords)
        segs.extend(LineString([a, b]) for a, b in zip(cs, cs[1:]))
    tree = STRtree(segs)
    water = []
    for face in faces:
        p = face.representative_point()
        seg = segs[tree.nearest(p)]
        (ax, ay), (bx, by) = seg.coords
        cross = (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax)
        if cross < 0:
            water.append(face)
    return unary_union(water) if water else None


def relation_water(path, frame, spec):
    """Close large water bodies whose relation is cut by the extract (e.g. Lake Michigan).

    spec: {"relations": [osm ids], "points": [[lon, lat], ...]}. Member ways are
    noded with the map frame; faces that contain a hint point become water.
    """
    wanted = set(spec["relations"])
    ways = set()
    for obj in osmium.FileProcessor(str(path), osmium.osm.RELATION):
        if obj.id in wanted:
            ways |= {m.ref for m in obj.members if m.type == "w"}
    wkb = osmium.geom.WKBFactory()
    lines = []
    for obj in osmium.FileProcessor(str(path)).with_locations():
        if obj.is_way() and obj.id in ways:
            try:
                lines.append(shapely.wkb.loads(wkb.create_linestring(obj), hex=True))
            except RuntimeError:
                continue
    clipped = [frame.intersection(l) for l in lines]
    noded = unary_union([frame.exterior] + [c for c in clipped if not c.is_empty])
    hints = [shapely.Point(p) for p in spec["points"]]
    faces = [f for f in polygonize(noded) if any(f.contains(h) for h in hints)]
    print(f"  water_fill: {len(lines)} member ways, {len(faces)} faces")
    return unary_union(faces) if faces else None


def simplify_m(geom, meters, lat):
    """Simplify in a locally equal-area lon/lat frame."""
    k = math.cos(math.radians(lat))
    g = affinity.scale(geom, xfact=k, yfact=1, origin=(0, 0))
    g = g.simplify(meters / 111320, preserve_topology=True)
    return affinity.scale(g, xfact=1 / k, yfact=1, origin=(0, 0))


def build(race):
    course = json.loads((DATA / "courses" / f"{race['id']}.geojson").read_text())
    bbox = race.get("bbox") or fetch_bbox(race, course)
    pbf = ensure_pbf(race["osm"])
    hdr = osmium.io.Reader(str(pbf), osmium.osm.osm_entity_bits.NOTHING).header().box()
    eps = 0.002
    ext = (hdr.bottom_left.lon + eps, hdr.bottom_left.lat + eps,
           hdr.top_right.lon - eps, hdr.top_right.lat - eps)
    bbox = (max(bbox[0], ext[0]), max(bbox[1], ext[1]), min(bbox[2], ext[2]), min(bbox[3], ext[3]))
    frame = box(*bbox)
    lat = (bbox[1] + bbox[3]) / 2
    print(f"{race['id']}: bbox {', '.join(f'{v:.4f}' for v in bbox)} from {pbf.name}")
    raw = read_pbf(pbf, frame)
    print("  " + ", ".join(f"{k} {len(v)}" for k, v in raw.items()))

    layers = {}
    for key in ("roads_1", "roads_2", "roads_3", "rail"):
        layers[key] = frame.intersection(unary_union(raw[key])) if raw[key] else None
    parts = raw["water"] + [r.buffer(0.00012) for r in raw["rivers"]]
    if raw["coast"]:
        sea = coastal_water(raw["coast"], bbox)
        if sea is not None:
            parts.append(sea)
    if race.get("water_fill"):
        filled = relation_water(pbf, frame, race["water_fill"])
        if filled is not None:
            parts.append(filled)
    parts = [p if p.is_valid else p.buffer(0) for p in parts]
    layers["water"] = frame.intersection(unary_union(parts)) if parts else None
    green = [p if p.is_valid else p.buffer(0) for p in raw["green"]]
    layers["green"] = frame.intersection(unary_union(green)) if green else None
    if layers["green"] is not None and layers["water"] is not None:
        layers["green"] = layers["green"].difference(layers["water"])

    feats = []
    for key, geom in layers.items():
        if geom is None or geom.is_empty:
            continue
        geom = simplify_m(geom, TOLERANCE[key], lat)
        if key in ("water", "green"):
            polys = [g for g in getattr(geom, "geoms", [geom]) if isinstance(g, (Polygon, MultiPolygon))]
            geom = unary_union(polys).buffer(0)
            # Drop specks that would never print.
            min_area = (8 / 111320) ** 2
            keep = [p for p in getattr(geom, "geoms", [geom]) if p.area > min_area]
            geom = MultiPolygon(keep) if keep else None
        else:
            ls = [g for g in getattr(geom, "geoms", [geom]) if isinstance(g, LineString)]
            geom = linemerge(MultiLineString(ls)) if ls else None
        if geom is None or geom.is_empty:
            continue
        feats.append({"type": "Feature", "properties": {"layer": key}, "geometry": mapping(geom)})

    out = DATA / "cities" / f"{race['id']}.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "bbox": list(bbox), "features": feats}))
    print(f"  wrote {out.relative_to(DATA.parent)} ({out.stat().st_size / 1e6:.1f} MB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--race", help="race id; all races when omitted")
    ap.add_argument("--spec", help="JSON file with a full race entry, for testing before races.json")
    args = ap.parse_args()
    if args.spec:
        races = [json.loads(open(args.spec).read())]
    else:
        races = [get_race(args.race)] if args.race else load_races()
    for race in races:
        build(race)


if __name__ == "__main__":
    main()
