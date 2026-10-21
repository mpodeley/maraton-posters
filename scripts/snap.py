"""Snap course waypoints to the OSM street network.

Builds an undirected graph of every walkable or drivable way in the extract
(marathons close motorways and ignore one-way rules), then map-matches the
course points onto it.
"""
import math

import numpy as np
import osmium
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

EXCLUDE = {"proposed", "construction", "abandoned", "platform", "raceway", "bus_stop",
           "elevator", "corridor", "via_ferrata", "steps"}
# Prefer real streets over sidewalks and service lanes when both exist.
DENSIFY_M = 25
PENALTY = {"footway": 1.6, "path": 1.6, "cycleway": 1.4, "service": 1.5, "track": 1.8,
           "bridleway": 2.0, "sidewalk": 1.6}


class StreetGraph:
    def __init__(self, pbf, bbox, prefer=None):
        w, s, e, n = bbox
        self.lat0 = (s + n) / 2
        self.kx = 111320 * math.cos(math.radians(self.lat0))
        penalty = {**PENALTY, **(prefer or {})}
        ids = {}
        lon, lat = [], []
        rows, cols, wts = [], [], []

        def idx(node):
            i = ids.get(node.ref)
            if i is None:
                i = ids[node.ref] = len(lon)
                lon.append(node.lon)
                lat.append(node.lat)
            return i

        def link(a, b, k):
            # Densify long segments so candidates exist along bridges and avenues.
            dx = (lon[b] - lon[a]) * self.kx
            dy = (lat[b] - lat[a]) * 111320
            steps = int(math.hypot(dx, dy) // DENSIFY_M)
            prev = a
            for j in range(1, steps + 1):
                t = j / (steps + 1)
                lon.append(lon[a] + (lon[b] - lon[a]) * t)
                lat.append(lat[a] + (lat[b] - lat[a]) * t)
                cur = len(lon) - 1
                rows.append(prev)
                cols.append(cur)
                wts.append(k)
                prev = cur
            rows.append(prev)
            cols.append(b)
            wts.append(k)

        fp = (osmium.FileProcessor(str(pbf)).with_locations()
              .with_filter(osmium.filter.KeyFilter("highway")))
        for obj in fp:
            if not obj.is_way():
                continue
            hw = obj.tags.get("highway")
            if hw in EXCLUDE or obj.tags.get("area") == "yes":
                continue
            nodes = [nd for nd in obj.nodes if nd.location.valid()]
            if len(nodes) < 2:
                continue
            if not any(w <= nd.lon <= e and s <= nd.lat <= n for nd in nodes):
                continue
            k = penalty.get(hw, 1.0)
            if obj.tags.get("footway") == "sidewalk":
                k = penalty["sidewalk"]
            prev = idx(nodes[0])
            for nd in nodes[1:]:
                cur = idx(nd)
                link(prev, cur, k)
                prev = cur
        self.lon = np.array(lon)
        self.lat = np.array(lat)
        rows = np.array(rows)
        cols = np.array(cols)
        xy = self.project(self.lon, self.lat)
        d = np.hypot(*(xy[rows] - xy[cols]).T) * np.array(wts) + 1e-3
        m = len(lon)
        g = coo_matrix((np.concatenate([d, d]), (np.concatenate([rows, cols]), np.concatenate([cols, rows]))),
                       shape=(m, m)).tocsr()
        self.graph = g
        self.xy = xy
        self.tree = cKDTree(xy)

    def project(self, lon, lat):
        return np.column_stack([(np.asarray(lon) - 0) * self.kx, np.asarray(lat) * 111320.0])

    def match(self, points, radius=50, k=6, sigma=12.0, beta=40.0):
        """HMM map matching (Viterbi): points [(lon, lat)] → street-following [(lon, lat)].

        Each point gets up to k candidate nodes within radius meters. The
        transition cost penalizes routes much longer than the straight line,
        which keeps the line off U-turns between dual carriageways.
        """
        pts = self.project([p[0] for p in points], [p[1] for p in points])
        cands, emis = [], []
        for xy in pts:
            d, i = self.tree.query(xy, k=k, distance_upper_bound=radius)
            ok = np.isfinite(d)
            if not ok.any():
                d, i = self.tree.query(xy, k=1)
                d, i = np.array([d]), np.array([i])
                ok = np.array([True])
            cands.append([int(v) for v in i[ok]])
            emis.append((d[ok] / sigma) ** 2 / 2)
        n = len(pts)
        cost = [emis[0]]
        back = [None]
        paths = []
        for t in range(1, n):
            gc = float(np.hypot(*(pts[t] - pts[t - 1])))
            limit = 3 * gc + 400
            dist, pred = dijkstra(self.graph, indices=cands[t - 1], return_predecessors=True, limit=limit)
            trans = np.full((len(cands[t - 1]), len(cands[t])), 1e6)
            for a_i in range(len(cands[t - 1])):
                for b_i, b in enumerate(cands[t]):
                    if np.isfinite(dist[a_i, b]):
                        trans[a_i, b_i] = abs(dist[a_i, b] - gc) / beta
            total = cost[-1][:, None] + trans + emis[t][None, :]
            back.append(total.argmin(axis=0))
            cost.append(total.min(axis=0))
            paths.append(pred)
        # Backtrack the best candidate chain, then expand each hop into its path.
        chain = [int(cost[-1].argmin())]
        for t in range(n - 1, 0, -1):
            chain.append(int(back[t][chain[-1]]))
        chain = chain[::-1]
        coords = []
        for t in range(1, n):
            a_i, b_i = chain[t - 1], chain[t]
            a, b = cands[t - 1][a_i], cands[t][b_i]
            pred = paths[t - 1][a_i]
            hop = [b]
            if a != b:
                while hop[-1] != a and hop[-1] >= 0:
                    hop.append(int(pred[hop[-1]]))
                if hop[-1] != a:
                    print(f"  gap near {self.lon[b]:.5f},{self.lat[b]:.5f}; straight segment")
                    hop = [b, a]
            for i in hop[::-1]:
                c = [float(self.lon[i]), float(self.lat[i])]
                if not coords or coords[-1] != c:
                    coords.append(c)
        return coords


def resample(coords, step_m):
    """Points every step_m meters along a lon/lat polyline (keeps both ends)."""
    if len(coords) < 2:
        return coords
    lat0 = coords[0][1]
    kx = 111320 * math.cos(math.radians(lat0))
    out = [coords[0]]
    carry = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        seg = math.hypot((x2 - x1) * kx, (y2 - y1) * 111320)
        pos = step_m - carry
        while pos < seg:
            t = pos / seg
            out.append([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t])
            pos += step_m
        carry = (carry + seg) % step_m
    out.append(coords[-1])
    return out
