import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import * as Utils from "./utils/utils.js";
import * as UtilsMap from "./utils/utils-mapping.js";
import * as UtilsGraph from "./utils/utils-graph.js";
import {
  showDownloadModal,
  parseShareParam,
  initShareButton,
  applyShareZoomPagination,
  createPaginationController,
} from "./utils/plot-controls.js";

/**
 * Téléchargement Page
 * Data visualization with filtering, plotting, CSV export, and map integration
 */

// Application state
const state = {
  config: null,
  obspDict: {},
  datastreamDict: {},
  sensorDict: {},
  thingDict: {},
  datastreamsToShow: [],
  datastreamListInter: [],
  sensorCheck: false,
  thingCheck: false,
  listAggregation: {},
  listAggregationResume: {},
  dataZoomDict: {},
  groupInit: null,
  plotActive: [],
  fullScreen: false,
  seriesData: {},
  seriesConfig: {},
  dictArgStat: {},
  zoom: false,
  isUpdatingZoom: false,
  graph: null,
  map: null,
  vectorLayer: new ol.layer.Vector({}),
  plotHighlightLayer: null,
  boundingBox: null,
  geojsonFeature: {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "EPSG:4326" } },
    features: [],
  },
  pagination: {
    enabled: false,
    currentPage: 1,
    totalPages: 1,
    pageSize: 50000,
    maxCachedPages: 10,
    referenceDs: null,
    counts: {},
    pageData: {},
    pageBounds: {},
    pageOrder: [],
  },
};

const elements = {
  obspList: document.getElementById("obspList"),
  datastreamList: document.getElementById("datastreamList"),
  sensorList: document.getElementById("sensorList"),
  thingList: document.getElementById("thingList"),
  familleList: document.getElementById("familleList"),
  progressBar: document.getElementById("progressBar"),
  progressBar2: document.getElementById("progressBar2"),
  progressBar3: document.getElementById("progressBar3"),
};

const paginationCtrl = createPaginationController({
  prevBtn: document.getElementById("btn_prev_page"),
  nextBtn: document.getElementById("btn_next_page"),
  indicator: document.getElementById("pageIndicator"),
  container: document.getElementById("paginationControls"),
  onPageChange: async (pageNum) => {
    state.pagination.currentPage = pageNum;
    await downloadAndPlotPage(pageNum);
  },
});

async function loadDatastreamsInfo() {
  elements.progressBar3.classList.remove("is-hidden");
  try {
    const url = STAApi.buildQuery(state.config.urlService, "Datastreams", {
      top: 10000,
      select: "name,description,id,unitOfMeasurement,properties",
      expand:
        "Sensor($select=name),Thing($select=name),ObservedProperty($select=name)",
    });
    const data = await STAApi.fetchSTA(url);
    data.forEach((ds) => {
      state.datastreamDict[ds.name] = {
        sensor: ds.Sensor.name,
        thing: ds.Thing.name,
        observedproperty: ds.ObservedProperty.name,
        description: ds.description,
        id: ds["@iot.id"],
        unitOfMeasurement: ds.unitOfMeasurement,
        properties: ds.properties,
      };
    });
  } catch (error) {
    console.error("Error:", error);
    Utils.showNotification("Erreur de chargement", "danger");
  } finally {
    elements.progressBar3.classList.add("is-hidden");
  }
}

async function loadSensorsInfo() {
  const url = STAApi.buildQuery(state.config.urlService, "Sensors", {
    select: "name,metadata,description,id",
  });
  const data = await STAApi.fetchSTA(url);
  data.forEach((sensor) => {
    state.sensorDict[sensor.name] = {
      metadata: sensor.metadata,
      description: sensor.description,
      id: sensor["@iot.id"],
    };
  });
}

async function loadThingsInfo() {
  const thingsUrl = STAApi.buildQuery(state.config.urlService, "Things", {
    top: 10000,
    select: "name,description,id",
    expand:
      "Locations($select=location;$top=10000),Datastreams($select=name;$top=10000)",
  });
  const things = await STAApi.fetchSTA(thingsUrl);
  things.forEach((thing) => {
    state.thingDict[thing.name] = {
      description: thing.description,
      id: thing["@iot.id"],
    };
    let loc = thing.Locations[0].location;
    if (!loc.geometry) {
      loc = {
        type: "Feature",
        geometry: { type: loc.type, coordinates: loc.coordinates },
        properties: {},
      };
    }
    loc.properties = {
      name: thing.name,
      id: thing["@iot.id"],
      description: thing.description,
      datastreamsName: thing.Datastreams.map((ds) => ds.name),
    };
    state.geojsonFeature.features.push(loc);
  });

  const geojson = UtilsMap.createFeatureCollection(things);
  state.vectorLayer = UtilsMap.createVectorLayer(geojson);
  state.map.addLayer(state.vectorLayer);
  UtilsMap.fitToFeatures(state.map, state.vectorLayer, 150);
  state.map.on("click", handleMapClick);
  UtilsMap.addCursorFeedback(state.map);
}

async function populateObservedPropertiesList() {
  let familly = [];
  const familleListDiv = document.getElementById("familleList");
  const obspUrl = STAApi.buildQuery(
    state.config.urlService,
    "ObservedProperties",
    {
      select: "name,description,id,definition,properties",
      expand: "Datastreams($select=name;$top=10000)",
    },
  );
  const data = await STAApi.fetchSTA(obspUrl);

  data.forEach((obsp) => {
    state.obspDict[obsp.name] = {
      id: obsp["@iot.id"],
      description: obsp.description,
      definition: obsp.definition,
      property: obsp.properties,
      datastreamsName: obsp.Datastreams.map((ds) => ds.name),
    };
    if (obsp.properties?.famille) {
      if (!familly.includes(obsp.properties.famille)) {
        familly.push(obsp.properties.famille);

        const div = document.createElement("div");
        const label = document.createElement("label");
        label.classList.add("checkbox");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = obsp.properties.famille;
        checkbox.checked = false;
        checkbox.addEventListener("change", updateObservedPropertiesByFamille);

        label.appendChild(checkbox);
        label.appendChild(
          document.createTextNode(" " + obsp.properties.famille),
        );
        div.appendChild(label);

        familleListDiv.appendChild(div);
      }
    }
  });
  for (const obsp in state.obspDict) {
    if (!state.obspDict[obsp].definition) continue;
    elements.obspList.appendChild(
      createCheckbox(
        obsp,
        updateDatastreamList,
        state.obspDict[obsp]["description"],
      ),
    );
  }
  if (familly.length == 0) {
    document.getElementById("FamilleCard").remove();
  }
}

