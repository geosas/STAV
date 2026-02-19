import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import * as Utils from "./utils/utils.js";
import * as UtilsMap from "./utils/utils-mapping.js";
import * as UtilsGraph from "./utils/utils-graph.js";

/**
 * Metrology Page
 * Enter STA worl by sensor
 * Data visualization with Dygraph,  and mini-map
 */

// Application state
const state = {
  config: null,
  datastreamIdList: [],
  dataDict: {},
  seriesConfig: {},
  xRange: null,
  originalWidth: "",
  graph: null,
  map: null,
  vectorLayer: new ol.layer.Vector({}),
  boundingBox: null,
};

// Clear search inputs on load
document.getElementById("searchInput").value = "";
document.getElementById("searchDescriptionInput").value = "";

/**
 * Checks if the navbar burger menu is visible (mobile/small screen)
 * Mode VeloProcessing For the François
 * @returns {boolean}
 */
function isBurgerMode() {
  const burger = document.querySelector(".navbar-burger");
  return burger && window.getComputedStyle(burger).display !== "none";
}

/**
 * Shows the graph column as a fullscreen overlay (mobile mode)
 */
function showGraphOverlay() {
  document.getElementById("columnGraph").classList.add("graph-overlay");
  document.getElementById("closeGraphOverlay").style.display = "";
  state.graph.resize();
  state.map.updateSize();
}

/**
 * Hides the graph overlay and restores normal column layout
 */
function hideGraphOverlay() {
  document.getElementById("columnGraph").classList.remove("graph-overlay");
  document.getElementById("closeGraphOverlay").style.display = "none";
  state.graph.resize();
  state.map.updateSize();
}

/**
 * Creates the table of sensors and datastreams
 */
async function createSensorTable() {
  try {
    const sensorsUrl = STAApi.buildQuery(state.config.urlService, "Sensors", {
      select: "name,description",
      expand:
        "Datastreams($select=id,name,description,phenomenonTime,unitOfMeasurement,properties)",
    });
    const sensors = await STAApi.fetchSTA(sensorsUrl);

    const table = document.getElementById("table_sensor");
    if (!table) return;

    let sensorContent = "";

    sensors.forEach((sensor) => {
      sensorContent += `
                <div class="card">
                    <header class="card-header" style="background-color:#4a4a4a;">
                        <p class="card-header-title title is-5 nameSensor" style="color:white">
                            ${Utils.escapeHtml(sensor.name)}
                        </p>
                    </header>
                    <div class="card-content">
                        <div class="content">
                            <p class='has-text-success'>${Utils.escapeHtml(sensor.description)}</p>
                            <p><b>Flux de données enregistrés :</b></p>
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Description</th>
                                        <th>Date</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>`;

      sensor.Datastreams.forEach((datastream) => {
        const { start, end } = Utils.parsePhenomenonTime(
          datastream.phenomenonTime,
        );
        const parsedFirstDate = Utils.parseDate(start);
        const parsedLastDate = Utils.parseDate(end);
        const unitLabel = `${datastream.unitOfMeasurement?.name || ""} ${datastream.unitOfMeasurement?.symbol || ""}`;
        const graphType = datastream.properties?.graph || "line";

        sensorContent += `
                    <tr>
                        <th class='is_info'>${Utils.escapeHtml(datastream.name)}</th>
                        <td>${Utils.escapeHtml(datastream.description)}</td>
                        <td>
                            Premier enregistrement : <b>${parsedFirstDate}</b><br>
                            Dernier enregistrement : <b>${parsedLastDate}</b>
                        </td>
                        <td>
                            <button class="button datastreamBTN"
                                data-action="plot"
                                data-id="${datastream["@iot.id"]}"
                                data-name="${Utils.escapeHtml(datastream.name)}"
                                data-unit="${Utils.escapeHtml(unitLabel)}"
                                data-graph="${graphType}">
                                Afficher
                            </button>
                        </td>
                    </tr>`;
      });

      sensorContent += `</tbody></table></div></div></div>`;
    });

    table.innerHTML = sensorContent;
  } catch (error) {
    console.error("Failed to create sensor table:", error);
    Utils.showNotification("Erreur lors du chargement des capteurs", "danger");
  }
}

