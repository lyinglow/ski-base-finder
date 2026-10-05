# Download MODIS 8-day snow extent tiles (NASA GIBS) for 10 winters over the French Alps.
import math, os, datetime, urllib.request, time, json, sys
OUT = sys.argv[1]
Z = 8
W, E, S, N = 4.9, 7.9, 44.3, 46.7
def tx(lon): return int((lon + 180) / 360 * 2**Z)
def ty(lat):
    r = math.radians(lat); return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2**Z)
xs = range(tx(W), tx(E) + 1); ys = range(ty(N), ty(S) + 1)
def period_start(d):
    doy = d.timetuple().tm_yday
    return datetime.date(d.year, 1, 1) + datetime.timedelta(days=((doy - 1) // 8) * 8)
jobs = []
for y in range(2015, 2025):  # winter y/y+1
    for mon, yr in [(12, y), (1, y + 1), (2, y + 1), (3, y + 1), (4, y + 1)]:
        for day in (8, 22):
            p = period_start(datetime.date(yr, mon, day))
            jobs.append((y, mon, p.isoformat()))
meta = {"z": Z, "xs": [xs.start, xs.stop - 1], "ys": [ys.start, ys.stop - 1], "jobs": jobs}
json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"))
n = 0; fails = 0
for (_, _, date) in jobs:
    for x in xs:
        for yy in ys:
            f = os.path.join(OUT, f"{date}_{x}_{yy}.png")
            if os.path.exists(f): continue
            url = f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_Snow_Extent_8Day/default/{date}/GoogleMapsCompatible_Level8/{Z}/{yy}/{x}.png"
            for a in range(3):
                try:
                    data = urllib.request.urlopen(url, timeout=30).read(); open(f, "wb").write(data); n += 1; break
                except Exception as e:
                    time.sleep(2 * (a + 1))
            else:
                fails += 1
            time.sleep(0.05)
print("downloaded", n, "failed", fails, "tiles per date", len(xs) * len(ys), "dates", len(jobs), flush=True)