function updateObservedPropertiesByFamille() {
  const selectedFamille = getSelectedValues(elements.familleList);
  clearList(elements.obspList);
  for (const obsp in state.obspDict) {
    if (
      selectedFamille.length === 0 ||
      selectedFamille.includes(state.obspDict[obsp].property?.famille)
    ) {
      elements.obspList.appendChild(createCheckbox(obsp, updateDatastreamList));
    }
  }
}

function updateDatastreamList({ skipMapFit = false } = {}) {
  resetPagination();
  const searchInput = document.getElementById("searchInput");
  const hasSearchContext = searchInput && searchInput.value.trim() !== "";

  const previouslyChecked = getSelectedValues(elements.datastreamList);
  const previousThings = getSelectedValues(elements.thingList);
  const previousSensors = getSelectedValues(elements.sensorList);
  clearList(elements.datastreamList);
  clearList(elements.sensorList);

  const selectedObsp = getSelectedValues(elements.obspList);
  state.datastreamsToShow = [
    ...new Set(
      selectedObsp.flatMap((obsp) => state.obspDict[obsp].datastreamsName),
    ),
  ];

  if (hasSearchContext) {
    // Map click context: keep things list unchanged, filter datastreams by selected things
    const selectedThings = getSelectedValues(elements.thingList);
    const filteredDatastreams =
      selectedThings.length > 0
        ? state.datastreamsToShow.filter(
            (ds) =>
              state.datastreamDict[ds] &&
              selectedThings.includes(state.datastreamDict[ds].thing),
          )
        : state.datastreamsToShow;

    filteredDatastreams.forEach((datastream) => {
      elements.datastreamList.appendChild(
        createCheckbox(datastream, handlePlot),
      );
    });
    updateSensorThingListFromDatastreams(filteredDatastreams, true);
  } else {
    clearList(elements.thingList);
    state.datastreamsToShow.forEach((datastream) => {
      elements.datastreamList.appendChild(
        createCheckbox(datastream, handlePlot),
      );
    });
    updateSensorThingListFromDatastreams(state.datastreamsToShow);

    // Restore previously selected Things and Sensors
    elements.thingList
      .querySelectorAll('input[type="checkbox"]')
      .forEach((cb) => {
        if (previousThings.includes(cb.value)) cb.checked = true;
      });
    elements.sensorList
      .querySelectorAll('input[type="checkbox"]')
      .forEach((cb) => {
        if (previousSensors.includes(cb.value)) cb.checked = true;
      });

    if (!skipMapFit) {
      highlightThingsOnMap(
        getThingNamesFromDatastreams(state.datastreamsToShow),
      );
    }
  }
  recheckSurvivingDatastreams(previouslyChecked);
  togglePlotAllDatastreams();
}

function updateSensorThingListFromDatastreams(datastreams, skipThings = false) {
  clearList(elements.sensorList);
  if (!skipThings) {
    clearList(elements.thingList);
  }
  const sensorsToShow = new Set();
  const thingsToShow = new Set();
  datastreams.forEach((datastream) => {
    const relatedData = state.datastreamDict[datastream];
    sensorsToShow.add(relatedData.sensor);
    thingsToShow.add(relatedData.thing);
  });
  sensorsToShow.forEach((sensor) => {
    elements.sensorList.appendChild(
      createCheckbox(sensor, updateDatastreamFromSensor),
    );
  });
  if (!skipThings) {
    thingsToShow.forEach((thing) => {
      elements.thingList.appendChild(
        createCheckbox(
          thing,
          updateDatastreamFromThing,
          state.thingDict[thing]["description"],
        ),
      );
    });
  }
}

function updateDatastreamFromSensor() {
  const selectedSensors = getSelectedValues(elements.sensorList);
  const previouslyChecked = getSelectedValues(elements.datastreamList);

  filterDatastreamsBySensorOrThing(selectedSensors, "sensor");
  recheckSurvivingDatastreams(previouslyChecked);

  // Highlight: use selected things if any, otherwise things from visible datastreams
  const selectedThings = getSelectedValues(elements.thingList);
  const thingsToHighlight =
    selectedThings.length > 0
      ? new Set(selectedThings)
      : getThingNamesFromDatastreams(
          getAllCheckboxValues(elements.datastreamList),
        );
  highlightThingsOnMap(thingsToHighlight);
}

function updateDatastreamFromThing() {
  const selectedThings = getSelectedValues(elements.thingList);

  // Exit map click context when all things are unchecked
  const searchInput = document.getElementById("searchInput");
  if (
    selectedThings.length === 0 &&
    searchInput &&
    searchInput.value.trim() !== ""
  ) {
    searchInput.value = "";
    updateSensorThingListFromDatastreams(state.datastreamsToShow);
    updateDatastreamList();
    return;
  }

  const previouslyChecked = getSelectedValues(elements.datastreamList);
  filterDatastreamsBySensorOrThing(selectedThings, "thing");
  recheckSurvivingDatastreams(previouslyChecked);
  highlightThingsOnMap(new Set(selectedThings));
}

function filterDatastreamsBySensorOrThing(selectedItems, key) {
  clearList(elements.datastreamList);

  const otherKey = key === "sensor" ? "thing" : "sensor";
  const otherList = key === "sensor" ? elements.thingList : elements.sensorList;
  const otherCallback =
    key === "sensor" ? updateDatastreamFromThing : updateDatastreamFromSensor;
  let visibleDatastreams;

  if (selectedItems.length === 0) {
    state[key + "Check"] = false;
    // Apply the other filter if it's active
    if (state[otherKey + "Check"]) {
      const otherSelected = getSelectedValues(otherList);
      visibleDatastreams = state.datastreamsToShow.filter(
        (ds) =>
          state.datastreamDict[ds] &&
          otherSelected.includes(state.datastreamDict[ds][otherKey]),
      );
    } else {
      visibleDatastreams = state.datastreamsToShow;
    }
  } else {
    state[key + "Check"] = true;
    const otherSelected = getSelectedValues(otherList);
    visibleDatastreams = [];
    for (const datastream in state.datastreamDict) {
      if (
        state.datastreamsToShow.includes(datastream) &&
        selectedItems.includes(state.datastreamDict[datastream][key]) &&
        (!state[otherKey + "Check"] ||
          otherSelected.includes(state.datastreamDict[datastream][otherKey]))
      ) {
        visibleDatastreams.push(datastream);
      }
    }
    state.datastreamListInter = visibleDatastreams;
  }

  visibleDatastreams.forEach((datastream) => {
    elements.datastreamList.appendChild(createCheckbox(datastream, handlePlot));
  });

  // Rebuild other list if it's not actively filtered
  if (!state[otherKey + "Check"]) {
    clearList(otherList);
    const objectsToShow = new Set();
    visibleDatastreams.forEach((datastream) => {
      objectsToShow.add(state.datastreamDict[datastream][otherKey]);
    });
    objectsToShow.forEach((item) => {
      otherList.appendChild(createCheckbox(item, otherCallback));
    });
  }

  togglePlotAllDatastreams();
}

