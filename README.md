# Ski Base Finder

A 3D map that helps you choose where to stay for a ski trip from Geneva.

It shows ski resorts and the cheaper, lower towns around them on the same map. Click a resort and it shows you where else you could stay, how long the daily hop is, and how much you save. Click a town and it shows which resorts you can reach from it.

France, Switzerland, Italy and Austria are live: 132 ski areas and 56 feeder towns, from the Hautes-Alpes to the Arlberg and Schladming, big names and small local hills alike. The Dolomites are next (see `docs/EXPANSION.md`).

## Run it

It is a plain static site. No build step, no API keys.

```
npm start          # serves the folder at http://localhost:8080
npm run validate   # checks the data files
```

Any static host works (GitHub Pages, Netlify, Vercel, an S3 bucket). Opening `index.html` straight from disk will not work, because the browser blocks loading the data files that way.

The live site (https://ski-base-finder.vercel.app) deploys itself from GitHub: every push to `main` goes live within a minute or so, and other branches get a preview link.

## What you can do

- **See the land.** Satellite or topo map draped over real elevation. Drag to pan, right-drag or two-finger drag to tilt and rotate.
- **Tell the two kinds of place apart.** Blue triangles are resorts. Amber circles are feeder towns.
- **Start with a country.** The first screen asks where you are skiing. Picking a country starts from its main airport (Geneva for France and Switzerland, Turin for Italy, Innsbruck for Austria), and you can change the airport any time. Clear map goes back to this screen, with no airport picked and every place on show.
- **Pick your airport.** Geneva, Lyon, Chambéry, Grenoble, Turin, Zurich, Basel, Milan Malpensa, Bergamo, Innsbruck, Salzburg or Munich. Picking a country in Where to? switches to its main airport, and you can still change it. Every drive time, filter and trip cost follows. Times are winter routes from a route planner, avoiding passes that close in winter (Iseran, Galibier, Petit-Saint-Bernard, Mont-Cenis, Furka, Grimsel, Stelvio, Timmelsjoch, Grossglockner and others). Car-free resorts such as Zermatt and Wengen include the last train or lift.
- **Filter** by time from the airport (up to 5 hours), the daily hop from a feeder town to the slopes, price to stay, ski area size, family-friendly, and whether it works without a car.
- **Click a resort** to see "Stay lower, ski here": every cheaper place with quick access, how many minutes away, by car, bus, train or lift, how many price bands cheaper, and how many metres lower.
- **Click a feeder town** to see every resort within reach, nearest first.
- **Compare** up to four places side by side. One button pairs a resort with its cheaper bases. The best value in each row is highlighted.
- **See the trip cost.** Enter nights, ski days, adults, children, and shuttle or hire car. Every place shows a whole-trip total: accommodation, lift passes, airport transfers and daily trips to the slopes. Each cheaper place under a resort shows what you save by staying there. For a feeder town, pick which resort you plan to ski. Flights, ski hire and food are not included.
- **Who's skiing.** Pick First time, Intermediate, Expert, or a mix for a group. First time shows only resorts where you can walk from the village to the beginner slopes.
- **Find somewhere to stay.** Set your arrival date in Your trip. Every place has a Places to stay section with one-tap searches on Booking.com, Airbnb and Abritel, already filled in with that town, your dates and your group, plus web searches for ski apartment deals and package holidays.
- **Pounds or euros.** Prices show in pounds by default, converted at the latest European Central Bank rate. Switch to euros with £/€ next to Your trip.
- **Plan a family trip.** Add children with the + button and pick each one's age, choose lessons (none, kids only, everyone) and ski hire, and pick a week. The week picker marks UK half term, the French school holidays, Christmas, New Year and Easter, with how busy and how pricey each week is. Trip cost adds lessons, hire, childcare for under-3s, and free passes for under-5s. Resorts closed in your week are hidden.
- **Best match.** Every place gets a fit score out of 100 for your group, with the reasons for each level: walk to the beginner slopes and English-speaking schools for first-timers, km of blue and red runs for intermediates, expert terrain and black runs for experts, plus snow, children's ages and transfer time for everyone. A mixed group's score leans towards whoever the place suits least. The list sorts by best match first.
- **Run mix and expert terrain.** Each resort shows its km of green, blue, red and black runs and a rating of its expert terrain.
- **Pick a vibe.** Lively, quiet, traditional, upmarket, ski-in ski-out or town life. Choose any number, or none for all.
- **See past snow cover.** The Snow button lays ten winters of NASA satellite snow records over the 3D map for the month you pick: faint blue where snow is sometimes lying, white where it is nearly always there. Each place's panel shows how many of the last 10 winters had snow lying on the upper slopes and in the village (or in town for feeder towns).
- **Check the snow.** Pick the months you are going. Every resort shows how snow-sure it is for those months (snow-sure, usually fine, risky), month by month in its panel. Feeder towns show the best snow they reach. Filter to snow-sure places only, or sort by snow.
- **Pick up where you left off.** Your shortlist, trip, filters, airport, currency and the place you had open are saved in your browser. Share plan copies a link that opens the same plan on any device, or for someone you are travelling with. Start a new plan clears it.
- **Snow parks.** Each resort is rated Awesome, Good, Fair or no park, with a filter. Tapping a place draws its parks in pink.
- **See it from the airport.** The map opens looking out from your airport, which sits at the bottom of the screen, with a line to the furthest place on show and its drive time. Changing airport does the same. **Clear map** also takes off every filter, the selected place and the snow layer, and keeps your trip and shortlist.
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
data/ch.json        every Swiss resort and feeder town
data/it.json        every Italian resort and feeder town
data/at.json        every Austrian resort and feeder town
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
