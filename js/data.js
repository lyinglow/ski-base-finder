// Loads data/index.json and every live country file, then adds derived fields.
// The UI only reads from the model this returns, so new countries need no code changes.

export async function loadData() {
  const index = await getJSON("data/index.json");
  const live = index.countries.filter((c) => c.status === "live");
  const files = await Promise.all(live.map((c) => getJSON("data/" + c.file)));

  const locations = files.flatMap((f, i) =>
    f.locations.map((l) => ({ ...l, country: live[i].code }))
  );
  const byId = new Map(locations.map((l) => [l.id, l]));

  // Reverse links: for each resort, the places that list it as reachable.
  for (const l of locations) l.reachedFrom = [];
  for (const l of locations) {
    for (const k of l.links || []) {
      const target = byId.get(k.to);
      if (target) target.reachedFrom.push({ ...k, from: l.id });
    }
  }

  for (const l of locations) {
    l.skiSize = l.skiArea ? skiSize(l.skiArea.pisteKm) : null;
    // Car-free: a base needs a rail link plus bus, train or lift to a resort.
    // A resort counts unless its transfer note starts with "Car".
    const easyLinks = (l.links || []).some((k) => k.by.some((m) => m !== "car"));
    l.carFree = l.type === "base" ? Boolean(l.rail) && easyLinks : !/^car/i.test(l.transfer || "");
  }

  return {
    index,
    countries: live,
    notes: files.map((f) => f.notes).filter(Boolean),
    origin: index.origins.find((o) => o.id === index.defaultOrigin),
    priceBands: index.priceBands,
    locations,
    byId,
  };
}

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

export function skiSize(km) {
  if (km >= 400) return "huge";
  if (km >= 200) return "large";
  if (km >= 60) return "medium";
  return "small";
}

// Places worth staying in instead of this resort: they link to it and
// are cheaper, or are feeder towns at the same price with a quick hop.
export function cheaperStays(resort, byId) {
  return resort.reachedFrom
    .map((k) => ({ link: k, place: byId.get(k.from) }))
    .filter(({ place, link }) => place.price < resort.price ||
      (place.type === "base" && place.price === resort.price && link.min <= 20))
    .sort((a, b) => a.place.price - b.place.price || a.link.min - b.link.min);
}

// Resorts reachable from a place, nearest first.
export function reachable(place, byId) {
  return (place.links || [])
    .map((k) => ({ link: k, place: byId.get(k.to) }))
    .filter((x) => x.place)
    .sort((a, b) => a.link.min - b.link.min);
}
