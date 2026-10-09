import { loadData, cheaperStays, reachable, MONTHS, SNOW_RANK, snowFor, snowAltitude, BIKE_RANK, bikeLinks, ridesHere, inSeason } from "./data.js";
import { tripCost, skiTarget } from "./cost.js";
import { fitScore, bikeFit, seasonState, runKm, LEVELS, BIKE_LEVELS } from "./fit.js";
import { createMap, setBasemap, setTerrain, setLinks, setLifts, setParks, setReach, setSnowLayer, HOME_VIEW } from "./map.js";
/* global maplibregl */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SNOW_LABEL = { good: "Snow-sure", fair: "Usually fine", poor: "Risky" };
const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate", expert: "Expert" };
const SIZE_LABEL = { small: "Small", medium: "Medium", large: "Large", huge: "Huge" };
const MODE_LABEL = { car: "car", bus: "bus", train: "train", lift: "lift" };
const MAX_COMPARE = Infinity; // compare as many places as you like

const state = {
  season: "winter", // "winter" for skiing, "summer" for mountain biking
  bikeMonths: new Set(["jul", "aug"]),
  bike: "any", // "any", "good" (good or better) or "awesome"
  bikeNeeds: new Set(), // riding styles that must be there, e.g. "flow"
  otherWeek: null, // the week picked in the other season, kept while you look at this one
  otherLessons: "none", // coaching is optional in summer; each season keeps its own choice
  show: "all",
  maxTime: 300,
  maxHop: 60,
  prices: new Set([1, 2, 3]),
  sizes: new Set(["small", "medium", "large", "huge"]),
  family: false,
  carFree: false,
  months: new Set(["jan", "feb", "mar"]),
  snowSure: false,
  currency: "GBP",
  gbpPerEur: 0.85,
  rateDate: null,
  origin: null, // no airport until a country or an airport is picked
  levels: ["intermediate"], // who's skiing: any of "first", "intermediate", "expert"
  park: "any", // "any", "good" (good or better) or "awesome"
  parkNeeds: new Set(), // park features that must be there, e.g. "beginner"
  snowLayer: false,
  snowMonth: null, // month shown on the snow layer; null follows the trip
  vibes: new Set(), // empty means any vibe
  countries: new Set(), // empty means every country
  trip: { nights: 7, skiDays: 6, adults: 2, childAges: [], transport: "shuttle", lessons: "all", hire: true, week: null },
  skiAt: {},
  sort: "fit",
  selected: null,
  related: new Set(),
  detailMin: false,
  tripOpen: false,
  saved: new Set(), // this season's shortlist; the other season's waits in otherSaved
  otherSaved: new Set(),
  pairIds: null, // a one-off comparison opened from a place panel (a resort and its cheaper stays); null means the shortlist
  get compare() { return [...this.saved]; }, // the comparison is always the shortlist
};

let model, map;
const markers = new Map();
let minuteMarkers = [];

init().catch((err) => {
  console.error(err);
  $("#results").innerHTML = `<li class="empty">Could not load the data. Serve this folder over http (for example <code>npm start</code>) and reload.</li>`;
});

async function init() {
  model = await loadData();
  $("#origin").innerHTML = `<option value="">Pick an airport</option>` + model.origins.map((o) =>
    `<option value="${o.id}">${esc(o.name)} (${o.id})</option>`).join("");
  $("#country-list").textContent = model.countries.map((c) => c.name).join(", ");
  setupCurrency();
  restorePlan(); // last visit, or a shared plan link
  renderDataNote();
  loadShortlist();

  map = createMap("map");
  map.addControl(savePlanControl(), "top-right");
  for (const o of model.origins) addOriginMarker(o);
  updateOriginMarkers();
  for (const l of model.locations) addMarker(l);
  map.on("zoom", updateLabelMode);
  // On a phone the place card covers half the map. Tapping empty map lowers it so the map shows; tap its title to bring it back.
  map.on("click", (e) => {
    if (!isNarrow() || !state.selected || state.detailMin || $("#detail").hidden) return;
    if (map.queryRenderedFeatures(e.point, { layers: ["lifts-line", "parks-fill", "parks-line"].filter((l) => map.getLayer(l)) }).length) return;
    state.detailMin = true;
    renderDetail(model.byId.get(state.selected));
  });
  for (const layer of ["lifts-line", "parks-fill", "parks-line"]) {
    map.on("click", layer, showLiftName);
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  }
  updateLabelMode();

  map.once("load", () => { if (!state.selected) airportView(); updateReach(lastVisible); updateSnowLayer(); });
  syncControls();
  bindControls();
  applySeasonUI();
  syncControls(); // again for controls that bindControls builds (vibes, weeks)
  applyFilters();

  // Reopen the place from a #link, or the one open last time.
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const reopen = model.byId.has(fromHash) ? fromHash : planReopen;
  if (reopen && model.byId.has(reopen)) map.once("load", () => select(reopen));
}

/* ---------- formatting ---------- */

const mins = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
const price = (p) => curSymbol().repeat(Number(p));
// With no airport picked there are no drive times yet, so every place passes through with an empty trip.
const NO_TRIP = { km: 0, min: 0, none: true };
const travel = (l) => (state.origin ? l.fromOrigin[state.origin] : NO_TRIP);
const originName = () => model.origins.find((o) => o.id === state.origin).name;
const typeLabel = (l) => (l.type === "resort" ? "Resort" : summer() ? "Valley town" : "Feeder town");
const modes = (by) => by.map((m) => MODE_LABEL[m]).join(" or ");

// How you get from a feeder town (or linked village) up to the resort, in plain words.
function accessShort(by) {
  if (by.includes("lift")) return "lift";
  if (by.includes("train")) return "train";
  if (by.includes("bus")) return "bus";
  return "car";
}

function accessText(link) {
  const order = ["lift", "train", "bus", "car"];
  const by = order.filter((m) => link.by.includes(m));
  if (by.includes("lift")) {
    const others = by.filter((m) => m !== "lift");
    return `${link.note || "Lift link"}${others.length ? `, or ${others.map((m) => MODE_LABEL[m]).join(" or ")}` : ""}`;
  }
  if (by.length === 1 && by[0] === "car") return "Car only. No bus or lift from here.";
  const words = by.map((m) => MODE_LABEL[m]).join(" or ");
  return words[0].toUpperCase() + words.slice(1) + (link.note ? `. ${link.note}` : "");
}

function levelDots(levels = []) {
  return `<span class="levels" title="${levels.map((v) => LEVEL_LABEL[v]).join(", ")}">${
    ["beginner", "intermediate", "expert"]
      .map((v) => `<i class="lv ${v}${levels.includes(v) ? "" : " off"}"></i>`)
      .join("")
  }</span>`;
}

/* ---------- snow ---------- */

const summer = () => state.season === "summer";
const monthList = () => (summer() ? model.bike.months : MONTHS);
const activeMonths = () => (summer() ? state.bikeMonths : state.months);
const tripMonths = () => monthList().map((m) => m.key).filter((k) => activeMonths().has(k));
const monthNames = () => {
  const ks = tripMonths();
  return ks.length === monthList().length ? (summer() ? "the whole summer" : "the whole season") : ks.map((k) => monthList().find((m) => m.key === k).label).join(", ");
};
const snowOf = (l) => snowFor(l, tripMonths(), model.byId);
const flake = (rating, title = SNOW_LABEL[rating]) =>
  `<i class="flake ${rating}" title="${esc(title)}" aria-label="${esc(title)}">❄</i>`;

// Snow for the best resort a feeder town reaches, for the chosen months.
function bestSnowFrom(place) {
  return reachable(place, model.byId).reduce((best, r) => {
    const a = SNOW_RANK[snowOf(r.place)], b = best ? SNOW_RANK[snowOf(best.place)] : -1;
    return a > b || (a === b && r.link.min < best.link.min) ? r : best;
  }, null);
}

const MONTH_LONG = { dec: "December", jan: "January", feb: "February", mar: "March", apr: "April" };

// Satellite record: winters (of the last 10) with snow lying, per month.
function snowHistory(l) {
  const h = l.snowYears;
  if (!h) return "";
  const rows = { slopes: "Upper slopes", village: "Village", town: "In town" };
  const cell = ([yes, n], key) => {
    const share = yes / n;
    const tone = share >= 0.8 ? "good" : share >= 0.5 ? "fair" : "poor";
    return `<td class="${tone}${state.months.has(key) ? " picked" : ""}" title="${yes} of ${n} winters">${yes}</td>`;
  };
  return `<table class="snow-hist">
      <thead><tr><th scope="col"><span class="sr-only">Where</span></th>${MONTHS.map((m) => `<th scope="col">${m.label}</th>`).join("")}</tr></thead>
      <tbody>${Object.entries(h).map(([area, months]) =>
        `<tr><th scope="row">${rows[area]}</th>${MONTHS.map((m) => cell(months[m.key], m.key)).join("")}</tr>`).join("")}</tbody>
    </table>
    <p class="snow-note">Winters out of the last 10 with snow lying in the middle of the month, from NASA satellite images. Snow-making is not included.</p>`;
}

function snowMonths(l) {
  return `<div class="snow-months" role="list">${MONTHS.map((m) => {
    const r = l.snow[m.key];
    return `<span role="listitem" class="sm ${r}${state.months.has(m.key) ? " picked" : ""}" title="${m.label}: ${SNOW_LABEL[r]}">
      <b>${m.label}</b>${flake(r)}</span>`;
  }).join("")}</div>`;
}

/* ---------- trip cost ---------- */

// All prices are held in euros; show them in the chosen currency.
const toShown = (eur) => (state.currency === "GBP" ? eur * state.gbpPerEur : eur);
const curSymbol = () => (state.currency === "GBP" ? "£" : "€");
const moneyExact = (n) => curSymbol() + Math.round(toShown(n)).toLocaleString("en-GB");
const money = (n) => curSymbol() + (Math.round(toShown(n) / 10) * 10).toLocaleString("en-GB");
const tripOf = () => ({ ...state.trip, months: tripMonths(), origin: state.origin, season: state.season });
const kidsText = (ages) => ages.length === 1 ? `1 child aged ${ages[0]}` : `${ages.length} children aged ${ages.slice(0, -1).join(", ")} and ${ages[ages.length - 1]}`;

// Fit score for the current trip. Season dates only count once a specific week is chosen.
function fitOf(l) {
  return (summer() ? bikeFit : fitScore)(l, {
    model,
    levels: state.levels,
    childAges: state.trip.childAges,
    snowOf,
    travel,
    dates: state.trip.week ? stayDates() : null,
  });
}
// stay in `place`, ski `ski` (defaults to itself, or the chosen or nearest resort for a town).
const costOf = (place, ski) => tripCost(place, ski || skiTarget(place, model, state.skiAt[place.id], state.season), tripOf(), model);

function costBreakdown(cost) {
  const p = cost.parts;
  const row = (label, v, note = "") => `<li><span>${label}${note ? `<small>${note}</small>` : ""}</span><b>${money(v)}</b></li>`;
  const t = state.trip;
  if (summer()) {
    const b = cost.ski.bike;
    const park = b.styles.includes("flow") || b.styles.includes("downhill");
    const coached = t.lessons !== "none" && (t.lessons === "all" || t.childAges.some((a) => a >= model.bike.costs.lessons.minAge));
    return `<ul class="cost-lines">
    ${row("Accommodation", p.accommodation, `${t.nights} nights`)}
    ${b.pass ? row(park ? "Bike lift passes" : "Uplift and shuttles", p.liftPasses, `${t.skiDays} days, ${esc(cost.ski.name)}${t.childAges.some((a) => a < model.bike.costs.passFreeUnder) ? ", under-6s free" : ""}`) : ""}
    ${coached ? row("Bike coaching", p.lessons, t.lessons === "all" ? "Group coaching for everyone, 6 half days" : "Group coaching for the kids, 6 half days") : ""}
    ${t.hire ? row("Bike hire", p.hire, "Mountain bike and helmet") : ""}
    ${row("Airport transfers", p.airport, state.trip.transport === "car" || cost.needsCar ? "Hire car, fuel and tolls" : "Shared shuttle, return")}
    ${row("Daily trips to the trails", p.daily, cost.dailyHow)}
  </ul>`;
  }
  return `<ul class="cost-lines">
    ${row("Accommodation", p.accommodation, `${t.nights} nights`)}
    ${row("Lift passes", p.liftPasses, `${t.skiDays} days, ${esc(cost.ski.skiArea.name)}${t.childAges.some((a) => a < 5) ? ", under-5s free" : ""}`)}
    ${t.lessons !== "none" && (t.lessons === "all" || t.childAges.some((a) => a >= 3)) ? row("Ski lessons", p.lessons, t.lessons === "all" ? "Group lessons for everyone, 6 half days" : "Group lessons for the kids, 6 half days") : ""}
    ${t.hire ? row("Ski hire", p.hire, "Skis, boots and helmets") : ""}
    ${p.childcare ? row("Childcare", p.childcare, "Crèche for under-3s") : ""}
    ${row("Airport transfers", p.airport, state.trip.transport === "car" || cost.needsCar ? "Hire car, fuel and tolls" : "Shared shuttle, return")}
    ${row("Daily trips to the slopes", p.daily, cost.dailyHow)}
  </ul>`;
}

function bestSkiFrom(place) {
  return reachable(place, model.byId).reduce(
    (best, r) => (!best || r.place.skiArea.pisteKm > best.place.skiArea.pisteKm ? r : best), null);
}

/* ---------- markers ---------- */

const originMarkers = new Map();

