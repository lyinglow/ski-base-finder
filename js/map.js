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
export const HOME_VIEW = { center: [6.6, 45.92], zoom: 8.75, pitch: 55, bearing: 128 };
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
    },
    layers: [
      { id: "satellite", type: "raster", source: "satellite" },
      { id: "topo", type: "raster", source: "topo", layout: { visibility: "none" } },
      {
        id: "hillshade", type: "hillshade", source: "hillshadeDem",
        paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0b1520" },
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

export function setLinks(map, features) {
  const src = map.getSource("links");
  if (src) src.setData({ type: "FeatureCollection", features });
}

function empty() {
  return { type: "FeatureCollection", features: [] };
}
