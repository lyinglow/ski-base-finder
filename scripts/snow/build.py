# Turn ten winters of 8-day snow snapshots into one "how often is there snow" map per month,
# plus a per-place count of winters with snow on the ground.
import json, os, math, sys
import numpy as np
from PIL import Image
T, OUT, *FILES = sys.argv[1:]  # tiles, map output folder, then one or more country files
meta = json.load(open(os.path.join(T, "meta.json")))
Z = meta["z"]; x0, x1 = meta["xs"]; y0, y1 = meta["ys"]
W_PX, H_PX = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
def lon(x): return x / 2**Z * 360 - 180
def lat(y): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2**Z))))
bounds = {"west": lon(x0), "east": lon(x1 + 1), "north": lat(y0), "south": lat(y1 + 1)}

def snapshot(date):
    arr = np.zeros((H_PX, W_PX), dtype=np.float32)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            f = os.path.join(T, f"{date}_{x}_{y}.png")
            if not os.path.exists(f): return None
            im = np.asarray(Image.open(f).convert("RGBA"))
            snow = (im[..., 3] > 0) & (im[..., 0] > 200) & (im[..., 1] < 160) & (im[..., 2] < 160)
            arr[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = snow
    return arr

# Elevation for every pixel, from the same terrain tiles as the 3D map.
elev = np.zeros((H_PX, W_PX), dtype=np.float32)
for x in range(x0, x1 + 1):
    for y in range(y0, y1 + 1):
        im = np.asarray(Image.open(os.path.join(os.path.dirname(T.rstrip("/")), "dem", f"{x}_{y}.png")).convert("RGB")).astype(np.float32)
        elev[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768

MONTHS = {12: "dec", 1: "jan", 2: "feb", 3: "mar", 4: "apr"}
# per winter, per month: mean of that month's snapshots (0, 0.5 or 1 per pixel)
wm = {}
for winter, mon, date in meta["jobs"]:
    a = snapshot(date)
    if a is None: continue
    wm.setdefault((winter, mon), []).append(a)
wm = {k: np.mean(v, axis=0) for k, v in wm.items()}

stats = {}
for mon, key in MONTHS.items():
    layers = [v for (w, m), v in wm.items() if m == mon]
    # Share of winters with snow lying in both of the month's snapshots (same rule as the per-place counts).
    freq = np.mean([(v >= 1).astype(np.float32) for v in layers], axis=0)
    stats[key] = len(layers)
    # Colour: faint blue where snow is occasional, bright white where it is near-certain.
    f = np.clip(freq, 0, 1)
    rgba = np.zeros((H_PX, W_PX, 4), dtype=np.uint8)
    rgba[..., 0] = (150 + 105 * f).astype(np.uint8)
    rgba[..., 1] = (190 + 65 * f).astype(np.uint8)
    rgba[..., 2] = 255
    alpha = np.where(f < 0.1, 0, 40 + 190 * f ** 0.8)
    rgba[..., 3] = np.clip(alpha, 0, 230).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, f"{key}.png"), optimize=True)

# Per place: winters with snow on the ground (best pixel near a resort, the town itself for a base).
px_m = 156543.03 / 2**Z
for FR in FILES:
  d = json.load(open(FR))
  for l in d["locations"]:
      lo, la = l["coords"]
      gx = (lo + 180) / 360 * 2**Z * 256 - x0 * 256
      r = math.radians(la)
      gy = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2**Z * 256 - y0 * 256
      ix, iy = int(gx), int(gy)
      def window(radius_m):
          rad = max(1, int(round(radius_m / (px_m * math.cos(r)))))
          return slice(max(0, iy - rad), iy + rad + 1), slice(max(0, ix - rad), ix + rad + 1)
      # The place itself: within about 500 m.
      near = window(500)
      areas = {"village" if l["type"] == "resort" else "town": np.ones_like(elev[near], dtype=bool)}
      if l["type"] == "resort":
          # Upper slopes: ground within 6 km, above halfway between village and top lift.
          wide = window(6000)
          e = elev[wide]
          mid = (l["altitude"] + l["topAltitude"]) / 2
          mask = (e >= mid) & (e <= l["topAltitude"] + 300)
          if mask.sum() < 4:  # small or steep areas: take the highest quarter instead
              mask = e >= np.percentile(e, 75)
          areas = {"slopes": mask, **areas}
      hist = {}
      for area, mask in areas.items():
          sl = wide if area == "slopes" else near
          hist[area] = {}
          for mon, key in MONTHS.items():
              winters = [v for (w, m), v in wm.items() if m == mon]
              # A winter counts if at least half the ground looked at had snow in both of the month's snapshots.
              yes = sum(1 for v in winters if ((v[sl] >= 1)[mask]).mean() >= 0.5)
              hist[area][key] = [yes, len(winters)]
      l["snowYears"] = hist
  json.dump(d, open(FR, "w"), ensure_ascii=False, indent=2); open(FR, "a").write("\n")
json.dump({"bounds": bounds, "winters": stats}, open(os.path.join(OUT, "meta.json"), "w"), indent=2)
print("bounds", bounds, "winters per month", stats)
