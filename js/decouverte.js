/**
 * Page Decouverte
 * A GetCapabilities() like geoserver
 * Interactive map with Things, filtering by sensors/properties, and capability summaries
 */

import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import * as Utils from "./utils/utils.js";
import * as UtilsMap from "./utils/utils-mapping.js";

// State management
const state = {
  map: null,
  vectorLayer: null,
  boundingBox: null,
  lastSelectedRadio: null,
  config: null,
};

// Constants for entity summaries
const ENTITY_LABELS = {
  Things: "points de mesure (Things)",
  Sensors: "types de capteurs (Sensors)",
  ObservedProperties: "propriétés observées (ObservedProperties)",
  Datastreams: "flux de données (DataStreams)",
};

/**
 * Fetches and displays entity counts
 */
async function displayCapabilities() {
  // Counts part
  for (const [entity, label] of Object.entries(ENTITY_LABELS)) {
    try {
      const count = await STAApi.getCount(state.config.urlService, entity);
      const element = document.getElementById(`${entity}Infos`);
      if (element) {
        element.innerHTML = `<b>${count}</b> ${label}`;
      }
    } catch (error) {
      console.error(`Failed to get count for ${entity}:`, error);
    }
  }

  // Fetch date range
  try {
    const firstObsUrl = STAApi.buildQuery(
      state.config.urlService,
      "Observations",
      {
        select: "phenomenonTime",
        orderby: "phenomenonTime asc",
        top: 1,
      },
    );
    const firstObs = await STAApi.fetchSTA(firstObsUrl, { paginate: false });

    const lastObsUrl = STAApi.buildQuery(
      state.config.urlService,
      "Observations",
      {
        select: "phenomenonTime",
        orderby: "phenomenonTime desc",
        top: 1,
      },
    );
    const lastObs = await STAApi.fetchSTA(lastObsUrl, { paginate: false });

    if (firstObs.length > 0 && lastObs.length > 0) {
      const firstDate = Utils.parseDate(firstObs[0].phenomenonTime);
      const lastDate = Utils.parseDate(lastObs[0].phenomenonTime);

      const dateElement = document.getElementById("DateInfos");
      if (dateElement) {
        dateElement.innerHTML = `Premier enregistrement : <b>${firstDate}</b><br>Dernier enregistrement : <b>${lastDate}</b>`;
      }
    }
  } catch (error) {
    console.error("Failed to fetch date range:", error);
  }
}

/**
 * Creates tables for sensors and observed properties
 */
async function createTables() {
  const sensorsPromise = createSensorsTable();
  const propertiesPromise = createObservedPropertiesTable();
  await Promise.all([sensorsPromise, propertiesPromise]);
}

/**
 * Creates the sensors table
 */
async function createSensorsTable() {
  try {
    const sensorsUrl = STAApi.buildQuery(state.config.urlService, "Sensors", {
      select: "name,description,id,metadata",
    });
    const sensors = await STAApi.fetchSTA(sensorsUrl);

    const tbody = document.getElementById("SensorField");
    if (!tbody) return;

    sensors.forEach((sensor) => {
      const row = document.createElement("tr");

      const radioCell = document.createElement("td");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.value = sensor["@iot.id"];
      radio.addEventListener("change", () =>
        filterByEntity(radio.value, "Sensor", radio),
      );
      radioCell.appendChild(radio);

      const nameCell = document.createElement("th");
      nameCell.textContent = sensor.name;

      const descCell = document.createElement("td");
      descCell.textContent = sensor.description;

      const metadataCell = document.createElement("td");
      const metadata = sensor.metadata || "";
      const displayText = metadata ? metadata.substr(0, 15) : "(aucun)";
      metadataCell.innerHTML = metadata
        ? `<a href="${Utils.escapeHtml(metadata)}" target="_blank">${Utils.escapeHtml(displayText)}</a>`
        : "(aucun)";
      row.appendChild(radioCell);
      row.appendChild(nameCell);
      row.appendChild(descCell);
      row.appendChild(metadataCell);

      tbody.appendChild(row);
    });
  } catch (error) {
    console.error("Failed to create sensors table:", error);
  }
}