/**
 * Plots a datastream on the graph
 */
async function plotDatastream(id, title, unit, graphType, btn) {
  const datastreamId = id.toString();
  const checkboxSuperpose = document.getElementById("checkbox_superpose");

  // Manage datastream list based on overlay mode
  if (!checkboxSuperpose.checked) {
    if (!state.dataDict.hasOwnProperty(datastreamId)) {
      state.datastreamIdList = [datastreamId];
      state.dataDict = {};
      state.seriesConfig = {};
    }
  } else {
    if (!state.dataDict.hasOwnProperty(datastreamId)) {
      state.datastreamIdList.push(datastreamId);
    }
  }

  // Load data for each datastream
  for (const dsId of state.datastreamIdList) {
    if (state.dataDict.hasOwnProperty(dsId)) {
      continue; // Already loaded
    }

    try {
      // Fetch observations
      const obsUrl = STAApi.buildQuery(
        state.config.urlService,
        `Datastreams(${dsId})/Observations`,
        {
          select: "result,phenomenonTime",
          top: 10000,
          orderby: "phenomenonTime desc",
          resultFormat: "dataArray",
        },
      );
      const obsResult = await STAApi.fetchSTA(obsUrl, { maxRecords: 9999 });
      const components = obsResult.components;
      let data;
      if (components[0] === "phenomenonTime") {
        data = obsResult.dataArray.map((row) => [new Date(row[0]), row[1]]);
      } else {
        data = obsResult.dataArray.map((row) => [new Date(row[1]), row[0]]);
      }
      data = data.reverse(); //because of orderby: 'phenomenonTime desc'

      state.dataDict[dsId] = {
        data: data,
        label: `${title} (${unit}) \n`,
        graph: graphType,
      };

      // Fetch location
      const locUrl = STAApi.buildQuery(
        state.config.urlService,
        `Datastreams(${dsId})/Thing/Locations`,
        {
          select: "location,name",
        },
      );
      const locationData = await STAApi.fetchSTA(locUrl);

      if (locationData.length > 0) {
        locationData[0].location.properties = {
          name: locationData[0].name,
        };
        state.dataDict[dsId].location = locationData[0].location;
      }

      // Configure plotter for bar charts
      if (graphType === "bar") {
        state.seriesConfig[state.dataDict[dsId].label] = {
          plotter: UtilsGraph.barChartPlotter(1),
        };
      } else {
        state.seriesConfig[state.dataDict[dsId].label] = {};
      }
    } catch (error) {
      console.error(`Failed to load datastream ${dsId}:`, error);
      Utils.showNotification(
        `Erreur lors du chargement du flux ${title}`,
        "danger",
      );
      return;
    }
  }

  // Update graph based on mode
  if (!checkboxSuperpose.checked) {
    // Solo mode
    state.graph.updateOptions({
      file: state.dataDict[datastreamId].data,
      title: title,
      ylabel: unit,
      labels: ["x", `${title} (${unit}) \n`],
      series: state.seriesConfig,
    });

    document.getElementById("label_superpose").style.visibility = "";
  } else {
    // Overlay mode
    const mergedData = [];
    const labels = ["x"];

    for (const dsId of state.datastreamIdList) {
      mergedData.push(state.dataDict[dsId].data);
      labels.push(state.dataDict[dsId].label);
    }

    const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);

    state.graph.updateOptions({
      file: arrayFinal,
      labels: labels,
      ylabel: null,
      title: null,
      series: state.seriesConfig,
    });
  }

  // Update mini-map
  updateMiniMap();

  // Show download button
  document.getElementById("DL_data").style.visibility = "";
  state.xRange = state.graph.xAxisRange();

  // Update button for overlay mode
  if (checkboxSuperpose.checked) {
    btn.innerText = "Masquer";
    btn.dataset.action = "hide";
  }

  // Show graph as overlay on mobile
  if (isBurgerMode()) {
    showGraphOverlay();
  }
}

