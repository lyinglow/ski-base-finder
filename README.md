# Ski Base Finder

A 3D map that helps you choose where to stay for a ski trip from Geneva.

It shows ski resorts and the cheaper, lower towns around them on the same map. Click a resort and it shows you where else you could stay, how long the daily hop is, and how much you save. Click a town and it shows which resorts you can reach from it.

France is live: 70 ski areas and 28 feeder towns, from Haute-Savoie down to the Hautes-Alpes, big names and small local hills alike. Switzerland and Italy are planned.

## Run it

It is a plain static site. No build step, no API keys.

```
npm start          # serves the folder at http://localhost:8080
npm run validate   # checks the data files
```

Any static host works (GitHub Pages, Netlify, Vercel, an S3 bucket). Opening `index.html` straight from disk will not work, because the browser blocks loading the data files that way.

## What you can do

- **See the land.** Satellite or topo map draped over real elevation. Drag to pan, right-drag or two-finger drag to tilt and rotate.
- **Tell the two kinds of place apart.** Blue triangles are resorts. Amber circles are feeder towns.
- **Filter** by time from the airport (up to 5 hours), the daily hop from a feeder town to the slopes, price to stay, ski area size, family-friendly, and whether it works without a car.
- **Click a resort** to see "Stay lower, ski here": every cheaper place with quick access, how many minutes away, by car, bus, train or lift, how many price bands cheaper, and how many metres lower.
- **Click a feeder town** to see every resort within reach, nearest first.
- **Compare** up to four places side by side. One button pairs a resort with its cheaper bases. The best value in each row is highlighted.
- **See the trip cost.** Enter nights, ski days, adults, children, and shuttle or hire car. Every place shows a whole-trip total: accommodation, lift passes, airport transfers and daily trips to the slopes. Each cheaper place under a resort shows what you save by staying there. For a feeder town, pick which resort you plan to ski. Flights, ski hire and food are not included.
- **Check the snow.** Pick the months you are going. Every resort shows how snow-sure it is for those months (snow-sure, usually fine, risky), month by month in its panel. Feeder towns show the best snow they reach. Filter to snow-sure places only, or sort by snow.
- **Save a shortlist.** Tap the star or Save on any place. Your shortlist stays in your browser, shows as stars on the map, and can be compared or shared as a link.
- **Share a place.** The address bar updates (`#fr-megeve`), so a link opens straight to it.

## How it is built

| Part | Choice | Why |
| --- | --- | --- |
| Map engine | [MapLibre GL JS](https://maplibre.org) 5 | Open source, real 3D terrain, no account or key needed. Same API as Mapbox GL, so you can switch later. |
| Elevation | AWS Open Data terrain tiles (Terrarium) | Free, global, no key. |
| Imagery | Esri World Imagery and World Topo | Free to use for a prototype, with attribution. |
| App | Plain HTML, CSS and JavaScript modules | Nothing to install or build. Easy to hand over. |
| Data | JSON files, one per country | Readable, easy to edit, easy to review in a pull request. |

All tile sources live in one file, `js/map.js`. To go to production, swap them for a paid provider there and nothing else changes. See [docs/EXPANSION.md](docs/EXPANSION.md) for when and how.

### Files

```
index.html          page layout
css/app.css         styles, light and dark
js/app.js           filters, list, detail card, compare
js/data.js          loads every live country and works out the links
js/map.js           map, terrain and tile sources
data/index.json     origins (airports), countries, price bands
data/fr.json        every French resort and feeder town
scripts/validate.mjs  data checks
docs/DATA.md        the data format, field by field
docs/EXPANSION.md   how to add Switzerland and Italy
```

## The data

Each place is one record. Resorts and feeder towns share the same shape, so they can be filtered and compared together. Feeder towns add **links**: the resorts they reach, with minutes and transport.

```json
{
  "id": "fr-sallanches",
  "type": "base",
  "name": "Sallanches",
  "coords": [6.6311, 45.9361],
  "altitude": 550,
  "townSize": "medium",
  "price": 1,
  "family": true,
  "fromOrigin": { "GVA": { "km": 60, "min": 50 } },
  "rail": "Léman Express L3",
  "links": [
    { "to": "fr-megeve", "min": 15, "by": ["car", "bus"] },
    { "to": "fr-chamonix", "min": 30, "by": ["car", "train"] }
  ]
}
```

Resorts can have links too. Combloux links to Megève by lift, so it appears as a cheaper way into the Megève ski area.

The app reads links in both directions. You only write "Sallanches reaches Megève" once, and Megève shows Sallanches as a cheaper place to stay.

Full field list: [docs/DATA.md](docs/DATA.md).

### About the numbers

The figures are researched estimates, good for comparing places, not for booking:

- **Drive times** are typical winter times on clear roads, not Saturday change-over traffic.
- **Price** is a band (€, €€, €€€) for a double room or small apartment in peak season.
- **Piste km** is the whole linked area your pass covers.

Check prices and timetables before you book. Each country file has an `updated` date.

## Adding Switzerland and Italy

Add a file, flip a switch. No code changes. The short version:

1. Create `data/ch.json` with the same record format, ids starting `ch-`.
2. Set its `status` to `"live"` in `data/index.json`.
3. Run `npm run validate`.

Links can cross borders, so Châtel can link to Morgins and La Rosière to La Thuile. The full plan, including new airports, is in [docs/EXPANSION.md](docs/EXPANSION.md).