function createCheckbox(value, onChangeHandler, description = null) {
  const div = document.createElement("div");
  const label = document.createElement("label");
  label.classList.add("checkbox");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = value;
  checkbox.checked = false;
  checkbox.addEventListener("change", onChangeHandler);
  label.appendChild(checkbox);
  label.appendChild(document.createTextNode(" " + value));
  if (description) {
    label.title = description;
  }
  div.appendChild(label);
  return div;
}

function getSelectedValues(container) {
  const checkboxes = container.querySelectorAll(
    'input[type="checkbox"]:checked',
  );
  return Array.from(checkboxes).map((checkbox) => checkbox.value);
}

function clearList(container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function getAllCheckboxValues(container) {
  return Array.from(container.querySelectorAll('input[type="checkbox"]')).map(
    (cb) => cb.value,
  );
}

/**
 * Get unique thing names from a list of datastream names
 * @param {Array} datastreams - Array of datastream names
 * @returns {Set} Set of thing names
 */
function getThingNamesFromDatastreams(datastreams) {
  const things = new Set();
  datastreams.forEach((ds) => {
    if (state.datastreamDict[ds]) {
      things.add(state.datastreamDict[ds].thing);
    }
  });
  return things;
}

/**
 * Highlight things on the map and zoom to them
 * @param {Set} thingNames - Set of thing names to highlight
 */
function highlightThingsOnMap(thingNames) {
  state.vectorLayer
    .getSource()
    .getFeatures()
    .forEach((feature) => {
      feature.set("selected", thingNames.has(feature.get("name")));
    });
  state.vectorLayer.changed();
  UtilsMap.fitToFeatures(state.map, state.vectorLayer, 150, true);
}

/**
 * After a list rebuild, re-check datastreams that are still visible and re-plot if selection changed
 * @param {Array} previouslyChecked - Datastream names that were checked before rebuild
 */
function recheckSurvivingDatastreams(previouslyChecked) {
  if (previouslyChecked.length === 0) return;
  const visibleValues = new Set(getAllCheckboxValues(elements.datastreamList));
  const survivors = previouslyChecked.filter((ds) => visibleValues.has(ds));
  elements.datastreamList
    .querySelectorAll('input[type="checkbox"]')
    .forEach((cb) => {
      if (survivors.includes(cb.value)) cb.checked = true;
    });
  if (survivors.length !== previouslyChecked.length) {
    handlePlot();
  }
}

function createMetadataTabs() {
  const tabsContainer = document.getElementById("tabs");
  const contentContainer = document.getElementById("tab-content");
  tabsContainer.innerHTML = "";
  contentContainer.innerHTML = "";
  getSelectedValues(elements.datastreamList).forEach((item, index) => {
    const dictInfo = state.datastreamDict[item];
    const tab = document.createElement("li");
    tab.setAttribute("data-target", `tab${index}`);
    tab.innerHTML = `<a>${Utils.escapeHtml(item)}</a>`;
    tabsContainer.appendChild(tab);
    const content = document.createElement("div");
    content.className = "ongletContent is-hidden";
    content.id = `tab${index}`;
    content.innerHTML = `
            <div class="box"><b>${Utils.escapeHtml(dictInfo.description)}</b></div>
            <div class="box">Point de mesure : ${Utils.escapeHtml(dictInfo.thing)}, ${Utils.escapeHtml(state.thingDict[dictInfo.thing].description)}</div>
            <div class="box">Variable mesurée : ${Utils.escapeHtml(dictInfo.observedproperty)}, ${Utils.escapeHtml(state.obspDict[dictInfo.observedproperty].description)} <a href="${Utils.escapeHtml(state.obspDict[dictInfo.observedproperty].definition)}">Thesaurus</a></div>
            <div class="box">Capteur : ${Utils.escapeHtml(dictInfo.sensor)}, ${Utils.escapeHtml(state.sensorDict[dictInfo.sensor].description)} <a href="${Utils.escapeHtml(state.sensorDict[dictInfo.sensor].metadata)}">documentation capteur</a></div>
        `;
    contentContainer.appendChild(content);
    if (index === 0) {
      tab.classList.add("is-active");
      content.classList.remove("is-hidden");
    }
  });
  document.getElementById("ongletInfo").classList.remove("is-hidden");
  addTabClickEvent();
}

function addTabClickEvent() {
  const tabs = document.querySelectorAll("#tabs li");
  const contents = document.querySelectorAll(".ongletContent");
  tabs.forEach((tab) => {
    tab.addEventListener("click", function () {
      tabs.forEach((item) => item.classList.remove("is-active"));
      contents.forEach((content) => content.classList.add("is-hidden"));
      tab.classList.add("is-active");
      document
        .getElementById(tab.getAttribute("data-target"))
        .classList.remove("is-hidden");
    });
  });
}

/**
 * Plots datastreams in STEAN mode using $resultFormat=graphDatas.
 * Fetches each datastream separately, parses, and merges for Dygraph.
 */
async function plotGraphStean() {
  const selectedValues = getSelectedValues(elements.datastreamList);
  if (selectedValues.length === 0) return;

  const listNameSensor = [];
  const listNameThing = [];

  selectedValues.forEach((name) => {
    const dictInfo = state.datastreamDict[name];
    listNameSensor.push(dictInfo.sensor);
    listNameThing.push(dictInfo.thing);
  });

  createMetadataTabs();

  elements.progressBar2.classList.remove("is-hidden");

  const mergedData = [];
  const labels = ["x"];
  state.seriesConfig = {};
  state.dictArgStat = {};
  state.plotActive = state.plotActive.filter((item) =>
    selectedValues.includes(item),
  );

  for (const name of selectedValues) {
    const ds = state.datastreamDict[name];
    const unit = `unité : ${ds.unitOfMeasurement.name} (${ds.unitOfMeasurement.symbol})`;
    const graphType = ds?.properties?.graph === "bar" ? "bar" : "line";

    if (!state.seriesData[name]) {
      const url = `${state.config.urlService}/Datastreams(${ds.id})/Observations?$resultFormat=graphDatas`;
      const chunks = await Utils.fetchStreamWithSize(
        url,
        elements.progressBar2,
        selectedValues.length > 1 ? name : "",
      );
      const totalArray = Utils.concatUint8Arrays(chunks);
      const decoder = new TextDecoder();
      const text = decoder.decode(totalArray);
      const json = JSON.parse(text);
      const parsed = UtilsGraph.parseGraphDatas(json[0]);

      state.seriesData[name] = {
        data: parsed.data,
        label: name,
        unit,
        graph: graphType,
        aggregation: "moving_average",
        properties: ds.properties,
      };
      state.plotActive.push(name);
    }

    state.listAggregation[name] = "moving_average";
    mergedData.push(state.seriesData[name].data);
    labels.push(`${name} ${unit}`);
    state.seriesConfig[`${name} ${unit}`] =
      graphType === "bar" ? { plotter: UtilsGraph.barChartPlotter(2) } : {};
    state.dictArgStat[`${name} ${unit}`] = graphType;
  }

  elements.progressBar2.classList.add("is-hidden");

  const arrayFinal =
    mergedData.length === 1
      ? mergedData[0]
      : UtilsGraph.mergeDataArrays(mergedData);

  let thresholdCallback = null;
  if (selectedValues.length === 1) {
    const props = state.datastreamDict[selectedValues[0]]?.properties;
    thresholdCallback = UtilsGraph.createThresholdCallback(props);
  }

  state.graph.updateOptions({
    file: arrayFinal,
    labels,
    series: state.seriesConfig,
    underlayCallback: thresholdCallback,
    title: "",
  });

  const statistique = UtilsGraph.calculStatGraph(
    state.graph,
    state.dictArgStat,
  );
  UtilsGraph.renderStatisticsTable(
    selectedValues,
    statistique,
    document.getElementById("stat_agg"),
    state.seriesData,
    state.listAggregation,
  );

  updateCheckboxColors(elements.sensorList, listNameSensor);
  updateCheckboxColors(elements.thingList, listNameThing);
  document.getElementById("DL_data").style.visibility = "";
  filterMapBySelection();
}

/**
 * Routes to the appropriate plot function based on service mode
 */
async function handlePlot() {
  if (state.config.modeService === "stean") {
    await plotGraphStean();
  } else if (state.config.modeService === "Frost_Geosas") {
    await plotGraph();
  } else {
    await plotGraphBasique();
  }
}

/**
 * Plots datastreams in basic mode with pagination for large datasets.
 * Checks observation count first: if <= pageSize, uses standard plotGraph().
 * Otherwise enables paginated navigation with FIFO cache.
 */
async function plotGraphBasique() {
  const selectedValues = getSelectedValues(elements.datastreamList);
  if (selectedValues.length === 0) {
    resetPagination();
    return;
  }

  const listNameSensor = [];
  const listNameThing = [];
  const plotToDo = {};

  selectedValues.forEach((info) => {
    const dictInfo = state.datastreamDict[info];
    const graph = dictInfo?.properties?.graph === "bar" ? "bar" : "line";
    listNameSensor.push(dictInfo.sensor);
    listNameThing.push(dictInfo.thing);
    plotToDo[info] = {
      id: dictInfo.id,
      title: info,
      unit: `unité : ${dictInfo.unitOfMeasurement.name} (${dictInfo.unitOfMeasurement.symbol})`,
      graph: graph,
    };
  });

  createMetadataTabs();

  // Get counts for new datastreams
  elements.progressBar2.classList.remove("is-hidden");
  for (const name of selectedValues) {
    if (state.pagination.counts[name] === undefined) {
      const id = state.datastreamDict[name].id;
      state.pagination.counts[name] = await STAApi.getCount(
        state.config.urlService,
        `Datastreams(${id})/Observations`,
      );
    }
  }
  elements.progressBar2.classList.add("is-hidden");

  const maxCount = Math.max(
    ...selectedValues.map((n) => state.pagination.counts[n]),
  );

  if (maxCount <= state.pagination.pageSize) {
    // Small dataset: use standard flow, hide pagination
    state.pagination.enabled = false;
    paginationCtrl.hide();
    await plotGraph();
    return;
  }

  // Large dataset: enable pagination
  const referenceDs = selectedValues.reduce((a, b) =>
    state.pagination.counts[a] >= state.pagination.counts[b] ? a : b,
  );

  // Reset pagination if reference changed
  if (state.pagination.referenceDs !== referenceDs) {
    state.pagination.pageData = {};
    state.pagination.pageBounds = {};
    state.pagination.pageOrder = [];
  }

  state.pagination.enabled = true;
  state.pagination.referenceDs = referenceDs;
  state.pagination.totalPages = Math.ceil(
    state.pagination.counts[referenceDs] / state.pagination.pageSize,
  );
  // Cap current page to valid range
  state.pagination.currentPage = Math.min(
    state.pagination.currentPage,
    state.pagination.totalPages,
  );

  paginationCtrl.update(
    state.pagination.currentPage,
    state.pagination.totalPages,
  );
  paginationCtrl.show();

  await downloadAndPlotPage(state.pagination.currentPage);

  updateCheckboxColors(elements.sensorList, listNameSensor);
  updateCheckboxColors(elements.thingList, listNameThing);
  document.getElementById("DL_data").style.visibility = "";
  filterMapBySelection();
}

/**
 * Downloads and displays a specific page of observations.
 * Uses FIFO cache with max 10 pages.
 * Reference datastream uses $skip/$top, others use temporal filter.
 * @param {number} pageNum - Page number (1-based)
 */
async function downloadAndPlotPage(pageNum) {
  const selectedValues = getSelectedValues(elements.datastreamList);
  const pag = state.pagination;
  let pageCache = pag.pageData[pageNum] || {};
  const needsFetch = selectedValues.some((name) => !pageCache[name]);

  unzoomGraph();
  if (needsFetch) {
    elements.progressBar2.classList.remove("is-hidden");

    // Fetch reference datastream if not cached
    if (!pageCache[pag.referenceDs]) {
      const refId = state.datastreamDict[pag.referenceDs].id;
      const skip = (pageNum - 1) * pag.pageSize;
      const refUrl = STAApi.buildQuery(
        state.config.urlService,
        `Datastreams(${refId})/Observations`,
        {
          resultFormat: "dataArray",
          select: "phenomenonTime,result",
          orderby: "phenomenonTime asc",
          top: pag.pageSize,
          skip: skip || undefined,
        },
      );
      const refResult = await STAApi.fetchSTA(refUrl, { paginate: false });
      const refData = UtilsGraph.transformDataArray(refResult);
      pageCache[pag.referenceDs] = refData;

      // Store temporal bounds
      if (refData.length > 0) {
        pag.pageBounds[pageNum] = {
          start: refData[0][0].toISOString(),
          end: refData[refData.length - 1][0].toISOString(),
        };
      }
    }

    // Fetch other datastreams using temporal bounds
    const bounds = pag.pageBounds[pageNum];
    if (bounds) {
      for (const name of selectedValues) {
        if (name === pag.referenceDs || pageCache[name]) continue;
        const id = state.datastreamDict[name].id;
        const url = STAApi.buildQuery(
          state.config.urlService,
          `Datastreams(${id})/Observations`,
          {
            resultFormat: "dataArray",
            select: "phenomenonTime,result",
            orderby: "phenomenonTime asc",
            filter: `phenomenonTime ge ${bounds.start} and phenomenonTime le ${bounds.end}`,
          },
        );
        const result = await STAApi.fetchSTA(url, { paginate: false });
        pageCache[name] = UtilsGraph.transformDataArray(result);
      }
    }

    // Store in cache with FIFO eviction
    pag.pageData[pageNum] = pageCache;
    if (!pag.pageOrder.includes(pageNum)) {
      pag.pageOrder.push(pageNum);
    }
    while (pag.pageOrder.length > pag.maxCachedPages) {
      const oldest = pag.pageOrder.shift();
      delete pag.pageData[oldest];
    }

    elements.progressBar2.classList.add("is-hidden");
  }

  // Render: merge data for selected datastreams
  const mergedData = [];
  const labels = ["x"];
  state.seriesConfig = {};
  state.dictArgStat = {};

  for (const name of selectedValues) {
    const data = pageCache[name] || [];
    const dictInfo = state.datastreamDict[name];
    const unit = `unité : ${dictInfo.unitOfMeasurement.name} (${dictInfo.unitOfMeasurement.symbol})`;
    const graphType = dictInfo?.properties?.graph === "bar" ? "bar" : "line";
    mergedData.push(data);
    labels.push(`${name} ${unit}`);
    state.seriesConfig[`${name} ${unit}`] =
      graphType === "bar" ? { plotter: UtilsGraph.barChartPlotter(2) } : {};
    state.dictArgStat[`${name} ${unit}`] = graphType;

    // Populate seriesData for statistics table
    state.seriesData[name] = {
      data,
      label: name,
      unit,
      graph: graphType,
      aggregation: null,
      properties: dictInfo.properties,
    };
    state.listAggregation[name] = null;
  }

  const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);

  let thresholdCallback = null;
  if (selectedValues.length === 1) {
    const props = state.datastreamDict[selectedValues[0]]?.properties;
    thresholdCallback = UtilsGraph.createThresholdCallback(props);
  }

  state.graph.updateOptions({
    file: arrayFinal,
    labels: labels,
    series: state.seriesConfig,
    underlayCallback: thresholdCallback,
  });

  const statistique = UtilsGraph.calculStatGraph(
    state.graph,
    state.dictArgStat,
  );
  UtilsGraph.renderStatisticsTable(
    selectedValues,
    statistique,
    document.getElementById("stat_agg"),
    state.seriesData,
    state.listAggregation,
  );

  paginationCtrl.update(
    state.pagination.currentPage,
    state.pagination.totalPages,
  );
}

