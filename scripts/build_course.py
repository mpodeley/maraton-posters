"""Normalize an official marathon course into data/courses/<id>.geojson.

Output: FeatureCollection with the course LineString plus point features for
start, finish, half (marathons only) and every 5 km, positioned by scaling the
GPS length to the certified race distance (race["distance_km"], default 42.195).
"""
import argparse
import json
from pathlib import Path
from common import DATA, MARATHON_KM, ROOT, get_race, haversine_km, load_races, round_coords


def from_segments_json(spec):
    data = json.loads((ROOT / spec["path"]).read_text())
    coords = []
    for seg in data["segments"]:
        pts = [[lng, lat] for lat, lng in seg["coords"]]
        if coords and pts and pts[0] == coords[-1]:
            pts = pts[1:]
        coords.extend(pts)
    return coords


def from_gpx(spec):
    import gpxpy
    gpx = gpxpy.parse((ROOT / spec["path"]).read_text())
    coords = []
    for track in gpx.tracks:
        for seg in track.segments:
            coords.extend([p.longitude, p.latitude] for p in seg.points)
    for route in gpx.routes:
        coords.extend([p.longitude, p.latitude] for p in route.points)
    return coords


def from_geojson(spec):
    data = json.loads((ROOT / spec["path"]).read_text())
    feats = data["features"] if data.get("type") == "FeatureCollection" else [data]
    coords = []
    for f in feats:
        g = f["geometry"]
        if g["type"] == "LineString":
            coords.extend(g["coordinates"])
        elif g["type"] == "MultiLineString":
            for line in g["coordinates"]:
                coords.extend(line)
    return [c[:2] for c in coords]


def from_waypoints(spec):
    """Manual turn points as [lat, lon]; always snapped to streets."""
    return [[lon, lat] for lat, lon in spec["waypoints"]]


SOURCES = {"segments-json": from_segments_json, "gpx": from_gpx,
           "geojson": from_geojson, "waypoints": from_waypoints}


def dedupe(coords):
    out = []
    for c in coords:
        if not out or c != out[-1]:
            out.append(c)
    return out


def point_at(coords, cum, target):
    for i in range(1, len(cum)):
        if cum[i] >= target:
            seg = cum[i] - cum[i - 1] or 1e-9
            t = (target - cum[i - 1]) / seg
            a, b = coords[i - 1], coords[i]
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    return coords[-1]


def snap(race, coords):
    """Route the raw points over the OSM street graph so the line follows real streets."""
    from fetch_osm import ensure_pbf
    from snap import StreetGraph, resample
    spec = race["course"]
    pts = coords if spec["type"] == "waypoints" else resample(coords, spec.get("snap_step", 200))
    lons = [p[0] for p in coords]
    lats = [p[1] for p in coords]
    pad = 0.02
    bbox = (min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad)
    graph = StreetGraph(ensure_pbf(race["osm"]), bbox, spec.get("prefer"))
    if spec["type"] == "waypoints":
        return graph.match(pts, radius=80, beta=400.0)
    return graph.match(pts)


def build(race):
    spec = race["course"]
    coords = dedupe(SOURCES[spec["type"]](spec))
    if spec["type"] == "waypoints" or spec.get("snap"):
        coords = dedupe(snap(race, coords))
    cum = [0.0]
    for a, b in zip(coords, coords[1:]):
        cum.append(cum[-1] + haversine_km(a, b))
    gps_km = cum[-1]
    total = race.get("distance_km", MARATHON_KM)
    scale = total / gps_km
    cum_scaled = [d * scale for d in cum]

    feats = [{"type": "Feature", "properties": {"kind": "course", "gps_km": round(gps_km, 3)},
              "geometry": {"type": "LineString", "coordinates": round_coords(coords)}}]
    marks = [(0, "start"), (total, "finish")]
    if total == MARATHON_KM:
        marks.append((total / 2, "half"))
    marks += [(k, "km") for k in range(5, int(total), 5) if k < total - 0.5]
    for km, kind in marks:
        p = point_at(coords, cum_scaled, km)
        feats.append({"type": "Feature", "properties": {"kind": kind, "km": round(km, 4)},
                      "geometry": {"type": "Point", "coordinates": round_coords([p])[0]}})
    out = DATA / "courses" / f"{race['id']}.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    print(f"{race['id']}: {len(coords)} pts, GPS {gps_km:.2f} km (scale {scale:.4f}, {total} km), "
          f"bbox {min(lons):.4f},{min(lats):.4f},{max(lons):.4f},{max(lats):.4f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--race", help="race id; all races when omitted")
    ap.add_argument("--spec", help="JSON file with a full race entry, for testing before races.json")
    args = ap.parse_args()
    if args.spec:
        races = [json.loads(Path(args.spec).read_text())]
    else:
        races = [get_race(args.race)] if args.race else load_races()
    for race in races:
        build(race)


if __name__ == "__main__":
    main()
