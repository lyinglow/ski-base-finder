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
| `character` | string | One or two plain sentences. What it feels like to stay there. |
| `fromOrigin` | object | Travel per origin: `{ "GVA": { "km": 70, "min": 65 } }`. Add a key for each new airport. |
| `transfer` | string | How to get there without your own car. Start with "Car" if a car is really needed. |
| `links` | array | Resorts reachable from here. Required for bases, optional for resorts. |

Extra fields for resorts:

| Field | Type | Meaning |
| --- | --- | --- |
| `topAltitude` | metres | Highest lift. |
| `levels` | array | Any of `beginner`, `intermediate`, `expert`. |
| `skiArea` | object | `{ "name": "Évasion Mont-Blanc", "pisteKm": 445 }`. Use the whole linked area the pass covers. |

Optional for any place:

| Field | Meaning |
| --- | --- |
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
- **No car needed**: a base with `rail` and at least one bus, train or lift link; a resort whose `transfer` does not start with "Car".

## Checking your edits

```
npm run validate
```

It checks ids, required fields, coordinates, price bands, and that every link points at a real resort. Run it before every commit.
