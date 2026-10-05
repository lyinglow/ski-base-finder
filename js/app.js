import { loadData, cheaperStays, reachable, MONTHS, SNOW_RANK, snowFor, snowAltitude } from "./data.js";
import { tripCost, skiTarget } from "./cost.js";
import { fitScore, seasonState } from "./fit.js";
import { createMap, setBasemap, setTerrain, setLinks, setReach, HOME_VIEW } from "./map.js";
/* global maplibregl */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SNOW_LABEL = { good: "Snow-sure", fair: "Usually fine", poor: "Risky" };
const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate", expert: "Expert" };
const SIZE_LABEL = { small: "Small", medium: "Medium", large: "Large", huge: "Huge" };
const MODE_LABEL = { car: "car", bus: "bus", train: "train", lift: "lift" };
const MAX_COMPARE = 4;

const state = {
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
  origin: "GVA",
  beginner: false,
  vibes: new Set(), // empty means any vibe
  trip: { nights: 7, skiDays: 6, adults: 2, childAges: [], transport: "shuttle", lessons: "all", hire: true, week: null },
  skiAt: {},
  sort: "fit",
  selected: null,
  related: new Set(),
  detailMin: false,
  tripOpen: false,
  saved: new Set(),
  compare: [],
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
  $("#origin").innerHTML = model.origins.map((o) =>
    `<option value="${o.id}"${o.id === state.origin ? " selected" : ""}>${esc(o.name)} (${o.id})</option>`).join("");
  $("#country-list").textContent = model.countries.map((c) => c.name).join(", ");
  setupCurrency();
  restorePlan(); // last visit, or a shared plan link
  renderDataNote();
  loadShortlist();

  map = createMap("map");
  for (const o of model.origins) addOriginMarker(o);
  updateOriginMarkers();
  for (const l of model.locations) addMarker(l);
  map.on("zoom", updateLabelMode);
  updateLabelMode();

  map.once("load", () => { if (!state.selected) airportView(); updateReach(lastVisible); });
  syncControls();
  bindControls();
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
const travel = (l) => l.fromOrigin[state.origin];
const originName = () => model.origins.find((o) => o.id === state.origin).name;
const typeLabel = (l) => (l.type === "resort" ? "Resort" : "Feeder town");
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

const tripMonths = () => MONTHS.map((m) => m.key).filter((k) => state.months.has(k));
const monthNames = () => {
  const ks = tripMonths();
  return ks.length === MONTHS.length ? "the whole season" : ks.map((k) => MONTHS.find((m) => m.key === k).label).join(", ");
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
const money = (n) => curSymbol() + (Math.round(toShown(n) / 10) * 10).toLocaleString("en-GB");
const tripOf = () => ({ ...state.trip, months: tripMonths(), origin: state.origin });
const kidsText = (ages) => ages.length === 1 ? `1 child aged ${ages[0]}` : `${ages.length} children aged ${ages.slice(0, -1).join(", ")} and ${ages[ages.length - 1]}`;

// Fit score for the current trip. Season dates only count once a specific week is chosen.
function fitOf(l) {
  return fitScore(l, {
    model,
    childAges: state.trip.childAges,
    snowOf,
    travel,
    dates: state.trip.week ? stayDates() : null,
  });
}
// stay in `place`, ski `ski` (defaults to itself, or the chosen or nearest resort for a town).
const costOf = (place, ski) => tripCost(place, ski || skiTarget(place, model, state.skiAt[place.id]), tripOf(), model);

function costBreakdown(cost) {
  const p = cost.parts;
  const row = (label, v, note = "") => `<li><span>${label}${note ? `<small>${note}</small>` : ""}</span><b>${money(v)}</b></li>`;
  const t = state.trip;
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
  el.addEventListener("click", (e) => { e.stopPropagation(); setOrigin(o.id); });
  new maplibregl.Marker({ element: el, opacityWhenCovered: "0.7" }).setLngLat(o.coords).addTo(map);
  originMarkers.set(o.id, el);
}

function updateOriginMarkers() {
  for (const [id, el] of originMarkers) el.classList.toggle("is-current", id === state.origin);
}

function setOrigin(id) {
  state.origin = id;
  $("#origin").value = id;
  updateOriginMarkers();
  tripChanged();
  if (!state.selected) airportView(1400);
}

/* ---------- airport view: airport at the bottom, everywhere you can reach above it ---------- */

let lastVisible = [];
let reachMarker = null;

function airportView(duration = 0) {
  const origin = model.origins.find((o) => o.id === state.origin);
  const places = (lastVisible.length ? lastVisible : model.locations).map((l) => l.coords);
  if (!places.length) return;
  // Face from the airport toward the middle of the places, so the airport sits at the bottom.
  const c = places.reduce((a, p) => [a[0] + p[0] / places.length, a[1] + p[1] / places.length], [0, 0]);
  const lat = (origin.coords[1] * Math.PI) / 180;
  const bearing = (Math.atan2((c[0] - origin.coords[0]) * Math.cos(lat), c[1] - origin.coords[1]) * 180) / Math.PI;
  const bounds = places.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(origin.coords, origin.coords));
  const narrow = matchMedia("(max-width: 899px)").matches;
  const cam = map.cameraForBounds(bounds, {
    bearing,
    padding: narrow ? { top: 70, bottom: 60, left: 30, right: 30 } : { top: 80, bottom: 110, left: 60, right: 90 },
  });
  if (!cam) return;
  const view = { ...cam, pitch: 45 };
  duration ? map.flyTo({ ...view, duration }) : map.jumpTo(view);
}

// Line and label from the airport to the furthest place currently on show.
function updateReach(visible) {
  lastVisible = visible;
  reachMarker?.remove();
  reachMarker = null;
  if (!map || state.selected || !visible.length) { if (map) setReach(map, []); return; }
  const origin = model.origins.find((o) => o.id === state.origin);
  const far = visible.reduce((a, b) => (travel(b).min > travel(a).min ? b : a));
  setReach(map, [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [origin.coords, far.coords] } }]);
  const el = document.createElement("span");
  el.className = "minutes reach";
  el.textContent = `Furthest: ${far.name} · ${mins(travel(far).min)}`;
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

