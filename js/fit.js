// Fit for your group: a 0 to 100 score with the reasons behind it.
// Each level in the group (first time, intermediate, expert) scores the resort on what matters to it,
// on top of what matters to everyone (snow, transfer, children, season). The group score leans
// towards whoever the place suits least: half the lowest score plus half the average.
// A feeder town takes its best resort, minus the daily trip, and first-timers lose the
// walk-to-the-slopes points, because beginners there always travel first.

import { reachable, ridesHere, bikeLinks } from "./data.js";

export const LEVELS = {
  first: "first-timers",
  intermediate: "intermediates",
  expert: "experts",
};

export const BIKE_LEVELS = {
  first: "beginners",
  intermediate: "intermediate riders",
  expert: "experts",
};

const SNOW_POINTS = { good: 15, fair: 7, poor: 0 };
const ENGLISH = {
  many: [15, "Several English-speaking ski schools"],
  some: [8, "Some English-speaking instructors"],
  few: [0, "Mostly French-speaking ski schools"],
};
const EXPERT_POINTS = { awesome: 35, good: 25, fair: 12, little: 0 };

// Is the resort open for the whole stay, part of it, or not at all?
export function seasonState(resort, arrive, leave) {
  const { open, close } = resort.season;
  if (leave <= open || arrive >= close) return "closed";
  if (arrive < open || leave > close) return "partial";
  return "open";
}

// Estimated km of each piste colour: the mapped mix applied to the resort's published total.
export function runKm(r) {
  if (!r.runShare) return null;
  const km = {};
  for (const [c, pct] of Object.entries(r.runShare)) km[c] = Math.round((r.skiArea.pisteKm * pct) / 100);
  return km;
}

const part = (points, max, ok, text) => ({ points, max, ok, text });

// What matters to everyone in the group.
function sharedParts(r, ctx) {
  const parts = [];
  const snow = ctx.snowOf(r);
  parts.push(part(SNOW_POINTS[snow], 15, snow === "good",
    { good: "Snow-sure for your months", fair: "Snow usually fine for your months", poor: "Snow risky for your months" }[snow]));
  const kids = ctx.childAges;
  if (kids.length) {
    parts.push(part(r.family ? 10 : 0, 10, r.family, r.family ? "Family-friendly resort" : "Better for adults"));
    const problems = [];
    if (kids.some((a) => a < 3) && !r.school.crecheFromMonths) problems.push("no crèche listed for under-3s");
    if (kids.some((a) => a >= 3 && a < r.school.skiFrom)) problems.push(`ski school from age ${r.school.skiFrom}`);
    const ages = kids.join(" and ");
    parts.push(part(problems.length ? 0 : 10, 10, !problems.length,
      problems.length ? `For ages ${ages}: ${problems.join(", ")}` : `Suits children aged ${ages}`));
  }
  if (ctx.dates) {
    const s = seasonState(r, ctx.dates.arrive, ctx.dates.leave);
    if (s === "partial") parts.push(part(-10, 0, false, "Opens or closes during your week"));
    if (s === "closed") parts.push(part(-100, 0, false, "Closed during your week"));
  }
  return parts;
}

