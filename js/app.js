import { loadData, cheaperStays, reachable } from "./data.js";
import { createMap, setBasemap, setTerrain, setLinks, HOME_VIEW } from "./map.js";
/* global maplibregl */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate", expert: "Expert" };
const SIZE_LABEL = { small: "Small", medium: "Medium", large: "Large", huge: "Huge" };
const MODE_LABEL = { car: "car", bus: "bus", train: "train", lift: "lift" };
const MAX_COMPARE = 4;

const state = {
  show: "all",
  maxTime: 180,
  prices: new Set([1, 2, 3]),
  sizes: new Set(["small", "medium", "large", "huge"]),
  family: false,
  carFree: false,
  sort: "time",
  selected: null,
  related: new Set(),
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

function levelDots(levels = []) {
  return `<span class="levels" title="${levels.map((v) => LEVEL_LABEL[v]).join(", ")}">${
    ["beginner", "intermediate", "expert"]
      .map((v) => `<i class="lv ${v}${levels.includes(v) ? "" : " off"}"></i>`)
      .join("")
  }</span>`;
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
  if (state.show !== "all" && l.type !== state.show) return false;
  if (travel(l).min > state.maxTime) return false;
  if (!state.prices.has(l.price)) return false;
  if (state.family && !l.family) return false;
  if (state.carFree && !l.carFree) return false;
  if (l.type === "resort") return state.sizes.has(l.skiSize);
  return reachable(l, model.byId).some((r) => state.sizes.has(r.place.skiSize));
}

function sortKey(l) {
  switch (state.sort) {
    case "price": return [l.price, travel(l).min];
    case "altitude": return [-l.altitude, travel(l).min];
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
  $("#results").innerHTML = n
    ? visible.map(resultItem).join("")
    : `<li class="empty">Nothing matches. Try a longer travel time or more price levels.</li>`;
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
    <span class="r-main"><span class="r-name">${esc(l.name)}</span><span class="r-sub">${sub}</span></span>
    <span class="r-side"><span class="r-time">${mins(t.min)}</span><span class="r-price">${price(l.price)}</span></span>
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
  renderDetail(l);
  applyFilters();

  const narrow = matchMedia("(max-width: 899px)").matches;
  if (narrow) closeSidebar();
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

function placeRow({ place, link }, context) {
  let gain = "";
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
      <span class="lr-sub">${sub}</span>${gain}</span>
    </button>
    <span class="lr-hop"><strong>${mins(link.min)}</strong><span>by ${modes(link.by)}</span>${link.note ? `<span>${esc(link.note)}</span>` : ""}</span>
    <button type="button" class="add" data-compare="${place.id}" aria-pressed="${inCompare}" title="Add to compare">${inCompare ? "Added" : "Compare"}</button>
  </li>`;
}

function renderDetail(l) {
  const t = travel(l);
  const band = model.priceBands[l.price];
  const head = `<header class="d-head">
      <span class="eyebrow"><i class="dot ${l.type}"></i>${typeLabel(l)} · ${esc(l.region)}</span>
      <h2>${esc(l.name)}</h2>
      <p class="character">${esc(l.character)}</p>
      <button type="button" class="close" id="detail-close" aria-label="Close details">×</button>
    </header>`;

  const stats = `<div class="stats">
      ${stat("From airport", mins(t.min), `${t.km} km`)}
      ${stat("Altitude", `${l.altitude} m`, l.topAltitude ? `top ${l.topAltitude} m` : "village")}
      ${stat("Price to stay", band.symbol, band.label)}
      ${stat("Town", SIZE_LABEL[l.townSize], l.family ? "Family-friendly" : "Better for adults")}
    </div>`;

  const getting = `<p class="getting"><span class="s-label">Getting there</span>${esc(l.transfer)}${l.rail ? ` <span class="badge">${esc(l.rail)}</span>` : ""}${l.carFree ? ` <span class="badge good">No car needed</span>` : ""}</p>`;

  let body = "";
  if (l.type === "resort") {
    const cheaper = cheaperStays(l, model.byId);
    body += `<section class="ski">
        <span class="s-label">Ski area</span>
        <p><strong>${esc(l.skiArea.name)}</strong> · ${l.skiArea.pisteKm} km · ${SIZE_LABEL[l.skiSize]}</p>
        <p class="suits">Suits ${levelDots(l.levels)} ${l.levels.map((v) => LEVEL_LABEL[v]).join(", ")}</p>
      </section>`;
    body += `<section class="alt">
        <h3>Stay lower, ski here</h3>
        ${cheaper.length
          ? `<p class="hint">${cheaper.length} cheaper place${cheaper.length === 1 ? "" : "s"} to stay with quick access to ${esc(l.name)}.</p>
             <ul class="link-list">${cheaper.map((c) => placeRow(c, l)).join("")}</ul>
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
    body += `<section class="alt">
        <h3>Resorts within reach</h3>
        <p class="hint">${r.length} resort${r.length === 1 ? "" : "s"}, nearest in ${mins(r[0].link.min)}.${savings.length ? ` Cheaper than staying in ${savings.length} of them.` : ""}</p>
        <ul class="link-list">${r.map((c) => placeRow(c)).join("")}</ul>
        <button type="button" class="primary wide" data-pair="${l.id}">Compare with nearest resorts</button>
      </section>`;
  }

  const inCompare = state.compare.includes(l.id);
  const foot = `<footer class="d-foot">
      <button type="button" class="secondary" data-compare="${l.id}" aria-pressed="${inCompare}">${inCompare ? "In compare" : "Add to compare"}</button>
    </footer>`;

  const d = $("#detail");
  d.innerHTML = head + stats + getting + body + foot;
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
  $$(".segmented button").forEach((b) => b.addEventListener("click", () => {
    state.show = b.dataset.show;
    $$(".segmented button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    applyFilters();
  }));

  const time = $("#f-time");
  const showTime = () => {
    state.maxTime = +time.value;
    $("#f-time-out").textContent = state.maxTime >= 180 ? "Any" : mins(state.maxTime);
  };
  time.addEventListener("input", () => { showTime(); applyFilters(); });
  showTime();

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

  $("#f-family").addEventListener("change", (e) => { state.family = e.target.checked; applyFilters(); });
  $("#f-carfree").addEventListener("change", (e) => { state.carFree = e.target.checked; applyFilters(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; applyFilters(); });

  $("#results").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) select(b.dataset.id);
  });

  // Delegated actions used by the detail panel, compare bar and table.
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-select],[data-compare],[data-pair],#detail-close");
    if (!t) return;
    if (t.id === "detail-close") return clearSelection();
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

  $("#sidebar-toggle").addEventListener("click", () => {
    const open = !$("#sidebar").classList.contains("open");
    $("#sidebar").classList.toggle("open", open);
    $("#sidebar-toggle").setAttribute("aria-expanded", open);
  });
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-toggle").setAttribute("aria-expanded", "false");
}

function renderDataNote() {
  const bands = Object.values(model.priceBands).map((b) => `<li><b>${b.symbol}</b> ${b.label}: ${b.guide}</li>`).join("");
  $("#data-note").innerHTML = `<ul class="bands">${bands}</ul>
    <p>${esc(model.index.priceNote)} ${model.notes.map(esc).join(" ")}</p>`;
}
