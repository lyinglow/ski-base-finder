// Checks every country file listed in data/index.json.
// Run: node scripts/validate.mjs
import { readFileSync, existsSync } from "node:fs";

const dir = new URL("../data/", import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

const index = read("index.json");
const origins = new Set(index.origins.map((o) => o.id));
const errors = [];
const all = new Map();

const SIZES = ["small", "medium", "large"];
const LEVELS = ["beginner", "intermediate", "expert"];
const MODES = ["car", "bus", "train", "lift"];

for (const c of index.countries) {
  if (c.status !== "live") continue;
  if (!existsSync(new URL(c.file, dir))) {
    errors.push(`${c.code}: missing ${c.file}`);
    continue;
  }
  const data = read(c.file);
  const prefix = c.code.toLowerCase() + "-";
  for (const l of data.locations) {
    const at = `${c.file} ${l.id}`;
    const need = (cond, msg) => cond || errors.push(`${at}: ${msg}`);
    need(l.id?.startsWith(prefix), `id must start with "${prefix}"`);
    need(!all.has(l.id), "duplicate id");
    need(["resort", "base"].includes(l.type), "type must be resort or base");
    need(l.name, "name missing");
    need(Array.isArray(l.coords) && l.coords.length === 2 &&
      l.coords[0] > -10 && l.coords[0] < 20 && l.coords[1] > 40 && l.coords[1] < 50,
      "coords must be [lng, lat] in the Alps region");
    need(Number.isFinite(l.altitude), "altitude missing");
    need([1, 2, 3].includes(l.price), "price must be 1, 2 or 3");
    need(SIZES.includes(l.townSize), "townSize must be small, medium or large");
    need(typeof l.family === "boolean", "family must be true or false");
    need(Array.isArray(l.vibes) && l.vibes.length > 0 && l.vibes.every((v) => v in (index.vibes || {})),
      `vibes must list one or more of: ${Object.keys(index.vibes || {}).join(", ")}`);
    need(l.character, "character missing");
    for (const [area, months] of Object.entries(l.snowYears || {})) {
      need(["slopes", "village", "town"].includes(area) &&
        Object.values(months).every((v) => Array.isArray(v) && v[0] >= 0 && v[0] <= v[1]),
        `snowYears.${area} must hold [winters with snow, winters] per month`);
    }
    const fromKeys = Object.keys(l.fromOrigin || {});
    need(fromKeys.length > 0, "fromOrigin missing");
    for (const k of fromKeys) {
      need(origins.has(k), `unknown origin ${k}`);
      need(l.fromOrigin[k].km > 0 && l.fromOrigin[k].min > 0, `fromOrigin.${k} needs km and min`);
    }
    if (l.type === "resort") {
      need(l.topAltitude >= l.altitude, "topAltitude must be at or above altitude");
      need(l.skiArea?.name && l.skiArea.pisteKm > 0, "skiArea needs name and pisteKm");
      need(l.levels?.length && l.levels.every((v) => LEVELS.includes(v)), "levels invalid");
      need(l.park && l.park.level in (index.parkLevels || {}) && typeof l.park.note === "string" && l.park.note.length > 0,
        `park must have a level (${Object.keys(index.parkLevels || {}).join(", ")}) and a note`);
      need(l.expert && l.expert.level in (index.expertLevels || {}) && typeof l.expert.note === "string" && l.expert.note.length > 0,
        `expert must have a level (${Object.keys(index.expertLevels || {}).join(", ")}) and a note`);
      need(!l.runShare || ["green", "blue", "red", "black"].reduce((s, c) => s + (l.runShare[c] || 0), 0) === 100,
        "runShare must add up to 100");
      need(!l.park?.features || l.park.features.every((f) => f in (index.parkFeatures || {})),
        `park.features must list only: ${Object.keys(index.parkFeatures || {}).join(", ")}`);
      need(/^\d{4}-\d{2}-\d{2}$/.test(l.season?.open) && /^\d{4}-\d{2}-\d{2}$/.test(l.season?.close) && l.season.open < l.season.close,
        "season needs open and close dates (YYYY-MM-DD), open first");
      need(["many", "some", "few"].includes(l.school?.english) && l.school.skiFrom >= 2 && l.school.skiFrom <= 6,
        "school needs english (many, some, few) and skiFrom age");
      need(l.easyStart === undefined || (typeof l.easyStart === "string" && l.easyStart.length > 0),
        "easyStart must be a short note");
      need(l.snowAdjust === undefined || (Number.isFinite(l.snowAdjust) && Math.abs(l.snowAdjust) <= 500),
        "snowAdjust must be a number of metres, at most 500 either way");
      for (const [m, v] of Object.entries(l.snow || {})) {
        need(["dec", "jan", "feb", "mar", "apr"].includes(m) && ["good", "fair", "poor"].includes(v),
          `snow.${m} must be good, fair or poor for dec to apr`);
      }
    } else {
      need(l.links?.length > 0, "a base needs at least one link to a resort");
    }
    all.set(l.id, l);
  }
}

for (const l of all.values()) {
  for (const k of l.links || []) {
    const at = `${l.id} -> ${k.to}`;
    if (!all.has(k.to)) errors.push(`${at}: unknown location`);
    else if (all.get(k.to).type !== "resort") errors.push(`${at}: links must point to a resort`);
    if (!(k.min > 0)) errors.push(`${at}: min must be positive`);
    if (!k.by?.length || !k.by.every((m) => MODES.includes(m))) errors.push(`${at}: by must use ${MODES.join(", ")}`);
  }
}

// Summer riding: data/bike.json holds each resort's bike rating plus the valley towns with no ski area.
const bike = existsSync(new URL("bike.json", dir)) ? read("bike.json") : null;
if (bike) {
  const levels = Object.keys(index.bike.levels);
  const styles = Object.keys(index.bike.styles);
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const check = (id, b) => {
    const at = `bike.json ${id}`;
    const need = (cond, msg) => cond || errors.push(`${at}: ${msg}`);
    need(levels.includes(b.level), `level must be one of ${levels.join(", ")}`);
    if (b.level === "none") return;
    need(Array.isArray(b.suits) && b.suits.length > 0 && b.suits.every((v) => LEVELS.includes(v)), "suits invalid");
    need(Array.isArray(b.styles) && b.styles.length > 0 && b.styles.every((v) => styles.includes(v)), `styles must use ${styles.join(", ")}`);
    need(Number.isFinite(b.pass) && b.pass >= 0 && b.pass <= 100, "pass must be a day price in euros, 0 for none");
    need(date.test(b.season?.open) && date.test(b.season?.close) && b.season.open < b.season.close, "season needs open and close dates");
    need(typeof b.note === "string" && b.note.length > 0 && !/—/.test(b.note), "note needed, with no long dashes");
  };
  for (const [id, b] of Object.entries(bike.places)) {
    if (!all.has(id)) errors.push(`bike.json ${id}: unknown place`);
    else check(id, b);
  }
  for (const [id, l] of all) {
    if (l.type === "resort" && !bike.places[id]) errors.push(`bike.json: resort ${id} has no bike entry (use level "none")`);
  }
  for (const t of bike.towns) {
    const at = `bike.json town ${t.id}`;
    const need = (cond, msg) => cond || errors.push(`${at}: ${msg}`);
    need(!all.has(t.id), "duplicate id");
    need(t.summerOnly === true && t.type === "base" && t.bike && t.bike.level !== "none", "summer town needs summerOnly, type base and bike data");
    need(Array.isArray(t.coords) && t.coords.length === 2, "coords missing");
    need([1, 2, 3].includes(t.price) && t.vibes?.every((v) => v in index.vibes) && t.character, "price, vibes and character needed");
    need(Object.keys(t.fromOrigin || {}).length > 0 && Object.keys(t.fromOrigin).every((k) => origins.has(k)), "fromOrigin needs known airports");
    need(index.countries.some((c) => c.code === t.country && c.status === "live"), "country must be live");
    if (t.bike) check(t.id, t.bike);
    all.set(t.id, t);
  }
  for (const [id, b] of Object.entries(bike.places)) {
    const l = all.get(id);
    if (l?.type === "base") {
      if (b.level === "none") errors.push(`bike.json ${id}: a feeder town with its own riding needs a real level`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
const counts = [...all.values()].reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {});
const towns = bike ? bike.towns.length : 0;
console.log(`OK: ${counts.resort} resorts, ${counts.base} bases${towns ? ` (${towns} summer valley towns)` : ""}.`);