/**
 * Resets pagination state and hides controls
 */
function resetPagination() {
  state.pagination.enabled = false;
  state.pagination.currentPage = 1;
  state.pagination.totalPages = 1;
  state.pagination.counts = {};
  state.pagination.pageData = {};
  state.pagination.pageBounds = {};
  state.pagination.pageOrder = [];
  state.pagination.referenceDs = null;
  paginationCtrl.reset();
}

async function plotGraph() {
  const plotToDo = {};
  const listNameSensor = [];
  const listNameThing = [];
  try {
    const selectedValues = getSelectedValues(elements.datastreamList);
    selectedValues.forEach((info) => {
      const dictInfo = state.datastreamDict[info];
      const graph = dictInfo?.properties?.graph === "bar" ? "bar" : "line";
      listNameSensor.push(dictInfo.sensor);
      listNameThing.push(dictInfo.thing);
      plotToDo[info] = {
        id: dictInfo.id,
        title: info,
        unit: `unité : ${dictInfo.unitOfMeasurement.name} (${dictInfo.unitOfMeasurement.symbol})`,
        graph: graph,
      };
    });
    createMetadataTabs();
    state.plotActive = state.plotActive.filter((item) =>
      Object.keys(plotToDo).includes(item),
    );
    for (const key in plotToDo) {
      if (
        !state.plotActive.includes(key) &&
        !state.seriesData.hasOwnProperty(key)
      ) {
        await downloadDataForPlot(
          plotToDo[key].id,
          plotToDo[key].title,
          plotToDo[key].unit,
          plotToDo[key].graph,
        );
        state.plotActive.push(key);
      } else {
        state.listAggregation[plotToDo[key].title] =
          state.listAggregationResume[plotToDo[key].title];
      }
    }
    plotGraph_internal();
    updateCheckboxColors(elements.sensorList, listNameSensor);
    updateCheckboxColors(elements.thingList, listNameThing);
    document.getElementById("DL_data").style.visibility = "";
    filterMapBySelection();
  } finally {
    if (Object.keys(state.seriesConfig).length == 0) {
      unzoomGraph();
    }
  }
}

