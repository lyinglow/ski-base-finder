// Whole-trip cost for staying in one place and skiing one resort.
// Every rate comes from "costs" in data/index.json, so prices can be updated without touching code.

import { reachable } from "./data.js";

// trip: { nights, skiDays, adults, children, transport: "shuttle" | "car", months: ["jan", ...] }
// stay: where you sleep. ski: the resort you ski (same as stay when staying in a resort).
export function tripCost(stay, ski, trip, model) {
  const c = model.index.costs;
  const people = trip.adults + trip.children;
  const fromAirport = stay.fromOrigin[model.origin.id];

  // How you get from bed to lifts. A lift or same place costs nothing.
  const link = stay.id === ski.id ? null : (stay.links || []).find((k) => k.to === ski.id);
  const hopBy = link?.by || [];
  const needsCar = link && !hopBy.some((m) => m !== "car");
  const usesCar = trip.transport === "car" || needsCar;
  const cars = Math.max(1, Math.ceil(people / c.car.seats));

  // Accommodation: per person per night, scaled for the season.
  const season = average(trip.months.map((m) => c.seasonFactor[m] ?? 1));
  const perNight = stay.stayPerPerson ?? model.priceBands[stay.price].perPerson;
  const accommodation = perNight * season * people * trip.nights;

  // Lift passes: the 6-day price spread per day; children pay a share.
  const passDay = ski.skiArea.pass6 / 6;
  const liftPasses = passDay * trip.skiDays * (trip.adults + trip.children * c.childPass);

  // Airport there and back.
  let airport;
  if (usesCar) {
    const days = trip.nights + 1;
    airport = cars * (days * c.car.hirePerDay + 2 * fromAirport.km * (c.car.fuelPerKm + c.car.tollPerKm));
  } else {
    airport = people * 2 * (c.shuttle.base + c.shuttle.perKm * fromAirport.km);
  }

  // Daily trips to the slopes.
  let daily = 0;
  let dailyHow = "On the slopes";
  if (link && hopBy.includes("lift")) {
    dailyHow = "Lift from the door";
  } else if (link && !usesCar && hopBy.includes("bus")) {
    const free = link.min <= c.bus.freeWithinMin;
    daily = free ? 0 : people * c.bus.farePerDay * trip.skiDays;
    dailyHow = free ? "Free ski bus" : "Bus";
  } else if (link) {
    const km = link.min * c.car.mountainKmPerMin;
    daily = cars * trip.skiDays * (2 * km * c.car.fuelPerKm + c.car.slopeParking);
    dailyHow = "Drive and park";
  }

  const parts = { accommodation, liftPasses, airport, daily };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, perPerson: total / Math.max(1, people), parts, dailyHow, needsCar: Boolean(needsCar), ski };
}

// The resort a place is costed against: itself, or a chosen or nearest resort it reaches.
export function skiTarget(place, model, preferred) {
  if (place.type === "resort") return place;
  const options = reachable(place, model.byId).map((r) => r.place);
  return options.find((r) => r.id === preferred) || options[0];
}

function average(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1;
}
