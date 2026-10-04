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
    need(l.character, "character missing");
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

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
const counts = [...all.values()].reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {});
console.log(`OK: ${counts.resort} resorts, ${counts.base} bases.`);