function addOriginMarker(o) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "marker origin";
  el.title = `Fly into ${o.name}`;
  el.innerHTML = `<span class="pin"></span><span class="tag">${esc(o.id)}</span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.selected) clearSelection();
    if (o.id === state.origin) airportView(1400);
    else setOrigin(o.id);
  });
  new maplibregl.Marker({ element: el, opacityWhenCovered: "0.7" }).setLngLat(o.coords).addTo(map);
  originMarkers.set(o.id, el);
}

function updateOriginMarkers() {
  for (const [id, el] of originMarkers) el.classList.toggle("is-current", id === state.origin);
}

function setOrigin(id) {
  state.origin = id || null;
  $("#origin").value = id || "";
  updateOriginMarkers();
  tripChanged();
  if (!state.selected) airportView(1400);
}

/* ---------- countries and the first screen ---------- */

// Choose which countries are on show. Picking one flies in from its main airport; the airport can
// then be changed on its own. Taking the last country away goes back to no airport, unless the
// airport was changed by hand.
function pickCountries(next, { added, removed } = {}) {
  state.countries = new Set(next);
  $$("#f-country button").forEach((b) => b.setAttribute("aria-pressed", state.countries.has(b.dataset.v)));
  const primary = (code) => model.countries.find((c) => c.code === code)?.primaryAirport;
  let airport = state.origin;
  if (added) airport = primary(added);
  else if (state.countries.size === 1) airport = primary([...state.countries][0]);
  else if (state.countries.size === 0 && state.origin === primary(removed)) airport = null;
  if (airport && !model.origins.some((o) => o.id === airport)) airport = state.origin;
  state.origin = airport;
  $("#origin").value = airport || "";
  updateOriginMarkers();
  if (state.selected) clearSelection();
  tripChanged();
  fullView(1400);
}

/* ---------- clear map ---------- */

// Back to a fresh map: every filter off, nothing selected, satellite in 3D, no snow layer,
// and a view that takes in every place from the airport.
// The airport goes too, so the first screen asks where you are skiing. The trip (nights, people)
// and the shortlist stay, because they are the user's plan.
function clearMap() {
  clearSelection();
  $("#compare").hidden = true;
  Object.assign(state, {
    show: "all", maxTime: 300, maxHop: 60, months: new Set(["jan", "feb", "mar"]),
    prices: new Set([1, 2, 3]), sizes: new Set(["small", "medium", "large", "huge"]), vibes: new Set(), countries: new Set(),
    family: false, carFree: false, snowSure: false, park: "any", parkNeeds: new Set(), levels: ["intermediate"],
    snowLayer: false, snowMonth: null, sort: "fit", origin: null,
    bike: "any", bikeNeeds: new Set(), bikeMonths: new Set(["jul", "aug"]),
  });
  state.trip.week = null; // a week pick overrides the months, so it goes too
  state.otherWeek = null;
  fillWeeks();
  updateOriginMarkers();
  syncControls();
  ["#f-time", "#f-hop"].forEach((id) => $(id).dispatchEvent(new Event("input"))); // refresh their labels
  renderCompareBar();
  updateSnowLayer();
  tripChanged();
  if ($("#style-topo").getAttribute("aria-pressed") === "true") $("#style-sat").click();
  if (!$("#toggle-3d").matches("[aria-pressed=true]")) $("#toggle-3d").click();
  setTab("filters");
  fullView(1400);
}

// Everything on show, seen from the airport: the airport near the bottom, every place above it.
// Fitted by trying views out without drawing, because a turned, tilted map does not fit a north-up box.
function fullView(duration = 0) {
  const origin = model.origins.find((o) => o.id === state.origin) || null;
  const places = lastVisible.length ? lastVisible : model.locations.filter((l) => travel(l));
  if (!places.length) return;
  const pts = [...(origin ? [origin.coords] : []), ...places.map((l) => l.coords)];
  const mid = places.reduce((a, l) => [a[0] + l.coords[0] / places.length, a[1] + l.coords[1] / places.length], [0, 0]);
  const from = origin ? origin.coords : [mid[0], mid[1] - 1]; // with no airport, look north-up
  const lat = (from[1] * Math.PI) / 180;
  const toward = origin ? (Math.atan2((mid[0] - from[0]) * Math.cos(lat), mid[1] - from[1]) * 180) / Math.PI : 0;
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  // On a tall screen, turn the map so the group's long side runs top to bottom,
  // choosing the way round that keeps the airport at the bottom.
  let bearing = toward;
  if (h > w && origin) {
    const k = Math.cos(lat);
    const dx = pts.map((p) => (p[0] - mid[0]) * k), dy = pts.map((p) => p[1] - mid[1]);
    const sxx = dx.reduce((t, v) => t + v * v, 0), syy = dy.reduce((t, v) => t + v * v, 0);
    const sxy = dx.reduce((t, v, i) => t + v * dy[i], 0);
    const axis = (Math.atan2(2 * sxy, syy - sxx) / 2) * 180 / Math.PI; // bearing of the long side
    const gap = (b) => Math.abs(((b - toward + 540) % 360) - 180);
    bearing = gap(axis) <= gap(axis + 180) ? axis : axis + 180;
  }

  const tools = document.querySelector(".map-tools")?.getBoundingClientRect();
  const mapTop = map.getContainer().getBoundingClientRect().top;
  const box = { left: 30, right: w - 30, top: Math.max(60, tools ? tools.bottom - mapTop + 30 : 60), bottom: h - 50 };
  const start = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  let view = { center: origin ? [(mid[0] + origin.coords[0]) / 2, (mid[1] + origin.coords[1]) / 2] : mid, zoom: 7, bearing, pitch: origin ? 30 : 25 };
  for (let i = 0; i < 6; i++) {
    map.jumpTo(view);
    const xy = pts.map((p) => map.project(p));
    const xs = xy.map((p) => p.x), ys = xy.map((p) => p.y);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    const scale = Math.min((box.right - box.left) / Math.max(bw, 1), (box.bottom - box.top) / Math.max(bh, 1));
    const zoom = Math.max(5, Math.min(10, view.zoom + Math.log2(scale)));
    map.jumpTo({ ...view, zoom });
    // Slide the map so the group sits in the middle of the free space.
    const xy2 = pts.map((p) => map.project(p));
    const cx = (Math.min(...xy2.map((p) => p.x)) + Math.max(...xy2.map((p) => p.x))) / 2;
    const cy = (Math.min(...xy2.map((p) => p.y)) + Math.max(...xy2.map((p) => p.y))) / 2;
    const c = map.unproject([w / 2 + (cx - (box.left + box.right) / 2), h / 2 + (cy - (box.top + box.bottom) / 2)]);
    view = { ...view, zoom, center: [c.lng, c.lat] };
  }
  map.jumpTo(start);
  duration ? map.flyTo({ ...view, duration }) : map.jumpTo(view);
}

/* ---------- snow parks ---------- */

const PARK_RANK = { none: 0, fair: 1, good: 2, awesome: 3 };

// A resort's own park, or for a feeder town the best park it reaches (nearest when tied).
function parkOf(l) {
  if (l.type === "resort") return { level: l.park.level, place: l, link: null };
  let best = null;
  for (const { place, link } of reachable(l, model.byId)) {
    const rank = PARK_RANK[place.park.level];
    if (!best || rank > PARK_RANK[best.level] || (rank === PARK_RANK[best.level] && link.min < best.link.min)) {
      best = { level: place.park.level, place, link };
    }
  }
  return best;
}

// Does this resort, or any resort a feeder town reaches, have the park asked for?
function parkMatch(l) {
  const resorts = l.type === "resort" ? [l] : reachable(l, model.byId).map((x) => x.place);
  const min = state.park === "any" ? 0 : PARK_RANK[state.park];
  return resorts.some((r) => PARK_RANK[r.park.level] >= min && [...state.parkNeeds].every((f) => r.park.features?.includes(f)));
}

function parkFeatures(park) {
  if (!park.features?.length) return "";
  const labels = model.index.parkFeatures;
  return `<ul class="park-features">${park.features.map((f) => `<li>${esc(labels[f])}</li>`).join("")}</ul>`;
}

function parkSection(l) {
  const k = parkOf(l);
  const r = k.place;
  const where = k.link
    ? ` at <button type="button" class="link" data-select="${r.id}">${esc(r.name)}</button>, ${mins(k.link.min)} away`
    : r.park.name ? `<span>${esc(r.park.name)}</span>` : "";
  return `<section class="park">
      <span class="s-label">${k.link ? "Best snow park nearby" : "Snow park"}</span>
      <p class="park-verdict"><b class="park-pill ${k.level}">${model.index.parkLevels[k.level]}</b>${where}</p>
      <p>${esc(r.park.note)}</p>
      ${parkFeatures(r.park)}
      <p class="snow-note">Our rating for ${model.index.parkChecked}.${r.park.features && !r.park.featuresChecked ? " Features are from our first pass, not yet checked against this season's park map." : ""} Parks are rebuilt every winter, so check the resort's site before you go. Parks on the map are from OpenStreetMap and may be missing.</p>
    </section>`;
}

/* ---------- snow layer ---------- */

// The snow layer follows the trip (the chosen week, else the first chosen month) until a month is picked on it.
function updateSnowLayer() {
  if (summer()) {
    $("#snow-legend").hidden = true;
    if (map) setSnowLayer(map, model.index.snowLayer, null);
    return;
  }
  const tripMonth = state.trip.week
    ? MONTHS[[11, 0, 1, 2, 3].indexOf(new Date(state.trip.week + "T12:00:00").getMonth())]?.key
    : tripMonths()[0];
  const month = state.snowMonth || tripMonth || "jan";
  $("#toggle-snow").setAttribute("aria-pressed", state.snowLayer);
  $("#snow-legend").hidden = !state.snowLayer || summer();
  $("#snow-month-name").textContent = MONTH_LONG[month];
  $$("#snow-months button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === month));
  if (map) setSnowLayer(map, model.index.snowLayer, state.snowLayer && !summer() ? month : null);
}

/* ---------- airport view: airport at the bottom, everywhere you can reach above it ---------- */

let lastVisible = [];
let reachMarker = null;

// Look along the line from the airport to the furthest place on show:
// the furthest place in the middle of the screen, the airport straight below it at the bottom centre.
function airportView(duration = 0) {
  if (!state.origin) return fullView(duration);
  const origin = model.origins.find((o) => o.id === state.origin);
  const places = lastVisible.length ? lastVisible : model.locations.filter((l) => travel(l));
  if (!places.length) return;
  const far = places.reduce((a, b) => (travel(b).min > travel(a).min ? b : a));
  const lat = (origin.coords[1] * Math.PI) / 180;
  const bearing = (Math.atan2((far.coords[0] - origin.coords[0]) * Math.cos(lat), far.coords[1] - origin.coords[1]) * 180) / Math.PI;

  // Put the far place at the top middle and the airport at the bottom middle, by trying views out without drawing.
  const start = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const tools = document.querySelector(".map-tools")?.getBoundingClientRect();
  const mapTop = map.getContainer().getBoundingClientRect().top;
  const top = Math.max(h * 0.14, tools ? tools.bottom - mapTop + 36 : 0); // far place, clear of the buttons
  // Airport near the bottom, but above the snow key when that is showing.
  const key = $("#snow-legend");
  const keyTop = key.hidden ? h : key.getBoundingClientRect().top - mapTop;
  const bottom = Math.min(h * 0.86, keyTop - 40);
  let view = { center: [(far.coords[0] + origin.coords[0]) / 2, (far.coords[1] + origin.coords[1]) / 2], zoom: 8, bearing, pitch: 35 };
  for (let i = 0; i < 6; i++) {
    map.jumpTo(view);
    const a = map.project(far.coords);
    const b = map.project(origin.coords);
    const span = b.y - a.y;
    if (span <= 0) break;
    const zoom = Math.max(6, Math.min(11, view.zoom + Math.log2((bottom - top) / span)));
    map.jumpTo({ ...view, zoom });
    // Slide the map so the far place lands where we want it.
    const p = map.project(far.coords);
    const c = map.unproject([w / 2 + (p.x - w / 2), h / 2 + (p.y - top)]);
    view = { ...view, zoom, center: [c.lng, c.lat] };
  }
  map.jumpTo(start);
  duration ? map.flyTo({ ...view, duration }) : map.jumpTo(view);
}

// Line and label from the airport to the furthest place currently on show.
function updateReach(visible) {
  lastVisible = visible;
  reachMarker?.remove();
  reachMarker = null;
  if (!map || state.selected || !visible.length || !state.origin) { if (map) setReach(map, []); return; }
  const origin = model.origins.find((o) => o.id === state.origin);
  const far = visible.reduce((a, b) => (travel(b).min > travel(a).min ? b : a));
  setReach(map, [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [origin.coords, far.coords] } }]);
  const el = document.createElement("span");
  el.className = "minutes reach";
  el.textContent = mins(travel(far).min);
  el.title = `Furthest place on show: ${far.name}`;
  const mid = [0, 1].map((i) => origin.coords[i] + (far.coords[i] - origin.coords[i]) * 0.55);
  reachMarker = new maplibregl.Marker({ element: el }).setLngLat(mid).addTo(map);
}

function addMarker(l) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `marker ${l.type}`;
  el.setAttribute("aria-label", `${l.name}, ${typeLabel(l).toLowerCase()}`);
  el.innerHTML = `<span class="pin"></span><span class="tag">${esc(l.name)} <em>${price(l.price)}</em></span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    select(l.id);
  });
  const m = new maplibregl.Marker({ element: el, opacityWhenCovered: "0.7" }).setLngLat(l.coords).addTo(map);
  markers.set(l.id, { marker: m, el });
}

function updateLabelMode() {
  $("#map").classList.toggle("labels-on", map.getZoom() >= 9.4);
}

/* ---------- filtering ---------- */

// Does this place suit riders of this level? A feeder town counts when a bike park it reaches does.
const bikeSuits = (l, level) => (ridesHere(l) ? l.bike.suits.includes(level) : bikeLinks(l, model.byId).some((x) => x.place.bike.suits.includes(level)));

// The best riding for a place: its own, or for a feeder town the best bike park it reaches (nearest when tied).
function bikeOf(l) {
  if (ridesHere(l)) return { level: l.bike.level, place: l, link: null };
  let best = null;
  for (const { place, link } of bikeLinks(l, model.byId)) {
    const rank = BIKE_RANK[place.bike.level];
    if (!best || rank > BIKE_RANK[best.level] || (rank === BIKE_RANK[best.level] && link.min < best.link.min)) {
      best = { level: place.bike.level, place, link };
    }
  }
  return best;
}

