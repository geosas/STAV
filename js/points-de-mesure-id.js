/**
 * Point de Mesure by STA thing ID Page
 * Displays detailed information about a single Thing datastreams, sensors, location
 * including photo(s) str or list  if present in properties
 */

import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import * as Utils from "./utils/utils.js";
import * as UtilsMap from "./utils/utils-mapping.js";

/**
 * Loads and displays Thing details
 */
async function loadThing() {
  const config = await waitForAppReady();
  const thingId = Utils.getQueryParam("id");

  if (!thingId) {
    Utils.showNotification(
      "Aucun ID de point de mesure fourni dans l'URL",
      "danger",
    );
    return;
  }

  try {
    // Fetch Thing with all related data
    const url = STAApi.buildQuery(config.urlService, `Things(${thingId})`, {
      expand:
        "Datastreams($select=name,description,phenomenonTime,id;$expand=Sensor,ObservedProperty),Locations",
      select: "name,description,id,properties",
    });
    const thing = await STAApi.fetchSTA(url, { paginate: false });

    renderThingDetails(thing);
    renderDatastreamsTable(thing.Datastreams, config.configFileName);
    renderMap([thing]); //[] because we have a thing by id so not an array
  } catch (error) {
    console.error("Error loading Thing details:", error);
    Utils.showNotification(
      "Erreur lors du chargement des données du point de mesure",
      "danger",
    );
  }
}

/**
 * Renders the Thing's photo and description
 * @param {Object} thing - Thing entity
 *
 */
function renderThingDetails(thing) {
  const photoContainer = document.getElementById("photoContainer");
  const nameEl = document.getElementById("thingName");
  const descEl = document.getElementById("thingDesc");

  // Render name and description
  if (nameEl) nameEl.textContent = thing.name || "Sans nom";
  if (descEl) descEl.textContent = thing.description || "";

  // Render photo(s)
  if (!photoContainer) return;

  const photos = thing.properties?.image;

  if (Array.isArray(photos) && photos.length > 0) {
    // Multiple photos
    photoContainer.innerHTML = photos
      .map(
        (src, index) => `
            <img
                src="${Utils.escapeHtml(src)}"
                alt="Aperçu du point ${thing.name} - image ${index + 1}"
                style="max-width: 100%; height: auto; border-radius: 8px; margin: 4px 0;"
                loading="lazy"
            >
        `,
      )
      .join("");
  } else if (photos && typeof photos === "string") {
    // Single photo
    photoContainer.innerHTML = `
            <img
                src="${Utils.escapeHtml(photos)}"
                alt="Aperçu du point ${thing.name}"
                style="max-width: 100%; height: auto; border-radius: 8px;"
                loading="lazy"
            >
        `;
  } else {
    // No photo
    photoContainer.innerHTML =
      '<p class="has-text-grey is-italic">Aucune image disponible.</p>';
  }
}

/**
 * Renders the table of Datastreams
 * @param {Array} datastreams - Array of Datastream entities
 * @param {string} configFileName - Configuration file name
 */
function renderDatastreamsTable(datastreams, configFileName) {
  const tbody = document.getElementById("datastreamsBody");
  if (!tbody) return;

  tbody.innerHTML = ""; // Clear existing content

  datastreams.forEach((ds) => {
    const { start, end } = Utils.parsePhenomenonTime(ds.phenomenonTime);
    const tr = document.createElement("tr");

    // Build ObservedProperty cell with link if definition exists
    const hasDef =
      ds.ObservedProperty.definition &&
      ds.ObservedProperty.definition.trim() !== "";
    const observedPropertyCell = hasDef
      ? `<a href="${Utils.escapeHtml(ds.ObservedProperty.definition)}" target="_blank" class="has-text-link">
                ${Utils.escapeHtml(ds.ObservedProperty.name)}
            </a>`
      : Utils.escapeHtml(ds.ObservedProperty.name);

    tr.innerHTML = `
            <td>
                <a
                    href="${Utils.BASE_URL}/espace/simple-plot?id=${ds["@iot.id"]}&type=datastream&config=${configFileName}"
                    target="_blank"
                    class="has-text-link"
                >
                    ${Utils.escapeHtml(ds.name)}
                </a>
            </td>
            <td>${Utils.escapeHtml(ds.description)}</td>
            <td>
                <a href="${Utils.escapeHtml(ds.Sensor.metadata)}" target="_blank" class="has-text-link">
                    ${Utils.escapeHtml(ds.Sensor.name)}
                </a>
            </td>
            <td>${observedPropertyCell}</td>
            <td>${Utils.escapeHtml(start)} <br> ${Utils.escapeHtml(end)}</td>
        `;

    tbody.appendChild(tr);
  });
}

/**
 * Renders  map with Thing location
 * @param {Array} thing - Array of Thing with expand Location
 */
function renderMap(thing) {
  const map = UtilsMap.createMap("map", { zoom: 15 });
  const geojson = UtilsMap.createFeatureCollection(thing);
  const layer = UtilsMap.createVectorLayer(geojson);
  map.addLayer(layer);
  UtilsMap.fitToFeatures(map, layer, 50);
}

loadThing();