/**
 * Creates the observed properties table
 */
async function createObservedPropertiesTable() {
  try {
    const propertiesUrl = STAApi.buildQuery(
      state.config.urlService,
      "ObservedProperties",
      {
        select: "name,description,id,definition",
      },
    );
    const properties = await STAApi.fetchSTA(propertiesUrl);

    const tbody = document.getElementById("ObsPField");
    if (!tbody) return;

    properties.forEach((prop) => {
      // Skip properties without definition
      if (!prop.definition || prop.definition === "") return;

      const row = document.createElement("tr");

      const radioCell = document.createElement("td");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.value = prop["@iot.id"];
      radio.addEventListener("change", () =>
        filterByEntity(radio.value, "ObservedProperty", radio),
      );
      radioCell.appendChild(radio);

      const nameCell = document.createElement("th");
      nameCell.textContent = prop.name;

      const descCell = document.createElement("td");
      descCell.textContent = prop.description;

      const defCell = document.createElement("td");
      defCell.innerHTML = `<a href="${Utils.escapeHtml(prop.definition)}" target="_blank">${Utils.escapeHtml(prop.definition.substr(0, 15))}</a>`;

      row.appendChild(radioCell);
      row.appendChild(nameCell);
      row.appendChild(descCell);
      row.appendChild(defCell);

      tbody.appendChild(row);
    });
  } catch (error) {
    console.error("Failed to create observed properties table:", error);
  }
}

/**
 * Filters map features by sensor or observed property
 * @param {string} entityId - ID of sensor/property
 * @param {string} entityType - "Sensor" or "ObservedProperty"
 * @param {HTMLElement} inputElement - Radio input element
 */
async function filterByEntity(entityId, entityType, inputElement) {
  // Handle radio deselection
  if (state.lastSelectedRadio && state.lastSelectedRadio !== inputElement) {
    state.lastSelectedRadio.checked = false;
    state.lastSelectedRadio = null;
  }

  if (inputElement.checked) {
    state.lastSelectedRadio = inputElement;

    const infoDiv = document.getElementById("infoThingSelect");
    if (infoDiv) infoDiv.innerHTML = "";

    try {
      // Fetch datastreams filtered by entity
      const dsUrl = STAApi.buildQuery(state.config.urlService, "Datastreams", {
        filter: `${entityType}/id eq ${entityId}`,
        select: "id",
      });
      const datastreams = await STAApi.fetchSTA(dsUrl);

      const datastreamIds = datastreams.map((ds) => ds["@iot.id"]);

      // Update feature selected property
      state.vectorLayer
        .getSource()
        .getFeatures()
        .forEach((feature) => {
          const featureDatastreams = feature.get("datastreamsId");
          if (featureDatastreams.some((item) => datastreamIds.includes(item))) {
            feature.set("selected", true);
          } else {
            feature.set("selected", false);
          }
        });

      UtilsMap.fitToFeatures(state.map, state.vectorLayer, 150, true);

      state.vectorLayer.changed();
    } catch (error) {
      console.error("Failed to filter by entity:", error);
    }
  } else {
    // Deselected - reset all features
    state.lastSelectedRadio = null;
    state.vectorLayer
      .getSource()
      .getFeatures()
      .forEach((feature) => {
        feature.set("selected", false);
      });
    state.vectorLayer.changed();
    UtilsMap.fitToFeatures(state.map, state.vectorLayer, 150);
  }
}

/**
 * Handles map click events, for highligth a Thing
 * @param {Object} evt - OpenLayers click event
 */