// Does the riding here, or at a bike park a feeder town reaches, have the rating and styles asked for?
function bikeMatch(l) {
  const spots = ridesHere(l) ? [l] : bikeLinks(l, model.byId).map((x) => x.place);
  const min = state.bike === "any" ? 0 : BIKE_RANK[state.bike];
  return spots.some((r) => BIKE_RANK[r.bike.level] >= min && [...state.bikeNeeds].every((f) => r.bike.styles.includes(f)));
}

function passes(l) {
  if (!inSeason(l, state.season, model.byId)) return false; // summer-only valley towns have no winter, and the reverse
  if (!travel(l)) return false; // no route recorded from this airport
  // The shortlist ignores the filters so saved places never disappear.
  if (state.show === "saved") return state.saved.has(l.id);
  if (state.show !== "all" && l.type !== state.show) return false;
  if (summer()) {
    if (state.levels.includes("first") && !bikeSuits(l, "beginner")) return false;
  } else if (state.levels.includes("first") && !l.easyStart) return false; // resorts only, walk to the beginner slopes
  if (state.maxTime < 300 && travel(l).min > state.maxTime) return false; // the top of the slider means any time
  if (l.type === "base" && !l.summerOnly) {
    const hops = summer() ? bikeLinks(l, model.byId) : reachable(l, model.byId);
    if (hops.length && hops[0].link.min > state.maxHop) return false;
  }
  if (!state.prices.has(l.price)) return false;
  if (state.family && !l.family) return false;
  if (state.countries.size && !state.countries.has(l.country)) return false;
  if (state.vibes.size && !l.vibes.some((v) => state.vibes.has(v))) return false;
  if (state.carFree && !l.carFree) return false;
  if (summer()) {
    if ((state.bike !== "any" || state.bikeNeeds.size) && !bikeMatch(l)) return false;
    return !(state.trip.week && fitOf(l)?.closed); // closed for the chosen week
  }
  if ((state.park !== "any" || state.parkNeeds.size) && !parkMatch(l)) return false;
  if (state.snowSure && snowOf(l) !== "good") return false;
  if (state.trip.week && fitOf(l)?.closed) return false; // closed for the chosen week
  if (l.type === "resort") return state.sizes.has(l.skiSize);
  return reachable(l, model.byId).some((r) => state.sizes.has(r.place.skiSize));
}

function sortKey(l) {
  const sort = summer() ? (["snow", "ski"].includes(state.sort) ? "fit" : state.sort) : state.sort === "bike" ? "fit" : state.sort;
  switch (sort) {
    case "bike": return [-BIKE_RANK[bikeOf(l).level], travel(l).min];
    case "price": return [l.price, travel(l).min];
    case "altitude": return [-l.altitude, travel(l).min];
    case "fit": return [-fitOf(l).score, costOf(l).total];
    case "cost": return [costOf(l).total, travel(l).min];
    case "snow": return [-SNOW_RANK[snowOf(l)], -(l.type === "resort" ? snowAltitude(l) : snowAltitude(bestSnowFrom(l).place))];
    case "ski": return [-(l.skiArea?.pisteKm ?? bestSkiFrom(l)?.place.skiArea.pisteKm ?? 0), travel(l).min];
    default: return [travel(l).min, l.price];
  }
}

// How many filters are set, shown on the Filters button so a narrowed list is never a mystery.
function filterCount() {
  return [
    state.maxTime < 300, state.maxHop < 60, state.prices.size < 3,
    state.vibes.size > 0, state.countries.size > 0, state.family, state.carFree, state.levels.includes("first"),
    ...(summer()
      ? [state.bike !== "any", state.bikeNeeds.size > 0]
      : [state.sizes.size < 4, state.snowSure, state.park !== "any", state.parkNeeds.size > 0]),
  ].filter(Boolean).length;
}

function applyFilters() {
  $("#welcome").hidden = Boolean(state.origin) || Boolean(state.selected);
  $("#f-time-field").hidden = !state.origin; // drive times need an airport
  const set = filterCount();
  $("#filter-count").hidden = !set;
  $("#filter-count").textContent = set;
  const visible = model.locations.filter(passes);
  const ids = new Set(visible.map((l) => l.id));
  for (const [id, { el }] of markers) el.hidden = !ids.has(id) && !state.related.has(id);

  visible.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || a.name.localeCompare(b.name);
  });

  const n = visible.length;
  const nb = visible.filter((l) => l.type === "base").length;
  $("#result-count").textContent = `${n} place${n === 1 ? "" : "s"} · ${nb} ${summer() ? "valley" : "feeder"} town${nb === 1 ? "" : "s"}`;
  $("#tab-count").textContent = n;
  $("#show-places-n").textContent = n === 1 ? "1 place" : `${n} places`;
  const emptyText = state.show === "saved"
    ? "Nothing saved yet. Open a resort or town and tap Save."
    : "Nothing matches. Try a longer travel time or more price levels.";
  $("#results").innerHTML = n ? visible.map(resultItem).join("") : `<li class="empty">${emptyText}</li>`;
  updateReach(visible);
  savePlan();
}

function tripTitle(l) {
  const target = skiTarget(l, model, state.skiAt[l.id], state.season);
  return target.id === l.id ? `staying in ${l.name}` : `staying in ${l.name}, ${summer() ? "riding" : "skiing"} ${target.name}`;
}

// "Good · Flow, downhill": the rating and the main styles of a place that rides at home.
const styleNames = (b, n = 3) => b.styles.slice(0, n).map((k) => model.bike.styles[k].replace(/ friendly$/, "").replace(/ area$/, "")).join(", ");
const bikeBlurb = (l) => `${esc(styleNames(l.bike))}${l.bike.pass ? "" : " · no lifts"}`;
const bikePill = (k) => `<b class="park-pill sm ${k.level}" title="${esc(`Bike riding: ${model.bike.levels[k.level]}${k.link ? ` at ${k.place.name}` : ""}`)}">${model.bike.levels[k.level]}</b>`;

function resultItem(l) {
  const t = travel(l);
  let sub;
  if (summer()) {
    sub = ridesHere(l) ? bikeBlurb(l) : (() => {
      const r = bikeLinks(l, model.byId);
      return `${r.length} bike park${r.length === 1 ? "" : "s"} within ${mins(r[r.length - 1].link.min)}`;
    })();
  } else if (l.type === "resort") {
    sub = `${esc(l.skiArea.name)} · ${l.skiArea.pisteKm} km`;
  } else {
    const r = reachable(l, model.byId);
    sub = `${r.length} resort${r.length === 1 ? "" : "s"} within ${mins(r[r.length - 1].link.min)}`;
  }
  return `<li><button type="button" class="result ${l.type}${l.id === state.selected ? " is-active" : ""}" data-id="${l.id}">
    <i class="dot ${l.type}"></i>
    <span class="r-main"><span class="r-name"><b class="fit-pill" title="Fit for your group">${fitOf(l).score}</b>${esc(l.name)}${state.saved.has(l.id) ? ` <i class="saved-star" aria-label="saved">★</i>` : ""}</span><span class="r-sub">${sub}</span></span>
    <span class="r-side"><span class="r-time">${t.none ? "" : mins(t.min)}</span><span class="r-price" title="Trip cost: ${esc(tripTitle(l))}">${money(costOf(l).total)} ${summer() ? bikePill(bikeOf(l)) : flake(snowOf(l), l.type === "resort" ? `${SNOW_LABEL[snowOf(l)]} for ${monthNames()}` : `Best nearby: ${SNOW_LABEL[snowOf(l)]}`)}</span></span>
  </button></li>`;
}

/* ---------- selection ---------- */

function select(id) {
  const l = model.byId.get(id);
  if (!l) return;
  state.selected = id;
  history.replaceState(null, "", "#" + id);

  const related = new Set([id]);
  const pairs = [];
  if (l.type === "resort") {
    for (const k of l.reachedFrom) { related.add(k.from); pairs.push([model.byId.get(k.from), l, k]); }
  }
  for (const k of l.links || []) { related.add(k.to); pairs.push([l, model.byId.get(k.to), k]); }

  if (summer()) {
    const ok = (p) => inSeason(p, "summer", model.byId);
    for (let i = pairs.length - 1; i >= 0; i--) if (!ok(pairs[i][0]) || !ok(pairs[i][1])) pairs.splice(i, 1);
    related.clear();
    related.add(id);
    for (const [a, b] of pairs) { related.add(a.id); related.add(b.id); }
  }
  state.related = related;
  for (const [mid, { el }] of markers) {
    el.classList.toggle("is-selected", mid === id);
    el.classList.toggle("is-related", related.has(mid) && mid !== id);
  }
  $("#map").classList.add("has-selection");
  drawLinks(pairs, id);
  drawLifts(l);
  state.detailMin = false;
  closeTripSheet();
  renderDetail(l);
  applyFilters();

  const narrow = matchMedia("(max-width: 899px)").matches;
  if (narrow) setSidebar(false);
  // Frame the quick hops; far links still draw but should not pull the camera out.
  const near = pairs.filter(([, , k]) => k.min <= 35).flatMap(([a, b]) => [a.coords, b.coords]);
  const pts = near.length ? near : pairs.flatMap(([a, b]) => [a.coords, b.coords]);
  const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(l.coords, l.coords));
  const cam = map.cameraForBounds(bounds, {
    padding: narrow
      ? { top: 80, bottom: window.innerHeight * 0.55, left: 40, right: 40 }
      : { top: 120, bottom: 120, left: 100, right: 460 },
    maxZoom: 11.5,
    bearing: map.getBearing(),
  });
  if (cam) map.flyTo({ ...cam, pitch: 60, duration: 1600 });
}

function clearSelection() {
  state.selected = null;
  state.related = new Set();
  history.replaceState(null, "", location.pathname);
  $("#detail").hidden = true;
  closeTripSheet();
  $("#map").classList.remove("has-selection");
  for (const { el } of markers.values()) el.classList.remove("is-selected", "is-related");
  drawLinks([]);
  drawLifts(null);
  applyFilters();
}

// Lifts of the selected resort, or of every resort a feeder town reaches. Loaded on first use.
let liftData = null;
let parkData = null;
let liftPopup = null;
const LIFT_KIND = { cabin: "Gondola or cable car", chair: "Chairlift", surface: "Drag lift", park: "Snow park" };

async function drawLifts(place) {
  liftPopup?.remove();
  if (!place || summer()) { setLifts(map, []); setParks(map, []); return; } // the ski lift map is winter only
  try {
    [liftData, parkData] = await Promise.all([
      liftData || fetch("data/lifts.json").then((r) => r.json()),
      parkData || fetch("data/parks.json").then((r) => r.json()),
    ]);
  } catch {
    return; // no lifts is fine; the rest of the map still works
  }
  if (state.selected !== place.id) return; // another place was picked while loading
  const resorts = place.type === "resort" ? [place.id] : (place.links || []).map((k) => k.to);
  const pick = (data) => [...new Set(resorts.flatMap((r) => data.byResort[r] || []))];
  setLifts(map, pick(liftData).map((i) => {
    const [name, kind, coordinates] = liftData.lifts[i];
    return { type: "Feature", properties: { name, kind }, geometry: { type: "LineString", coordinates } };
  }));
  setParks(map, pick(parkData).map((i) => {
    const [name, shape, coordinates] = parkData.parks[i];
    return { type: "Feature", properties: { name, kind: "park" }, geometry: { type: shape === "area" ? "Polygon" : "LineString", coordinates } };
  }));
}

function showLiftName(e) {
  const f = e.features?.[0];
  if (!f) return;
  liftPopup?.remove();
  const { name, kind } = f.properties;
  liftPopup = new maplibregl.Popup({ closeButton: false, className: "lift-pop", offset: 8 })
    .setLngLat(e.lngLat)
    .setHTML(`${name ? `<b>${esc(name)}</b>` : ""}<span>${LIFT_KIND[kind]}</span>`)
    .addTo(map);
}

function drawLinks(pairs, selectedId) {
  minuteMarkers.forEach((m) => m.remove());
  minuteMarkers = [];
  const css = getComputedStyle(document.documentElement);
  const color = { base: css.getPropertyValue("--base").trim(), resort: css.getPropertyValue("--resort").trim() };
  const features = pairs.map(([a, b, k]) => {
    const easy = k.by.some((m) => m !== "car");
    const [near, far] = a.id === selectedId ? [a, b] : [b, a];
    const mid = [0, 1].map((i) => near.coords[i] + (far.coords[i] - near.coords[i]) * 0.62);
    const el = document.createElement("span");
    el.className = "minutes";
    el.textContent = mins(k.min);
    minuteMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(mid).addTo(map));
    return {
      type: "Feature",
      properties: { kind: easy ? "lift" : "road", color: color[a.type] },
      geometry: { type: "LineString", coordinates: [a.coords, b.coords] },
    };
  });
  setLinks(map, features);
}

/* ---------- detail panel ---------- */

function stat(label, value, note = "") {
  return `<div class="stat"><span class="s-label">${label}</span><span class="s-value">${value}</span>${note ? `<span class="s-note">${note}</span>` : ""}</div>`;
}

// opts.vsResort: listing cheaper stays for a resort. opts.fromBase: listing resorts a town reaches.
function placeRow({ place, link }, context, opts = {}) {
  let gain = "";
  let cost = "";
  if (opts.vsResort) {
    const here = costOf(opts.vsResort).total;
    const there = costOf(place, opts.vsResort).total;
    cost = tripLine(there, here - there);
  } else if (opts.fromBase) {
    const there = costOf(opts.fromBase, place).total;
    cost = tripLine(there, costOf(place).total - there, `staying in ${place.name}`);
  }
  if (context) {
    const bands = context.price - place.price;
    const drop = context.altitude - place.altitude;
    const parts = [];
    if (bands > 0) parts.push(`${bands === 2 ? "Two" : "One"} price band${bands === 2 ? "s" : ""} cheaper`);
    if (drop >= 150) parts.push(`${drop} m lower`);
    gain = parts.length ? `<span class="gain">${parts.join(" · ")}</span>` : "";
  }
  const sub = summer()
    ? (ridesHere(place) ? `${model.bike.levels[place.bike.level]} riding ${levelDots(place.bike.suits)}` : `${typeLabel(place)} · ${place.altitude} m`)
    : place.type === "resort"
      ? `${place.skiArea.pisteKm} km of pistes ${levelDots(place.levels)}`
      : `${typeLabel(place)} · ${place.altitude} m`;
  const inList = state.saved.has(place.id);
  return `<li class="link-row">
    <button type="button" class="lr-main" data-select="${place.id}">
      <i class="dot ${place.type}"></i>
      <span><span class="lr-name">${esc(place.name)} <em>${price(place.price)}</em></span>
      <span class="lr-sub">${sub}</span>${gain}${cost}</span>
    </button>
    <span class="lr-hop"><strong>${mins(link.min)}</strong><span>${esc(accessText(link))}</span></span>
    <button type="button" class="add save-btn" data-save="${place.id}" aria-pressed="${inList}" title="Add to your shortlist, which is what Compare shows">${inList ? "Saved" : "Save"}</button>
  </li>`;
}