// What matters to one level. `fromTown` drops the walk-to-the-slopes points.
function levelParts(level, r, fromTown) {
  const parts = [];
  const km = runKm(r);
  if (level === "first") {
    if (!fromTown) parts.push(part(r.easyStart ? 25 : 0, 25, Boolean(r.easyStart), r.easyStart ? "Walk to the beginner slopes" : "Lift or bus to the beginner slopes"));
    parts.push(part(r.levels.includes("beginner") ? 10 : 0, 10, r.levels.includes("beginner"), r.levels.includes("beginner") ? "Good beginner terrain" : "Little beginner terrain"));
    const [pts, text] = ENGLISH[r.school.english];
    parts.push(part(pts, 15, pts > 0, text));
    if (r.vibes.includes("skiin")) parts.push(part(5, 5, true, "Ski-in ski-out village"));
  }
  if (level === "intermediate") {
    const cruise = km ? km.blue + km.red : r.skiArea.pisteKm * 0.7;
    const pts = cruise >= 300 ? 30 : cruise >= 150 ? 22 : cruise >= 80 ? 15 : cruise >= 40 ? 8 : 3;
    parts.push(part(pts, 30, pts >= 15, `About ${Math.round(cruise)} km of blue and red runs`));
    parts.push(part(r.levels.includes("intermediate") ? 10 : 0, 10, r.levels.includes("intermediate"),
      r.levels.includes("intermediate") ? "Plenty of terrain for intermediates" : "Little intermediate terrain"));
    const top = r.topAltitude >= 2700 ? 10 : r.topAltitude >= 2300 ? 6 : 2;
    parts.push(part(top, 10, top >= 6, `Skiing up to ${r.topAltitude} m`));
  }
  if (level === "expert") {
    const e = r.expert;
    parts.push(part(EXPERT_POINTS[e.level], 35, EXPERT_POINTS[e.level] >= 25, `Expert terrain: ${e.note}`));
    const black = km ? km.black : null;
    const pts = black == null ? 2 : black >= 60 ? 20 : black >= 30 ? 14 : black >= 15 ? 8 : 2;
    parts.push(part(pts, 20, pts >= 14, black == null ? "No run mix on record" : `About ${black} km of black runs`));
    const top = r.topAltitude >= 3200 ? 15 : r.topAltitude >= 2800 ? 10 : r.topAltitude >= 2400 ? 5 : 0;
    parts.push(part(top, 15, top >= 10, `Skiing up to ${r.topAltitude} m`));
  }
  return parts;
}

function transferPart(place, ctx) {
  if (ctx.travel(place).none) return part(0, 0, true, null); // no airport picked yet
  const min = ctx.travel(place).min;
  if (min <= 90) return part(10, 10, true, "Under 1h30 from the airport");
  if (min <= 150) return part(5, 10, true, "Under 2h30 from the airport");
  return part(0, 10, false, "Over 2h30 from the airport");
}

const pct = (parts) => {
  const max = parts.reduce((s, p) => s + p.max, 0);
  const got = parts.reduce((s, p) => s + p.points, 0);
  return Math.max(0, Math.min(100, Math.round((100 * got) / max)));
};

// Score one resort for the group. extra: parts that apply to everyone (transfer, the daily trip).
function scoreResort(r, ctx, extra, fromTown) {
  const shared = [...extra, ...sharedParts(r, ctx)];
  const levels = ctx.levels.map((level) => {
    const own = levelParts(level, r, fromTown);
    return { level, score: pct([...shared, ...own]), reasons: own.filter((p) => p.text) };
  });
  const scores = levels.map((x) => x.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    score: Math.round((Math.min(...scores) + mean) / 2),
    levels,
    shared: shared.filter((p) => p.text),
    closed: shared.some((p) => p.points <= -100),
  };
}

// ctx: { model, levels: ["first", ...], childAges, snowOf(resort), travel(place), dates: { arrive, leave } | null }
export function fitScore(place, ctx) {
  if (place.type === "resort") return { ...scoreResort(place, ctx, [transferPart(place, ctx)], false), resort: place };
  // Feeder town: best resort it reaches, minus the daily trip.
  let best = null;
  for (const { place: r, link } of reachable(place, ctx.model.byId)) {
    const quickLift = link.by.includes("lift") && link.min <= 15;
    const carOnly = !link.by.some((m) => m !== "car");
    const hop = quickLift ? 0 : carOnly ? -10 : -5;
    const how = carOnly ? "by car" : link.by.includes("lift") ? "by lift" : "by bus";
    const extra = [part(hop, 0, hop === 0, `Stay here, ski ${r.name}: ${link.min} min ${how}`), transferPart(place, ctx)];
    const s = scoreResort(r, ctx, extra, true);
    if (!best || s.score > best.score) best = { ...s, resort: r };
  }
  return best;
}

/* ---------- summer: mountain biking ---------- */

const BIKE_POINTS = { awesome: 25, good: 18, fair: 8, none: 0 };
const BIKE_WORD = { awesome: "Awesome", good: "Good", fair: "Fair", none: "No" };

