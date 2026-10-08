# Builds data/bike.json: summer riding for resorts, plus valley towns with no ski area.
# Run: python3 scripts/bike/build.py <town_routes.json>
# The ratings are hand data (first pass). Drive times for the valley towns come from a route planner,
# scaled by 0.85 like the winter times, with no winter pass closures.
import json, sys, os
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from towns import TOWNS
from own import OWN
root = os.path.join(here, "..", "..")
SUITS = {"b": "beginner", "i": "intermediate", "x": "expert"}
STYLES = {"f": "flow", "d": "downhill", "e": "enduro", "x": "xc", "m": "ebike", "k": "kids"}
PASS = {"FR": {"awesome": 38, "good": 32, "fair": 18}, "CH": {"awesome": 55, "good": 45, "fair": 28},
        "IT": {"awesome": 40, "good": 32, "fair": 18}, "AT": {"awesome": 48, "good": 40, "fair": 26}}

places = {}
tops = {}
for c in ("fr", "ch", "it", "at"):
    for l in json.load(open(os.path.join(root, "data", f"{c}.json")))["locations"]:
        tops[l["id"]] = (l["type"], l.get("topAltitude"), c.upper())

def season(top):
    if top >= 3000: return ("2027-06-19", "2027-09-20")
    if top >= 2400: return ("2027-06-12", "2027-09-13")
    if top >= 2000: return ("2027-06-19", "2027-09-06")
    return ("2027-06-26", "2027-09-05")

OVERRIDE = {  # known earlier or longer seasons
    "at-saalbach": ("2027-05-22", "2027-10-04"), "at-soelden": ("2027-06-12", "2027-10-03"),
    "it-livigno": ("2027-06-05", "2027-09-20"),
}
for line in open(os.path.join(here, "ratings.txt"), encoding="utf8"):
    line = line.strip()
    if not line or line.startswith("#"): continue
    id_, level, suits, styles, pas, note = line.split("|", 5)
    kind, top, cc = tops[id_]
    assert kind == "resort", id_
    p = int(pas) if pas != "" else PASS[cc][level]
    o, cl = OVERRIDE.get(id_) or season(top)
    places[id_] = {"level": level, "suits": [SUITS[s] for s in suits], "styles": [STYLES[s] for s in styles],
                   "pass": p, "season": {"open": o, "close": cl}, "note": note}
for id_, b in OWN.items():
    assert tops[id_][0] == "base", id_
    places[id_] = b
for id_, (kind, top, cc) in tops.items():
    if kind == "resort" and id_ not in places:
        places[id_] = {"level": "none"}

routes = json.load(open(sys.argv[1]))
towns = []
for t in TOWNS:
    t = dict(t)
    fo = {}
    for key, r in routes.items():
        code, id_ = key.split("|")
        if id_ == t["id"] and r:
            m = r["min"] * 0.85
            if m <= 330: fo[code] = {"km": round(r["km"]), "min": max(5, int(5 * round(m / 5)))}
    t["fromOrigin"] = fo
    t["type"] = "base"
    t["summerOnly"] = True
    t["links"] = []
    t["places"] = None
    t.pop("places")
    towns.append(t)

out = {"updated": "2026-10", "places": places, "towns": towns}
json.dump(out, open(os.path.join(root, "data", "bike.json"), "w"), ensure_ascii=False, indent=1)
n = lambda lv: sum(1 for b in places.values() if b["level"] == lv)
print({lv: n(lv) for lv in ("awesome", "good", "fair", "none")}, "towns", len(towns))