function tripLine(total, saving, vs = "") {
  const save = saving >= 20
    ? ` · <span class="save">saves ${money(saving)}${vs ? ` vs ${esc(vs)}` : ""}</span>`
    : saving <= -20 ? ` · <span class="dearer">${money(-saving)} more${vs ? ` than ${esc(vs)}` : ""}</span>` : "";
  return `<span class="trip-line">Trip ${money(total)}${save}</span>`;
}

/* ---------- places to stay ---------- */

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MONTH_INDEX = { dec: 11, jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8 };

// First Saturday of the first chosen month, in the coming season.
function defaultArrive() {
  const today = new Date();
  const m = MONTH_INDEX[tripMonths()[0]];
  let year = today.getFullYear();
  if (new Date(year, m + 1, 0) < today) year += 1;
  const d = new Date(year, m, 1);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

function stayDates() {
  const arrive = state.trip.week || defaultArrive();
  const out = new Date(arrive + "T12:00:00");
  out.setDate(out.getDate() + state.trip.nights);
  return { arrive, leave: isoDate(out) };
}

function staySection(l) {
  const { arrive, leave } = stayDates();
  const t = state.trip;
  const town = l.searchName || l.name;
  const country = model.countries.find((c) => c.code === l.country)?.name || "";
  const where = encodeURIComponent(`${town}, ${country}`);
  const guests = t.adults + t.childAges.length;
  const kids = t.childAges.map((a) => `age=${a}`).join("&");
  const when = new Date(arrive + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const g = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const links = [
    ["Booking.com", "Hotels and apartments",
      `https://www.booking.com/searchresults.html?ss=${where}&checkin=${arrive}&checkout=${leave}&group_adults=${t.adults}&group_children=${t.childAges.length}&no_rooms=1${kids ? "&" + kids : ""}`],
    ["Airbnb", "Homes and chalets",
      `https://www.airbnb.com/s/${encodeURIComponent(`${town}--${country}`)}/homes?checkin=${arrive}&checkout=${leave}&adults=${t.adults}&children=${t.childAges.length}`],
    ["Abritel", "French holiday rentals (Vrbo)",
      `https://www.abritel.fr/search?destination=${where}&startDate=${arrive}&endDate=${leave}&adults=${guests}`],
    ...(summer()
      ? [["Bike hire and guides", "Hire shops and guided rides (web search)", g(`${town} mountain bike hire and guides`)]]
      : [["Ski apartment deals", "Pierre & Vacances, Maeva and others (web search)", g(`${town} ski apartment and lift pass deal ${when}`)]]),
  ];
  // Package holiday sites: a web search limited to each site, so the link keeps working if the site changes its addresses.
  const site = (host, q) => g(`site:${host} ${q}`);
  const sport = summer() ? "mountain bike holiday" : "ski holiday";
  const packages = summer()
    ? [["Bike holiday deals", "Chalets with bike storage, and packages (web search)", g(`${town} mountain bike holiday ${when}`)],
       ["Mountain bike tour operators", "Guided weeks and transfers (web search)", g(`${town} mountain bike holiday package guided week ${when}`)]]
    : [["Igluski", "Compares ski holiday and chalet prices (web search)", site("igluski.com", `${town} ${sport}`)],
       ["Crystal Ski", "Packages with flights and transfers (web search)", site("crystalski.co.uk", `${town} ${sport}`)],
       ["Ski Solutions", "Tailor-made trips (web search)", site("skisolutions.com", `${town} ${sport}`)],
       ["Inghams", "Catered chalets and hotels (web search)", site("inghams.co.uk", `${town} ${sport}`)],
       ["Package holidays", "Any other tour operator (web search)", g(`${town} ski package holiday ${when}`)]];
  const airport = state.origin ? model.origins.find((o) => o.id === state.origin) : null;
  const flights = [
    ["Google Flights", airport ? `Flights to ${airport.name} (${airport.id}) on your dates` : "Flights near your dates (pick an airport for a match)",
      `https://www.google.com/travel/flights?q=${encodeURIComponent(airport ? `Flights to ${airport.id} on ${arrive} returning ${leave} for ${guests} passenger${guests === 1 ? "" : "s"}` : `Flights to ${town} on ${arrive} returning ${leave}`)}`],
    ["Skyscanner", "Compare airlines and dates", airport ? `https://www.skyscanner.net/transport/flights-to/${airport.id.toLowerCase()}/` : "https://www.skyscanner.net/"],
  ];
  const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const list = (items) => `<ul class="stay-links">${items.map(([name, what, url]) =>
    `<li><a href="${url}" target="_blank" rel="noopener"><b>${esc(name)}</b><span>${esc(what)}</span><i aria-hidden="true">↗</i></a></li>`).join("")}</ul>`;
  return `<section class="stay">
      <span class="s-label">Places to stay</span>
      <p class="hint">${esc(town)}, ${fmt(arrive)} to ${fmt(leave)}, ${guests} guest${guests === 1 ? "" : "s"}. Opens in a new tab.</p>
      ${list(links)}
    </section>
    <section class="stay">
      <span class="s-label">Package holidays</span>
      <p class="hint">Flights, transfers and stay in one price. Compare a few.</p>
      ${list(packages)}
    </section>
    <section class="stay">
      <span class="s-label">Flights</span>
      <p class="hint">Flights are not in the trip cost above.</p>
      ${list(flights)}
    </section>`;
}

/* ---------- trip sheet: slides over the place panel ---------- */

/* ---------- fit and ski school ---------- */

const fmtDay = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const seasonText = (r) => `${fmtDay(r.season.open)} to ${fmtDay(r.season.close)} (typical dates)`;

function seasonWarn(r) {
  const { arrive, leave } = stayDates();
  const s = seasonState(r, arrive, leave);
  return s === "closed" ? `. <strong class="warn">Closed for your week.</strong>` : s === "partial" ? `. <strong class="warn">Opens or closes during your week.</strong>` : ".";
}

function schoolText(r) {
  const s = r.school;
  const english = { many: "ESF plus several English-speaking schools, many British-run.",
    some: "ESF, with some English-speaking instructors. Ask for an English group when booking.",
    few: "ESF or a small local school. English may be limited." }[s.english];
  const kids = `Children's ski school from age ${s.skiFrom}.`;
  const creche = s.crecheFromMonths ? ` Crèche from ${s.crecheFromMonths} months.` : " No crèche listed.";
  return `${english} ${kids}${creche}`;
}

function fitBand(score) {
  return score >= 75 ? "Great fit" : score >= 55 ? "Good fit" : score >= 35 ? "OK fit" : "Weak fit";
}

const LEVEL_ORDER = ["first", "intermediate", "expert"];

function groupText() {
  const names = state.levels.map((v) => (summer() ? BIKE_LEVELS : LEVELS)[v]);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return state.trip.childAges.length ? `${who}, with ${kidsText(state.trip.childAges)}` : who;
}

function fitSection(l) {
  const f = fitOf(l);
  const li = (r) => `<li class="${r.ok ? "ok" : "no"}">${esc(r.text)}</li>`;
  const several = f.levels.length > 1;
  const byLevel = f.levels.map((x) => `${several ? `<p class="fit-group">For ${(summer() ? BIKE_LEVELS : LEVELS)[x.level]} <b>${x.score}</b></p>` : ""}
      <ul class="fit-reasons">${x.reasons.map(li).join("")}</ul>`).join("");
  return `<section class="fit">
      <span class="s-label">Fit for your group</span>
      <p class="fit-head"><b class="fit-score">${f.score}</b><span><strong>${fitBand(f.score)}</strong> for ${esc(groupText())}${f.resort.id !== l.id ? `, ${summer() ? "riding" : "skiing"} ${esc(f.resort.name)}` : ""}</span></p>
      ${byLevel}
      ${several ? `<p class="fit-group">For everyone</p>` : ""}
      <ul class="fit-reasons">${f.shared.map(li).join("")}</ul>
    </section>`;
}

// Bar of green, blue, red and black runs, as a share of the published piste km.
function runMix(r) {
  const km = runKm(r);
  if (!km) return "";
  const names = { green: "Green", blue: "Blue", red: "Red", black: "Black" };
  const cols = Object.keys(names);
  return `<div class="run-mix" role="img" aria-label="Run mix: ${cols.map((c) => `${r.runShare[c]}% ${c}`).join(", ")}">${cols.map((c) => `<i class="${c}" style="width:${r.runShare[c]}%"></i>`).join("")}</div>
    <p class="run-key">${cols.map((c) => `<span class="${c}">${names[c]} ${km[c]} km</span>`).join("")}</p>`;
}

function tripTeaser(l) {
  const cost = costOf(l);
  const skiing = cost.ski.id !== l.id ? ` · ${summer() ? "riding" : "skiing"} ${esc(cost.ski.name)}` : "";
  return `<button type="button" class="trip-teaser" data-trip="${l.id}">
      <span class="s-label">Trip cost</span>
      <span class="tt-total"><strong>${money(cost.total)}</strong> ${money(cost.perPerson)} per person${skiing}</span>
      <span class="tt-go">Cost breakdown and places to stay <i aria-hidden="true">›</i></span>
    </button>`;
}

function renderTripSheet(l) {
  const s = $("#tripsheet");
  const top = s.hidden ? 0 : s.scrollTop;
  s.innerHTML = `<header class="d-head">
      <span class="eyebrow">Trip and stay</span>
      <h2>${esc(l.name)}</h2>
      <div class="d-actions">
        <button type="button" class="icon-btn" id="trip-back" aria-label="Back to ${esc(l.name)}" title="Back"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button type="button" class="icon-btn" id="trip-close" aria-label="Close" title="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
    </header>
    ${tripSection(l)}
    ${staySection(l)}
    <p class="snow-note">Change nights, people, dates or transport under Your trip in the side panel.</p>`;
  s.hidden = false;
  s.scrollTop = top;
  s.classList.toggle("scrolled", top > 4);
}

function openTripSheet(id) {
  state.tripOpen = true;
  renderTripSheet(model.byId.get(id));
}

function closeTripSheet() {
  state.tripOpen = false;
  $("#tripsheet").hidden = true;
}

function tripSection(l) {
  const cost = costOf(l);
  const t = state.trip;
  const who = `${t.adults} adult${t.adults === 1 ? "" : "s"}${t.childAges.length ? `, ${kidsText(t.childAges)}` : ""}`;
  let picker = "";
  if (l.type === "base" && cost.ski.id !== l.id) {
    const options = summer() ? bikeLinks(l, model.byId) : reachable(l, model.byId);
    picker = `<label class="ski-at" for="ski-at">${summer() ? "Riding at" : "Skiing at"}
      <select id="ski-at" data-base="${l.id}">${options.map((r) =>
        `<option value="${r.place.id}"${r.place.id === cost.ski.id ? " selected" : ""}>${esc(r.place.name)} · ${mins(r.link.min)} by ${accessShort(r.link.by)}</option>`).join("")}</select></label>`;
    const link = options.find((r) => r.place.id === cost.ski.id).link;
    picker += `<p class="access"><span class="s-label">Getting up</span>${esc(accessText(link))} · ${mins(link.min)}</p>`;
  }
  return `<section class="trip">
      <span class="s-label">Trip cost</span>
      <p class="trip-total"><strong>${money(cost.total)}</strong> <span>${money(cost.perPerson)} per person</span></p>
      <p class="trip-who">${who}, ${t.nights} nights, ${t.skiDays} ${summer() ? "riding" : "ski"} days, ${cost.week ? `week of ${new Date(cost.week.start + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })} (${esc(cost.week.label)})` : monthNames()}</p>
      ${picker}
      ${costBreakdown(cost)}
      ${cost.needsCar && t.transport !== "car" ? `<p class="snow-note">No bus to ${esc(cost.ski.name)} from here, so this includes a hire car.</p>` : ""}
    </section>`;
}

function vibePills(l) {
  return `<p class="vibes">${l.vibes.map((v) => {
    const def = model.index.vibes[v];
    return `<span class="vibe${state.vibes.has(v) ? " on" : ""}" title="${esc(def.hint)}">${esc(def.label)}</span>`;
  }).join("")}</p>`;
}

/* ---------- summer: riding ---------- */

const bikeSeasonText = (b) => `${fmtDay(b.season.open)} to ${fmtDay(b.season.close)} (typical dates)`;
const bikeSeasonWarn = (b) => {
  const { arrive, leave } = stayDates();
  const s = seasonState({ season: b.season }, arrive, leave);
  return s === "closed" ? `. <strong class="warn">Closed for your week.</strong>` : s === "partial" ? `. <strong class="warn">Lifts open or close during your week.</strong>` : ".";
};

// The riding at a place that rides at home.
function bikeSection(l, label) {
  const b = l.bike;
  const cost = b.pass ? `About ${moneyExact(b.pass)} a day for ${b.styles.includes("flow") || b.styles.includes("downhill") ? "lifts" : "uplift and shuttles"}.` : "No lifts needed. Ride from the door.";
  return `<section class="park bike">
      <span class="s-label">${label || (l.summerOnly ? "Riding here" : "Bike park and riding")}</span>
      <p class="park-verdict"><b class="park-pill ${b.level}">${model.bike.levels[b.level]}</b> <span>${cost}</span></p>
      <p>${esc(b.note)}</p>
      <ul class="park-features">${b.styles.map((k) => `<li>${esc(model.bike.styles[k])}</li>`).join("")}</ul>
      <p class="suits">Suits ${levelDots(b.suits)} ${b.suits.map((v) => LEVEL_LABEL[v]).join(", ")}</p>
      <p class="season-line">Usually open ${bikeSeasonText(b)}${state.trip.week ? bikeSeasonWarn(b) : ""}</p>
      <p class="snow-note">Our rating for ${model.bike.checked}. A first pass from what we know of each place, so check the park's own site for trail maps, opening dates and prices before you go. ${l.summerOnly ? " This valley town has no ski area in the app, so it only shows in summer." : " Summer bus times differ from winter ones."}</p>
    </section>`;
}

function bikeBody(l) {
  if (ridesHere(l)) {
    let body = bikeSection(l);
    if (l.type !== "resort") return body;
    const cheaper = cheaperStays(l, model.byId).filter((c) => inSeason(c.place, "summer", model.byId));
    body += `<section class="alt">
        <h3>Stay lower, ride here</h3>
        ${cheaper.length
          ? `<p class="hint">${cheaper.length} cheaper place${cheaper.length === 1 ? "" : "s"} to stay with quick access to ${esc(l.name)}.</p>
             <ul class="link-list">${cheaper.map((c) => placeRow(c, l, { vsResort: l })).join("")}</ul>
             <button type="button" class="primary wide" data-pair="${l.id}">Compare ${esc(l.name)} with these</button>`
          : `<p class="hint">No cheaper base within easy reach. Staying in the resort is the simple choice here.</p>`}
      </section>`;
    const linked = reachable(l, model.byId).filter((c) => inSeason(c.place, "summer", model.byId));
    if (linked.length) body += `<section class="alt"><h3>Also reaches</h3><ul class="link-list">${linked.map((c) => placeRow(c)).join("")}</ul></section>`;
    return body;
  }
  // A feeder town: stay low, ride the bike parks it reaches.
  const r = bikeLinks(l, model.byId);
  const best = bikeOf(l);
  const savings = r.filter((x) => x.place.price > l.price);
  return `<section class="park bike">
      <span class="s-label">Riding nearby</span>
      <p class="park-verdict"><b class="park-pill ${best.level}">${model.bike.levels[best.level]}</b> at
        <button type="button" class="link" data-select="${best.place.id}">${esc(best.place.name)}</button>, ${mins(best.link.min)} away</p>
      <p>${esc(best.place.bike.note)}</p>
      <p class="snow-note">Our rating for ${model.bike.checked}. Bus and lift links are winter times, so check summer timetables before you book.</p>
    </section>
    <section class="alt">
      <h3>Bike parks within reach</h3>
      <p class="hint">${r.length} place${r.length === 1 ? "" : "s"}, nearest in ${mins(r[0].link.min)}.${savings.length ? ` Cheaper than staying in ${savings.length} of them.` : ""}</p>
      <ul class="link-list">${r.map((c) => placeRow(c, null, { fromBase: l })).join("")}</ul>
      <button type="button" class="primary wide" data-pair="${l.id}">Compare with nearest ones</button>
    </section>`;
}

function renderDetail(l) {
  const t = travel(l);
  const band = model.priceBands[l.price];
  const head = `<header class="d-head">
      <span class="eyebrow"><i class="dot ${l.type}"></i>${typeLabel(l)} · ${esc(l.region)}</span>
      <h2>${esc(l.name)}</h2>
      <div class="d-actions">
        <button type="button" class="icon-btn save-icon" data-save="${l.id}" aria-pressed="${state.saved.has(l.id)}" aria-label="Save to shortlist" title="Save to shortlist"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="var(--star-fill, none)" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
        <button type="button" class="icon-btn" id="detail-min" aria-expanded="${!state.detailMin}" aria-label="${state.detailMin ? "Expand details" : "Minimise details"}" title="${state.detailMin ? "Expand" : "Minimise"}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button type="button" class="icon-btn" id="detail-close" aria-label="Close details" title="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
    </header>
    <div class="d-intro">
      <p class="character">${esc(l.character)}</p>
      ${vibePills(l)}
    </div>`;

  const stats = `<div class="stats">
      ${t.none ? stat("From airport", "Not set", "pick a country") : stat(`From ${state.origin}`, mins(t.min), `${t.km} km`)}
      ${stat("Altitude", `${l.altitude} m`, l.topAltitude ? `top ${l.topAltitude} m` : "village")}
      ${stat("Price to stay", band.symbol, band.label)}
      ${stat("Town", SIZE_LABEL[l.townSize], l.family ? "Family-friendly" : "Better for adults")}
    </div>`;

  const getting = `<p class="getting"><span class="s-label">Getting there</span>${esc(l.transfer)}${l.rail ? ` <span class="badge">${esc(l.rail)}</span>` : ""}${l.carFree ? ` <span class="badge good">No car needed</span>` : ""}</p>`;

  let body = tripTeaser(l) + fitSection(l);
  if (summer()) {
    body += bikeBody(l);
  } else if (l.type === "resort") {
    const cheaper = cheaperStays(l, model.byId);
    body += `<section class="ski">
        <span class="s-label">Ski area</span>
        <p><strong>${esc(l.skiArea.name)}</strong> · ${l.skiArea.pisteKm} km · ${SIZE_LABEL[l.skiSize]}</p>
        <p class="suits">Suits ${levelDots(l.levels)} ${l.levels.map((v) => LEVEL_LABEL[v]).join(", ")}</p>
        ${runMix(l)}
        <p class="expert-line"><strong>Expert terrain: ${model.index.expertLevels[l.expert.level]}.</strong> ${esc(l.expert.note)}</p>
        ${l.easyStart ? `<p class="easy-start"><strong>Good for first-timers.</strong> ${esc(l.easyStart)}</p>` : ""}
        <p class="season-line">Usually open ${seasonText(l)}${state.trip.week ? seasonWarn(l) : ""}</p>
      </section>
      <section class="school">
        <span class="s-label">Ski school</span>
        <p>${schoolText(l)}</p>
      </section>
      ${parkSection(l)}`;
    const s = snowOf(l);
    body += `<section class="snow">
        <span class="s-label">Snow</span>
        <p class="snow-verdict ${s}">${flake(s)} <strong>${SNOW_LABEL[s]}</strong> for ${monthNames()}</p>
        ${snowMonths(l)}
        <p class="snow-note">Rating estimated from altitude: skiing up to ${l.topAltitude} m, village at ${l.altitude} m.${l.snowNote ? ` ${esc(l.snowNote)}` : ""}</p>
        <span class="s-label">Snow in past winters</span>
        ${snowHistory(l)}
      </section>`;
    body += `<section class="alt">
        <h3>Stay lower, ski here</h3>
        ${cheaper.length
          ? `<p class="hint">${cheaper.length} cheaper place${cheaper.length === 1 ? "" : "s"} to stay with quick access to ${esc(l.name)}.</p>
             <ul class="link-list">${cheaper.map((c) => placeRow(c, l, { vsResort: l })).join("")}</ul>
             <button type="button" class="primary wide" data-pair="${l.id}">Compare ${esc(l.name)} with these</button>`
          : `<p class="hint">No cheaper base within easy reach. Staying in the resort is the simple choice here.</p>`}
      </section>`;
    const linked = reachable(l, model.byId);
    if (linked.length) {
      body += `<section class="alt"><h3>Also reaches</h3><ul class="link-list">${linked.map((c) => placeRow(c)).join("")}</ul></section>`;
    }
  } else {
    const r = reachable(l, model.byId);
    const savings = r.filter((x) => x.place.price > l.price);
    const bs = bestSnowFrom(l);
    const sr = snowOf(bs.place);
    body += `<section class="snow">
        <span class="s-label">Snow nearby</span>
        <p class="snow-verdict ${sr}">${flake(sr)} <strong>${SNOW_LABEL[sr]}</strong> for ${monthNames()} at
          <button type="button" class="link" data-select="${bs.place.id}">${esc(bs.place.name)}</button>, ${mins(bs.link.min)} away</p>
        ${snowMonths(bs.place)}
        <span class="s-label">Snow in past winters, ${esc(l.name)}</span>
        ${snowHistory(l)}
      </section>`;
    body += parkSection(l);
    body += `<section class="alt">
        <h3>Resorts within reach</h3>
        <p class="hint">${r.length} resort${r.length === 1 ? "" : "s"}, nearest in ${mins(r[0].link.min)}.${savings.length ? ` Cheaper than staying in ${savings.length} of them.` : ""}</p>
        <ul class="link-list">${r.map((c) => placeRow(c, null, { fromBase: l })).join("")}</ul>
        <button type="button" class="primary wide" data-pair="${l.id}">Compare with nearest ones</button>
      </section>`;
  }

  const isSaved = state.saved.has(l.id);
  const foot = `<footer class="d-foot">
      <button type="button" class="secondary save-btn" data-save="${l.id}" aria-pressed="${isSaved}">${isSaved ? "Saved" : "Save"}</button>
    </footer>`;

  const d = $("#detail");
  d.innerHTML = head + stats + getting + body + foot;
  d.classList.remove("scrolled");
  if (state.tripOpen) renderTripSheet(l);
  d.classList.toggle("is-min", state.detailMin);
  d.hidden = false;
  d.scrollTop = 0;
}

/* ---------- compare ---------- */

let removedFromCompare = null;

// The comparison is the shortlist, so adding or taking out a place here changes the shortlist.
function toggleCompare(id, force) {
  if (state.pairIds) {
    // In a one-off comparison, taking a column out leaves the shortlist alone.
    if (state.pairIds.includes(id)) {
      removedFromCompare = { id, pair: true };
      $("#compare-undo-text").textContent = `Removed ${model.byId.get(id).name} from this comparison.`;
      $("#compare-undo").hidden = false;
      state.pairIds = state.pairIds.filter((x) => x !== id);
      renderCompareTable();
    }
    return;
  }
  const has = state.saved.has(id);
  const want = force ?? !has;
  if (!want && has && !$("#compare").hidden) {
    // Taking a place out of an open comparison can be undone.
    removedFromCompare = { id };
    $("#compare-undo-text").textContent = `Removed ${model.byId.get(id).name} from your shortlist.`;
    $("#compare-undo").hidden = false;
  }
  want ? state.saved.add(id) : state.saved.delete(id);
  shortlistChanged();
  if (state.selected) renderDetail(model.byId.get(state.selected));
}

function pairUp(id) {
  const l = model.byId.get(id);
  const others = (l.type === "resort"
    ? cheaperStays(l, model.byId).map((x) => x.place.id)
    : (summer() ? bikeLinks(l, model.byId) : reachable(l, model.byId)).map((x) => x.place.id))
    .filter((x) => inSeason(model.byId.get(x), state.season, model.byId));
  openCompare([id, ...others]); // a one-off comparison; the shortlist is not touched
}

function renderCompareBar() {
  const bar = $("#compare-bar");
  bar.hidden = state.compare.length === 0;
  $("#compare-chips").innerHTML = state.compare.map((id) => {
    const l = model.byId.get(id);
    return `<span class="chip ${l.type}"><i class="dot ${l.type}"></i>${esc(l.name)}<button type="button" data-compare="${id}" aria-label="Take ${esc(l.name)} off your shortlist">×</button></span>`;
  }).join("");
  $("#compare-open").textContent = state.compare.length > 1 ? `Compare shortlist (${state.compare.length})` : "Compare";
  $("#compare-open").disabled = state.compare.length < 2;
}

function openCompare(pair = null) {
  state.pairIds = pair;
  $("#compare h2").textContent = pair ? `${model.byId.get(pair[0]).name} and its cheaper places` : "Your shortlist";
  removedFromCompare = null;
  $("#compare-undo").hidden = true;
  if (isNarrow()) setSidebar(false); // on a phone the panel would sit on top of the table
  renderCompareTable();
  $("#compare").hidden = false;
}

// A town in the table is costed against a resort it reaches that is also in the table, if any.
function compareCost(l, cols) {
  if (l.type === "resort" || (summer() && ridesHere(l))) return costOf(l);
  const reach = new Set((l.links || []).map((k) => k.to));
  const match = cols.find((c) => c.type === "resort" && reach.has(c.id));
  return costOf(l, match);
}

function renderCompareTable() {
  const cols = (state.pairIds || state.compare).map((id) => model.byId.get(id));
  if (!cols.length) { $("#compare").hidden = true; return; }

  const best = (vals, pick) => {
    const nums = vals.filter((v) => Number.isFinite(v));
    if (nums.length < 2) return () => false;
    const target = pick(...nums);
    return (v) => v === target && nums.some((n) => n !== target);
  };

  // The nearest resort a town reaches, for this season. Places that ride or ski where they stay have none.
  const nearbyList = (l) => {
    const r = summer() ? (ridesHere(l) ? [] : bikeLinks(l, model.byId)) : l.type === "base" ? reachable(l, model.byId) : [];
    return l.type === "resort" || !r.length ? null : r;
  };
  const dailyHop = (l) => nearbyList(l)?.[0];

  const rows = [
    {
      label: "Trip cost",
      vals: cols.map((l) => compareCost(l, cols).total),
      win: Math.min,
      cell: (l) => {
        const c = compareCost(l, cols);
        return `${money(c.total)}<small>${c.ski.id === l.id ? "staying here" : `${summer() ? "riding" : "skiing"} ${esc(c.ski.name)}`}, ${money(c.perPerson)} each</small>`;
      },
    },
    {
      label: "From airport",
      vals: cols.map((l) => travel(l).min),
      win: Math.min,
      cell: (l) => (travel(l).none ? "Not set" : `${mins(travel(l).min)}<small>${travel(l).km} km</small>`),
    },
    {
      label: "Price to stay",
      vals: cols.map((l) => l.price),
      win: Math.min,
      cell: (l) => `${price(l.price)}<small>${model.priceBands[l.price].label}</small>`,
    },
    {
      label: "Altitude",
      vals: cols.map((l) => l.altitude),
      win: Math.max,
      cell: (l) => `${l.altitude} m<small>${l.topAltitude ? `top ${l.topAltitude} m` : "village"}</small>`,
    },
    {
      only: "winter",
      label: "Ski area",
      vals: cols.map((l) => l.skiArea?.pisteKm ?? bestSkiFrom(l)?.place.skiArea.pisteKm),
      win: Math.max,
      cell: (l) => {
        if (l.skiArea) return `${l.skiArea.pisteKm} km<small>${esc(l.skiArea.name)}</small>`;
        const b = bestSkiFrom(l);
        return `${b.place.skiArea.pisteKm} km<small>${esc(b.place.skiArea.name)}, ${mins(b.link.min)} away</small>`;
      },
    },
    {
      only: "winter",
      label: "Snow park",
      vals: cols.map((l) => PARK_RANK[parkOf(l).level]),
      win: Math.max,
      cell: (l) => {
        const k = parkOf(l);
        return `${model.index.parkLevels[k.level]}${k.link ? `<small>at ${esc(k.place.name)}, ${mins(k.link.min)} away</small>` : ""}`;
      },
    },
    {
      only: "summer",
      label: "Bike riding",
      vals: cols.map((l) => BIKE_RANK[bikeOf(l).level]),
      win: Math.max,
      cell: (l) => {
        const k = bikeOf(l);
        return `${model.bike.levels[k.level]}<small>${k.link ? `at ${esc(k.place.name)}, ${mins(k.link.min)} away` : esc(styleNames(k.place.bike))}</small>`;
      },
    },
    {
      only: "summer",
      label: "Lift pass, per day",
      vals: cols.map((l) => bikeOf(l).place.bike.pass),
      win: Math.min,
      cell: (l) => {
        const b = bikeOf(l).place.bike;
        return b.pass ? `${moneyExact(b.pass)}<small>${b.styles.includes("flow") || b.styles.includes("downhill") ? "bike lift pass" : "uplift and shuttles"}</small>` : "None needed";
      },
    },
    {
      only: "summer",
      label: "Riding styles",
      cell: (l) => esc(bikeOf(l).place.bike.styles.map((k) => model.bike.styles[k]).join(", ")),
    },
    {
      only: "summer",
      label: "Usually open",
      cell: (l) => {
        const b = bikeOf(l).place.bike;
        return `${fmtDay(b.season.open)} to ${fmtDay(b.season.close)}`;
      },
    },
    {
      label: "Daily hop to the slopes",
      vals: cols.map((l) => dailyHop(l)?.link.min ?? 0),
      win: Math.min,
      cell: (l) => {
        const n = dailyHop(l);
        if (!n) return summer() ? `Ride from the door` : `On the slopes`;
        return `${mins(n.link.min)}<small>to ${esc(n.place.name)} by ${modes(n.link.by)}</small>`;
      },
    },
    {
      label: summer() ? "Bike parks within 30 min" : "Resorts within 30 min",
      vals: cols.map((l) => (nearbyList(l) ? nearbyList(l).filter((x) => x.link.min <= 30).length : NaN)),
      win: Math.max,
      cell: (l) => (nearbyList(l) ? String(nearbyList(l).filter((x) => x.link.min <= 30).length) : "—"),
    },
    {
      label: "Group fit",
      vals: cols.map((l) => fitOf(l).score),
      win: Math.max,
      cell: (l) => `${fitOf(l).score}<small>${fitBand(fitOf(l).score)}</small>`,
    },
    {
      only: "winter",
      label: "Ski school",
      cell: (l) => {
        const r = l.type === "resort" ? l : fitOf(l).resort;
        const e = { many: "Several English-speaking", some: "Some English", few: "English limited" }[r.school.english];
        return `${e}<small>Kids from ${r.school.skiFrom}${r.school.crecheFromMonths ? `, crèche from ${r.school.crecheFromMonths} months` : ""}</small>`;
      },
    },
    { label: "Suits", cell: (l) => (summer() ? levelDots(bikeOf(l).place.bike.suits) : l.levels ? levelDots(l.levels) : l.type === "base" ? "Depends on the resort" : "—") },
    {
      only: "winter",
      label: "Snow, your months",
      vals: cols.map((l) => SNOW_RANK[snowOf(l)]),
      win: Math.max,
      cell: (l) => {
        const s = snowOf(l);
        if (l.type === "resort") return `${flake(s)} ${SNOW_LABEL[s]}<small>${monthNames()}</small>`;
        return `${flake(s)} ${SNOW_LABEL[s]}<small>best nearby: ${esc(bestSnowFrom(l).place.name)}</small>`;
      },
    },
    { label: "Vibe", cell: (l) => vibePills(l) },
    { label: "Town size", cell: (l) => SIZE_LABEL[l.townSize] },
    { label: "Family-friendly", cell: (l) => (l.family ? "Yes" : "Less so") },
    { label: "No car needed", cell: (l) => (l.carFree ? "Yes" : "Car helps") },
    { label: "Character", cell: (l) => `<span class="long">${esc(l.character)}</span>` },
  ].filter((r) => !r.only || r.only === state.season);

  const headRow = `<tr><th scope="col"></th>${cols.map((l) => `<th scope="col" class="${l.type}">
      <span class="eyebrow"><i class="dot ${l.type}"></i>${typeLabel(l)}</span>
      <button type="button" class="col-name" data-select="${l.id}">${esc(l.name)}</button>
      <button type="button" class="col-x" data-compare="${l.id}" aria-label="Take ${esc(l.name)} out of this comparison" title="${state.pairIds ? "Take out of this comparison. Your shortlist stays as it is." : "Take off your shortlist. You can undo it."}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Remove</button>
      ${state.pairIds ? `<button type="button" class="col-save save-btn" data-save="${l.id}" aria-pressed="${state.saved.has(l.id)}">${state.saved.has(l.id) ? "Saved" : "Save"}</button>` : ""}
    </th>`).join("")}</tr>`;

  const body = rows.map((r) => {
    const isBest = r.vals ? best(r.vals, r.win) : () => false;
    return `<tr><th scope="row">${r.label}</th>${cols.map((l, i) =>
      `<td class="${isBest(r.vals?.[i]) ? "best" : ""}">${r.cell(l)}</td>`).join("")}</tr>`;
  }).join("");

  $("#compare-table").innerHTML = `<table><thead>${headRow}</thead><tbody>${body}</tbody></table>
    <p class="compare-note">Highlighted: best in row. ${esc(model.index.priceNote)}</p>`;
}

/* ---------- controls ---------- */

const shortDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const weekList = () => (summer() ? model.bike.weeks : model.index.weeks);

function fillWeeks() {
  $("#t-week").innerHTML = `<option value="">Any week in my months</option>` + weekList().map((w) =>
    `<option value="${w.start}">${shortDate(w.start)} · ${esc(w.label)} · ${w.crowd}</option>`).join("");
  $("#t-week").value = state.trip.week || "";
  showWeekNote();
}

function showWeekNote() {
  const w = weekList().find((x) => x.start === state.trip.week);
  $("#week-note").textContent = w
    ? `${w.note} Prices about ${Math.round(w.factor * 100)}% of a normal week.`
    : `Pick a week to see school holidays, crowds and which ${summer() ? "places" : "resorts"} are open.`;
  $("#week-note").dataset.crowd = w ? w.crowd : "";
}

/* ---------- winter and summer ---------- */

const SORTS = {
  winter: [["fit", "Best match"], ["time", "Time from airport"], ["cost", "Trip cost"], ["price", "Price"], ["altitude", "Altitude"], ["ski", "Ski area size"], ["snow", "Snow reliability"]],
  summer: [["fit", "Best match"], ["time", "Time from airport"], ["cost", "Trip cost"], ["price", "Price"], ["altitude", "Altitude"], ["bike", "Bike riding rating"]],
};

// First-screen cards: one per country, counting what there is to do in this season.
function renderWelcome() {
  $("#welcome-countries").innerHTML = model.countries.map((c) => {
    const n = model.locations.filter((l) => l.country === c.code && (summer() ? ridesHere(l) && !(l.type === "base" && l.bike && !l.summerOnly) : l.type === "resort")).length;
    const airport = model.origins.find((o) => o.id === c.primaryAirport);
    return `<button type="button" data-v="${c.code}"><b>${esc(c.name)}</b><span>${n} ${summer() ? "places to ride" : "resorts"} · from ${esc(airport?.name || "")}</span></button>`;
  }).join("");
}

// Put everything that depends on the season in line with state.season: words, lists, accent colour.
function applySeasonUI() {
  document.documentElement.dataset.season = state.season;
  $$("[data-w]").forEach((el) => { el.textContent = summer() ? el.dataset.s : el.dataset.w; });
  $$("[data-wt]").forEach((el) => { el.title = summer() ? el.dataset.st : el.dataset.wt; });
  $$(".season-seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.season === state.season));
  const sorts = SORTS[state.season];
  if (!sorts.some(([v]) => v === state.sort)) state.sort = "fit";
  $("#sort").innerHTML = sorts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  $("#sort").value = state.sort;
  fillWeeks();
  renderWelcome();
  renderDataNote();
  $$("#f-months button").forEach((b) => b.setAttribute("aria-pressed", state.months.has(b.dataset.v)));
  $$("#f-bmonths button").forEach((b) => b.setAttribute("aria-pressed", state.bikeMonths.has(b.dataset.v)));
}

function setSeason(next) {
  if (next === state.season) return;
  [state.trip.week, state.otherWeek] = [state.otherWeek, state.trip.week]; // each season keeps its own week
  [state.trip.lessons, state.otherLessons] = [state.otherLessons, state.trip.lessons]; // and its own lessons
  state.season = next;
  [state.saved, state.otherSaved] = [state.otherSaved, state.saved]; // each season has its own shortlist
  $("#compare").hidden = true; // an open comparison belongs to the other season
  state.pairIds = null;
  applySeasonUI();
  renderCompareBar();
  shortlistChanged();
  const open = state.selected && model.byId.get(state.selected);
  if (open && !inSeason(open, next, model.byId)) clearSelection();
  tripChanged();
  updateSnowLayer();
  if (open && inSeason(open, next, model.byId)) select(open.id);
  else if (!state.selected) airportView(900);
  savePlan();
}

function bindControls() {
  // Winter and summer switch: one in the side panel, one on the map.
  $$(".season-seg button").forEach((b) => b.addEventListener("click", () => setSeason(b.dataset.season)));
  // Summer controls built from the data: month chips and riding styles.
  $("#f-bmonths").innerHTML = model.bike.months.map((m) =>
    `<button type="button" id="f-m-${m.key}" data-v="${m.key}" aria-pressed="false">${m.label}</button>`).join("");
  $("#f-bike-needs").innerHTML = Object.entries(model.bike.styles).map(([k, label]) =>
    `<button type="button" id="f-bike-need-${k}" data-v="${k}" aria-pressed="false">${esc(label)}</button>`).join("");
  $$("#f-bike button").forEach((b) => b.addEventListener("click", () => {
    state.bike = b.dataset.v;
    $$("#f-bike button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    applyFilters();
  }));
  $$("#f-bike-needs button").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.v;
    state.bikeNeeds.has(v) ? state.bikeNeeds.delete(v) : state.bikeNeeds.add(v);
    b.setAttribute("aria-pressed", state.bikeNeeds.has(v));
    applyFilters();
  }));
  $$("#show-seg button").forEach((b) => b.addEventListener("click", () => setShow(b.dataset.show)));
  $("#show-saved").addEventListener("click", () => setShow(state.show === "saved" ? "all" : "saved"));

  $("#saved-compare").addEventListener("click", () => {
    openCompare();
  });
  $("#saved-share").addEventListener("click", shareShortlist);
  $("#share-plan").addEventListener("click", (e) => copyPlanLink(e.currentTarget, $("#plan-link")));
  $("#plan-reset").addEventListener("click", (e) => {
    // Two taps, so one slip does not wipe a plan.
    const b = e.currentTarget;
    if (b.dataset.armed !== "1") {
      b.dataset.armed = "1";
      b.textContent = "Tap again to clear trip, filters and shortlist";
      setTimeout(() => { b.dataset.armed = ""; b.textContent = "Start a new plan"; }, 3000);
      return;
    }
    try { localStorage.removeItem(PLAN_KEY); localStorage.removeItem(SAVED_KEY); } catch { /* nothing saved */ }
    location.href = location.pathname;
  });
  $("#saved-clear").addEventListener("click", (e) => {
    // Two taps to clear, so one slip does not lose the list.
    const b = e.currentTarget;
    if (b.dataset.armed !== "1") {
      b.dataset.armed = "1";
      b.textContent = "Tap again to clear";
      setTimeout(() => { b.dataset.armed = ""; b.textContent = "Clear"; }, 3000);
      return;
    }
    b.dataset.armed = "";
    b.textContent = "Clear";
    state.saved.clear();
    shortlistChanged();
  });

  const time = $("#f-time");
  const showTime = () => {
    state.maxTime = +time.value;
    $("#f-time-out").textContent = state.maxTime >= 300 ? "Any" : mins(state.maxTime);
  };
  time.addEventListener("input", () => { showTime(); applyFilters(); });
  showTime();

  const hop = $("#f-hop");
  const showHop = () => {
    state.maxHop = +hop.value;
    $("#f-hop-out").textContent = state.maxHop >= 60 ? "Any" : mins(state.maxHop);
  };
  hop.addEventListener("input", () => { showHop(); applyFilters(); });
  showHop();

  // Reads the set from state on each click, since a restored plan or a week pick can replace it.
  const chipSet = (sel, key, parse) => $$(`${sel} button`).forEach((b) => b.addEventListener("click", () => {
    const set = state[key];
    const v = parse(b.dataset.v);
    const on = set.has(v);
    if (on && set.size === 1) return; // keep at least one
    on ? set.delete(v) : set.add(v);
    b.setAttribute("aria-pressed", !on);
    applyFilters();
  }));
  chipSet("#f-price", "prices", Number);
  chipSet("#f-size", "sizes", String);
  chipSet("#f-months", "months", String);
  chipSet("#f-bmonths", "bikeMonths", String);
  $$("#f-months, #f-bmonths").forEach((el) => el.addEventListener("click", () => {
    if (state.snowLayer) updateSnowLayer();
    // Month choice changes every snow rating and trip cost, so redraw open panels too.
    if (state.selected) renderDetail(model.byId.get(state.selected));
    if (!$("#compare").hidden) renderCompareTable();
  }));
  const tripInputs = { nights: "#t-nights", skiDays: "#t-days", adults: "#t-adults" };
  for (const [key, sel] of Object.entries(tripInputs)) {
    $(sel).addEventListener("input", (e) => {
      const el = e.target;
      const v = Math.round(Number(el.value));
      // The ski days box is capped at the nights, but a bigger number should be pulled down, not ignored.
      const top = key === "skiDays" ? 21 : +el.max;
      if (!Number.isFinite(v) || v < +el.min || v > top) return; // wait for a valid number
      state.trip[key] = v;
      keepDaysWithinNights();
      tripChanged();
    });
  }
  // Children: a counter, then one age picker per child (no typing needed on phones).
  $("#kids-plus").addEventListener("click", () => {
    if (state.trip.childAges.length >= 8) return;
    state.trip.childAges.push(8);
    renderKidAges();
    tripChanged();
    $(`#kid-age-${state.trip.childAges.length - 1}`)?.focus();
  });
  $("#kids-minus").addEventListener("click", () => {
    if (!state.trip.childAges.length) return;
    state.trip.childAges.pop();
    renderKidAges();
    tripChanged();
  });
  $("#kid-ages").addEventListener("change", (e) => {
    const i = Number(e.target.dataset.i);
    if (!Number.isInteger(i)) return;
    state.trip.childAges[i] = Number(e.target.value);
    tripChanged();
  });

  // Week picker: Saturdays across the season, labelled with school holidays. fillWeeks builds the list.
  $("#t-week").addEventListener("change", () => {
    state.trip.week = $("#t-week").value || null;
    if (state.trip.week) {
      // The week decides the month too.
      const month = new Date(state.trip.week + "T12:00:00").getMonth();
      if (summer()) {
        const key = { 5: "jun", 6: "jul", 7: "aug", 8: "sep" }[month];
        if (key) {
          state.bikeMonths = new Set([key]);
          $$("#f-bmonths button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === key));
        }
      } else {
        const key = MONTHS[[11, 0, 1, 2, 3].indexOf(month)]?.key;
        if (key) {
          state.months = new Set([key]);
          $$("#f-months button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === key));
        }
      }
    }
    showWeekNote();
    tripChanged();
  });

  $$("#t-lessons button").forEach((b) => b.addEventListener("click", () => {
    state.trip.lessons = b.dataset.v;
    $$("#t-lessons button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    tripChanged();
  }));
  $("#t-hire").addEventListener("change", (e) => { state.trip.hire = e.target.checked; tripChanged(); });
  for (const panel of [$("#detail"), $("#tripsheet")]) {
    panel.addEventListener("scroll", (e) => e.currentTarget.classList.toggle("scrolled", e.currentTarget.scrollTop > 4));
  }
  $$("#t-transport button").forEach((b) => b.addEventListener("click", () => {
    state.trip.transport = b.dataset.v;
    $$("#t-transport button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    tripChanged();
  }));
  document.addEventListener("change", (e) => {
    if (e.target.id !== "ski-at") return;
    state.skiAt[e.target.dataset.base] = e.target.value;
    tripChanged();
  });
  // First screen: one card per country.
  $("#welcome-countries").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) pickCountries([b.dataset.v], { added: b.dataset.v });
  });
  // Country chips, shown once more than one country is live. None picked means all.
  $("#f-country-field").hidden = model.countries.length < 2;
  $("#f-country").innerHTML = model.countries.map((c) =>
    `<button type="button" id="f-country-${c.code.toLowerCase()}" data-v="${c.code}" aria-pressed="false">${esc(c.name)}</button>`).join("");
  $$("#f-country button").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.v;
    const next = new Set(state.countries);
    const on = !next.has(v);
    on ? next.add(v) : next.delete(v);
    pickCountries(next, on ? { added: v } : { removed: v });
  }));
  // Vibe chips start all off: no choice means any vibe.
  $("#f-vibe").innerHTML = Object.entries(model.index.vibes).map(([key, v]) =>
    `<button type="button" id="f-vibe-${key}" data-v="${key}" aria-pressed="false" title="${esc(v.hint)}">${esc(v.label)}</button>`).join("");
  $$("#f-vibe button").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.v;
    state.vibes.has(v) ? state.vibes.delete(v) : state.vibes.add(v);
    b.setAttribute("aria-pressed", state.vibes.has(v));
    applyFilters();
    if (state.selected) renderDetail(model.byId.get(state.selected));
  }));
  $$("#f-park button").forEach((b) => b.addEventListener("click", () => {
    state.park = b.dataset.v;
    $$("#f-park button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    applyFilters();
  }));
  $$("#f-park-needs button").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.v;
    state.parkNeeds.has(v) ? state.parkNeeds.delete(v) : state.parkNeeds.add(v);
    b.setAttribute("aria-pressed", state.parkNeeds.has(v));
    applyFilters();
  }));
  $$("#f-level button").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.v;
    const on = state.levels.includes(v);
    if (on && state.levels.length === 1) return; // someone is always skiing
    state.levels = LEVEL_ORDER.filter((x) => (x === v ? !on : state.levels.includes(x)));
    syncLevels();
    tripChanged();
  }));
  $("#origin").addEventListener("change", (e) => setOrigin(e.target.value));
  $("#f-snow").addEventListener("change", (e) => { state.snowSure = e.target.checked; applyFilters(); });

  $("#f-family").addEventListener("change", (e) => { state.family = e.target.checked; applyFilters(); });
  $("#f-carfree").addEventListener("change", (e) => { state.carFree = e.target.checked; applyFilters(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; applyFilters(); });

  $("#results").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) select(b.dataset.id);
  });
  // Hover or keyboard focus on a place in the list lights it up on the map, and brings it into view if it is off screen.
  const list = $("#results");
  let hoverId = null, hoverTimer = null;
  const hoverPlace = (id) => {
    if (id === hoverId) return;
    clearTimeout(hoverTimer);
    if (hoverId) markers.get(hoverId)?.el.classList.remove("is-hover");
    hoverId = id;
    if (!id) return;
    const m = markers.get(id);
    if (!m) return;
    m.el.classList.add("is-hover");
    // Wait a moment so sweeping the mouse down the list does not make the map jump about.
    hoverTimer = setTimeout(() => {
      const p = map.project(m.marker.getLngLat());
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const tools = document.querySelector(".map-tools")?.getBoundingClientRect();
      const top = tools ? tools.bottom - map.getContainer().getBoundingClientRect().top + 20 : 70;
      const inView = p.x > 40 && p.x < w - 40 && p.y > top && p.y < h - 60;
      if (!inView && !state.selected) map.easeTo({ center: m.marker.getLngLat(), duration: 600 });
    }, 350);
  };
  list.addEventListener("mouseover", (e) => hoverPlace(e.target.closest("[data-id]")?.dataset.id ?? null));
  list.addEventListener("mouseleave", () => hoverPlace(null));
  list.addEventListener("focusin", (e) => hoverPlace(e.target.closest("[data-id]")?.dataset.id ?? null));
  list.addEventListener("focusout", () => hoverPlace(null));

  // Delegated actions used by the detail panel, compare bar and table.
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-select],[data-compare],[data-pair],[data-save],[data-trip],#detail-close,#detail-min,#trip-back,#trip-close,.detail.is-min .d-head");
    if (!t) return;
    if (t.dataset.trip) return openTripSheet(t.dataset.trip);
    if (t.id === "trip-back") return closeTripSheet();
    if (t.id === "trip-close") return clearSelection();
    if (t.dataset.save) return toggleSaved(t.dataset.save);
    if (t.id === "detail-close") return clearSelection();
    if (t.id === "detail-min" || t.classList.contains("d-head")) {
      state.detailMin = !state.detailMin;
      return renderDetail(model.byId.get(state.selected));
    }
    if (t.dataset.select) { $("#compare").hidden = true; return select(t.dataset.select); }
    if (t.dataset.compare) return toggleCompare(t.dataset.compare);
    if (t.dataset.pair) return pairUp(t.dataset.pair);
  });

  $("#compare-open").addEventListener("click", () => openCompare());
  $("#compare-undo-btn").addEventListener("click", () => {
    if (!removedFromCompare) return;
    const { id, pair } = removedFromCompare;
    removedFromCompare = null;
    $("#compare-undo").hidden = true;
    if (pair) {
      if (state.pairIds && !state.pairIds.includes(id)) state.pairIds.push(id);
      renderCompareTable();
    } else {
      state.saved.add(id);
      shortlistChanged();
    }
    $("#compare").hidden = false;
  });
  $("#compare-close").addEventListener("click", () => { $("#compare").hidden = true; state.pairIds = null; });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#compare").hidden) $("#compare").hidden = true;
    else if (state.tripOpen) closeTripSheet();
    else if (state.selected) clearSelection();
  });

  const styleBtns = { satellite: $("#style-sat"), topo: $("#style-topo") };
  for (const [name, btn] of Object.entries(styleBtns)) {
    btn.addEventListener("click", () => {
      setBasemap(map, name);
      for (const [n, b] of Object.entries(styleBtns)) b.setAttribute("aria-pressed", n === name);
    });
  }

  $("#toggle-3d").addEventListener("click", (e) => {
    const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
    e.currentTarget.setAttribute("aria-pressed", on);
    setTerrain(map, on);
    map.easeTo({ pitch: on ? 58 : 0, duration: 800 });
  });

  $("#clear-map").addEventListener("click", clearMap);
  $("#clear-filters").addEventListener("click", clearMap);

  // Layers menu (phones): open and close; the options also work in the row on wide screens.
  const layersBtn = $("#layers-btn"), layersPanel = $("#layers-panel");
  const setLayers = (open) => { layersPanel.hidden = !open; layersBtn.setAttribute("aria-expanded", open); };
  layersBtn.addEventListener("click", () => setLayers(layersPanel.hidden));
  document.addEventListener("click", (e) => { if (!layersPanel.hidden && !e.target.closest("#layers")) setLayers(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !layersPanel.hidden) { setLayers(false); layersBtn.focus(); } });

  $("#toggle-snow").addEventListener("click", () => {
    state.snowLayer = !state.snowLayer;
    updateSnowLayer();
    // On a phone the key sits at the bottom, so lift the airport clear of it (or back down).
    if (!state.selected && matchMedia("(max-width: 899px)").matches) airportView(800);
    savePlan();
  });
  $$("#snow-months button").forEach((b) => b.addEventListener("click", () => {
    state.snowMonth = b.dataset.v;
    updateSnowLayer();
  }));

  $("#sidebar-toggle").addEventListener("click", () => {
    if (!sidebarOpen()) setTab("filters");
    setSidebar(!sidebarOpen());
  });
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#show-places").addEventListener("click", () => setTab("places"));
  $("#sidebar-hide").addEventListener("click", () => setSidebar(false));
  // Switching between phone and desktop layouts starts with the panel in its default state.
  matchMedia("(max-width: 899px)").addEventListener("change", () => {
    $(".app").classList.remove("side-collapsed");
    $("#sidebar").classList.remove("open");
    map.resize();
  });
}