function updateCheckboxColors(list, selectedNames) {
  list.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.parentNode.style.backgroundColor = selectedNames.includes(
      checkbox.value,
    )
      ? "yellow"
      : "";
  });
}

async function downloadDataForPlot(id, titre, unit, graph) {
  elements.progressBar2.classList.remove("is-hidden");
  try {
    let dateRange = null;
    let isZoomed = false;

    // If graph is already zoomed and in Frost_Geosas mode, download data for the zoomed range
    if (
      state.zoom &&
      state.graph &&
      state.config.modeService === "Frost_Geosas"
    ) {
      const xRange = state.graph.xAxisRange();
      dateRange = { start: new Date(xRange[0]), end: new Date(xRange[1]) };
      isZoomed = true;
    }

    const { data, aggregation, limitReached } =
      await UtilsGraph.downloadObservations({
        baseUrl: state.config.urlService,
        datastreamId: id,
        graphType: graph,
        mode: state.config.modeService,
        dateRange,
      });

    if (limitReached) {
      console.warn(
        `Data limit reached for ${titre}: showing first 100,000 records`,
      );
      Utils.showNotification(
        `Limite de données atteinte pour ${titre}: affichage des 100 000 premiers enregistrements`,
        "warning",
      );
    }

    state.listAggregation[titre] = aggregation;
    state.listAggregationResume[titre] = aggregation;
    state.seriesData[titre] = {
      data,
      label: titre,
      unit,
      graph,
      aggregation,
      isFiltered: isZoomed,
      properties: state.datastreamDict[titre]?.properties,
    };

    if (isZoomed) {
      state.dataZoomDict[titre] = data;
    }
  } finally {
    elements.progressBar2.classList.add("is-hidden");
  }
}

