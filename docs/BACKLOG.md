# Backlog

Things we have talked about and not yet done. Newest thinking first within each group. Tick them off as they ship.

## Decide first

- [x] **Name: Base Finder** (for now, owner's choice). The `.com` and `.net` are taken (registered 2000). `basefinder.app`, `.io`, `.co`, `.co.uk` and `.ski` looked unregistered, so register one and point the site at it. Other things use the name (Septentrio survey software, a TradingView indicator, Clash of Clans and Minecraft tools), so keep the sport in the page title. Do a trademark search (UK IPO, EUIPO, USPTO; classes 39 and 42) before spending on branding. Not yet moved: the web address is still `ski-base-finder.vercel.app`.
- [ ] Register a domain and move the site to it, with the old address forwarding.

## Fixes from the health check

- [ ] Add a favicon (`/favicon.ico` is a 404).
- [ ] Make a 1200 by 630 link preview image (3D map with the name) and add `og:image` and the Twitter card tags. This fixes the grey box in link previews. Do it after the name.
- [ ] Add `robots.txt` and `sitemap.xml`.
- [ ] Add a canonical link and `theme-color` to `index.html`.
- [ ] Add security headers with a `vercel.json`: Content Security Policy, `X-Content-Type-Options`, `X-Frame-Options`, referrer policy.
- [ ] Host MapLibre ourselves, or add an integrity hash to the unpkg links.
- [ ] Run a full accessibility check (screen reader, keyboard, colour contrast on the green summer theme). Add a text description for the map.
- [ ] Check real-device speed on a mid-range phone.
- [ ] Switch satellite and map tiles to a paid provider before a public launch, and keep their credit.
- [ ] Check data source licences (OpenSkiMap, NASA GIBS, map tiles).

## Check the data

- [ ] Graubünden and Dolomites are a first pass: check 6-day pass prices, season dates, ski school details, link minutes and top lift heights against each resort's site. Least sure: Cavalese, Sesto, San Martino, Madonna di Campiglio prices; Chur to Davos and Samedan to Scuol link times; Pinzolo to Madonna; Zurich times to St. Moritz and Scuol.
- [ ] Summer bike ratings, styles, day pass prices and dates for all resorts are a first pass. Check against each park's own site and trail map.
- [ ] Review park and expert ratings, vibes and school notes added for Switzerland, Italy and Austria.
- [ ] Summer drive times are the winter ones. Some are longer than they need to be where passes are open in summer.
- [ ] Summer bus and lift links use winter times. Check summer timetables.
- [ ] Kronplatz and Cavalese have too few mapped runs for a run mix.
- [ ] Add German and Dutch school holiday weeks to the week picker.
- [ ] Ski school note: how far the meeting point is from the village centre (for example "5 min from the centre"). Needs the minutes per resort, from each school's site. An optional `school.fromCentreMin` field and a line in the Ski school section would carry it.

## Ideas for the place panel

Quick:
- [ ] Resort links: official site, snow report, piste map and bike park map.
- [ ] Monthly weather (temperature, rain, dry days in summer) from free historical data.
- [ ] Lift pass and hire links with your dates.
- [ ] A short note on each shortlisted place, shareable with a group.
- [ ] A one-page printable trip summary (cost, links, getting there, what to book).

Medium:
- [ ] "Getting there" step by step from your airport, with times, prices and the last train or bus.
- [ ] Group voting: share a shortlist and let friends rank it.
- [ ] Real piste and bike trail maps as a layer (summer stage 2).
- [ ] Car-free check: parking, bus cost, access to lifts without a car.

Bigger:
- [ ] Live snow depth and conditions.
- [ ] Live accommodation and package prices on the page (needs a partner feed).
- [ ] Accounts so plans sync across devices.

## Money

- [ ] Join affiliate programmes (Igluski, Booking.com, Skyscanner) and swap in tracked links. Say so in the footer.
- [ ] Package sites are web searches limited to each site, because their own address formats could not be confirmed. Replace with direct links when known.

## New regions

- [ ] Nordics and Japan. Needs: other currencies (yen, krone), a region picker above countries, snow ratings that do not depend on altitude (lean on the satellite record), wider map and lift data, local school holidays. Japan is far from the Alps, so give it its own view. Do it in stages, one country at a time.
- [ ] Spain (Pyrenees, Sierra Nevada) and other Alpine areas if wanted (Savoie is done; Slovenia, Germany and Liechtenstein are not).

## Maybe later

- [ ] Group nearby markers at wide zoom once the map passes about 500 places.
- [ ] Speed up the Winter and Summer switch (about 1 second, mostly map movement).
- [ ] Add more valley bike towns (Val di Sole, Lenzerheide area is done under Graubünden; consider Bellinzona, Lienz, Reschen).