// Phones: the panel is a sheet that slides up. Wider screens: it collapses to give the map full width.
const isNarrow = () => matchMedia("(max-width: 899px)").matches;
const sidebarOpen = () => (isNarrow()
  ? $("#sidebar").classList.contains("open")
  : !$(".app").classList.contains("side-collapsed"));

function setSidebar(open) {
  if (isNarrow()) {
    $("#sidebar").classList.toggle("open", open);
  } else {
    $(".app").classList.toggle("side-collapsed", !open);
    map.resize();
  }
  $("#sidebar-toggle").setAttribute("aria-expanded", open);
}

/* ---------- shortlist ---------- */

const SAVED_KEY = "skibase.shortlist"; // storage keys keep their old prefix so saved plans survive the rename

function setShow(show) {
  state.show = show;
  $$("#show-seg button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.show === show));
  const saved = show === "saved";
  $("#show-saved").setAttribute("aria-pressed", saved);
  $("#shortlist-tools").hidden = !saved;
  if (saved) setTab("places");
  applyFilters();
}

// The panel has two tabs: Filters to set up the search, Places to see what it finds.
function setTab(tab) {
  if (tab === "filters" && state.show === "saved") setShow("all"); // filters never apply to the shortlist
  for (const t of ["filters", "places"]) {
    $(`#tab-${t}`).setAttribute("aria-selected", t === tab);
    $(`#view-${t}`).hidden = t !== tab;
  }
  $("#sidebar").scrollTop = 0;
}

function loadShortlist() {
  try {
    const stored = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    const other = state.season === "summer" ? "winter" : "summer";
    // Older versions kept one list, which was the winter one.
    const lists = Array.isArray(stored) ? { winter: stored } : stored;
    for (const id of lists[state.season] || []) if (model.byId.has(id)) state.saved.add(id);
    for (const id of lists[other] || []) if (model.byId.has(id)) state.otherSaved.add(id);
  } catch { /* storage blocked: start empty */ }

  // A shared link (?list=a,b,c) adds its places to this browser's shortlist.
  const shared = new URLSearchParams(location.search).get("list");
  if (shared) {
    for (const id of shared.split(",")) if (model.byId.has(id)) state.saved.add(id);
    history.replaceState(null, "", location.pathname + location.hash);
    persistShortlist();
    setShow("saved");
  }
  shortlistChanged(false);
}

function persistShortlist() {
  try {
    const other = state.season === "summer" ? "winter" : "summer";
    localStorage.setItem(SAVED_KEY, JSON.stringify({ [state.season]: [...state.saved], [other]: [...state.otherSaved] }));
  } catch { /* not saved */ }
}

function toggleSaved(id) {
  state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
  shortlistChanged();
}

function shortlistChanged(persist = true) {
  if (persist) persistShortlist();
  const n = state.saved.size;
  $("#saved-count").textContent = n;
  $("#saved-compare").disabled = n < 2;
  $("#saved-compare").textContent = n > 1 ? `Compare all ${n}` : "Compare";
  $("#saved-share").disabled = n === 0;
  $("#saved-link").hidden = true;
  for (const [id, { el }] of markers) el.classList.toggle("is-saved", state.saved.has(id));
  for (const b of $$("[data-save]")) {
    const on = state.saved.has(b.dataset.save);
    b.setAttribute("aria-pressed", on);
    if (b.classList.contains("save-btn")) b.textContent = on ? "Saved" : "Save";
  }
  renderCompareBar();
  if (!$("#compare").hidden) renderCompareTable();
  applyFilters();
}

function shareShortlist() {
  copyPlanLink($("#saved-share"), $("#saved-link"));
}

/* ---------- plan: saved in the browser, and as a link ---------- */

const PLAN_KEY = "skibase.plan";
let planReopen = null;
let saveTimer = null;

function planOf() {
  return {
    v: 1,
    season: state.season,
    bikeMonths: [...state.bikeMonths],
    bike: state.bike,
    bikeNeeds: [...state.bikeNeeds],
    otherWeek: state.otherWeek,
    otherLessons: state.otherLessons,
    origin: state.origin,
    currency: state.currency,
    months: [...state.months],
    trip: { ...state.trip },
    skiAt: state.skiAt,
    show: state.show,
    maxTime: state.maxTime,
    maxHop: state.maxHop,
    prices: [...state.prices],
    sizes: [...state.sizes],
    vibes: [...state.vibes],
    countries: [...state.countries],
    family: state.family,
    carFree: state.carFree,
    snowSure: state.snowSure,
    levels: state.levels,
    park: state.park,
    parkNeeds: [...state.parkNeeds],
    snowLayer: state.snowLayer,
    sort: state.sort,
    saved: [...state.saved],
    otherSaved: [...state.otherSaved],
    selected: state.selected,
  };
}

addEventListener("pagehide", () => {
  if (!model) return;
  clearTimeout(saveTimer);
  try { localStorage.setItem(PLAN_KEY, JSON.stringify(planOf())); } catch { /* storage blocked */ }
});

function savePlan() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(planOf())); } catch { /* storage blocked */ }
  }, 300);
}

