/**
 * OpenLayers Map Utilities
 */

// ============================================================================
// MAP CONSTANTS
// ============================================================================
const MAX_RESOLUTION = 2;
const DEFAULT_CENTER = [-189274.8, 6129523.9]; // Rennes area (EPSG:4326)
const DEFAULT_ZOOM = 13;
const CRS = "EPSG:4326"; //data crs, in sta generally 4326

import { BASE_URL } from "./utils.js";

// ============================================================================
// Style
// ============================================================================
/**
 * Create an OpenLayers dynamic style function for Point OR Polygon geometries.
 *
 * The style changes depending on the feature's 'selected' property:
 * - Different marker icon for Point geometries
 * - Different fill and stroke colors for Polygon geometries
 *
 * @param {Object} options - Style options
 * @param {string} [options.markerSelected] - Marker icon for selected state
 * @param {string} [options.markerDefault] - Marker icon for default state
 * @param {Object} [options.fillColorPolygon] - Fill colors {default, selected}
 * @param {Object} [options.strokeColorPolygon] - Stroke colors {default, selected}
 * @returns {Function} Style function for ol.layer.Vector
 */
function createStyleFunction({
  markerSelected = "marker.svg",
  markerDefault = "markerB.svg",
  fillColorPolygon = {
    default: "rgba(0, 0, 255, 0.2)",
    selected: "rgba(255, 0, 0, 0.4)",
  },
  strokeColorPolygon = { default: "#00f", selected: "#f00" },
} = {}) {
  return function (feature, resolution) {
    const selected = feature.get("selected"); // dynamique
    const geometryType = feature.getGeometry().getType();

    const textStyle =
      resolution > MAX_RESOLUTION
        ? null
        : new ol.style.Text({
          font: "12px Calibri,sans-serif",
          overflow: !!selected,
          offsetY: 10,
          text: feature.get("name"),
          fill: new ol.style.Fill({ color: "#000" }),
          stroke: new ol.style.Stroke({ color: "#fff", width: 3 }),
        });

    let zIndex = 0;
    if (geometryType === "Point" && selected) {
      zIndex = 1000;
    }

    if (geometryType === "Polygon" || geometryType === "MultiPolygon") {
      return new ol.style.Style({
        fill: new ol.style.Fill({
          color: selected
            ? fillColorPolygon.selected
            : fillColorPolygon.default,
        }),
        stroke: new ol.style.Stroke({
          color: selected
            ? strokeColorPolygon.selected
            : strokeColorPolygon.default,
          width: 2,
        }),
        text: textStyle,
        zIndex: zIndex,
      });
    }

    if (geometryType === "Point") {
      const markerFile = selected ? markerSelected : markerDefault;
      return new ol.style.Style({
        image: new ol.style.Icon({
          scale: 0.05,
          displacement: [0, 15],
          src: `${BASE_URL}/img/${markerFile}`,
        }),
        text: textStyle,
        zIndex: zIndex,
      });
    }

    return new ol.style.Style({ text: textStyle });
  };
}

function filterMapFeatures(vectorLayer) {
  if (!vectorLayer) return;

  const input = document.getElementById("searchInput");
  const searchTerm = input.value.toUpperCase();

  vectorLayer
    .getSource()
    .getFeatures()
    .forEach((feature) => {
      const name = feature.get("name").toUpperCase() || "";
      if (searchTerm === "") {
        feature.set("selected", false);
      } else {
        feature.set("selected", name.includes(searchTerm));
      }
    });

  vectorLayer.changed();
}

// ============================================================================
// MAP INITIALIZATION
// ============================================================================
/**
 * Create an OpenLayers map with OSM base layer
 * @param {string} containerId - DOM element ID for map container
 * @param {Object} options - Map options
 * @param {Array} [options.center] - Center coordinates [lng, lat] in EPSG:4326
 * @param {number} [options.zoom] - Initial zoom level
 * @param {string} [options.crs] - Map projection
 * @returns {ol.Map} OpenLayers map instance
 */
function createMap(containerId, options = {}) {
  const { center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM, crs = CRS } = options;

  const map = new ol.Map({
    target: containerId,
    layers: [
      new ol.layer.Tile({
        source: new ol.source.OSM(),
      }),
    ],
    view: new ol.View({
      center: center,
      zoom: zoom,
      projection: "EPSG:3857",
    }),
  });

  return map;
}

