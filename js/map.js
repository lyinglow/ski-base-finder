// Map setup. Swap tile providers here; nothing else in the app knows about them.
/* global maplibregl */

const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const BASEMAPS = {
  satellite: {
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    maxzoom: 18,
  },
  topo: {
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Map © Esri, HERE, Garmin, OpenStreetMap contributors",
    maxzoom: 18,
  },
};

// Looking south-east from above Geneva toward Mont Blanc.
export const HOME_VIEW = { center: [6.45, 45.55], zoom: 8.05, pitch: 52, bearing: 140 };
const EXAGGERATION = 1.35;

function style() {
  const dem = {
    type: "raster-dem",
    tiles: [TERRAIN_TILES],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 14,
    attribution: "Terrain: Mapzen, AWS Open Data",
  };
  return {
    version: 8,
    sources: {
      satellite: { type: "raster", tileSize: 256, ...BASEMAPS.satellite },
      topo: { type: "raster", tileSize: 256, ...BASEMAPS.topo },
      dem,
      hillshadeDem: { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 14 },
      links: { type: "geojson", data: empty() },
      reach: { type: "geojson", data: empty() },
    },
    layers: [
      { id: "satellite", type: "raster", source: "satellite" },
      { id: "topo", type: "raster", source: "topo", layout: { visibility: "none" } },
      {
        id: "hillshade", type: "hillshade", source: "hillshadeDem",
        paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0b1520" },
      },
      {
        id: "reach-line", type: "line", source: "reach",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": 0.85, "line-dasharray": [2, 2] },
      },
      {
        id: "links-casing", type: "line", source: "links",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#0b1520", "line-width": 6, "line-opacity": 0.45 },
      },
      {
        id: "links-road", type: "line", source: "links", filter: ["==", ["get", "kind"], "road"],
        layout: { "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3, "line-dasharray": [1.5, 1.5] },
      },
      {
        id: "links-lift", type: "line", source: "links", filter: ["==", ["get", "kind"], "lift"],
        layout: { "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3.5 },
      },
    ],
    sky: {
      "sky-color": "#8fb6dd",
      "horizon-color": "#dbe7f1",
      "fog-color": "#dbe7f1",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.85,
    },
  };
}

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: style(),
    ...HOME_VIEW,
    maxPitch: 75,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.on("load", () => setTerrain(map, true));
  return map;
}

export function setTerrain(map, on) {
  map.setTerrain(on ? { source: "dem", exaggeration: EXAGGERATION } : null);
}

export function setBasemap(map, name) {
  for (const id of Object.keys(BASEMAPS)) {
    map.setLayoutProperty(id, "visibility", id === name ? "visible" : "none");
  }
}

// Dashed line from the airport to the furthest place on show.
export function setReach(map, features) {
  const src = map.getSource("reach");
  if (src) src.setData({ type: "FeatureCollection", features });
}

// Snow cover from past winters, draped over the terrain. month: "dec".."apr", or null to hide.
export function setSnowLayer(map, cfg, month) {
  if (!map.isStyleLoaded()) { map.once("load", () => setSnowLayer(map, cfg, month)); return; }
  if (!month) {
    if (map.getLayer("snow-cover")) map.setLayoutProperty("snow-cover", "visibility", "none");
    return;
  }
  const url = cfg.path.replace("{month}", month);
  const src = map.getSource("snow");
  if (src) src.updateImage({ url, coordinates: cfg.coordinates });
  else map.addSource("snow", { type: "image", url, coordinates: cfg.coordinates });
  if (!map.getLayer("snow-cover")) {
    map.addLayer({ id: "snow-cover", type: "raster", source: "snow", paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 } }, "reach-line");
  }
  map.setLayoutProperty("snow-cover", "visibility", "visible");
}

export function setLinks(map, features) {
  const src = map.getSource("links");
  if (src) src.setData({ type: "FeatureCollection", features });
}

function empty() {
  return { type: "FeatureCollection", features: [] };
}