function passes(l) {
  if (!travel(l)) return false; // no route recorded from this airport
  // The shortlist ignores the filters so saved places never disappear.
  if (state.show === "saved") return state.saved.has(l.id);
  if (state.show !== "all" && l.type !== state.show) return false;
  if (state.beginner && !l.easyStart) return false; // resorts only, walk to the beginner slopes
  if (state.maxTime < 300 && travel(l).min > state.maxTime) return false; // the top of the slider means any time
  if (l.type === "base" && reachable(l, model.byId)[0].link.min > state.maxHop) return false;
  if (!state.prices.has(l.price)) return false;
  if (state.family && !l.family) return false;
  if (state.vibes.size && !l.vibes.some((v) => state.vibes.has(v))) return false;
  if (state.carFree && !l.carFree) return false;
  if (state.snowSure && snowOf(l) !== "good") return false;
  if (state.trip.week && fitOf(l)?.closed) return false; // closed for the chosen week
  if (l.type === "resort") return state.sizes.has(l.skiSize);
  return reachable(l, model.byId).some((r) => state.sizes.has(r.place.skiSize));
}

function sortKey(l) {
  switch (state.sort) {
    case "price": return [l.price, travel(l).min];
    case "altitude": return [-l.altitude, travel(l).min];
    case "fit": return [-fitOf(l).score, costOf(l).total];
    case "cost": return [costOf(l).total, travel(l).min];
    case "snow": return [-SNOW_RANK[snowOf(l)], -(l.type === "resort" ? snowAltitude(l) : snowAltitude(bestSnowFrom(l).place))];
    case "ski": return [-(l.skiArea?.pisteKm ?? bestSkiFrom(l)?.place.skiArea.pisteKm ?? 0), travel(l).min];
    default: return [travel(l).min, l.price];
  }
}