/**
 * Hides a datastream from the graph
 */
function hideDatastream(id, btn) {
  const datastreamId = id.toString();
  delete state.dataDict[datastreamId];

  const index = state.datastreamIdList.indexOf(datastreamId);
  if (index > -1) {
    state.datastreamIdList.splice(index, 1);
  }

  // Rebuild graph
  const mergedData = [];
  const labels = ["x"];

  for (const dsId of Object.keys(state.dataDict)) {
    mergedData.push(state.dataDict[dsId].data);
    labels.push(state.dataDict[dsId].label);
  }

  const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);

  state.graph.updateOptions({
    file: arrayFinal,
    labels: labels,
    ylabel: null,
    title: null,
  });

  // Update button text and action
  const checkboxSuperpose = document.getElementById("checkbox_superpose");
  btn.dataset.action = "plot";
  if (!checkboxSuperpose.checked) {
    btn.innerText = "Afficher";
  } else {
    btn.innerText = "Superposer";
  }
}

/**
 * Renames all datastream buttons
 */
function renameButtons(text) {
  const buttons = document.querySelectorAll(".datastreamBTN");
  buttons.forEach((button) => {
    if (button.textContent !== "Masquer") {
      button.textContent = text;
    }
  });
}

/**
 * Downloads CSV files for selected datastreams
 */
async function downloadAllCSV() {
  if (Object.keys(state.dataDict).length === 0) {
    Utils.showNotification("Aucune datastream sélectionnée", "warning");
    return;
  }

  if (
    !confirm(
      "Vous allez télécharger un ou plusieurs fichiers CSV. Voulez-vous continuer ?",
    )
  ) {
    return;
  }

  for (const datastreamId of Object.keys(state.dataDict)) {
    try {
      const dataInfo = state.dataDict[datastreamId];
      const filterClause = `phenomenonTime ge ${new Date(state.xRange[0]).toISOString()} and phenomenonTime le ${new Date(state.xRange[1]).toISOString()}`;

      const url = STAApi.buildQuery(
        state.config.urlService,
        `Datastreams(${datastreamId})/Observations`,
        {
          resultFormat: "csv",
          select: "phenomenonTime,result",
          orderby: "phenomenonTime asc",
          filter: filterClause,
        },
      );

      const csvText = await STAApi.fetchSTA(url);
      Utils.downloadFile([csvText], `${dataInfo.label}.csv`);

      console.log(`CSV pour ${dataInfo.label} téléchargé avec succès`);
    } catch (error) {
      console.error(
        `Erreur pour ${state.dataDict[datastreamId].label}:`,
        error,
      );
      Utils.showNotification(`Erreur de téléchargement`, "danger");
    }
  }
}

/**
 * Unzooms the graph
 * @param {Object} graph - Optional graph parameter (for backward compatibility, uses state.graph if not provided)
 */
function unzoomGraph(graph = null) {
  const targetGraph = graph || state.graph;
  targetGraph.updateOptions({
    dateWindow: null,
    valueRange: null,
  });
  document.getElementById("btn_zomm").style.visibility = "hidden";
}

/**
 * Filters table rows by datastream name
 */
function filterTable() {
  const input = document.getElementById("searchInput");
  const filter = input.value.toUpperCase();
  const tables = document.querySelectorAll("#table_sensor table");

  tables.forEach((table) => {
    const rows = table.getElementsByTagName("tr");

    for (let i = 1; i < rows.length; i++) {
      const th = rows[i].getElementsByTagName("th")[0];

      if (th) {
        const txtValue = th.textContent || th.innerText;
        rows[i].style.display = txtValue.toUpperCase().includes(filter)
          ? ""
          : "none";
      }
    }
  });
}

/**
 * Filters cards by sensor description
 */
function filterByDescription() {
  const input = document.getElementById("searchDescriptionInput");
  const filter = input.value.toUpperCase();
  const cards = document.querySelectorAll("#table_sensor .card");

  cards.forEach((card) => {
    const p = card.querySelector("p.nameSensor");

    if (p) {
      const txtValue = p.textContent || p.innerText;
      card.style.display = txtValue.toUpperCase().includes(filter)
        ? ""
        : "none";
    }
  });
}

