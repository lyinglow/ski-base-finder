# Data format

Two kinds of file live in `data/`.

## `index.json`

The list of everything the app should load.

| Field | Meaning |
| --- | --- |
| `origins` | Airports or stations people travel from. Each has `id`, `name`, `coords`. |
| `defaultOrigin` | The origin used for "time from airport". |
| `countries` | One entry per country: `code`, `name`, `file`, `status`. Only `"live"` files are loaded. |
| `priceBands` | Label, symbol and guide text for price levels 1, 2 and 3. |
| `priceNote` | Shown under the price guide and in the compare table. |

## Country files (`fr.json`, later `ch.json`, `it.json`)

```json
{
  "country": "FR",
  "name": "France",
  "updated": "2026-10",
  "notes": "How the numbers were measured.",
  "locations": [ ... ]
}
```

### A location

Fields for every place:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Unique. Starts with the country code: `fr-megeve`, `ch-verbier`. Never change it once published; links and shared URLs use it. |
| `type` | `"resort"` or `"base"` | A base is a feeder town: somewhere to stay, not ski. |
| `name` | string | As locals write it, with accents. |
| `region` | string | Département or canton. |
| `coords` | `[lng, lat]` | Longitude first. For resorts, the main village or lift base. |
| `altitude` | metres | Village or town altitude. |
| `townSize` | `small`, `medium`, `large` | Size of the place to stay, not the ski area. |
| `price` | 1, 2 or 3 | Price band to stay. See `priceBands`. |
| `family` | boolean | Good for families with young children. |
| `vibes` | array | One to three of the keys under `vibes` in `index.json`: `lively`, `quiet`, `traditional`, `upmarket`, `skiin`, `town`. |
| `character` | string | One or two plain sentences. What it feels like to stay there. |
| `fromOrigin` | object | Travel per origin: `{ "GVA": { "km": 70, "min": 65 } }`, one key per airport in `index.json`. Times come from the OSRM route planner, rerouted around passes closed in winter and scaled by 0.85 to match real journey times. A place with no key for an airport is hidden when that airport is picked. |
| `transfer` | string | How to get there without your own car. Start with "Car" if a car is really needed. |
| `links` | array | Resorts reachable from here. Required for bases, optional for resorts. |

Extra fields for resorts:

| Field | Type | Meaning |
| --- | --- | --- |
| `topAltitude` | metres | Highest lift. |
| `levels` | array | Any of `beginner`, `intermediate`, `expert`. |
| `skiArea` | object | `{ "name": "Évasion Mont-Blanc", "pisteKm": 445, "pass6": 335 }`. Use the whole linked area the pass covers. `pass6` is the adult 6-day lift pass in euros. |

Optional for resorts, to tune the snow rating:

| Field | Meaning |
| --- | --- |
| `season` | `{ "open": "2026-12-12", "close": "2027-04-18" }`. Typical opening and closing dates. Used to hide resorts closed in the chosen week. |
| `school` | `{ "english": "many" \| "some" \| "few", "skiFrom": 3, "crecheFromMonths": 18 }`. English-speaking ski school availability, youngest age for children's ski school, and youngest age for a crèche (leave out if none). |
| `easyStart` | A short note, for resorts where a first-timer can walk from the village to the beginner slopes. When First time is picked under Who's skiing, only these resorts show. |
| `snowAdjust` | Metres added to the snow altitude, for places that hold snow better (or worse) than their height suggests: a glacier, a cold north-facing bowl. Keep it within ±500. |
| `snowNote` | One short sentence on why, shown under the snow months. |
| `snow` | Override a month outright: `{ "apr": "good" }`. Values `good`, `fair`, `poor`. |

Optional for any place:

| Field | Meaning |
| --- | --- |
| `snowYears` | Built by `scripts/snow/build.py`, not by hand. Winters out of 10 with snow lying mid-month: `{ "slopes": { "apr": [9, 10], ... }, "village": { ... } }` for resorts, `{ "town": { ... } }` for feeder towns. |
| `searchName` | The name to use in accommodation searches, when the display name won't search well (for example `"Lélex"` for Monts Jura). |
| `stayPerPerson` | Euros per person per night, when a place costs clearly more or less than its price band's usual figure. |
| `rail` | Name of the train service from the origin, for example `"Léman Express L3"`. Used for the "No car needed" badge. |

### A link

```json
{ "to": "fr-meribel", "min": 25, "by": ["lift"], "note": "Olympe gondola" }
```

| Field | Meaning |
| --- | --- |
| `to` | Id of a resort. Can be in another country. |
| `min` | Door to slopes, normal conditions. For lifts, time until you are skiing. |
| `by` | Any of `car`, `bus`, `train`, `lift`. A link with anything other than `car` draws as a solid line. |
| `note` | Optional. Shown under the time. |

Write each link once, from the place you stay to the resort you ski. The app works out the reverse direction.

## What the app works out for you

- **Ski area size** from `pisteKm`: small under 60, medium 60 to 199, large 200 to 399, huge 400 and up.
- **Cheaper places to stay** for a resort: anything that links to it and is in a lower price band, plus feeder towns at the same price within 20 minutes.
- **Snow by month** for each resort, from December to April. The app takes a "snow altitude" of 35% village plus 65% top lift, adds any `snowAdjust`, and checks it against a height for each month:

  | Month | Snow-sure from | Usually fine from |
  | --- | --- | --- |
  | Dec | 2000 m | 1500 m |
  | Jan | 1600 m | 1150 m |
  | Feb | 1500 m | 1100 m |
  | Mar | 1800 m | 1350 m |
  | Apr | 2300 m | 1900 m |

  For a trip across several months, the weakest month decides. A feeder town takes the best rating among the resorts it reaches. The heights live in `MONTHS` in `js/data.js`; Swiss or Italian resorts may need their own once those countries are added.
