# Snow history

Builds the snow cover maps in `data/snow/` and the `snowYears` counts in each country file
from ten winters of NASA MODIS Terra 8-day snow extent (MOD10A2), served by NASA GIBS.

```
pip install pillow numpy
python3 scripts/snow/fetch.py /tmp/snow/tiles        # about 900 images, a few minutes
# elevation tiles for the same area, used to find each resort's upper slopes:
#   save https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/{x}/{y}.png
#   as /tmp/snow/dem/{x}_{y}.png for the x and y ranges in /tmp/snow/tiles/meta.json
python3 scripts/snow/build.py /tmp/snow/tiles data/snow data/fr.json data/ch.json   # every live country file
```

Rules:
- Two snapshots per month (the 8-day periods holding the 8th and the 22nd), for winters 2015/16 to 2024/25.
- A spot counts for a winter when snow was lying in both of that month's snapshots.
- Maps: the share of winters that met that rule, faint blue (sometimes) to white (nearly every winter).
- Per place: winters out of 10 where at least half the ground looked at met the rule.
  Towns and villages: within about 500 m. Resorts' upper slopes: ground within 6 km above
  halfway between village and top-lift height.

To add next winter, move the year range in `fetch.py` on by one and run both steps again.
