# Adding countries

Order: **Switzerland, then Italy, then Austria.** One country at a time, each one live before the next starts.

The app never names a country in code. It loads whatever `data/index.json` marks as live, so most of the work is data. Each country gets its own file (`data/ch.json`, `data/it.json`, `data/at.json`) in the same shape as `fr.json`, with ids starting `ch-`, `it-`, `at-`.

## What every place needs

| Part | Made by | Notes |
|---|---|---|
| Name, position, altitude, top altitude, ski area and km, price band, 6-day pass, season dates, character, transfer, access ("Getting up") | Hand | Resort websites. Most of the work. |
| Ski school, crèche, `easyStart`, `family`, `levels` | Hand | |
| `vibes`, `park` (level, note, features), `expert` (level, note) | Hand, our judgement | Marked "to check" until reviewed against the season's info. |
| Links between towns and resorts (bus, train, lift, car, minutes) | Hand | The heart of the feeder-town idea. |
| `fromOrigin` drive times from every airport | Script | Same route-planner method as France: avoid passes closed in winter, scale by 0.85. |
| `snowYears` | `scripts/snow/` | The NASA snow images must cover the new area first. |
| Lifts, parks on the map, `runShare` | `scripts/lifts/build.py` | Widen the region box first. |

## Changes made once, with Switzerland (done)

1. **Cost adjustment per country.** Lift passes, lessons, hire and childcare differ a lot (Switzerland about 30 to 40% above France, Italy a little below, Austria close to France). Add a factor per country in `index.json` and apply it in `js/cost.js`.
2. **Widen the map data.** Snow layer, lifts, parks and run mix currently stop at about 8.2° east. Switzerland needs to about 10.5° east. Austria needs to about 13.5° east, which roughly triples the snow images.
3. **Country filter** (France, Switzerland, Italy, Austria) in the Filters tab.
4. **New airports:** Zurich and Basel for Switzerland, Milan for Italy, then Innsbruck, Salzburg and Munich for Austria. Each new airport needs drive times to every place.

## Step 1: Switzerland (live)

- **Resorts (about 30):**
  - Portes du Soleil Swiss side: Champéry, Morgins, Les Crosets, Champoussin, Torgon
  - Vaud Alps: Villars, Leysin, Les Diablerets
  - 4 Vallées: Verbier, Nendaz, Veysonnaz, Thyon, La Tzoumaz
  - Valais: Crans-Montana, Anzère, Grimentz-Zinal, Ovronnaz, Leukerbad, Saas-Fee, Zermatt, Aletsch Arena (Riederalp, Bettmeralp)
  - Bernese Oberland: Gstaad, Adelboden, Wengen, Grindelwald, Mürren
  - Jura: La Dôle
- **Feeder towns (about 13):** Monthey, Aigle, Bex, Martigny, Le Châble, Sion, Sierre, Visp, Täsch, Brig, Interlaken, Lauterbrunnen, Frutigen.
  Switzerland suits the feeder-town idea well: valley towns with a train, funicular or gondola straight up (Le Châble to Verbier, Sierre to Crans-Montana, Täsch to Zermatt, Lauterbrunnen to Wengen and Mürren).
- **Cross-border links:** Châtel and Morgins, Avoriaz and Champéry (Portes du Soleil).

## Step 2: Italy (live)

- **Resorts (17):** Aosta Valley (Courmayeur, La Thuile, Pila, Cervinia, Valtournenche, Champoluc, Gressoney), Alagna, the Milky Way (Sestriere, Sauze d'Oulx, Sansicario, Claviere), Bardonecchia, and Lombardy (Livigno, Bormio, Santa Caterina, Madesimo).
- **Feeder towns (8):** Aosta (cable car to Pila), Pré-Saint-Didier, Morgex, Châtillon, Pont-Saint-Martin, Oulx, Susa, Tirano.
- **Cross-border links:** La Thuile and La Rosière, Cervinia and Zermatt, Claviere and Montgenèvre.
- **Airports:** Milan Malpensa and Bergamo added; Turin already in.
- **Later, with Austria:** the Dolomites (Cortina, Val Gardena, Alta Badia, Madonna di Campiglio), flown into from Verona or Innsbruck.

## Step 3: Austria

A different region, flown into from Innsbruck, Salzburg or Munich rather than Geneva. The map will open on the airport you pick, so it can still feel local.

- **Resorts to start:** St Anton, Lech, Ischgl, Sölden, Obergurgl, Mayrhofen, Kitzbühel, Saalbach, Zell am See, Bad Gastein, Obertauern, Schladming.
- **Feeder towns:** Landeck, Imst, Innsbruck, Zell am Ziller, Kirchberg, Bruck, Bischofshofen.
- **School holidays:** add the German and Dutch holiday weeks, which fill Austrian resorts.

## Keeping the data fresh

- Check every country each October and update `updated` in its file.
- Re-run the scripts: drive times when roads change, `scripts/lifts/build.py` each autumn, the snow build once a year.
- Use pull requests for data changes. The validator catches broken links and bad values.

## Going to production

- Swap to a paid map tile provider in `js/map.js` (MapTiler or Mapbox) before a public launch, and keep their attribution.
- Pushes to `main` deploy to Vercel automatically.