// ============================================================================
// FROM GEOJSON TO VECTOR LAYER
// ============================================================================
/**
 * Normalize SensorThings location to GeoJSON Feature format if not in a good
 * format
 * @param {Object} thing - Thing with expand Locations from sensorThings
 * @returns {Object} GeoJSON Feature
 */
function normalizeLocation(thing) {
  let location = thing.Locations ? thing.Locations[0].location : thing.location;
  if (!location.geometry) {
    location = {
      type: "Feature",
      geometry: {
        type: location.type,
        coordinates: location.coordinates,
      },
      properties: {},
    };
  }

  location.properties = {
    ...location.properties, // keep the properties if exist
    name: thing.name,
    id: thing["@iot.id"],
    description: thing.description,
    datastreamsId: thing.Datastreams?.map((ds) => ds["@iot.id"]) ?? [],
  };
  location.selected = false;

  return location;
}

/**
 * Create GeoJSON FeatureCollection from Things array
 * @param {Array} things - Array of Things with Locations
 * @returns {Object} GeoJSON FeatureCollection
 */
function createFeatureCollection(things) {
  const features = [];

  for (const thing of things) {
    features.push(normalizeLocation(thing));
  }

  return {
    type: "FeatureCollection",
    crs: {
      type: "name",
      properties: { name: CRS },
    },
    features: features,
  };
}
/**
 * Create Vector layer from GeoJSON
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @param {Function} styleFunction - Style function for features
 * @returns {ol.layer.Vector} OpenLayers vector layer
 */
function createVectorLayer(geojson, styleFunction = createStyleFunction()) {
  const source = new ol.source.Vector({
    features: new ol.format.GeoJSON().readFeatures(geojson, {
      dataProjection: CRS,
      featureProjection: "EPSG:3857",
    }),
  });

  return new ol.layer.Vector({
    source: source,
    style: styleFunction,
  });
}
// ============================================================================
// FIT MAP To DATA
// ============================================================================
/**
 * Calculate extent with padding
 * @param {Array} bbox - Bounding box [minX, minY, maxX, maxY]
 * @param {number} padding - Padding to add (in map units)
 * @returns {Array} Padded extent
 */
function calculateExtent(bbox, padding = 250) {
  return [
    bbox[0] - 2 * padding,
    bbox[1] - 2 * padding,
    bbox[2] + 2 * padding,
    bbox[3] + 2 * padding,
  ];
}

/**
 * Fit map view to layer extent
 * @param {ol.Map} map - OpenLayers map
 * @param {ol.layer.Vector} layer - Vector layer to fit to
 * @param {number} padding - Padding in pixels
 * @param {boolean} selectedOnly - if true, zoom only on selected
 */
function fitToFeatures(map, layer, padding = 150, selectedOnly = false) {
  const source = layer.getSource();
  if (source.getFeatures().length === 0) return;

  let extent;

  if (selectedOnly) {
    const features = source.getFeatures().filter((f) => f.get("selected"));
    if (features.length === 0) {
      extent = source.getExtent();
    } else {
      extent = features[0].getGeometry().getExtent().slice();
      for (let i = 1; i < features.length; i++) {
        ol.extent.extend(extent, features[i].getGeometry().getExtent());
      }
    }
  } else {
    extent = source.getExtent();
  }

  const paddedExtent = calculateExtent(extent, padding);

  map.getView().fit(paddedExtent, {
    duration: 300,
  });
}

// ============================================================================
// BASIC INTERACTION
// ============================================================================
/**
 * Add cursor feedback on feature hover
 * @param {ol.Map} map - OpenLayers map
 */
function addCursorFeedback(map) {
  map.on("pointermove", (evt) => {
    const hit = map.hasFeatureAtPixel(evt.pixel);
    map.getTargetElement().style.cursor = hit ? "pointer" : "";
  });
}

/**
 * Get feature at pixel (for click handlers)
 * @param {ol.Map} map - OpenLayers map
 * @param {Array} pixel - Pixel coordinates
 * @returns {ol.Feature|null} Feature at pixel or null
 */
function getFeatureAtPixel(map, pixel) {
  return map.forEachFeatureAtPixel(pixel, (feature) => feature) || null;
}

export {
  createStyleFunction,
  filterMapFeatures,
  createMap,
  normalizeLocation,
  createFeatureCollection,
  createVectorLayer,
  calculateExtent,
  fitToFeatures,
  addCursorFeedback,
  getFeatureAtPixel,
};
