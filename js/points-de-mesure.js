/**
 * Points de Mesure (Things) Page
 * Displays all measurement points as bulma cards with images (if in properties)
 *  and descriptions
 */

import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import * as Utils from "./utils/utils.js";
import * as UtilsMap from "./utils/utils-mapping.js";

let vectorLayer;
let map;

/**
 * Main initialization function
 */
async function main() {
  const config = await waitForAppReady();
  const container = document.getElementById("formContainer");
  const serviceNameEl = document.getElementById("serviceName");

  // Update page title
  if (serviceNameEl && config.nameService) {
    serviceNameEl.textContent = config.nameService;
  }

  try {
    // Fetch all Things with basic info
    const url = STAApi.buildQuery(config.urlService, "Things", {
      select: "name,description,id,properties",
      expand: "Locations($select=location)",
    });
    const things = await STAApi.fetchSTA(url);

    if (things.length === 0) {
      container.innerHTML =
        '<p class="notification is-info">Aucun point de mesure trouvé.</p>';
      return;
    }

    // Create cards for each Thing
    things.forEach((thing) => {
      const card = createThingCard(thing, config.configFileName);
      container.appendChild(card);
    });
    renderMap(things);
  } catch (error) {
    console.error("Error loading measurement points:", error);
    container.innerHTML =
      '<p class="notification is-danger">Impossible de charger les données.</p>';
  }
}

/**
 * Creates a card element for a Thing
 * @param {Object} thing - Thing entity from SensorThings
 * @param {string} configFileName - Configuration file name for links
 * @returns {HTMLElement} Card column element
 */
function createThingCard(thing, configFileName) {
  const id = thing["@iot.id"];
  const name = thing.name || "Sans nom";
  const description = thing.description || "";
  let photo = thing.properties?.image;

  // Handle photo as array or single value
  if (Array.isArray(photo)) {
    photo = photo.length > 0 ? photo[0] : null;
  }

  // Create column wrapper
  const col = document.createElement("div");
  col.className = "column is-6-tablet is-4-desktop";

  // Build card HTML
  const cardContent = `
        <div class="card">
            ${photo
      ? `
                <div class="card-image is-flex is-justify-content-center">
                    <img
                        style="max-height: 400px; width: auto; object-fit: contain;"
                        src="${photo}"
                        alt="Photo du point ${name}"
                        loading="lazy"
                    >
                </div>
            `
      : `
                <div class="card-content">
                    <p class="has-text-grey is-italic">Aucune image disponible.</p>
                </div>
            `
    }
            <div class="card-content">
                <div class="content">
                    <p class="title is-6">
                        <a
                            href="${Utils.BASE_URL}/espace/points-de-mesure-id?id=${id}&config=${configFileName}"
                            target="_blank"
                        >
                            ${Utils.escapeHtml(name)}
                        </a>
                    </p>
                    <p>${Utils.escapeHtml(description)}</p>
                </div>
            </div>
        </div>
    `;

  col.innerHTML = cardContent;
  return col;
}

function renderMap(thing) {
  map = UtilsMap.createMap("map", { zoom: 15 });
  const geojson = UtilsMap.createFeatureCollection(thing);
  vectorLayer = UtilsMap.createVectorLayer(geojson);
  map.addLayer(vectorLayer);
  UtilsMap.fitToFeatures(map, vectorLayer, 1000);
  map.on("click", handleMapClick);
  UtilsMap.addCursorFeedback(map);
}

/**
 * Handles map click events
 * @param {Object} evt - OpenLayers click event
 */
function handleMapClick(evt) {
  const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f);

  if (feature) {
    const name = feature.get("name");
    const input = document.getElementById("searchInput");
    input.value = name;

    const event = new Event("input", { bubbles: true });
    input.dispatchEvent(event);
  }
}

const debouncedFilter = Utils.debounce(
  [
    Utils.filterCards,
    () => UtilsMap.filterMapFeatures(vectorLayer),
    () => UtilsMap.fitToFeatures(map, vectorLayer, 50, true),
  ],
  300,
);
document
  .getElementById("searchInput")
  .addEventListener("input", debouncedFilter);

document.getElementById("exportGeoJSON").addEventListener("click", async () => {
  const config = await waitForAppReady();
  try {
    const response = await fetch(
      `${config.urlService}Locations?$resultFormat=GeoJSON`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    Utils.downloadFile([blob], "points-de-mesure.geojson");
  } catch (error) {
    console.error("GeoJSON export error:", error);
    Utils.showNotification(
      "Erreur lors du téléchargement du GeoJSON",
      "danger",
    );
  }
});

main();