// Take what is valid from a stored or shared plan; ignore anything unknown.
function applyPlan(p, { mergeSaved = false } = {}) {
  if (!p || p.v !== 1) return;
  const ids = (xs) => (Array.isArray(xs) ? xs.filter((id) => model.byId.has(id)) : []);
  const num = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  if (model.origins.some((o) => o.id === p.origin)) state.origin = p.origin;
  state.season = p.season === "summer" ? "summer" : "winter";
  const bikeMonths = (p.bikeMonths || []).filter((m) => model.bike.months.some((x) => x.key === m));
  if (bikeMonths.length) state.bikeMonths = new Set(bikeMonths);
  state.bike = ["good", "awesome"].includes(p.bike) ? p.bike : "any";
  state.bikeNeeds = new Set((p.bikeNeeds || []).filter((f) => f in model.bike.styles));
  const [winterWeeks, summerWeeks] = [model.index.weeks, model.bike.weeks];
  const weekIn = (list, w) => (list.some((x) => x.start === w) ? w : null);
  if (p.currency === "GBP" || p.currency === "EUR") state.currency = p.currency;
  const months = (p.months || []).filter((m) => MONTHS.some((x) => x.key === m));
  if (months.length) state.months = new Set(months);
  const t = p.trip || {};
  state.trip = {
    nights: num(t.nights, 1, 21, 7),
    skiDays: Math.min(num(t.skiDays, 1, 21, 6), num(t.nights, 1, 21, 7)),
    adults: num(t.adults, 1, 12, 2),
    childAges: (Array.isArray(t.childAges) ? t.childAges : []).filter((a) => Number.isInteger(a) && a >= 0 && a <= 17).slice(0, 8),
    transport: t.transport === "car" ? "car" : "shuttle",
    lessons: ["none", "kids", "all"].includes(t.lessons) ? t.lessons : "all",
    hire: t.hire !== false,
    week: weekIn(state.season === "summer" ? summerWeeks : winterWeeks, t.week),
  };
  state.otherWeek = weekIn(state.season === "summer" ? winterWeeks : summerWeeks, p.otherWeek);
  state.otherLessons = ["none", "kids", "all"].includes(p.otherLessons) ? p.otherLessons : state.season === "summer" ? "all" : "none";
  state.skiAt = Object.fromEntries(Object.entries(p.skiAt || {}).filter(([b, r]) => model.byId.has(b) && model.byId.has(r)));
  if (["all", "resort", "base", "saved"].includes(p.show)) state.show = p.show;
  state.maxTime = num(p.maxTime, 20, 300, 300);
  state.maxHop = num(p.maxHop, 5, 60, 60);
  const prices = (p.prices || []).filter((x) => [1, 2, 3].includes(x));
  if (prices.length) state.prices = new Set(prices);
  const sizes = (p.sizes || []).filter((x) => ["small", "medium", "large", "huge"].includes(x));
  if (sizes.length) state.sizes = new Set(sizes);
  state.vibes = new Set((p.vibes || []).filter((v) => v in model.index.vibes));
  state.countries = new Set((p.countries || []).filter((c) => model.countries.some((k) => k.code === c)));
  state.family = p.family === true;
  state.carFree = p.carFree === true;
  state.snowSure = p.snowSure === true;
  // Older plans had a single "absolute beginner" switch.
  const levels = LEVEL_ORDER.filter((v) => (p.levels || []).includes(v) || (v === "first" && p.beginner === true));
  if (levels.length) state.levels = levels;
  state.park = ["good", "awesome"].includes(p.park) ? p.park : "any";
  state.parkNeeds = new Set((p.parkNeeds || []).filter((f) => f in model.index.parkFeatures));
  state.snowLayer = p.snowLayer === true;
  if (["fit", "time", "cost", "price", "altitude", "ski", "snow", "bike"].includes(p.sort)) state.sort = p.sort;
  if (mergeSaved) {
    for (const id of ids(p.saved)) state.saved.add(id);
    for (const id of ids(p.otherSaved)) state.otherSaved.add(id);
  } else {
    state.saved = new Set(ids(p.saved));
    state.otherSaved = new Set(ids(p.otherSaved));
  }
  planReopen = model.byId.has(p.selected) ? p.selected : null;
}

