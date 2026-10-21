"""Place names for the poster: data/cities/<id>.labels.json.

Kinds: district (boroughs, suburbs, quarters, neighbourhoods), water (lakes,
bays, seas), river (named waterways, kept as lines for curved labels),
park and landmark. Each label keeps the original name and name:en; the
renderer picks one and resolves collisions.
"""
import argparse
import json
import math

import osmium
import shapely
import shapely.wkb
from shapely.geometry import box
from shapely.ops import linemerge, unary_union

from common import DATA, get_race, load_races
from fetch_osm import ensure_pbf

PLACE_RANK = {"city": 1, "town": 2, "borough": 1, "city_district": 1, "suburb": 2, "quarter": 3,
              "neighbourhood": 4}
RIVERS = ("river", "canal", "tidal_channel")
WATER_PLACES = {"sea", "ocean", "bay", "strait", "sound"}
LANDMARK_TAGS = [
    ("tourism", {"attraction", "museum", "zoo", "theme_park", "aquarium"}),
    ("historic", {"castle", "monument", "fort", "palace", "city_gate"}),
    ("leisure", {"stadium"}),
    ("man_made", {"bridge", "tower", "lighthouse"}),
    ("building", {"cathedral", "stadium", "temple", "shrine"}),
    ("amenity", {"place_of_worship"}),
]


def names(tags):
    name = tags.get("name")
    if not name:
        return None
    return {"name": name, "name_en": tags.get("name:en") or tags.get("int_name") or name}


def km2(geom, lat):
    return geom.area * (111.32 ** 2) * math.cos(math.radians(lat))


def landmark_kind(tags):
    for key, values in LANDMARK_TAGS:
        if tags.get(key) in values:
            return f"{key}={tags.get(key)}"
    return None


def build(race):
    city = json.loads((DATA / "cities" / f"{race['id']}.geojson").read_text())
    w, s, e, n = city["bbox"]
    frame = box(w, s, e, n)
    lat = (s + n) / 2
    wkb = osmium.geom.WKBFactory()
    labels = []
    rivers = {}
    keys = ("place", "natural", "waterway", "leisure", "tourism", "historic", "man_made", "building", "amenity")
    fp = (osmium.FileProcessor(str(ensure_pbf(race["osm"]))).with_locations().with_areas()
          .with_filter(osmium.filter.KeyFilter(*keys)))
    for obj in fp:
        tags = dict(obj.tags)
        nm = names(tags)
        if not nm:
            continue
        try:
            if obj.is_node():
                geom = shapely.Point(obj.location.lon, obj.location.lat)
            elif obj.is_area():
                geom = shapely.wkb.loads(wkb.create_multipolygon(obj), hex=True)
            elif obj.is_way() and tags.get("waterway") in RIVERS:
                geom = shapely.wkb.loads(wkb.create_linestring(obj), hex=True)
            else:
                continue
        except RuntimeError:
            continue
        if not geom.intersects(frame):
            continue
        place = tags.get("place")
        if geom.geom_type == "LineString":
            rivers.setdefault((nm["name"], nm["name_en"], tags["waterway"]), []).append(geom)
            continue
        pt = geom if geom.geom_type == "Point" else geom.representative_point()
        if not frame.contains(pt):
            continue
        base = {**nm, "lon": round(pt.x, 5), "lat": round(pt.y, 5)}
        area = km2(geom, lat) if geom.geom_type != "Point" else 0
        if place in PLACE_RANK and obj.is_node():
            try:
                pop = int(tags.get("population", "0").replace(",", ""))
            except ValueError:
                pop = 0
            # Big suburbs are boroughs in practice (NYC tags them as suburb).
            rank = 1 if pop >= 400_000 else PLACE_RANK[place]
            labels.append({**base, "kind": "district", "rank": rank, "place": place, "pop": pop})
        elif place in WATER_PLACES or tags.get("natural") in ("bay", "strait"):
            # Named coves and harbors are mapped as bays too; size decides.
            rank = 1 if place in ("sea", "ocean") or area > 3 else 2 if area > 0.5 else 3
            labels.append({**base, "kind": "water", "rank": rank, "area": round(area, 3)})
        elif tags.get("natural") == "water" and area > 0.03:
            labels.append({**base, "kind": "water", "rank": 2 if area > 1 else 3, "area": round(area, 3)})
        elif tags.get("leisure") in ("park", "nature_reserve", "garden") and area > 0.08:
            labels.append({**base, "kind": "park", "rank": 1 if area > 1 else 2 if area > 0.3 else 3,
                           "area": round(area, 3)})
        elif (kind := landmark_kind(tags)) and ("wikidata" in tags or "wikipedia" in tags):
            if kind == "amenity=place_of_worship" and area < 0.003:
                continue
            labels.append({**base, "kind": "landmark", "tag": kind,
                           "rank": 1 if "wikipedia" in tags else 2, "area": round(area, 4)})

    for (name, name_en, ww), parts in rivers.items():
        union = unary_union(parts)
        merged = frame.intersection(linemerge(union) if union.geom_type == "MultiLineString" else union)
        for line in getattr(merged, "geoms", [merged]):
            if line.geom_type != "LineString":
                continue
            length = line.length * 111.32 * math.cos(math.radians(lat))
            if length < 1.2:
                continue
            simple = line.simplify(0.0002)
            labels.append({"name": name, "name_en": name_en, "kind": "river", "rank": 2 if ww == "canal" else 1,
                           "length": round(length, 2),
                           "line": [[round(x, 5), round(y, 5)] for x, y in simple.coords]})

    # The race's own city is already the poster title.
    cities = [lb for lb in labels if lb.get("place") == "city"]
    if cities:
        main_city = max(cities, key=lambda lb: lb["pop"])
        labels = [lb for lb in labels if lb is not main_city]

    # Same name mapped twice (node + area, several river pieces): keep the best one.
    seen = {}
    for lb in labels:
        key = (lb["kind"], lb["name"])
        score = lb.get("area", 0) + lb.get("length", 0)
        if lb["kind"] == "river" or key not in seen or score > seen[key].get("area", 0) + seen[key].get("length", 0):
            if lb["kind"] != "river":
                seen[key] = lb
    out = list(seen.values()) + [lb for lb in labels if lb["kind"] == "river"]
    counts = {}
    for lb in out:
        counts[lb["kind"]] = counts.get(lb["kind"], 0) + 1
    path = DATA / "cities" / f"{race['id']}.labels.json"
    path.write_text(json.dumps(out, ensure_ascii=False))
    print(f"{race['id']}: {counts} → {path.name} ({path.stat().st_size / 1e3:.0f} kB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--race", help="race id; all races when omitted")
    args = ap.parse_args()
    for race in ([get_race(args.race)] if args.race else load_races()):
        build(race)


if __name__ == "__main__":
    main()
