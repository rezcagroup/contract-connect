"""Download and simplify the outline shapes for the maps. Run rarely (boundaries hardly change): python3 pull_shapes.py

Sources (public, no key):
  NYC   Borough Boundaries, clipped to the shoreline, NYC Open Data dataset gthc-hcne
  Westchester  Municipal Boundaries, Westchester County GIS (all 45 cities, towns and villages;
        a town's polygon excludes its villages, and the names match the referral data, e.g. "Ossining Village")
Writes data/shapes.json: {"nyc": {"Brooklyn": [[ring, ...], ...]}, "wc": {...}} with rings as [[lng, lat], ...],
simplified to about 40 m and rounded to 5 decimals (about 1 m), small islands dropped. build.py puts it in the pages.
"""
import json, math, urllib.request
from pathlib import Path

R = Path(__file__).parent
SOURCES = {
    "nyc": ("https://data.cityofnewyork.us/resource/gthc-hcne.geojson", "boroname"),
    "wc": ("https://giswww.westchestergov.com/arcgis/rest/services/MunicipalBoundaries/MapServer/0/query"
           "?where=1%3D1&outFields=NAME&outSR=4326&f=geojson", "NAME"),
}
TOL = 0.0004          # simplification tolerance in degrees of latitude (~40 m)
MIN_AREA = 2e-6       # drop islands smaller than this (square degrees, ~0.02 sq km)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "contract-connect-shapes"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def simplify(pts, tol, k):
    """Douglas-Peucker on [lng, lat] points, with longitude scaled by k = cos(latitude)."""
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a][0] * k, pts[a][1]
        bx, by = pts[b][0] * k, pts[b][1]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i][0] * k, pts[i][1]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, f in zip(pts, keep) if f]


def area(ring, k):
    return abs(sum((ring[i][0] * k) * ring[i + 1][1] - (ring[i + 1][0] * k) * ring[i][1] for i in range(len(ring) - 1))) / 2


def polygons(geom):
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def main():
    out = {}
    for region, (url, field) in SOURCES.items():
        shapes, npts = {}, 0
        for f in fetch(url)["features"]:
            name, geom = f["properties"][field], f["geometry"]
            if not geom:
                continue
            for poly in polygons(geom):
                k = math.cos(math.radians(poly[0][0][1]))
                if area(poly[0], k) < MIN_AREA:
                    continue
                rings = []
                for ring in poly:
                    s = simplify(ring, TOL, k)
                    if len(s) >= 4 and area(s, k) >= MIN_AREA / 4:
                        rings.append([[round(x, 5), round(y, 5)] for x, y in s])
                if rings:
                    shapes.setdefault(name, []).append(rings)
                    npts += sum(len(r) for r in rings)
        out[region] = dict(sorted(shapes.items()))
        print(f"{region}: {len(shapes)} areas, {npts} points")
    path = R / "data" / "shapes.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print("Wrote", path, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
