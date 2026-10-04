import { loadData, cheaperStays, reachable, MONTHS, SNOW_RANK, snowFor, snowAltitude } from "./data.js";
import { tripCost, skiTarget } from "./cost.js";
import { createMap, setBasemap, setTerrain, setLinks, HOME_VIEW } from "./map.js";
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
  beginner: false,
  vibes: new Set(), // empty means any vibe
  trip: { nights: 7, skiDays: 6, adults: 2, children: 0, transport: "shuttle" },
  skiAt: {},
  sort: "time",
  selected: null,
  related: new Set(),
  detailMin: false,
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
  $("#origin-name").textContent = model.origin.name;
  $("#country-list").textContent = model.countries.map((c) => c.name).join(", ");
  renderDataNote();
  loadShortlist();

  map = createMap("map");
  addOriginMarker();
  for (const l of model.locations) addMarker(l);
  map.on("zoom", updateLabelMode);
  updateLabelMode();

  bindControls();
  applyFilters();

  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (model.byId.has(fromHash)) map.once("load", () => select(fromHash));
}

/* ---------- formatting ---------- */

const mins = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
const price = (p) => model.priceBands[p].symbol;
const travel = (l) => l.fromOrigin[model.origin.id];
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

const money = (n) => "€" + (Math.round(n / 10) * 10).toLocaleString("en-GB");
const tripOf = () => ({ ...state.trip, months: tripMonths() });
// stay in `place`, ski `ski` (defaults to itself, or the chosen or nearest resort for a town).
const costOf = (place, ski) => tripCost(place, ski || skiTarget(place, model, state.skiAt[place.id]), tripOf(), model);

function costBreakdown(cost) {
  const p = cost.parts;
  const row = (label, v, note = "") => `<li><span>${label}${note ? `<small>${note}</small>` : ""}</span><b>${money(v)}</b></li>`;
  const t = state.trip;
  return `<ul class="cost-lines">
    ${row("Accommodation", p.accommodation, `${t.nights} nights`)}
    ${row("Lift passes", p.liftPasses, `${t.skiDays} days, ${esc(cost.ski.skiArea.name)}`)}
    ${row("Airport transfers", p.airport, state.trip.transport === "car" || cost.needsCar ? "Hire car, fuel and tolls" : "Shared shuttle, return")}
    ${row("Daily trips to the slopes", p.daily, cost.dailyHow)}
  </ul>`;
}

function bestSkiFrom(place) {
  return reachable(place, model.byId).reduce(
    (best, r) => (!best || r.place.skiArea.pisteKm > best.place.skiArea.pisteKm ? r : best), null);
}

/* ---------- markers ---------- */

function addOriginMarker() {
  const el = document.createElement("div");
  el.className = "marker origin";
  el.innerHTML = `<span class="pin"></span><span class="tag">${esc(model.origin.id)}</span>`;
  new maplibregl.Marker({ element: el, opacityWhenCovered: "0.7" }).setLngLat(model.origin.coords).addTo(map);
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
  // The shortlist ignores the filters so saved places never disappear.
  if (state.show === "saved") return state.saved.has(l.id);
  if (state.show !== "all" && l.type !== state.show) return false;
  if (state.beginner && !l.easyStart) return false; // resorts only, walk to the beginner slopes
  if (travel(l).min > state.maxTime) return false;
  if (l.type === "base" && reachable(l, model.byId)[0].link.min > state.maxHop) return false;
  if (!state.prices.has(l.price)) return false;
  if (state.family && !l.family) return false;
  if (state.vibes.size && !l.vibes.some((v) => state.vibes.has(v))) return false;
  if (state.carFree && !l.carFree) return false;
  if (state.snowSure && snowOf(l) !== "good") return false;
  if (l.type === "resort") return state.sizes.has(l.skiSize);
  return reachable(l, model.byId).some((r) => state.sizes.has(r.place.skiSize));
}