function plotGraph_internal() {
  const selectedValues = getSelectedValues(elements.datastreamList);
  const mergedData = [];
  const labels = ["x"];
  state.seriesConfig = {};
  state.dictArgStat = {};

  if (state.zoom) {
    // When zoomed, use data from dataZoomDict (already filtered/aggregated)
    // and preserve the current zoom range
    const xRange = state.graph.xAxisRange();

    for (const key of selectedValues) {
      const unit = state.seriesData[key].unit;
      mergedData.push(state.dataZoomDict[key] || state.seriesData[key].data);
      labels.push(key + " " + unit);
      state.seriesConfig[`${key} ${unit}`] =
        state.seriesData[key].graph === "bar"
          ? { plotter: UtilsGraph.barChartPlotter(2) }
          : {};
      state.dictArgStat[key + " " + unit] = state.seriesData[key].graph;
    }

    const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);
    state.graph.updateOptions({
      file: arrayFinal,
      labels: labels,
      series: state.seriesConfig,
      dateWindow: xRange, // Preserve zoom range
    });

    document.getElementById("btn_zomm").style.display = "";
  } else {
    // When not zoomed, use full data from seriesData
    for (const key in state.seriesData) {
      if (selectedValues.includes(key)) {
        state.listAggregation[key] = state.seriesData[key].aggregation;
        mergedData.push(state.seriesData[key].data);
        labels.push(
          state.seriesData[key].label + " " + state.seriesData[key].unit,
        );
        state.seriesConfig[
          `${state.seriesData[key].label} ${state.seriesData[key].unit}`
        ] =
          state.seriesData[key].graph === "bar"
            ? { plotter: UtilsGraph.barChartPlotter(2) }
            : {};
        state.dictArgStat[
          state.seriesData[key].label + " " + state.seriesData[key].unit
        ] = state.seriesData[key].graph;
      }
    }

    const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);

    let thresholdCallback = null;
    if (selectedValues.length == 1) {
      const props = state.datastreamDict[selectedValues[0]]?.properties;
      thresholdCallback = UtilsGraph.createThresholdCallback(props);
    }
    state.graph.updateOptions({
      file: arrayFinal,
      labels: labels,
      series: state.seriesConfig,
      underlayCallback: thresholdCallback,
    });
  }

  // Calculate and display statistics
  const statistique = UtilsGraph.calculStatGraph(
    state.graph,
    state.dictArgStat,
  );
  UtilsGraph.renderStatisticsTable(
    selectedValues,
    statistique,
    document.getElementById("stat_agg"),
    state.seriesData,
    state.listAggregation,
  );
}

/**
 * Resets graph zoom
 * Downloads full dataset for any series that only have filtered data
 * @param {Object} graph - Optional graph parameter (for backward compatibility, uses state.graph if not provided)
 */
async function unzoomGraph(graph = null) {
  state.zoom = false;
  const targetGraph = graph || state.graph;

  // Check for datastreams with filtered data and download full dataset
  const selectedValues = getSelectedValues(elements.datastreamList);
  const filteredSeries = [];

  for (const key of selectedValues) {
    if (state.seriesData[key] && state.seriesData[key].isFiltered) {
      filteredSeries.push(key);
    }
  }

  // Download full dataset for filtered series
  if (filteredSeries.length > 0) {
    elements.progressBar2.classList.remove("is-hidden");

    for (const titre of filteredSeries) {
      try {
        const dictInfo = state.datastreamDict[titre];
        const unit = `unité : ${dictInfo.unitOfMeasurement.name} (${dictInfo.unitOfMeasurement.symbol})`;
        const graph = dictInfo?.properties?.graph === "bar" ? "bar" : "line";

        const { data, aggregation, limitReached } =
          await UtilsGraph.downloadObservations({
            baseUrl: state.config.urlService,
            datastreamId: dictInfo.id,
            graphType: graph,
            mode: state.config.modeService,
          });

        if (limitReached) {
          console.warn(
            `Data limit reached for ${titre}: showing first 100,000 records`,
          );
          Utils.showNotification(
            `Limite de données atteinte pour ${titre}: affichage des 100 000 premiers enregistrements`,
            "warning",
          );
        }

        state.seriesData[titre] = {
          data,
          label: titre,
          unit,
          graph,
          aggregation,
          isFiltered: false,
        };
        state.listAggregationResume[titre] = aggregation;
      } catch (error) {
        console.error(`Error downloading full dataset for ${titre}:`, error);
        Utils.showNotification(
          `Erreur lors du téléchargement des données complètes pour ${titre}`,
          "danger",
        );
      }
    }

    elements.progressBar2.classList.add("is-hidden");
  }

  targetGraph.updateOptions({ dateWindow: null, valueRange: null });
  document.getElementById("btn_zomm").style.display = "none";
  plotGraph_internal();
  // if listAggregation empty  in mode frost_geosas next get will be with raw data
  state.listAggregation = { ...state.listAggregationResume };
  state.dataZoomDict = {}; // Clear zoom data when unzooming
}

