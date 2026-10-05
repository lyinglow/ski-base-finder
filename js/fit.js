// Beginner and family fit: a 0 to 100 score with the reasons behind it.
// A resort is scored on its own merits. A feeder town takes its best resort, minus the daily trip,
// and loses the walk-to-the-slopes points, because beginners there always travel first.

import { reachable } from "./data.js";

const SNOW_POINTS = { good: 15, fair: 7, poor: 0 };
const ENGLISH = {
  many: [15, "Several English-speaking ski schools"],
  some: [8, "Some English-speaking instructors"],
  few: [0, "Mostly French-speaking ski schools"],
};

// Is the resort open for the whole stay, part of it, or not at all?
export function seasonState(resort, arrive, leave) {
  const { open, close } = resort.season;
  if (leave <= open || arrive >= close) return "closed";
  if (arrive < open || leave > close) return "partial";
  return "open";
}

// ctx: { model, childAges, snowOf(resort), travel(place), dates: { arrive, leave } | null }
function resortParts(r, ctx) {
  const parts = [];
  const add = (points, ok, text) => parts.push({ points, ok, text });

  add(r.easyStart ? 25 : 0, Boolean(r.easyStart), r.easyStart ? "Walk to the beginner slopes" : "Lift or bus to the beginner slopes");
  if (r.levels.includes("beginner")) add(10, true, "Good beginner terrain");
  else add(0, false, "Little beginner terrain");
  add(r.family ? 10 : 0, r.family, r.family ? "Family-friendly resort" : "Better for adults");

  const [pts, text] = ENGLISH[r.school.english];
  add(pts, pts > 0, text);

  const kids = ctx.childAges;
  if (!kids.length) add(10, true, null); // nothing to check
  else {
    const problems = [];
    if (kids.some((a) => a < 3) && !r.school.crecheFromMonths) problems.push("no crèche listed for under-3s");
    if (kids.some((a) => a >= 3 && a < r.school.skiFrom)) problems.push(`ski school from age ${r.school.skiFrom}`);
    const ages = kids.join(" and ");
    add(problems.length ? 0 : 10, !problems.length,
      problems.length ? `For ages ${ages}: ${problems.join(", ")}` : `Suits children aged ${ages}`);
  }

  const snow = ctx.snowOf(r);
  add(SNOW_POINTS[snow], snow === "good", { good: "Snow-sure for your months", fair: "Snow usually fine for your months", poor: "Snow risky for your months" }[snow]);
  if (r.vibes.includes("skiin")) add(5, true, "Ski-in ski-out village");

  if (ctx.dates) {
    const s = seasonState(r, ctx.dates.arrive, ctx.dates.leave);
    if (s === "partial") add(-10, false, "Opens or closes during your week");
    if (s === "closed") add(-100, false, "Closed during your week");
  }
  return parts;
}

function transferPart(place, ctx) {
  const min = ctx.travel(place).min;
  if (min <= 90) return { points: 10, ok: true, text: "Under 1h30 from the airport" };
  if (min <= 150) return { points: 5, ok: true, text: "Under 2h30 from the airport" };
  return { points: 0, ok: false, text: "Over 2h30 from the airport" };
}

const total = (parts) => Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.points, 0)));

export function fitScore(place, ctx) {
  if (place.type === "resort") {
    const parts = [...resortParts(place, ctx), transferPart(place, ctx)];
    return { score: total(parts), reasons: parts.filter((p) => p.text), closed: parts.some((p) => p.points <= -100) };
  }
  // Feeder town: best resort it reaches, without the walk points, minus the daily trip.
  let best = null;
  for (const { place: r, link } of reachable(place, ctx.model.byId)) {
    const parts = resortParts(r, ctx).filter((p) => !/beginner slopes/.test(p.text || ""));
    const quickLift = link.by.includes("lift") && link.min <= 15;
    const carOnly = !link.by.some((m) => m !== "car");
    const hop = quickLift ? 0 : carOnly ? -10 : -5;
    parts.unshift({ points: hop, ok: hop === 0, text: `Stay here, ski ${r.name}: ${link.min} min ${carOnly ? "by car" : link.by.includes("lift") ? "by lift" : "by bus"}` });
    parts.push(transferPart(place, ctx));
    const s = total(parts);
    if (!best || s > best.score) best = { score: s, reasons: parts.filter((p) => p.text), closed: parts.some((p) => p.points <= -100), resort: r };
  }
  return best;
}