/**
 * Toggles fullscreen mode for the graph
 */
function toggleFullscreen() {
  const graphColumn = document.getElementById("columnGraph");
  const graphDiv = document.getElementById("graphDiv");

  if (graphColumn.classList.contains("fullscreen")) {
    // Exit fullscreen
    graphColumn.classList.remove("fullscreen");
    if (state.originalWidth) {
      graphColumn.style.width = state.originalWidth;
    }
    graphDiv.style.width = "95%";
    graphDiv.style.height = "400px";
    document.getElementById("fullscreenBtn").innerText = "Plein écran";
  } else {
    // Enter fullscreen
    state.originalWidth = graphColumn.offsetWidth + "px";
    graphColumn.style.width = "100%";
    graphColumn.classList.add("fullscreen");
    graphDiv.style.height = "75%";
    document.getElementById("fullscreenBtn").innerText = "Retour";
  }

  state.graph.resize();
}

/**
 * Updates the mini-map with current datastreams
 */
function updateMiniMap() {
  let locations = [];
  for (const datastreamId of state.datastreamIdList) {
    if (state.dataDict[datastreamId]?.location) {
      locations.push(state.dataDict[datastreamId]);
    }
  }

  if (state.vectorLayer) {
    state.map.removeLayer(state.vectorLayer);
  }

  const geojson = UtilsMap.createFeatureCollection(locations);
  state.vectorLayer = UtilsMap.createVectorLayer(geojson);

  state.map.addLayer(state.vectorLayer);
  UtilsMap.fitToFeatures(state.map, state.vectorLayer, 50);
}

/**
 * Initializes the Dygraph
 */
function initializeGraph() {
  state.graph = UtilsGraph.createDygraph(
    document.getElementById("graphDiv"),
    document.getElementById("customLegend"),
    {
      zoomCallback: function () {
        document.getElementById("btn_zomm").style.visibility = "";
      },
    },
  );
}

/**
 * Sets up overlay checkbox behavior
 */
function setupOverlayCheckbox() {
  const checkboxSuperpose = document.getElementById("checkbox_superpose");
  checkboxSuperpose.checked = false;

  checkboxSuperpose.addEventListener("change", function () {
    if (checkboxSuperpose.checked) {
      renameButtons("Superposer");
    } else {
      renameButtons("Afficher");
      state.datastreamIdList = [];
      state.dataDict = {};
    }
  });
}

/**
 * Main initialization function
 */
async function main() {
  state.config = await waitForAppReady();

  // Update service name
  const serviceNameEl = document.getElementById("serviceName");
  if (serviceNameEl && state.config.name_service) {
    serviceNameEl.textContent = state.config.name_service;
  }

  // Initialize components
  initializeGraph();
  state.map = UtilsMap.createMap("minimap", { zoom: 10 });
  setupOverlayCheckbox();

  // Load sensor table
  await createSensorTable();
}

// Initialize when page loads
main();

// Event listeners (replacing inline onclick/onkeyup handlers)
document
  .getElementById("searchDescriptionInput")
  .addEventListener("keyup", filterByDescription);
document.getElementById("searchInput").addEventListener("keyup", filterTable);
document.getElementById("btn_dl").addEventListener("click", downloadAllCSV);
document
  .getElementById("fullscreenBtn")
  .addEventListener("click", toggleFullscreen);
document
  .getElementById("btn_zomm")
  .addEventListener("click", () => unzoomGraph());
document
  .getElementById("closeGraphOverlay")
  .addEventListener("click", hideGraphOverlay);

// Event delegation for dynamic datastream buttons
document.getElementById("table_sensor").addEventListener("click", (e) => {
  const btn = e.target.closest(".datastreamBTN");
  if (!btn) return;

  const { action, id, name, unit, graph } = btn.dataset;
  if (action === "plot") {
    plotDatastream(Number(id), name, unit, graph, btn);
  } else if (action === "hide") {
    hideDatastream(Number(id), btn);
  }
});