async function updateGraphZoom() {
  // Prevent re-entry from zoomCallback
  if (state.isUpdatingZoom) return;

  state.isUpdatingZoom = true;
  state.zoom = true;
  state.seriesConfig = {};
  const xRange = state.graph.xAxisRange();
  const selectedValues = getSelectedValues(elements.datastreamList);

  // Only download new data in Frost_Geosas mode (for aggregation changes)
  // In other modes, just use the already-downloaded data
  if (state.config.modeService === "Frost_Geosas") {
    elements.progressBar2.classList.remove("is-hidden");

    for (const info of selectedValues) {
      const dictInfo = state.datastreamDict[info];
      const id = dictInfo.id;

      const zoomFilter = `phenomenonTime ge ${new Date(xRange[0]).toISOString()} and phenomenonTime le ${new Date(xRange[1]).toISOString()}`;

      let count;
      if (
        state.listAggregationResume[info] === null ||
        state.listAggregation[info] == null
      ) {
        count = 1;
      } else {
        console.log("DL en cours");
        count = await STAApi.getCount(
          state.config.urlService,
          `Datastreams(${id})/Observations`,
          zoomFilter,
        );
      }

      const group = UtilsGraph.determineAggregation(count);

      // Check if aggregation level changed - only fetch if it changed
      if (state.listAggregation[info] !== group) {
        state.listAggregation[info] = group;

        const graph = dictInfo?.properties?.graph === "bar" ? "bar" : "line";
        const groupby = UtilsGraph.buildGroupByParam(group, graph);
        let url;
        if (groupby) {
          url = STAApi.buildQuery(
            state.config.urlService,
            `Datastreams(${id})/Observations`,
            {
              resultFormat: "dataArray",
              filter: zoomFilter,
              groupby,
            },
          );
        } else {
          url = STAApi.buildQuery(
            state.config.urlService,
            `Datastreams(${id})/Observations`,
            {
              resultFormat: "dataArray",
              select: "phenomenonTime,result",
              orderby: "phenomenonTime asc",
              filter: zoomFilter,
            },
          );
        }
        const result = await STAApi.fetchSTA(url);
        state.dataZoomDict[info] = UtilsGraph.transformDataArray(result);
      }
      // If aggregation level didn't change, reuse existing data in dataZoomDict
    }

    elements.progressBar2.classList.add("is-hidden");
  }

  // Update graph with current data (from dataZoomDict or seriesData)
  const mergedData = [];
  const labels = ["x"];
  for (const key of selectedValues) {
    const unit = state.seriesData[key].unit;
    mergedData.push(state.dataZoomDict[key] || state.seriesData[key].data);
    labels.push(key + " " + unit);
    state.dictArgStat[key + " " + unit] = state.seriesData[key].graph;
  }
  const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);

  // Preserve the current zoom range to prevent triggering zoomCallback
  state.graph.updateOptions({
    file: arrayFinal,
    labels: labels,
    dateWindow: xRange, // Keep the same zoom range
  });

  // Calculate and display statistics
  const statistique = UtilsGraph.calculStatGraph(
    state.graph,
    state.dictArgStat,
  );
  UtilsGraph.renderStatisticsTable(
    selectedValues,
    statistique,
    document.getElementById("stat_agg"),
    state.seriesData,
    state.listAggregation,
  );

  document.getElementById("btn_zomm").style.display = "";
  state.isUpdatingZoom = false;
}

// ============================================================================
// Map functions
// ============================================================================
/**
 * Filters map to show only markers for selected Things and Datastreams
 * Hides non-selected markers and zooms to visible ones
 */
function filterMapBySelection() {
  // Remove previous highlight layer
  if (state.plotHighlightLayer) {
    state.map.removeLayer(state.plotHighlightLayer);
    state.plotHighlightLayer = null;
  }

  const selectedDatastreams = getSelectedValues(elements.datastreamList);
  if (selectedDatastreams.length === 0 || !state.graph) return;

  const colors = state.graph.getColors();
  const features = [];

  // Group datastreams by thing: thingName → [color1, color2, ...]
  const thingColors = new Map();
  selectedDatastreams.forEach((ds, index) => {
    if (state.datastreamDict[ds]) {
      const thingName = state.datastreamDict[ds].thing;
      if (!thingColors.has(thingName)) {
        thingColors.set(thingName, []);
      }
      thingColors.get(thingName).push(colors[index]);
    }
  });

  // Create colored circle features from existing vector layer features
  state.vectorLayer
    .getSource()
    .getFeatures()
    .forEach((feature) => {
      const name = feature.get("name");
      if (!thingColors.has(name)) return;

      const colorList = thingColors.get(name);
      colorList.forEach((color, i) => {
        const clone = feature.clone();
        clone.setStyle(
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: 15 + (colorList.length - 1 - i) * 8,
              fill: new ol.style.Fill({ color: color }),
              stroke: new ol.style.Stroke({ color: "#fff", width: 2 }),
            }),
            zIndex: i,
          }),
        );
        features.push(clone);
      });
    });

  if (features.length === 0) return;

  state.plotHighlightLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: features }),
    zIndex: 10,
  });
  state.map.addLayer(state.plotHighlightLayer);
  UtilsMap.fitToFeatures(state.map, state.plotHighlightLayer, 150);
}

function handleMapClick(evt) {
  const feature = state.map.forEachFeatureAtPixel(evt.pixel, (f) => f);
  if (!feature) return;

  const thingName = feature.get("name");

  document.getElementById("searchInput").value = "";

  const obspToCheck = new Set();
  for (const [dsName, ds] of Object.entries(state.datastreamDict)) {
    if (ds.thing === thingName) {
      obspToCheck.add(ds.observedproperty);
    }
  }

  elements.obspList
    .querySelectorAll('input[type="checkbox"]')
    .forEach((chekbox) => {
      chekbox.checked = obspToCheck.has(chekbox.value);
    });
  updateDatastreamList({ skipMapFit: true });

  elements.thingList
    .querySelectorAll('input[type="checkbox"]')
    .forEach((chekbox) => {
      chekbox.checked = chekbox.value === thingName;
    });

  const input = document.getElementById("searchInput");
  input.value = thingName;
  const event = new Event("input", { bubbles: true });
  input.dispatchEvent(event);

  updateDatastreamFromThing();
}

// ============================================================================
// UI Helper Functions
// ============================================================================

/**
 * Filters the thing list based on search input
 */
function filterTable() {
  const input = document.getElementById("searchInput");
  const filter = input.value.toUpperCase();
  const divs = document.querySelectorAll("#thingList div");

  divs.forEach((div) => {
    const label = div.querySelector("label");
    const checkbox = div.querySelector('input[type="checkbox"]');

    if (!label || !checkbox) return;

    const textToSearch = [checkbox.value, label.innerText, label.title]
      .filter(Boolean) // enlève null / undefined
      .join(" ")
      .toUpperCase();

    div.style.display = textToSearch.includes(filter) ? "" : "none";
  });
}
/**
 * Wait 300ms before doing a search, for let the user type
 */
const debouncedFilter = Utils.debounce(filterTable, 300);
document
  .getElementById("searchInput")
  .addEventListener("input", debouncedFilter);

let originalWidth = null;

/**
 * Toggles fullscreen mode for the graph
 */