function handleMapClick(evt) {
  const feature = state.map.forEachFeatureAtPixel(evt.pixel, (f) => f);

  if (feature) {
    const source = state.vectorLayer.getSource();
    source.getFeatures().forEach((f) => {
      f.set("selected", f === feature);
    });
    state.vectorLayer.changed();

    const thingId = feature.get("id");
    const name = feature.get("name");
    const description = feature.get("description");

    UtilsMap.fitToFeatures(state.map, state.vectorLayer, 50, true);

    if (thingId) {
      // Display thing info
      const infoDiv = document.getElementById("infoThingSelect");
      if (infoDiv) {
        infoDiv.innerHTML = `
                    <a target="_blank" href="${Utils.BASE_URL}/espace/points-de-mesure-id?id=${thingId}&config=${state.config.configFileName}">
                        ${Utils.escapeHtml(name)}
                    </a>
                    <br>${Utils.escapeHtml(description)}
                `;

        // Fetch and display observed properties
        const propsUrl = STAApi.buildQuery(
          state.config.urlService,
          "ObservedProperties",
          {
            filter: `Datastreams/Thing/id eq ${thingId}`,
            select: "name",
          },
        );
        STAApi.fetchSTA(propsUrl)
          .then((props) => {
            infoDiv.innerHTML += "<br>Propriétés observées :";
            props.forEach((prop) => {
              infoDiv.innerHTML += ` <b>- ${Utils.escapeHtml(prop.name)}</b>`;
            });
          })
          .catch((error) =>
            console.error("Failed to fetch properties:", error),
          );

        // Fetch and display sensors
        const sensUrl = STAApi.buildQuery(state.config.urlService, "Sensors", {
          filter: `Datastreams/Thing/id eq ${thingId}`,
          select: "name",
        });
        STAApi.fetchSTA(sensUrl)
          .then((sensors) => {
            infoDiv.innerHTML += "<br>Capteurs :";
            sensors.forEach((sensor) => {
              infoDiv.innerHTML += ` <b>- ${Utils.escapeHtml(sensor.name)}</b>`;
            });
          })
          .catch((error) => console.error("Failed to fetch sensors:", error));
      }
    }
  }
}

/**
 * Loads Things and displays them on the map
 */
async function loadThingsOnMap() {
  try {
    const thingsUrl = STAApi.buildQuery(state.config.urlService, "Things", {
      top: 10000,
      select: "id,name,description",
      expand: "Datastreams($select=id),Locations($select=location)",
    });
    const things = await STAApi.fetchSTA(thingsUrl);

    const geojson = UtilsMap.createFeatureCollection(things);
    state.vectorLayer = UtilsMap.createVectorLayer(geojson);
    state.map.addLayer(state.vectorLayer);
    UtilsMap.fitToFeatures(state.map, state.vectorLayer, 1000);
    state.map.on("click", handleMapClick);
    UtilsMap.addCursorFeedback(state.map);
  } catch (error) {
    console.error("Failed to load Things on map:", error);
    Utils.showNotification("Erreur lors du chargement de la carte", "danger");
  }
}

/**
 * Sets up radio button toggle behavior
 */
function setupRadioToggle() {
  const radios = document.querySelectorAll('input[type="radio"]');
  let selectedRadio = null;

  radios.forEach((radio) => {
    radio.addEventListener("click", function () {
      if (this === selectedRadio) {
        this.checked = false;
        selectedRadio = null;
        // For change event to trigger filterByEntity
        this.dispatchEvent(new Event("change"));
      } else {
        selectedRadio = this;
      }
    });
  });
}

/**
 * Main initialization function
 */
async function main() {
  state.config = await waitForAppReady();

  // Update service name
  const serviceNameEl = document.getElementById("serviceName");
  if (serviceNameEl && state.config.nameService) {
    serviceNameEl.textContent = state.config.nameService;
  }

  // Update service description
  const serviceDescriptionEl = document.getElementById("serviceDescription");
  if (serviceDescriptionEl && state.config.description) {
    serviceDescriptionEl.textContent = state.config.description;
  }

  // Load data
  displayCapabilities();

  await createTables();
  setupRadioToggle();

  // Initialize map
  state.map = UtilsMap.createMap("map", { zoom: 15 });
  await loadThingsOnMap();
}

main();