function sortKey(l) {
  switch (state.sort) {
    case "price": return [l.price, travel(l).min];
    case "altitude": return [-l.altitude, travel(l).min];
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
    <span class="r-main"><span class="r-name">${esc(l.name)}${state.saved.has(l.id) ? ` <i class="saved-star" aria-label="saved">★</i>` : ""}</span><span class="r-sub">${sub}</span></span>
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

function tripSection(l) {
  const cost = costOf(l);
  const t = state.trip;
  const who = `${t.adults} adult${t.adults === 1 ? "" : "s"}${t.children ? `, ${t.children} child${t.children === 1 ? "" : "ren"}` : ""}`;
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
      <p class="trip-who">${who}, ${t.nights} nights, ${t.skiDays} ski days, ${monthNames()}</p>
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
      <p class="character">${esc(l.character)}</p>
      ${vibePills(l)}
      <div class="d-actions">
        <button type="button" class="icon-btn save-icon" data-save="${l.id}" aria-pressed="${state.saved.has(l.id)}" aria-label="Save to shortlist" title="Save to shortlist"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="var(--star-fill, none)" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
        <button type="button" class="icon-btn" id="detail-min" aria-expanded="${!state.detailMin}" aria-label="${state.detailMin ? "Expand details" : "Minimise details"}" title="${state.detailMin ? "Expand" : "Minimise"}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button type="button" class="icon-btn" id="detail-close" aria-label="Close details" title="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
    </header>`;

  const stats = `<div class="stats">
      ${stat("From airport", mins(t.min), `${t.km} km`)}
      ${stat("Altitude", `${l.altitude} m`, l.topAltitude ? `top ${l.topAltitude} m` : "village")}
      ${stat("Price to stay", band.symbol, band.label)}
      ${stat("Town", SIZE_LABEL[l.townSize], l.family ? "Family-friendly" : "Better for adults")}
    </div>`;

  const getting = `<p class="getting"><span class="s-label">Getting there</span>${esc(l.transfer)}${l.rail ? ` <span class="badge">${esc(l.rail)}</span>` : ""}${l.carFree ? ` <span class="badge good">No car needed</span>` : ""}</p>`;

  let body = tripSection(l);
  if (l.type === "resort") {
    const cheaper = cheaperStays(l, model.byId);
    body += `<section class="ski">
        <span class="s-label">Ski area</span>
        <p><strong>${esc(l.skiArea.name)}</strong> · ${l.skiArea.pisteKm} km · ${SIZE_LABEL[l.skiSize]}</p>
        <p class="suits">Suits ${levelDots(l.levels)} ${l.levels.map((v) => LEVEL_LABEL[v]).join(", ")}</p>
        ${l.easyStart ? `<p class="easy-start"><strong>Good for first-timers.</strong> ${esc(l.easyStart)}</p>` : ""}
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

  const chipSet = (sel, set, parse) => $$(`${sel} button`).forEach((b) => b.addEventListener("click", () => {
    const v = parse(b.dataset.v);
    const on = set.has(v);
    if (on && set.size === 1) return; // keep at least one
    on ? set.delete(v) : set.add(v);
    b.setAttribute("aria-pressed", !on);
    applyFilters();
  }));
  chipSet("#f-price", state.prices, Number);
  chipSet("#f-size", state.sizes, String);
  chipSet("#f-months", state.months, String);
  $("#f-months").addEventListener("click", () => {
    // Month choice changes every snow rating, so redraw open panels too.
    if (state.selected) renderDetail(model.byId.get(state.selected));
    if (!$("#compare").hidden) renderCompareTable();
  });
  const tripInputs = { nights: "#t-nights", skiDays: "#t-days", adults: "#t-adults", children: "#t-children" };
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
    const t = e.target.closest("[data-select],[data-compare],[data-pair],[data-save],#detail-close,#detail-min,.detail.is-min .d-head");
    if (!t) return;
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

  $("#reset-view").addEventListener("click", () => map.flyTo({ ...HOME_VIEW, duration: 1400 }));

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

async function shareShortlist() {
  const url = `${location.origin}${location.pathname}?list=${[...state.saved].join(",")}`;
  const btn = $("#saved-share");
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Link copied";
  } catch {
    // Clipboard refused: show the link so it can be copied by hand.
    const input = $("#saved-link");
    input.value = url;
    input.hidden = false;
    input.select();
    btn.textContent = "Copy the link below";
  }
  setTimeout(() => { btn.textContent = "Copy link"; }, 2500);
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
  const bands = Object.values(model.priceBands).map((b) => `<li><b>${b.symbol}</b> ${b.label}: ${b.guide}</li>`).join("");
  $("#data-note").innerHTML = `<ul class="bands">${bands}</ul>
    <p>${esc(model.index.costs.note)} ${model.notes.map(esc).join(" ")}</p>`;
}