function toggleFullscreen() {
  const graphColumn = document.getElementById("columnGraph");
  const graphDiv = document.getElementById("graphDiv");

  if (graphColumn.classList.contains("fullscreen")) {
    // Exit fullscreen
    graphColumn.classList.remove("fullscreen");
    if (originalWidth) {
      graphColumn.style.width = originalWidth;
    }
    graphDiv.style.width = "95%";
    graphDiv.style.height = "400px";
    document.getElementById("fullscreenBtn").innerText = "Plein écran";
    state.fullScreen = false;
  } else {
    // Enter fullscreen
    originalWidth = graphColumn.offsetWidth + "px";
    graphColumn.style.width = "100%";
    graphColumn.classList.add("fullscreen");
    graphDiv.style.height = "75%";
    document.getElementById("fullscreenBtn").innerText = "Retour";
    state.fullScreen = true;
  }

  state.graph.resize();
}

/**
 * Plot all the datastream by activate input checkbox
 */
function plotAllDatastreams() {
  const divs = document.querySelectorAll("#datastreamList div");

  if (divs.length > 6) {
    Utils.showModal({
      title: "⚠️ Attention",
      body: "Il y a potentiellement beaucoup de données, êtes-vous sûr de continuer ?",
      buttons: [
        {
          text: "Continuer",
          class: "is-success",
          onClick: () => {
            divs.forEach((div) => {
              const checkbox = div.querySelector('input[type="checkbox"]');
              checkbox.checked = true;
            });
            handlePlot();
          },
        },
        {
          text: "Annuler",
          class: "",
          onClick: () => {},
        },
      ],
    });
    return; // on attend la décision
  }

  // Sinon, cocher directement si moins de 6 divs
  divs.forEach((div) => {
    const checkbox = div.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
  });
  handlePlot();
}

/**
 * hide/show the button for  plotAllDatastreams
 */
function togglePlotAllDatastreams() {
  const btn = document.getElementById("plotAll");
  btn.classList.toggle("is-hidden", state.datastreamsToShow.length === 0);
}

// ============================================================================
// ============================================================================
// Share Functionality
// ============================================================================

/**
 * Applies the share state after data is loaded
 * @param {Object} shareData - Parsed share data {ds: [...], z: [...]}
 */
async function applyShareState(shareData) {
  if (!shareData || !shareData.ds || shareData.ds.length === 0) return;

  // Find datastream names, sensors, things and observed properties by ID
  const datastreamNames = [];
  const observedPropertiesToCheck = new Set();
  const sensorsToCheck = new Set();
  const thingsToCheck = new Set();

  for (const id of shareData.ds) {
    for (const [name, data] of Object.entries(state.datastreamDict)) {
      if (data.id === id) {
        datastreamNames.push(name);
        observedPropertiesToCheck.add(data.observedproperty);
        if (data.sensor) sensorsToCheck.add(data.sensor);
        if (data.thing) thingsToCheck.add(data.thing);
        break;
      }
    }
  }

  if (datastreamNames.length === 0) {
    Utils.showNotification("Aucune série trouvée pour ce lien", "warning");
    return;
  }

  // Check the corresponding ObservedProperties
  const obspCheckboxes = elements.obspList.querySelectorAll(
    'input[type="checkbox"]',
  );
  obspCheckboxes.forEach((checkbox) => {
    if (observedPropertiesToCheck.has(checkbox.value)) {
      checkbox.checked = true;
    }
  });

  // Trigger update to populate datastream list (skip map highlight — done below with correct Things)
  updateDatastreamList({ skipMapFit: true });

  // Check the corresponding Sensors
  elements.sensorList
    .querySelectorAll('input[type="checkbox"]')
    .forEach((checkbox) => {
      if (sensorsToCheck.has(checkbox.value)) checkbox.checked = true;
    });

  // Check the corresponding Things and highlight only those on the map
  elements.thingList
    .querySelectorAll('input[type="checkbox"]')
    .forEach((checkbox) => {
      if (thingsToCheck.has(checkbox.value)) checkbox.checked = true;
    });
  highlightThingsOnMap(thingsToCheck);

  // Check the specific datastreams
  const dsCheckboxes = elements.datastreamList.querySelectorAll(
    'input[type="checkbox"]',
  );
  dsCheckboxes.forEach((checkbox) => {
    if (datastreamNames.includes(checkbox.value)) {
      checkbox.checked = true;
    }
  });

  await handlePlot();

  // Apply zoom and pagination from share data
  await applyShareZoomPagination(shareData, {
    graph: state.graph,
    paginationCtrl: state.pagination.enabled ? paginationCtrl : null,
    updateGraphZoom,
  });
}

function initializeGraph() {
  state.graph = UtilsGraph.createDygraph(
    document.getElementById("graphDiv"),
    document.getElementById("customLegend"),
    {
      zoomCallback: async function () {
        await updateGraphZoom();
      },
    },
  );
}

async function main() {
  state.config = await waitForAppReady();
  const serviceNameEl = document.getElementById("serviceName");
  if (serviceNameEl && state.config.nameService) {
    serviceNameEl.textContent = state.config.nameService;
  }
  initializeGraph();
  state.map = UtilsMap.createMap("map", { zoom: 15 });
  await Promise.all([
    loadDatastreamsInfo(),
    loadSensorsInfo(),
    loadThingsInfo(),
    populateObservedPropertiesList(),
  ]);

  // Check for share parameter and apply if present
  const shareData = parseShareParam();
  if (shareData) {
    await applyShareState(shareData);
  }
}

main();

document.getElementById("btn_dl").addEventListener("click", () => {
  const selectedValues = getSelectedValues(elements.datastreamList);
  showDownloadModal({
    graph: state.graph,
    datastreams: selectedValues.map((name) => ({
      id: state.datastreamDict[name].id,
      name,
    })),
    urlService: state.config.urlService,
    modeService: state.config.modeService,
    progressBar: elements.progressBar,
    beforeShow: () => {
      if (state.fullScreen) toggleFullscreen();
    },
  });
});
document
  .getElementById("fullscreenBtn")
  .addEventListener("click", toggleFullscreen);
document
  .getElementById("btn_zomm")
  .addEventListener("click", () => unzoomGraph());
initShareButton("btn_share", {
  getGraph: () => state.graph,
  getPageSpecificData: () => {
    const sel = getSelectedValues(elements.datastreamList);
    if (sel.length === 0) {
      Utils.showNotification("Aucune série sélectionnée", "warning");
      return null;
    }
    return { ds: sel.map((n) => state.datastreamDict[n].id) };
  },
  isZoomed: () => state.zoom,
  getPaginationCtrl: () => (state.pagination.enabled ? paginationCtrl : null),
});
document
  .getElementById("plotAll")
  .addEventListener("click", plotAllDatastreams);