function applyFilters() {
  const visible = model.locations.filter(passes);
  const ids = new Set(visible.map((l) => l.id));
  for (const [id, { el }] of markers) el.hidden = !ids.has(id) && !state.related.has(id);

  visible.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || a.name.localeCompare(b.name);
  });

  const n = visible.length;
  const nb = visible.filter((l) => l.type === "base").length;
  $("#result-count").textContent = `${n} place${n === 1 ? "" : "s"} · ${nb} feeder town${nb === 1 ? "" : "s"}`;
  const emptyText = state.show === "saved"
    ? "Nothing saved yet. Open a resort or town and tap Save."
    : "Nothing matches. Try a longer travel time or more price levels.";
  $("#results").innerHTML = n ? visible.map(resultItem).join("") : `<li class="empty">${emptyText}</li>`;
  updateReach(visible);
  savePlan();
}

function tripTitle(l) {
  return l.type === "resort" ? `staying in ${l.name}` : `staying in ${l.name}, skiing ${skiTarget(l, model, state.skiAt[l.id]).name}`;
}

function resultItem(l) {
  const t = travel(l);
  let sub;
  if (l.type === "resort") {
    sub = `${esc(l.skiArea.name)} · ${l.skiArea.pisteKm} km`;
  } else {
    const r = reachable(l, model.byId);
    sub = `${r.length} resort${r.length === 1 ? "" : "s"} within ${mins(r[r.length - 1].link.min)}`;
  }
  return `<li><button type="button" class="result ${l.type}${l.id === state.selected ? " is-active" : ""}" data-id="${l.id}">
    <i class="dot ${l.type}"></i>
    <span class="r-main"><span class="r-name"><b class="fit-pill" title="Beginner and family fit">${fitOf(l).score}</b>${esc(l.name)}${state.saved.has(l.id) ? ` <i class="saved-star" aria-label="saved">★</i>` : ""}</span><span class="r-sub">${sub}</span></span>
    <span class="r-side"><span class="r-time">${mins(t.min)}</span><span class="r-price" title="Trip cost: ${esc(tripTitle(l))}">${money(costOf(l).total)} ${flake(snowOf(l), l.type === "resort" ? `${SNOW_LABEL[snowOf(l)]} for ${monthNames()}` : `Best nearby: ${SNOW_LABEL[snowOf(l)]}`)}</span></span>
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

  state.related = related;
  for (const [mid, { el }] of markers) {
    el.classList.toggle("is-selected", mid === id);
    el.classList.toggle("is-related", related.has(mid) && mid !== id);
  }
  $("#map").classList.add("has-selection");
  drawLinks(pairs, id);
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
  applyFilters();
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
  const sub = place.type === "resort"
    ? `${place.skiArea.pisteKm} km of pistes ${levelDots(place.levels)}`
    : `${typeLabel(place)} · ${place.altitude} m`;
  const inCompare = state.compare.includes(place.id);
  return `<li class="link-row">
    <button type="button" class="lr-main" data-select="${place.id}">
      <i class="dot ${place.type}"></i>
      <span><span class="lr-name">${esc(place.name)} <em>${price(place.price)}</em></span>
      <span class="lr-sub">${sub}</span>${gain}${cost}</span>
    </button>
    <span class="lr-hop"><strong>${mins(link.min)}</strong><span>${esc(accessText(link))}</span></span>
    <button type="button" class="add" data-compare="${place.id}" aria-pressed="${inCompare}" title="Add to compare">${inCompare ? "Added" : "Compare"}</button>
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
const MONTH_INDEX = { dec: 11, jan: 0, feb: 1, mar: 2, apr: 3 };

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
  const where = encodeURIComponent(`${town}, France`);
  const guests = t.adults + t.childAges.length;
  const kids = t.childAges.map((a) => `age=${a}`).join("&");
  const when = new Date(arrive + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const g = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const links = [
    ["Booking.com", "Hotels and apartments",
      `https://www.booking.com/searchresults.html?ss=${where}&checkin=${arrive}&checkout=${leave}&group_adults=${t.adults}&group_children=${t.childAges.length}&no_rooms=1${kids ? "&" + kids : ""}`],
    ["Airbnb", "Homes and chalets",
      `https://www.airbnb.com/s/${encodeURIComponent(`${town}--France`)}/homes?checkin=${arrive}&checkout=${leave}&adults=${t.adults}&children=${t.childAges.length}`],
    ["Abritel", "French holiday rentals (Vrbo)",
      `https://www.abritel.fr/search?destination=${where}&startDate=${arrive}&endDate=${leave}&adults=${guests}`],
    ["Ski apartment deals", "Pierre & Vacances, Maeva and others (web search)",
      g(`${town} ski apartment and lift pass deal ${when}`)],
    ["Package holidays", "Tour operators with flights or transfers (web search)",
      g(`${town} ski package holiday ${when}`)],
  ];
  const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `<section class="stay">
      <span class="s-label">Places to stay</span>
      <p class="hint">${esc(town)}, ${fmt(arrive)} to ${fmt(leave)}, ${guests} guest${guests === 1 ? "" : "s"}. Opens in a new tab.</p>
      <ul class="stay-links">${links.map(([name, what, url]) =>
        `<li><a href="${url}" target="_blank" rel="noopener"><b>${esc(name)}</b><span>${esc(what)}</span><i aria-hidden="true">↗</i></a></li>`).join("")}</ul>
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

function fitSection(l) {
  const f = fitOf(l);
  const who = state.trip.childAges.length ? `beginners with ${kidsText(state.trip.childAges)}` : "beginners";
  return `<section class="fit">
      <span class="s-label">Beginner and family fit</span>
      <p class="fit-head"><b class="fit-score">${f.score}</b><span><strong>${fitBand(f.score)}</strong> for ${who}${l.type === "base" ? `, skiing ${esc(f.resort.name)}` : ""}</span></p>
      <ul class="fit-reasons">${f.reasons.map((r) => `<li class="${r.ok ? "ok" : "no"}">${esc(r.text)}</li>`).join("")}</ul>
    </section>`;
}

function tripTeaser(l) {
  const cost = costOf(l);
  const skiing = l.type === "base" ? ` · skiing ${esc(cost.ski.name)}` : "";
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
  if (l.type === "base") {
    const options = reachable(l, model.byId);
    picker = `<label class="ski-at" for="ski-at">Skiing at
      <select id="ski-at" data-base="${l.id}">${options.map((r) =>
        `<option value="${r.place.id}"${r.place.id === cost.ski.id ? " selected" : ""}>${esc(r.place.name)} · ${mins(r.link.min)} by ${accessShort(r.link.by)}</option>`).join("")}</select></label>`;
    const link = options.find((r) => r.place.id === cost.ski.id).link;
    picker += `<p class="access"><span class="s-label">Getting up</span>${esc(accessText(link))} · ${mins(link.min)}</p>`;
  }
  return `<section class="trip">
      <span class="s-label">Trip cost</span>
      <p class="trip-total"><strong>${money(cost.total)}</strong> <span>${money(cost.perPerson)} per person</span></p>
      <p class="trip-who">${who}, ${t.nights} nights, ${t.skiDays} ski days, ${cost.week ? `week of ${new Date(cost.week.start + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })} (${esc(cost.week.label)})` : monthNames()}</p>
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
      ${stat(`From ${state.origin}`, mins(t.min), `${t.km} km`)}
      ${stat("Altitude", `${l.altitude} m`, l.topAltitude ? `top ${l.topAltitude} m` : "village")}
      ${stat("Price to stay", band.symbol, band.label)}
      ${stat("Town", SIZE_LABEL[l.townSize], l.family ? "Family-friendly" : "Better for adults")}
    </div>`;

  const getting = `<p class="getting"><span class="s-label">Getting there from Geneva</span>${esc(l.transfer)}${l.rail ? ` <span class="badge">${esc(l.rail)}</span>` : ""}${l.carFree ? ` <span class="badge good">No car needed</span>` : ""}</p>`;

  let body = tripTeaser(l) + fitSection(l);
  if (l.type === "resort") {
    const cheaper = cheaperStays(l, model.byId);
    body += `<section class="ski">
        <span class="s-label">Ski area</span>
        <p><strong>${esc(l.skiArea.name)}</strong> · ${l.skiArea.pisteKm} km · ${SIZE_LABEL[l.skiSize]}</p>
        <p class="suits">Suits ${levelDots(l.levels)} ${l.levels.map((v) => LEVEL_LABEL[v]).join(", ")}</p>
        ${l.easyStart ? `<p class="easy-start"><strong>Good for first-timers.</strong> ${esc(l.easyStart)}</p>` : ""}
        <p class="season-line">Usually open ${seasonText(l)}${state.trip.week ? seasonWarn(l) : ""}</p>
      </section>
      <section class="school">
        <span class="s-label">Ski school</span>
        <p>${schoolText(l)}</p>
      </section>`;
    const s = snowOf(l);
    body += `<section class="snow">
        <span class="s-label">Snow</span>
        <p class="snow-verdict ${s}">${flake(s)} <strong>${SNOW_LABEL[s]}</strong> for ${monthNames()}</p>
        ${snowMonths(l)}
        <p class="snow-note">Estimated from altitude: skiing up to ${l.topAltitude} m, village at ${l.altitude} m.${l.snowNote ? ` ${esc(l.snowNote)}` : ""}</p>
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
      </section>`;
    body += `<section class="alt">
        <h3>Resorts within reach</h3>
        <p class="hint">${r.length} resort${r.length === 1 ? "" : "s"}, nearest in ${mins(r[0].link.min)}.${savings.length ? ` Cheaper than staying in ${savings.length} of them.` : ""}</p>
        <ul class="link-list">${r.map((c) => placeRow(c, null, { fromBase: l })).join("")}</ul>
        <button type="button" class="primary wide" data-pair="${l.id}">Compare with nearest resorts</button>
      </section>`;
  }

  const inCompare = state.compare.includes(l.id);
  const isSaved = state.saved.has(l.id);
  const foot = `<footer class="d-foot">
      <button type="button" class="secondary save-btn" data-save="${l.id}" aria-pressed="${isSaved}">${isSaved ? "Saved" : "Save"}</button>
      <button type="button" class="secondary" data-compare="${l.id}" aria-pressed="${inCompare}">${inCompare ? "In compare" : "Add to compare"}</button>
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

function toggleCompare(id, force) {
  const has = state.compare.includes(id);
  const want = force ?? !has;
  if (want && !has) {
    if (state.compare.length >= MAX_COMPARE) state.compare.shift();
    state.compare.push(id);
  } else if (!want && has) {
    state.compare = state.compare.filter((x) => x !== id);
  }
  renderCompareBar();
  if (state.selected) renderDetail(model.byId.get(state.selected));
  if (!$("#compare").hidden) renderCompareTable();
}

function pairUp(id) {
  const l = model.byId.get(id);
  const others = l.type === "resort"
    ? cheaperStays(l, model.byId).map((x) => x.place.id)
    : reachable(l, model.byId).map((x) => x.place.id);
  state.compare = [id, ...others].slice(0, MAX_COMPARE);
  renderCompareBar();
  openCompare();
}

function renderCompareBar() {
  const bar = $("#compare-bar");
  bar.hidden = state.compare.length === 0;
  $("#compare-chips").innerHTML = state.compare.map((id) => {
    const l = model.byId.get(id);
    return `<span class="chip ${l.type}"><i class="dot ${l.type}"></i>${esc(l.name)}<button type="button" data-compare="${id}" aria-label="Remove ${esc(l.name)}">×</button></span>`;
  }).join("");
  $("#compare-open").textContent = `Compare ${state.compare.length}`;
  $("#compare-open").disabled = state.compare.length < 2;
}

function openCompare() {
  renderCompareTable();
  $("#compare").hidden = false;
}

// A town in the table is costed against a resort it reaches that is also in the table, if any.
function compareCost(l, cols) {
  if (l.type === "resort") return costOf(l);
  const reach = new Set((l.links || []).map((k) => k.to));
  const match = cols.find((c) => c.type === "resort" && reach.has(c.id));
  return costOf(l, match);
}

function renderCompareTable() {
  const cols = state.compare.map((id) => model.byId.get(id));
  if (!cols.length) { $("#compare").hidden = true; return; }

  const best = (vals, pick) => {
    const nums = vals.filter((v) => Number.isFinite(v));
    if (nums.length < 2) return () => false;
    const target = pick(...nums);
    return (v) => v === target && nums.some((n) => n !== target);
  };

  const rows = [
    {
      label: "Trip cost",
      vals: cols.map((l) => compareCost(l, cols).total),
      win: Math.min,
      cell: (l) => {
        const c = compareCost(l, cols);
        return `${money(c.total)}<small>${l.type === "resort" ? "staying here" : `skiing ${esc(c.ski.name)}`}, ${money(c.perPerson)} each</small>`;
      },
    },
    {
      label: "From airport",
      vals: cols.map((l) => travel(l).min),
      win: Math.min,
      cell: (l) => `${mins(travel(l).min)}<small>${travel(l).km} km</small>`,
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
      label: "Daily hop to the slopes",
      vals: cols.map((l) => (l.type === "resort" ? 0 : reachable(l, model.byId)[0].link.min)),
      win: Math.min,
      cell: (l) => {
        if (l.type === "resort") return `On the slopes`;
        const n = reachable(l, model.byId)[0];
        return `${mins(n.link.min)}<small>to ${esc(n.place.name)} by ${modes(n.link.by)}</small>`;
      },
    },
    {
      label: "Resorts within 30 min",
      vals: cols.map((l) => (l.type === "base" ? reachable(l, model.byId).filter((x) => x.link.min <= 30).length : NaN)),
      win: Math.max,
      cell: (l) => (l.type === "base" ? String(reachable(l, model.byId).filter((x) => x.link.min <= 30).length) : "—"),
    },
    {
      label: "Beginner fit",
      vals: cols.map((l) => fitOf(l).score),
      win: Math.max,
      cell: (l) => `${fitOf(l).score}<small>${fitBand(fitOf(l).score)}</small>`,
    },
    {
      label: "Ski school",
      cell: (l) => {
        const r = l.type === "resort" ? l : fitOf(l).resort;
        const e = { many: "Several English-speaking", some: "Some English", few: "English limited" }[r.school.english];
        return `${e}<small>Kids from ${r.school.skiFrom}${r.school.crecheFromMonths ? `, crèche from ${r.school.crecheFromMonths} months` : ""}</small>`;
      },
    },
    { label: "Suits", cell: (l) => (l.levels ? levelDots(l.levels) : l.type === "base" ? "Depends on the resort" : "—") },
    {
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
  ];

  const headRow = `<tr><th scope="col"></th>${cols.map((l) => `<th scope="col" class="${l.type}">
      <span class="eyebrow"><i class="dot ${l.type}"></i>${typeLabel(l)}</span>
      <button type="button" class="col-name" data-select="${l.id}">${esc(l.name)}</button>
      <button type="button" class="col-x" data-compare="${l.id}" aria-label="Remove ${esc(l.name)}">Remove</button>
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

function bindControls() {
  $$("#show-seg button").forEach((b) => b.addEventListener("click", () => setShow(b.dataset.show)));
  $("#show-saved").addEventListener("click", () => setShow(state.show === "saved" ? "all" : "saved"));

  $("#saved-compare").addEventListener("click", () => {
    state.compare = [...state.saved].slice(0, MAX_COMPARE);
    renderCompareBar();
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
  $("#f-months").addEventListener("click", () => {
    // Month choice changes every snow rating, so redraw open panels too.
    if (state.selected) renderDetail(model.byId.get(state.selected));
    if (!$("#compare").hidden) renderCompareTable();
  });
  const tripInputs = { nights: "#t-nights", skiDays: "#t-days", adults: "#t-adults" };
  for (const [key, sel] of Object.entries(tripInputs)) {
    $(sel).addEventListener("input", (e) => {
      const el = e.target;
      const v = Math.round(Number(el.value));
      if (!Number.isFinite(v) || v < +el.min || v > +el.max) return; // wait for a valid number
      state.trip[key] = v;
      if (key === "nights" && state.trip.skiDays > v) { state.trip.skiDays = v; $("#t-days").value = v; }
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

  // Week picker: Saturdays across the season, labelled with school holidays.
  const weekSel = $("#t-week");
  const shortDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  weekSel.innerHTML = `<option value="">Any week in my months</option>` + model.index.weeks.map((w) =>
    `<option value="${w.start}">${shortDate(w.start)} · ${esc(w.label)} · ${w.crowd}</option>`).join("");
  const showWeekNote = () => {
    const w = model.index.weeks.find((x) => x.start === state.trip.week);
    $("#week-note").textContent = w
      ? `${w.note} Prices about ${Math.round(w.factor * 100)}% of a normal week.`
      : "Pick a week to see school holidays, crowds and which resorts are open.";
    $("#week-note").dataset.crowd = w ? w.crowd : "";
  };
  showWeekNote();
  weekSel.addEventListener("change", () => {
    state.trip.week = weekSel.value || null;
    if (state.trip.week) {
      // The week decides the snow month too.
      const key = MONTHS[[11, 0, 1, 2, 3].indexOf(new Date(state.trip.week + "T12:00:00").getMonth())]?.key;
      if (key) {
        state.months = new Set([key]);
        $$("#f-months button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === key));
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
  $("#f-beginner").addEventListener("click", (e) => {
    state.beginner = !state.beginner;
    e.currentTarget.setAttribute("aria-pressed", state.beginner);
    applyFilters();
  });
  $("#origin").addEventListener("change", (e) => setOrigin(e.target.value));
  $("#f-snow").addEventListener("change", (e) => { state.snowSure = e.target.checked; applyFilters(); });

  $("#f-family").addEventListener("change", (e) => { state.family = e.target.checked; applyFilters(); });
  $("#f-carfree").addEventListener("change", (e) => { state.carFree = e.target.checked; applyFilters(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; applyFilters(); });

  $("#results").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) select(b.dataset.id);
  });

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

  $("#compare-open").addEventListener("click", openCompare);
  $("#compare-close").addEventListener("click", () => { $("#compare").hidden = true; });
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

  $("#reset-view").addEventListener("click", () => airportView(1400));

  $("#sidebar-toggle").addEventListener("click", () => setSidebar(!sidebarOpen()));
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

const SAVED_KEY = "skibase.shortlist";

function setShow(show) {
  state.show = show;
  $$("#show-seg button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.show === show));
  const saved = show === "saved";
  $("#show-saved").setAttribute("aria-pressed", saved);
  $(".filters").hidden = saved;
  $("#shortlist-tools").hidden = !saved;
  applyFilters();
}

function loadShortlist() {
  try {
    for (const id of JSON.parse(localStorage.getItem(SAVED_KEY) || "[]")) {
      if (model.byId.has(id)) state.saved.add(id);
    }
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
  try { localStorage.setItem(SAVED_KEY, JSON.stringify([...state.saved])); } catch { /* not saved */ }
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
  $("#saved-compare").textContent = n > MAX_COMPARE ? `Compare first ${MAX_COMPARE}` : "Compare";
  $("#saved-share").disabled = n === 0;
  $("#saved-link").hidden = true;
  for (const [id, { el }] of markers) el.classList.toggle("is-saved", state.saved.has(id));
  for (const b of $$("[data-save]")) {
    const on = state.saved.has(b.dataset.save);
    b.setAttribute("aria-pressed", on);
    if (b.classList.contains("save-btn")) b.textContent = on ? "Saved" : "Save";
  }
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
    family: state.family,
    carFree: state.carFree,
    snowSure: state.snowSure,
    beginner: state.beginner,
    sort: state.sort,
    saved: [...state.saved],
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
  if (p.currency === "GBP" || p.currency === "EUR") state.currency = p.currency;
  const months = (p.months || []).filter((m) => MONTHS.some((x) => x.key === m));
  if (months.length) state.months = new Set(months);
  const t = p.trip || {};
  state.trip = {
    nights: num(t.nights, 1, 21, 7),
    skiDays: num(t.skiDays, 1, 21, 6),
    adults: num(t.adults, 1, 12, 2),
    childAges: (Array.isArray(t.childAges) ? t.childAges : []).filter((a) => Number.isInteger(a) && a >= 0 && a <= 17).slice(0, 8),
    transport: t.transport === "car" ? "car" : "shuttle",
    lessons: ["none", "kids", "all"].includes(t.lessons) ? t.lessons : "all",
    hire: t.hire !== false,
    week: model.index.weeks.some((w) => w.start === t.week) ? t.week : null,
  };
  state.skiAt = Object.fromEntries(Object.entries(p.skiAt || {}).filter(([b, r]) => model.byId.has(b) && model.byId.has(r)));
  if (["all", "resort", "base", "saved"].includes(p.show)) state.show = p.show;
  state.maxTime = num(p.maxTime, 20, 300, 300);
  state.maxHop = num(p.maxHop, 5, 60, 60);
  const prices = (p.prices || []).filter((x) => [1, 2, 3].includes(x));
  if (prices.length) state.prices = new Set(prices);
  const sizes = (p.sizes || []).filter((x) => ["small", "medium", "large", "huge"].includes(x));
  if (sizes.length) state.sizes = new Set(sizes);
  state.vibes = new Set((p.vibes || []).filter((v) => v in model.index.vibes));
  state.family = p.family === true;
  state.carFree = p.carFree === true;
  state.snowSure = p.snowSure === true;
  state.beginner = p.beginner === true;
  if (["fit", "time", "cost", "price", "altitude", "ski", "snow"].includes(p.sort)) state.sort = p.sort;
  if (mergeSaved) for (const id of ids(p.saved)) state.saved.add(id);
  else state.saved = new Set(ids(p.saved));
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
  try { localStorage.setItem(SAVED_KEY, JSON.stringify([...state.saved])); } catch { /* not saved */ }
}

const encodePlan = (p) => btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodePlan = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));

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

// Put every control in line with the state (after restoring a plan).
function syncControls() {
  const pressed = (sel, on) => $$(sel).forEach((b) => b.setAttribute("aria-pressed", on(b.dataset.v ?? b.dataset.show)));
  const t = state.trip;
  $("#origin").value = state.origin;
  $("#t-nights").value = t.nights;
  $("#t-days").value = t.skiDays;
  $("#t-adults").value = t.adults;
  renderKidAges();
  $("#t-hire").checked = t.hire;
  if ($("#t-week").options.length) $("#t-week").value = t.week || "";
  pressed("#t-lessons button", (v) => v === t.lessons);
  pressed("#t-transport button", (v) => v === t.transport);
  pressed("#f-months button", (v) => state.months.has(v));
  pressed("#f-price button", (v) => state.prices.has(Number(v)));
  pressed("#f-size button", (v) => state.sizes.has(v));
  pressed("#f-vibe button", (v) => state.vibes.has(v));
  pressed("#show-seg button", (v) => v === state.show);
  $("#f-time").value = state.maxTime;
  $("#f-hop").value = state.maxHop;
  $("#f-family").checked = state.family;
  $("#f-carfree").checked = state.carFree;
  $("#f-snow").checked = state.snowSure;
  $("#f-beginner").setAttribute("aria-pressed", state.beginner);
  $("#sort").value = state.sort;
  $("#show-saved").setAttribute("aria-pressed", state.show === "saved");
  $(".filters").hidden = state.show === "saved";
  $("#shortlist-tools").hidden = state.show !== "saved";
  currencyChanged(false);
}

function tripChanged() {
  applyFilters();
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
    <p>${esc(model.index.costs.note)} ${model.notes.map(esc).join(" ")}</p>${rate}`;
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
