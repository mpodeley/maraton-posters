"""Plot zoomed crops of the course over the street layers, for visual checks.

Usage: debug_course.py <race> lon,lat [lon,lat ...] [--r 600] [--out dir]
Draws the snapped course (red) and the raw source points (blue) when the
source is a trace.
"""
import argparse
import json
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from common import DATA, get_race  # noqa: E402


def lines(geom):
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return geom["coordinates"]
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [r for p in geom["coordinates"] for r in p]
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("race")
    ap.add_argument("points", nargs="*")
    ap.add_argument("--r", type=float, default=600, help="half-size of each crop in meters")
    ap.add_argument("--out", default=str(DATA / "raw" / "debug"))
    args = ap.parse_args()
    race = get_race(args.race) if not args.race.endswith(".json") else json.loads(open(args.race).read())
    city_file = DATA / "cities" / f"{race['id']}.geojson"
    city = json.loads(city_file.read_text()) if city_file.exists() else {"features": []}
    course = json.loads((DATA / "courses" / f"{race['id']}.geojson").read_text())
    line = next(f for f in course["features"] if f["properties"]["kind"] == "course")["geometry"]["coordinates"]
    marks = [f for f in course["features"] if f["geometry"]["type"] == "Point"]
    from pathlib import Path
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    centers = [tuple(map(float, p.split(","))) for p in args.points] or [None]
    for n, center in enumerate(centers):
        fig, ax = plt.subplots(figsize=(9, 9), dpi=90)
        for f in city["features"]:
            layer = f["properties"]["layer"]
            style = {"water": ("#9cc3d5", 0.8), "green": ("#b9d7a8", 0.8), "rail": ("#999", 0.6),
                     "roads_1": ("#333", 1.6), "roads_2": ("#555", 1.1), "roads_3": ("#999", 0.6)}[layer]
            for ln in lines(f["geometry"]):
                xs, ys = zip(*ln)
                ax.plot(xs, ys, color=style[0], lw=style[1], zorder=1)
        xs, ys = zip(*line)
        ax.plot(xs, ys, color="#e4002b", lw=2.2, alpha=0.85, zorder=3)
        for m in marks:
            x, y = m["geometry"]["coordinates"]
            ax.plot(x, y, "o", color="black", ms=4, zorder=4)
            ax.annotate(f"{m['properties']['kind']} {m['properties']['km']:.1f}", (x, y), fontsize=8, zorder=5)
        if center:
            kx = 111320 * math.cos(math.radians(center[1]))
            ax.set_xlim(center[0] - args.r / kx, center[0] + args.r / kx)
            ax.set_ylim(center[1] - args.r / 111320, center[1] + args.r / 111320)
        else:
            ax.set_xlim(min(xs) - 0.01, max(xs) + 0.01)
            ax.set_ylim(min(ys) - 0.01, max(ys) + 0.01)
        ax.set_aspect(1 / math.cos(math.radians(sum(ys) / len(ys))))
        ax.set_xticks([])
        ax.set_yticks([])
        fig.tight_layout()
        path = out / f"{race['id']}-{n}.png"
        fig.savefig(path)
        plt.close(fig)
        print(path)


if __name__ == "__main__":
    main()
