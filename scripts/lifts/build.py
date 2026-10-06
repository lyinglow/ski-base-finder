"""Build data/lifts.json from OpenSkiMap's lift export (OpenStreetMap data, ODbL).

    curl -o lifts.geojson https://tiles.openskimap.org/geojson/lifts.geojson
    python3 scripts/lifts/build.py lifts.geojson

A resort gets every working lift in the ski areas found within 2.5 km of it
(6 km if none are that close), so a linked area like the Portes du Soleil shows whole.
"""
import json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NEAR_KM = (2.5, 6)
KIND = {
    "gondola": "cabin", "cable_car": "cabin", "funicular": "cabin", "railway": "cabin", "mixed_lift": "cabin",
    "chair_lift": "chair",
    "platter": "surface", "drag_lift": "surface", "t-bar": "surface", "j-bar": "surface",
    "rope_tow": "surface", "magic_carpet": "surface",
}


def km(a, b):
    return math.hypot((a[0] - b[0]) * math.cos(math.radians(a[1])) * 111.3, (a[1] - b[1]) * 111.3)


def main(src):
    locs = [l for l in json.load(open(ROOT / "data/fr.json"))["locations"] if l["type"] == "resort"]
    lifts = []
    for f in json.load(open(src))["features"]:
        p, g = f["properties"], f["geometry"]
        if g["type"] != "LineString" or p["status"] != "operating" or p["liftType"] not in KIND or not p["skiAreas"]:
            continue
        lng, lat = g["coordinates"][0][:2]
        if not (4.8 < lng < 8.2 and 43.9 < lat < 46.7):
            continue
        lifts.append(f)

    out, used, by_resort = [], {}, {}
    for r in locs:
        ends = lambda f: (f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][-1])
        for radius in NEAR_KM:
            near = [f for f in lifts if min(km(r["coords"], e) for e in ends(f)) < radius]
            if near:
                break
        areas = {s["properties"]["id"] for f in near for s in f["properties"]["skiAreas"]}
        mine = [f for f in lifts if areas & {s["properties"]["id"] for s in f["properties"]["skiAreas"]}]
        ids = []
        for f in mine:
            key = f["properties"]["id"]
            if key not in used:
                p, c = f["properties"], f["geometry"]["coordinates"]
                # Most lifts run straight, so two points do; trains and funiculars keep their bends.
                pts = c if p["liftType"] in ("funicular", "railway") else [c[0], c[-1]]
                used[key] = len(used)
                out.append([p["name"] or "", KIND[p["liftType"]], [[round(x[0], 5), round(x[1], 5)] for x in pts]])
            ids.append(used[key])
        by_resort[r["id"]] = sorted(ids)
        print(f"{r['id']:24} {len(ids):4} lifts")

    data = {
        "source": "OpenSkiMap.org, from OpenStreetMap contributors (ODbL)",
        "lifts": out,
        "byResort": by_resort,
    }
    (ROOT / "data/lifts.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(len(out), "lifts written")


if __name__ == "__main__":
    main(sys.argv[1])
