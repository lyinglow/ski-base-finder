// Whole-trip cost for staying in one place and skiing one resort.
// Every rate comes from "costs" in data/index.json, so prices can be updated without touching code.

import { reachable, bikeLinks } from "./data.js";

// trip: { origin: airport id, nights, skiDays, adults, childAges: [7, 10], transport: "shuttle" | "car",
//         lessons: "none" | "kids" | "all", hire: true | false, months: ["jan", ...], week: "2027-02-13" | null }
// stay: where you sleep. ski: the resort you ski (same as stay when staying in a resort).
export function tripCost(stay, ski, trip, model) {
  const summer = trip.season === "summer";
  const c = summer ? { ...model.index.costs, ...model.index.bike.costs } : model.index.costs;
  const kids = trip.childAges;
  const people = trip.adults + kids.length;
  const fromAirport = stay.fromOrigin[trip.origin] || { km: 0 }; // no airport picked: no transfer counted

  // How you get from bed to lifts. A lift or same place costs nothing.
  const link = stay.id === ski.id ? null : (stay.links || []).find((k) => k.to === ski.id);
  const hopBy = link?.by || [];
  const needsCar = link && !hopBy.some((m) => m !== "car");
  const usesCar = trip.transport === "car" || needsCar;
  const cars = Math.max(1, Math.ceil(people / c.car.seats));

  // Accommodation: per person per night, scaled for the chosen week, or the chosen months on average.
  const weeks = summer ? model.index.bike.weeks : model.index.weeks;
  const factors = summer ? model.index.bike.seasonFactor : c.seasonFactor;
  const week = trip.week && weeks.find((w) => w.start === trip.week);
  const season = week ? week.factor : average(trip.months.map((m) => factors[m] ?? 1));
  const perNight = stay.stayPerPerson ?? model.priceBands[stay.price].perPerson;
  const accommodation = perNight * season * people * trip.nights;

  // Lift passes: the 6-day price spread per day. Under-5s ski free; children and teens pay a share.
  const passDay = summer ? ski.bike.pass : ski.skiArea.pass6 / 6;
  const passShare = (age) => (age < c.passFreeUnder ? 0 : age <= c.childPassTo ? c.childPass : c.teenPass);
  const liftPasses = passDay * trip.skiDays * (trip.adults + kids.reduce((s, a) => s + passShare(a), 0));

  // Lessons and hire are bought where you ski, and cost more in pricier resorts and dearer countries.
  const countryFactor = (place) => model.countries.find((k) => k.code === place.country)?.costFactor ?? 1;
  const local = (c.resortPriceFactor[ski.price] ?? 1) * countryFactor(ski);
  const dayShare = trip.skiDays / 6;
  let lessons = 0;
  let childcare = 0;
  for (const age of kids) {
    if (summer) {
      if (trip.lessons !== "none" && age >= c.lessons.minAge) lessons += c.lessons.child6 * dayShare * local;
    } else if (age < 3) childcare += c.childcare6 * dayShare * local; // too young to ski
    else if (trip.lessons !== "none") lessons += (age < 5 ? c.lessons.kindergarten6 : c.lessons.child6) * dayShare * local;
  }
  if (trip.lessons === "all") lessons += trip.adults * c.lessons.adult6 * dayShare * local;
  const hireRate = (age) => (age < (summer ? 6 : 3) ? 0 : age < 5 ? c.hirePerDay.small : age <= c.childPassTo ? c.hirePerDay.child : c.hirePerDay.teen);
  const hire = trip.hire
    ? trip.skiDays * local * (trip.adults * c.hirePerDay.adult + kids.reduce((s, a) => s + hireRate(a), 0))
    : 0;

  // Airport there and back.
  let airport;
  if (!trip.origin) {
    airport = 0;
  } else if (usesCar) {
    const days = trip.nights + 1;
    airport = cars * (days * c.car.hirePerDay + 2 * fromAirport.km * (c.car.fuelPerKm + c.car.tollPerKm));
  } else {
    airport = people * 2 * (c.shuttle.base + c.shuttle.perKm * fromAirport.km);
  }

  // Daily trips to the slopes.
  let daily = 0;
  let dailyHow = summer ? "Ride from the door" : "On the slopes";
  if (link && hopBy.includes("lift")) {
    dailyHow = "Lift from the door";
  } else if (link && !usesCar && hopBy.includes("bus")) {
    const free = link.min <= c.bus.freeWithinMin;
    daily = free ? 0 : people * c.bus.farePerDay * trip.skiDays * countryFactor(stay);
    dailyHow = free ? "Free ski bus" : "Bus";
  } else if (link) {
    const km = link.min * c.car.mountainKmPerMin;
    daily = cars * trip.skiDays * (2 * km * c.car.fuelPerKm + c.car.slopeParking);
    dailyHow = "Drive and park";
  }

  const parts = { accommodation, liftPasses, lessons, hire, childcare, airport, daily };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, perPerson: total / Math.max(1, people), parts, dailyHow, needsCar: Boolean(needsCar), ski, week };
}

// The resort a place is costed against: itself, or a chosen or nearest resort it reaches.
export function skiTarget(place, model, preferred, season = "winter") {
  if (place.type === "resort") return place;
  if (season === "summer" && place.bike) return place; // a valley town that rides at home
  const options = (season === "summer" ? bikeLinks(place, model.byId) : reachable(place, model.byId)).map((r) => r.place);
  return options.find((r) => r.id === preferred) || options[0];
}

function average(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1;
}
