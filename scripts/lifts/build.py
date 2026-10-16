"""Build data/lifts.json and data/parks.json from OpenSkiMap's exports (OpenStreetMap data, ODbL).

    curl -o lifts.geojson https://tiles.openskimap.org/geojson/lifts.geojson
    curl -o runs.geojson https://tiles.openskimap.org/geojson/runs.geojson   # about 850 MB
    python3 scripts/lifts/build.py lifts.geojson runs.geojson

The runs file gives the snow parks and each resort's mix of green, blue, red and black runs
(written to "runShare" in data/fr.json). Leave it out to rebuild the lifts alone.

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


# Every country file that exists, live or still being prepared.
def country_files():
    index = json.load(open(ROOT / "data/index.json"))
    return [ROOT / "data" / c["file"] for c in index["countries"] if (ROOT / "data" / c["file"]).exists()]


def in_region(c):
    while isinstance(c[0], list):
        c = c[0]
    return 4.8 < c[0] < 14.0 and 43.9 < c[1] < 47.8


def area_ids(f):
    return {s["properties"]["id"] for s in f["properties"]["skiAreas"]}


def rounded(c):
    if isinstance(c[0], list):
        return [rounded(x) for x in c]
    return [round(c[0], 5), round(c[1], 5)]


def main(src, runs_src=None):
    locs = [l for f in country_files() for l in json.load(open(f))["locations"] if l["type"] == "resort"]
    lifts = []
    for f in json.load(open(src))["features"]:
        p, g = f["properties"], f["geometry"]
        if g["type"] != "LineString" or p["status"] != "operating" or p["liftType"] not in KIND or not p["skiAreas"]:
            continue
        lng, lat = g["coordinates"][0][:2]
        if not (4.8 < lng < 14.0 and 43.9 < lat < 47.8):
            continue
        lifts.append(f)

    out, used, by_resort, resort_areas = [], {}, {}, {}
    for r in locs:
        ends = lambda f: (f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][-1])
        for radius in NEAR_KM:
            near = [f for f in lifts if min(km(r["coords"], e) for e in ends(f)) < radius]
            if near:
                break
        areas = {a for f in near for a in area_ids(f)}
        resort_areas[r["id"]] = areas
        mine = [f for f in lifts if areas & area_ids(f)]
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
    if runs_src:
        runs = json.load(open(runs_src))["features"]
        build_parks(runs, locs, resort_areas)
        build_run_share(runs, resort_areas)
        build_activities(runs, [l for f in country_files() for l in json.load(open(f))["locations"]], resort_areas)


# Snow parks: the same ski areas as the lifts, or within 3 km for parks not tied to an area.
# Race courses tagged as parks ("stade", "slalom") are left out.
def build_parks(runs, locs, resort_areas):
    parks = []
    for f in runs:
        p, g = f["properties"], f["geometry"]
        if "snow_park" not in (p.get("uses") or []) or p["status"] != "operating":
            continue
        if g["type"] not in ("LineString", "Polygon") or not in_region(g["coordinates"]):
            continue
        if any(w in (p["name"] or "").lower() for w in ("stade", "slalom")):
            continue
        parks.append(f)

    out, used, by_resort = [], {}, {}
    for r in locs:
        def near(f):
            c = f["geometry"]["coordinates"]
            pts = c[0] if f["geometry"]["type"] == "Polygon" else c
            return min(km(r["coords"], x) for x in pts) < 3
        mine = [f for f in parks if (area_ids(f) & resort_areas[r["id"]]) or (not f["properties"]["skiAreas"] and near(f))]
        ids = []
        for f in mine:
            key = f["properties"]["id"]
            if key not in used:
                used[key] = len(used)
                g = f["geometry"]
                out.append([f["properties"]["name"] or "", "area" if g["type"] == "Polygon" else "line", rounded(g["coordinates"])])
            ids.append(used[key])
        by_resort[r["id"]] = sorted(ids)

    data = {"source": "OpenSkiMap.org, from OpenStreetMap contributors (ODbL)", "parks": out, "byResort": by_resort}
    (ROOT / "data/parks.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(len(out), "snow parks written")


# Share of each piste colour, from the length of mapped runs. Mapped totals fall short of the
# resorts' own figures, so only the mix is kept; the app applies it to the published piste km.
# Where the ski area match is much bigger than the resort's own area, runs within 4 km are used.
COLOUR = {"novice": "green", "easy": "blue", "intermediate": "red", "advanced": "black", "expert": "black"}


def build_run_share(runs, resort_areas):
    pistes = []
    for f in runs:
        p, g = f["properties"], f["geometry"]
        if g["type"] != "LineString" or p["status"] != "operating" or "downhill" not in (p.get("uses") or []):
            continue
        if p.get("difficulty") not in COLOUR or not p["skiAreas"] or not in_region(g["coordinates"]):
            continue
        c = g["coordinates"]
        pistes.append((area_ids(f), COLOUR[p["difficulty"]], c[0], sum(km(c[i], c[i + 1]) for i in range(len(c) - 1))))

    for path in country_files():
        build_share_for(path, pistes, resort_areas)
    print("run shares written")


def build_share_for(path, pistes, resort_areas):
    data = json.load(open(path))
    for r in data["locations"]:
        if r["type"] != "resort":
            continue
        mine = [x for x in pistes if x[0] & resort_areas[r["id"]]]
        if sum(x[3] for x in mine) > 1.6 * r["skiArea"]["pisteKm"]:
            mine = [x for x in pistes if km(r["coords"], x[2]) < 4]
        total = sum(x[3] for x in mine)
        r.pop("runShare", None)
        if total < 10:
            print(f"{r['id']:24} too few mapped runs, no share")
            continue
        share = {c: round(100 * sum(x[3] for x in mine if x[1] == c) / total) for c in ("green", "blue", "red", "black")}
        share["blue"] += 100 - sum(share.values())  # rounding
        r["runShare"] = share
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


# Winter activities mapped on OpenStreetMap near each place: night skiing (lit downhill runs), sledging runs,
# cross-country trails, winter walking, ski-touring routes, fat-bike trails, ice rinks, horse sleighs and
# children's snow play areas. Night skiing counts when the lit run is in the place's ski area; everything else
# has to be within 4 km of the place (6 km for touring routes).
# The maps are volunteer made and can be incomplete, so the app says so. Spa and thermal baths are hand data.
ACTIVITY_NEAR_KM = 4
SPA = {  # places with a well-known thermal bath or spa complex in or next to the village
    "ch-leukerbad": "Leukerbad thermal baths", "it-bormio": "Bormio thermal baths", "at-bad-gastein": "Gastein thermal baths",
    "fr-brides": "Brides-les-Bains thermal spa", "fr-saint-gervais": "Saint-Gervais thermal baths",
    "it-pre-saint-didier": "Pré-Saint-Didier thermal baths", "fr-courchevel": "Aquamotion water park and spa",
    "ch-scuol": "Bogn Engiadina thermal baths", "at-zell-am-see": "TauernSpa at Kaprun", "it-livigno": "Aquagranda wellness centre",
    "fr-evian": "Évian thermal baths",
}


def build_activities(runs, places, resort_areas):
    kinds = {"sled": "sled", "nordic": "nordic", "hike": "hike", "skitour": "skitour", "fatbike": "fatbike",
             "ice_skate": "skate", "sleigh": "sleigh", "playground": "play"}
    feats = []
    for f in runs:
        p, g = f["properties"], f["geometry"]
        if p["status"] != "operating" or g["type"] not in ("LineString", "Polygon"):
            continue
        uses = p.get("uses") or []
        coords = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"]
        if not coords or not in_region(coords):
            continue
        length = sum(km(coords[i], coords[i + 1]) for i in range(len(coords) - 1)) if g["type"] == "LineString" else 0
        pts = [coords[0], coords[len(coords) // 2], coords[-1]]
        lit = p.get("lit") is True
        tags = {kinds[u] for u in uses if u in kinds}
        if lit and "downhill" in uses:
            tags.add("night")
        if lit and "sled" in uses:
            tags.add("nightsled")
        if tags:
            feats.append((tags, pts, length, area_ids(f)))

    out = {}
    for pl in places:
        areas = resort_areas.get(pl["id"], set())
        acc = {}
        for tags, pts, length, fareas in feats:
            for t in tags:
                # Night skiing is about the ski area, so a lit run in the same area counts. Everything else
                # has to be close to the place itself: 4 km, or 6 km for touring routes.
                near = t == "night" and bool(areas & fareas)
                if not near:
                    radius = 6 if t == "skitour" else ACTIVITY_NEAR_KM
                    if all(abs(x[1] - pl["coords"][1]) > 0.1 for x in pts):
                        continue
                    near = min(km(pl["coords"], x) for x in pts) < radius
                if not near:
                    continue
                n, total = acc.get(t, (0, 0.0))
                acc[t] = (n + 1, total + length)
        rec = {}
        for t, (n, total) in acc.items():
            if t == "night" and total >= 1: rec["night"] = round(total, 1)
            elif t == "nightsled" and n >= 1: rec["nightSled"] = n
            elif t == "sled" and n >= 1: rec["sled"] = [n, round(total, 1)]
            elif t == "nordic" and total >= 10: rec["nordic"] = round(total)
            elif t == "hike" and total >= 5: rec["hike"] = round(total)
            elif t in ("skitour", "fatbike", "skate", "sleigh", "play") and n >= 1: rec[t] = n
        if pl["id"] in SPA: rec["spa"] = SPA[pl["id"]]
        if rec: out[pl["id"]] = rec
    data = {"source": "OpenSkiMap.org, from OpenStreetMap contributors (ODbL), plus hand-checked spas", "places": out}
    (ROOT / "data/activities.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(len(out), "places with activities written")


if __name__ == "__main__":
    main(*sys.argv[1:3])