function restorePlan() {
  try { applyPlan(JSON.parse(localStorage.getItem(PLAN_KEY) || "null")); } catch { /* storage blocked or bad data */ }
  // A shared plan link replaces the settings and adds its shortlist to this browser's one.
  const shared = new URLSearchParams(location.search).get("plan");
  if (shared) {
    try { applyPlan(decodePlan(shared), { mergeSaved: true }); } catch { /* bad link: keep what we have */ }
    history.replaceState(null, "", location.pathname + location.hash);
  }
  persistShortlist();
}

const encodePlan = (p) => btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodePlan = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));

// Floppy disc under the zoom buttons: the plan already saves itself, so this confirms it and copies the link.
function savePlanControl() {
  const box = document.createElement("div");
  box.className = "maplibregl-ctrl maplibregl-ctrl-group save-ctrl";
  box.innerHTML = `<button type="button" id="save-plan" title="Save plan and copy its link" aria-label="Save plan and copy its link">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 3v5h7V3M8 21v-7h8v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
  </button><span class="save-tip" role="status"></span>`;
  const tip = box.querySelector(".save-tip");
  let timer;
  box.querySelector("button").addEventListener("click", async () => {
    savePlan();
    const url = `${location.origin}${location.pathname}?plan=${encodePlan(planOf())}`;
    let copied = true;
    try { await navigator.clipboard.writeText(url); } catch { copied = false; }
    tip.textContent = copied ? "Plan saved. Link copied." : "Plan saved in this browser.";
    box.classList.add("show-tip");
    clearTimeout(timer);
    timer = setTimeout(() => box.classList.remove("show-tip"), 2500);
  });
  return { onAdd: () => box, onRemove: () => box.remove() };
}

