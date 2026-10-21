"""Shared helpers for the data pipeline."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MARATHON_KM = 42.195


def load_races():
    return json.loads((DATA / "races.json").read_text())


def get_race(race_id):
    for race in load_races():
        if race["id"] == race_id:
            return race
    raise SystemExit(f"race not found: {race_id}")


def haversine_km(a, b):
    """Distance between two (lon, lat) points in km."""
    from math import radians, sin, cos, asin, sqrt
    lon1, lat1, lon2, lat2 = map(radians, (*a, *b))
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * asin(sqrt(h))


def round_coords(coords, nd=5):
    return [[round(x, nd), round(y, nd)] for x, y in coords]