// What matters to everyone riding.
function bikeShared(r, ctx) {
  const b = r.bike;
  const parts = [];
  const park = b.styles.includes("flow") || b.styles.includes("downhill");
  parts.push(part(BIKE_POINTS[b.level], 25, b.level === "awesome" || b.level === "good",
    `${park ? "Bike park" : "Trail riding"} rated ${BIKE_WORD[b.level]}`));
  const kids = ctx.childAges;
  if (kids.length) {
    parts.push(part(r.family ? 10 : 0, 10, r.family, r.family ? "Family-friendly place" : "Better for adults"));
    const ok = b.styles.includes("kids") || kids.every((a) => a >= 10);
    const ages = kids.join(" and ");
    parts.push(part(ok ? 10 : 0, 10, ok, ok ? `Suits children aged ${ages}` : `For ages ${ages}: few trails and coaching for children`));
  }
  if (ctx.dates) {
    const s = seasonState({ season: b.season }, ctx.dates.arrive, ctx.dates.leave);
    if (s === "partial") parts.push(part(-10, 0, false, "Lifts open or close during your week"));
    if (s === "closed") parts.push(part(-100, 0, false, "Closed during your week"));
  }
  return parts;
}

function bikeLevelParts(level, r) {
  const b = r.bike;
  const has = (...k) => k.some((x) => b.styles.includes(x));
  const parts = [];
  if (level === "first") {
    const easy = b.suits.includes("beginner");
    parts.push(part(easy ? 30 : 0, 30, easy, easy ? "Easy trails for beginners" : "Little for beginners"));
    parts.push(part(has("flow") ? 15 : 0, 15, has("flow"), has("flow") ? "Flow trails: smooth and forgiving" : "No flow trails"));
    parts.push(part(has("ebike") ? 5 : 0, 5, has("ebike"), has("ebike") ? "E-bikes make the climbs easy" : null));
  }
  if (level === "intermediate") {
    const ok = b.suits.includes("intermediate");
    parts.push(part(ok ? 30 : 0, 30, ok, ok ? "Plenty for intermediate riders" : "Little for intermediate riders"));
    parts.push(part(has("flow", "xc") ? 15 : 0, 15, has("flow", "xc"), has("flow", "xc") ? "Flow or cross-country routes" : "No flow or cross-country routes"));
    parts.push(part(has("enduro", "downhill") ? 10 : 0, 10, has("enduro", "downhill"), has("enduro", "downhill") ? "Enduro or downhill to grow into" : null));
  }
  if (level === "expert") {
    const ok = b.suits.includes("expert");
    parts.push(part(ok ? 30 : 0, 30, ok, ok ? "Steep, technical riding for experts" : "Little for experts"));
    parts.push(part(has("enduro", "downhill") ? 25 : 0, 25, has("enduro", "downhill"), has("enduro", "downhill") ? "Downhill or enduro trails" : "No downhill or enduro trails"));
    const big = b.level === "awesome" ? 10 : b.level === "good" ? 5 : 0;
    parts.push(part(big, 10, big >= 5, big ? "Big, varied riding" : null));
  }
  return parts;
}

function scoreBike(r, ctx, extra) {
  const shared = [...extra, ...bikeShared(r, ctx)];
  const levels = ctx.levels.map((level) => {
    const own = bikeLevelParts(level, r);
    return { level, score: pct([...shared, ...own]), reasons: own.filter((p) => p.text) };
  });
  const scores = levels.map((x) => x.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    score: Math.round((Math.min(...scores) + mean) / 2),
    levels,
    shared: shared.filter((p) => p.text),
    closed: shared.some((p) => p.points <= -100),
  };
}

// Summer fit. A place that rides at home scores itself; a feeder town takes the best bike park it reaches.
export function bikeFit(place, ctx) {
  if (ridesHere(place)) return { ...scoreBike(place, ctx, [transferPart(place, ctx)]), resort: place };
  let best = null;
  for (const { place: r, link } of bikeLinks(place, ctx.model.byId)) {
    const quickLift = link.by.includes("lift") && link.min <= 15;
    const carOnly = !link.by.some((m) => m !== "car");
    const hop = quickLift ? 0 : carOnly ? -10 : -5;
    const how = carOnly ? "by car" : link.by.includes("lift") ? "by lift" : "by bus";
    const extra = [part(hop, 0, hop === 0, `Stay here, ride ${r.name}: ${link.min} min ${how}`), transferPart(place, ctx)];
    const s = scoreBike(r, ctx, extra);
    if (!best || s.score > best.score) best = { ...s, resort: r };
  }
  return best;
}