async function copyPlanLink(btn, fallbackInput) {
  const label = btn.textContent;
  const url = `${location.origin}${location.pathname}?plan=${encodePlan(planOf())}`;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Link copied";
  } catch {
    // Clipboard refused: show the link so it can be copied by hand.
    fallbackInput.value = url;
    fallbackInput.hidden = false;
    fallbackInput.select();
    btn.textContent = "Copy the link below";
  }
  setTimeout(() => { btn.textContent = label; }, 2500);
}

function renderKidAges() {
  const ages = state.trip.childAges;
  $("#kids-count").textContent = ages.length;
  $("#kids-minus").disabled = !ages.length;
  $("#kids-plus").disabled = ages.length >= 8;
  const opt = (a, sel) => `<option value="${a}"${a === sel ? " selected" : ""}>${a === 0 ? "Under 1" : a === 1 ? "1 year" : `${a} years`}</option>`;
  $("#kid-ages").innerHTML = ages.map((age, i) =>
    `<label for="kid-age-${i}">Child ${i + 1}<select id="kid-age-${i}" data-i="${i}">${Array.from({ length: 18 }, (_, a) => opt(a, age)).join("")}</select></label>`).join("");
}

// You can't ski more days than you stay nights: pull the ski days down, in the data and in the box,
// and stop the box going higher.
function keepDaysWithinNights() {
  const t = state.trip;
  if (t.skiDays > t.nights) t.skiDays = t.nights;
  if (Number($("#t-days").value) !== t.skiDays && $("#t-days").value !== "") $("#t-days").value = t.skiDays;
  $("#t-days").max = t.nights;
}

// Put every control in line with the state (after restoring a plan).
function syncControls() {
  const pressed = (sel, on) => $$(sel).forEach((b) => b.setAttribute("aria-pressed", on(b.dataset.v ?? b.dataset.show ?? b.dataset.season)));
  const t = state.trip;
  $("#origin").value = state.origin || "";
  $("#t-nights").value = t.nights;
  keepDaysWithinNights();
  $("#t-days").value = t.skiDays;
  $("#t-adults").value = t.adults;
  renderKidAges();
  $("#t-hire").checked = t.hire;
  if ($("#t-week").options.length) $("#t-week").value = t.week || "";
  pressed("#t-lessons button", (v) => v === t.lessons);
  pressed("#t-transport button", (v) => v === t.transport);
  pressed("#f-months button", (v) => state.months.has(v));
  pressed("#f-bmonths button", (v) => state.bikeMonths.has(v));
  pressed("#f-bike button", (v) => v === state.bike);
  pressed("#f-bike-needs button", (v) => state.bikeNeeds.has(v));
  pressed(".season-seg button", (v) => v === state.season);
  pressed("#f-price button", (v) => state.prices.has(Number(v)));
  pressed("#f-size button", (v) => state.sizes.has(v));
  pressed("#f-vibe button", (v) => state.vibes.has(v));
  pressed("#f-country button", (v) => state.countries.has(v));
  pressed("#show-seg button", (v) => v === state.show);
  $("#f-time").value = state.maxTime;
  $("#f-hop").value = state.maxHop;
  $("#f-family").checked = state.family;
  $("#f-carfree").checked = state.carFree;
  $("#f-snow").checked = state.snowSure;
  syncLevels();
  pressed("#f-park button", (v) => v === state.park);
  pressed("#f-park-needs button", (v) => state.parkNeeds.has(v));
  $("#sort").value = state.sort;
  $("#show-saved").setAttribute("aria-pressed", state.show === "saved");
  $("#shortlist-tools").hidden = state.show !== "saved";
  currencyChanged(false);
}

function syncLevels() {
  $$("#f-level button").forEach((b) => b.setAttribute("aria-pressed", state.levels.includes(b.dataset.v)));
}

function tripChanged() {
  applyFilters();
  if (state.snowLayer) updateSnowLayer();
  if (state.selected) {
    const top = $("#detail").scrollTop;
    renderDetail(model.byId.get(state.selected));
    $("#detail").scrollTop = top;
  }
  if (!$("#compare").hidden) renderCompareTable();
}

function renderDataNote() {
  // Band guides are written in euros; convert the figures for display.
  const guide = (g) => g.replace(/€(\d+)/g, (_, n) => curSymbol() + Math.round(toShown(Number(n)) / 5) * 5);
  const bands = Object.entries(model.priceBands).map(([k, b]) => `<li><b>${price(k)}</b> ${b.label}: ${guide(b.guide)}</li>`).join("");
  const rate = state.currency === "GBP"
    ? `<p>£ at €1 = £${state.gbpPerEur.toFixed(3)} (European Central Bank${state.rateDate ? `, ${fmtDay(state.rateDate)}` : ""}).</p>` : "";
  $("#data-note").innerHTML = `<ul class="bands">${bands}</ul>
    <p>${esc(summer() ? model.bike.costs.note : model.index.costs.note)} ${model.notes.map(esc).join(" ")}</p>${rate}`;
}

/* ---------- currency ---------- */

function setupCurrency() {
  const cfg = model.index.currency;
  state.gbpPerEur = cfg.gbpPerEur;
  state.rateDate = cfg.rateDate;
  let saved = null;
  try { saved = localStorage.getItem("skibase.currency"); } catch { /* storage blocked */ }
  state.currency = saved === "EUR" || saved === "GBP" ? saved : cfg.default;
  $$("#currency button").forEach((b) => b.addEventListener("click", () => {
    state.currency = b.dataset.v;
    try { localStorage.setItem("skibase.currency", state.currency); } catch { /* not saved */ }
    currencyChanged();
  }));
  currencyChanged(false);
  // Fetch today's rate; keep the saved one if this fails.
  fetch(cfg.liveRate).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (j?.rates?.GBP) {
      state.gbpPerEur = j.rates.GBP;
      state.rateDate = j.date;
      currencyChanged();
    }
  }).catch(() => {});
}

function currencyChanged(rerender = true) {
  $$("#currency button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === state.currency));
  const labels = { 1: "Budget", 2: "Mid", 3: "High" };
  for (const k of [1, 2, 3]) $(`#f-price-${k}`).textContent = `${price(k)} ${labels[k]}`;
  if (!rerender) return;
  renderDataNote();
  tripChanged();
}
