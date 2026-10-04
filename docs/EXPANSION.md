# Adding Switzerland and Italy

The app never names a country in code. It loads whatever `data/index.json` marks as live. So adding a country is a data job.

## Step 1: Switzerland

Close to Geneva and the natural next step.

1. **Make `data/ch.json`** in the same format as `fr.json`. Ids start with `ch-`.
2. **Resorts to start with**, grouped by area:
   - Portes du Soleil Swiss side: Champéry, Morgins, Les Crosets, Champoussin, Torgon
   - Vaud Alps: Villars, Leysin, Les Diablerets, Les Mosses
   - 4 Vallées: Verbier, Nendaz, Veysonnaz, Thyon, La Tzoumaz
   - Valais: Crans-Montana, Anzère, Grimentz-Zinal, Saas-Fee, Zermatt
   - Jura: La Dôle, Saint-Cergue
3. **Feeder towns**: Monthey, Aigle, Martigny, Le Châble, Sion, Sierre, Visp, Nyon.
   The Swiss story is strong here: valley towns with trains and gondolas straight up, like Le Châble to Verbier.
4. **Cross-border links.** Edit the French file too: Châtel links to Morgins, Avoriaz to Les Crosets. The app shows them both ways.
5. **Price bands.** Switzerland costs more across the board. Keep one shared scale so a € in Italy and a € in Switzerland mean the same, and adjust the guide text in `index.json` if needed. Price is about where to stay, so a cheap Swiss town may still be €€.
6. Set `"status": "live"` for CH in `index.json`, run `npm run validate`, and check it on the map.

## Step 2: Italy

1. **Make `data/it.json`**, ids start with `it-`.
2. **Resorts**: Courmayeur, La Thuile, Pila, Cervinia, Valtournenche, Champoluc, Gressoney, Alagna.
3. **Feeder towns**: Aosta (cable car to Pila), Pré-Saint-Didier, Morgex, Châtillon.
4. **Cross-border links**: La Thuile and La Rosière share a ski area. Cervinia and Zermatt too.
5. Travel from Geneva goes through the Mont Blanc tunnel. Note the tunnel toll in `transfer`.

## Step 3: More airports

Italy is easier from Turin, central Switzerland from Zurich. The format already allows this.

1. Add the airport to `origins` in `index.json`: `{ "id": "TRN", "name": "Turin Airport", "coords": [7.6497, 45.2008] }`.
2. Add a `TRN` key to `fromOrigin` for places it serves.
3. In the app, add an origin picker next to "From Geneva Airport" that sets the origin id. Everything else already reads the origin from one place (`travel()` in `js/app.js`).

Places without a time for the chosen origin should be hidden for that origin.

## Keeping the data fresh

- **One owner per country** who checks it before each season (October).
- **Update `updated`** in the country file when you check it.
- **Use pull requests** for data changes. A JSON diff is easy to review, and the validator catches broken links.
- **Sources to check against**: resort websites for piste km and lift altitudes, Google Maps or ViaMichelin for winter drive times, sbb.ch and sncf-connect.com for trains, and booking sites in a fixed week of February for price bands.

## When it outgrows JSON

JSON files are right up to a few hundred places. Move on when you need:

- **Live prices or snow** from an outside service. Add a small server or a scheduled script that writes the same JSON, so the front end does not change.
- **Many editors.** Put the records in a spreadsheet or a simple CMS and export to this JSON format in a build step.

## Going to production

The free tile sources are fine for a prototype. For public launch:

- **Swap to a paid tile provider** in `js/map.js`. MapTiler and Mapbox both give satellite, terrain and a generous free tier. With Mapbox, the Mapbox GL JS library works with the same code.
- **Keep the attribution** the provider asks for.
- **Host on any static host** with a custom domain.