- **Trip cost** for staying in one place and skiing one resort (see `js/cost.js`). All rates live under `costs` in `index.json`:
  - Accommodation: `stayPerPerson`, or the price band's `perPerson`, × people × nights × the average `seasonFactor` of the chosen months.
  - Lift passes: `pass6` ÷ 6 × ski days, children at `childPass` of the adult price.
  - Airport: a shared shuttle per person (`base` + `perKm` × km, each way), or a hire car per day plus fuel and tolls.
  - Daily trips: free by lift or by a bus of 20 minutes or less; a bus fare beyond that; fuel and parking when driving. A town with no bus or lift to the chosen resort is costed with a hire car.
- **Lessons, hire and childcare** in the trip cost, from `costs` in `index.json`: six half-day group lessons (ski kindergarten for ages 3 to 4), daily hire by age, crèche for under-3s, all scaled by ski days and by the resort's price band (`resortPriceFactor`). Under-5s ski free; ages 5 to 12 pay `childPass`, 13 to 17 `teenPass`.
- **Weeks** in `index.json` list each Saturday of the season with a label, a price factor and how busy it is. Picking a week replaces the monthly price factor.
- **Fit for your group** (see `js/fit.js`). Everyone: snow up to 15, transfer up to 10, and with children, family-friendly 10 and children's ages 10. First-timers add: walk to beginner slopes 25, beginner terrain 10, English-speaking schools up to 15, ski-in ski-out 5. Intermediates add: km of blue and red runs up to 30, intermediate terrain 10, top altitude up to 10. Experts add: expert terrain rating up to 35, km of black runs up to 20, top altitude up to 15. Each level's points are turned into a score out of 100; a group's score is half the lowest plus half the average. A feeder town scores its best resort without the walk points, minus the daily trip.
- **No car needed**: a base with `rail` and at least one bus, train or lift link; a resort whose `transfer` does not start with "Car".

## Checking your edits

```
npm run validate
```

It checks ids, required fields, coordinates, price bands, and that every link points at a real resort. Run it before every commit.

## Expert terrain and run mix

Every resort has an `expert` rating: `{ "level": "good", "note": "..." }`, with level `awesome`, `good`, `fair` or `little`. Like the snow parks, it is our own judgement of steep runs and off-piste, so check it each autumn.

`runShare` is built by `scripts/lifts/build.py` from OpenStreetMap, not by hand: the share of green, blue, red and black runs, adding up to 100. Mapped run lengths fall short of what resorts publish, so the app applies the share to the published `pisteKm`. A resort with too few mapped runs has no `runShare` and shows no bar.

## Snow parks

Every resort has a `park` rating. It is our own judgement from what the resort publishes, not measured data, so check it each autumn and update `parkChecked` in `data/index.json`.

| Field | Meaning |
|---|---|
| `park.level` | `awesome` (several lines for every level, big jumps, often a halfpipe), `good` (a proper park with a beginner line), `fair` (a small park or fun zone), `none`. |
| `park.note` | One or two short sentences, shown in the place panel. |
| `park.name` | Optional. The park's own name, only when it is well known. |
| `park.features` | Optional. Any of `beginner`, `small`, `medium`, `big`, `rails`, `halfpipe`, `airbag`, `cross`, `kids` (labels in `parkFeatures` in `data/index.json`). |
| `park.featuresChecked` | `false` until the features have been checked against the season's park map, then `true`. |

A feeder town takes the best park among the resorts it reaches. The pink park shapes on the map come from OpenStreetMap through `scripts/lifts/build.py` (see below) and are often incomplete.

## Ski lifts

`data/lifts.json` holds the working lifts shown when a place is tapped. It is built, not edited by hand:

```
curl -o lifts.geojson https://tiles.openskimap.org/geojson/lifts.geojson
curl -o runs.geojson https://tiles.openskimap.org/geojson/runs.geojson   # about 850 MB, for snow parks
python3 scripts/lifts/build.py lifts.geojson runs.geojson
```

Each resort gets every lift in the ski areas within 2.5 km of it, so a linked area shows whole. A feeder town shows the lifts of the resorts it reaches. Data from OpenSkiMap, © OpenStreetMap contributors (ODbL). Rebuild it each autumn, or after adding resorts.

## Summer riding (`bike.json`)

Summer mountain biking lives in `data/bike.json`, separate from the winter data. It has two parts.

- `places`: a bike entry for every resort id (use `"level": "none"` where there is no riding, and the place is hidden in summer), plus feeder towns that are good to ride in their own right (Annecy, Innsbruck). Each entry has `level` (awesome, good, fair or none), `suits` (beginner, intermediate, expert), `styles` (flow, downhill, enduro, xc, ebike, kids), `pass` (day price in euros for bike lifts or uplift shuttles, 0 when no lifts are needed), `season` (typical `open` and `close` dates) and a one-sentence `note`.
- `towns`: valley towns with no ski area. They are full places (id, coords, altitude, price, vibes, character, `fromOrigin` drive times) with `type: "base"`, `summerOnly: true`, no links and their own `bike` entry. They only show in summer.

A feeder town without its own `bike` entry takes the best bike park it links to, the same way it takes a ski resort in winter.

Summer costs, months and weeks are under `bike` in `index.json`. The ratings are a first pass from general knowledge of each place, not checked against each park's trail map, so treat them as a starting point.

`scripts/bike/ratings.txt`, `own.py` and `towns.py` hold the hand data, and `python3 scripts/bike/build.py <routes.json>` writes `bike.json`. Drive times for the valley towns come from a route planner, scaled by 0.85 like the winter times, with no winter pass closures.
