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
    if (l.type === "resort") l.snow = snowByMonth(l);
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

// Snow reliability by month, estimated from altitude.
// "Snow altitude" leans toward the top lift, because most skiing happens up there,
// but the village counts too: it decides whether you can ski back to the door.
// A resort's optional snowAdjust (metres) credits glaciers, cold bowls and the like,
// and an optional "snow" object in the data overrides any month outright.
export const MONTHS = [
  { key: "dec", label: "Dec", good: 2000, fair: 1500 },
  { key: "jan", label: "Jan", good: 1600, fair: 1150 },
  { key: "feb", label: "Feb", good: 1500, fair: 1100 },
  { key: "mar", label: "Mar", good: 1800, fair: 1350 },
  { key: "apr", label: "Apr", good: 2300, fair: 1900 },
];
export const SNOW_RANK = { good: 2, fair: 1, poor: 0 };

export function snowAltitude(l) {
  return Math.round(0.35 * l.altitude + 0.65 * l.topAltitude + (l.snowAdjust || 0));
}

function snowByMonth(l) {
  const alt = snowAltitude(l);
  const out = {};
  for (const m of MONTHS) out[m.key] = alt >= m.good ? "good" : alt >= m.fair ? "fair" : "poor";
  return { ...out, ...(l.snow || {}) };
}

// Rating for a trip across several months: the weakest month decides.
export function snowFor(l, months, byId) {
  if (l.type === "resort") {
    return months.reduce((worst, m) => (SNOW_RANK[l.snow[m]] < SNOW_RANK[worst] ? l.snow[m] : worst), "good");
  }
  // A feeder town is as snow-sure as the best resort it reaches.
  return reachable(l, byId).reduce((best, r) => {
    const s = snowFor(r.place, months, byId);
    return SNOW_RANK[s] > SNOW_RANK[best] ? s : best;
  }, "poor");
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
