import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import * as Utils from "./utils/utils.js";
import * as UtilsGraph from "./utils/utils-graph.js";

/**
 * Dual Service Page
 * Allows comparing data from two SensorThings API services
 */

// Service states
const services = {
  1: createServiceState(),
  2: createServiceState(),
};

// Shared graph state
const sharedState = {
  graph: null,
  fullScreen: false,
  zoom: false,
  isUpdatingZoom: false,
  seriesData: {}, // Combined series data from both services
  seriesConfig: {},
  dictArgStat: {},
  dataZoomDict: {},
  listAggregation: {},
  listAggregationResume: {},
};

function createServiceState() {
  return {
    config: null,
    obspDict: {},
    datastreamDict: {},
    sensorDict: {},
    thingDict: {},
    datastreamsToShow: [],
    datastreamListInter: [],
    sensorCheck: false,
    thingCheck: false,
    plotActive: [],
    loaded: false,
  };
}

function getElements(serviceNum) {
  return {
    obspList: document.getElementById(`obspList${serviceNum}`),
    datastreamList: document.getElementById(`datastreamList${serviceNum}`),
    sensorList: document.getElementById(`sensorList${serviceNum}`),
    thingList: document.getElementById(`thingList${serviceNum}`),
    familleList: document.getElementById(`familleList${serviceNum}`),
    progressBar2: document.getElementById(`progressBar2_${serviceNum}`),
    progressBar3: document.getElementById(`progressBar3_${serviceNum}`),
  };
}

const progressBar = document.getElementById("progressBar");

// ============================================================================
// Data Loading Functions
// ============================================================================

async function loadDatastreamsInfo(serviceNum) {
  const state = services[serviceNum];
  const elements = getElements(serviceNum);
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
        serviceNum: serviceNum,
      };
    });
  } catch (error) {
    console.error("Error:", error);
    Utils.showNotification(
      `Erreur de chargement Service ${serviceNum}`,
      "danger",
    );
  } finally {
    elements.progressBar3.classList.add("is-hidden");
  }
}

async function loadSensorsInfo(serviceNum) {
  const state = services[serviceNum];
  const sensorsUrl = STAApi.buildQuery(state.config.urlService, "Sensors", {
    select: "name,metadata,description,id",
  });
  const data = await STAApi.fetchSTA(sensorsUrl);
  data.forEach((sensor) => {
    state.sensorDict[sensor.name] = {
      metadata: sensor.metadata,
      description: sensor.description,
      id: sensor["@iot.id"],
    };
  });
}

async function loadThingsInfo(serviceNum) {
  const state = services[serviceNum];
  const thingsUrl = STAApi.buildQuery(state.config.urlService, "Things", {
    top: 10000,
    select: "name,description,id",
    expand:
      "Locations($select=location;$top=10000),Datastreams($select=name;$top=10000)",
  });
  const data = await STAApi.fetchSTA(thingsUrl);
  data.forEach((thing) => {
    state.thingDict[thing.name] = {
      description: thing.description,
      id: thing["@iot.id"],
    };
  });
}

async function populateObservedPropertiesList(serviceNum) {
  const state = services[serviceNum];
  const elements = getElements(serviceNum);
  let familly = [];
  const familleListDiv = elements.familleList;
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
        checkbox.addEventListener("change", () => updateObsP(serviceNum));

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
        () => updateDatastreamList(serviceNum),
        state.obspDict[obsp]["description"],
        serviceNum,
      ),
    );
  }

  if (familly.length == 0) {
    const familleCard = document.getElementById(`FamilleCard${serviceNum}`);
    if (familleCard) familleCard.remove();
  }
}

// ============================================================================
// Filter Functions
// ============================================================================

function updateObsP(serviceNum) {
  updateObservedPropertiesByFamille(serviceNum);
}

function updateObservedPropertiesByFamille(serviceNum) {
  const state = services[serviceNum];
  const elements = getElements(serviceNum);
  const selectedFamille = getSelectedValues(elements.familleList);
  clearList(elements.obspList);
  for (const obsp in state.obspDict) {
    if (
      selectedFamille.length === 0 ||
      selectedFamille.includes(state.obspDict[obsp].property?.famille)
    ) {
      elements.obspList.appendChild(
        createCheckbox(
          obsp,
          () => updateDatastreamList(serviceNum),
          null,
          serviceNum,
        ),
      );
    }
  }
}

function updateDatastreamList(serviceNum) {
  const state = services[serviceNum];
  const elements = getElements(serviceNum);
  clearList(elements.datastreamList);
  clearList(elements.sensorList);
  clearList(elements.thingList);
  const selectedObsp = getSelectedValues(elements.obspList);
  state.datastreamsToShow = [];
  selectedObsp.forEach((obsp) => {
    state.datastreamsToShow = state.datastreamsToShow.concat(
      state.obspDict[obsp].datastreamsName,
    );
  });
  state.datastreamsToShow.forEach((datastream) => {
    elements.datastreamList.appendChild(
      createCheckbox(datastream, () => plotGraph(serviceNum), null, serviceNum),
    );
  });
  updateSensorThingListFromDatastreams(serviceNum, state.datastreamsToShow);
  togglePlotAllDatastreams(serviceNum);
}

function updateSensorThingListFromDatastreams(serviceNum, datastreams) {
  const state = services[serviceNum];
  const elements = getElements(serviceNum);
  clearList(elements.sensorList);
  clearList(elements.thingList);
  const sensorsToShow = new Set();
  const thingsToShow = new Set();
  datastreams.forEach((datastream) => {
    const relatedData = state.datastreamDict[datastream];
    if (relatedData) {
      sensorsToShow.add(relatedData.sensor);
      thingsToShow.add(relatedData.thing);
    }
  });
  sensorsToShow.forEach((sensor) => {
    elements.sensorList.appendChild(
      createCheckbox(
        sensor,
        () => updateDatastreamFromSensor(serviceNum),
        null,
        serviceNum,
      ),
    );
  });
  thingsToShow.forEach((thing) => {
    elements.thingList.appendChild(
      createCheckbox(
        thing,
        () => updateDatastreamFromThing(serviceNum),
        state.thingDict[thing]?.description,
        serviceNum,
      ),
    );
  });
}

function updateDatastreamFromSensor(serviceNum) {
  const elements = getElements(serviceNum);
  filterDatastreamsBySensorOrThing(
    serviceNum,
    getSelectedValues(elements.sensorList),
    "sensor",
  );
}

function updateDatastreamFromThing(serviceNum) {
  const elements = getElements(serviceNum);
  filterDatastreamsBySensorOrThing(
    serviceNum,
    getSelectedValues(elements.thingList),
    "thing",
  );
}

function filterDatastreamsBySensorOrThing(serviceNum, selectedItems, key) {
  const state = services[serviceNum];
  const elements = getElements(serviceNum);
  clearList(elements.datastreamList);

  if (selectedItems.length == 0) {
    state[key + "Check"] = false;
    state.datastreamsToShow.forEach((datastream) => {
      elements.datastreamList.appendChild(
        createCheckbox(
          datastream,
          () => plotGraph(serviceNum),
          null,
          serviceNum,
        ),
      );
    });
    const otherKey = key === "sensor" ? "thing" : "sensor";
    const otherCheck = otherKey + "Check";
    if (!state[otherCheck]) {
      const otherList =
        key === "sensor" ? elements.thingList : elements.sensorList;
      clearList(otherList);
      const objectsToShow = new Set();
      state.datastreamsToShow.forEach((datastream) => {
        if (state.datastreamDict[datastream]) {
          objectsToShow.add(state.datastreamDict[datastream][otherKey]);
        }
      });
      objectsToShow.forEach((item) => {
        otherList.appendChild(
          createCheckbox(
            item,
            key === "sensor"
              ? () => updateDatastreamFromThing(serviceNum)
              : () => updateDatastreamFromSensor(serviceNum),
            null,
            serviceNum,
          ),
        );
      });
    }
  } else {
    state[key + "Check"] = true;
    state.datastreamListInter = [];
    for (const datastream in state.datastreamDict) {
      if (
        state.datastreamsToShow.includes(datastream) &&
        selectedItems.includes(state.datastreamDict[datastream][key])
      ) {
        const otherKey = key === "sensor" ? "thing" : "sensor";
        const otherList =
          key === "sensor" ? elements.thingList : elements.sensorList;
        const otherSelected = getSelectedValues(otherList);
        if (
          otherSelected.length === 0 ||
          otherSelected.includes(state.datastreamDict[datastream][otherKey])
        ) {
          state.datastreamListInter.push(datastream);
          elements.datastreamList.appendChild(
            createCheckbox(
              datastream,
              () => plotGraph(serviceNum),
              null,
              serviceNum,
            ),
          );
        }
      }
    }
    const otherKey = key === "sensor" ? "thing" : "sensor";
    const otherCheck = otherKey + "Check";
    if (!state[otherCheck]) {
      const otherList =
        key === "sensor" ? elements.thingList : elements.sensorList;
      clearList(otherList);
      const objectsToShow = new Set();
      state.datastreamListInter.forEach((datastream) => {
        objectsToShow.add(state.datastreamDict[datastream][otherKey]);
      });
      objectsToShow.forEach((item) => {
        otherList.appendChild(
          createCheckbox(
            item,
            key === "sensor"
              ? () => updateDatastreamFromThing(serviceNum)
              : () => updateDatastreamFromSensor(serviceNum),
            null,
            serviceNum,
          ),
        );
      });
    }
  }
  togglePlotAllDatastreams(serviceNum);
}

// ============================================================================
// UI Helper Functions
// ============================================================================

function createCheckbox(
  value,
  onChangeHandler,
  description = null,
  serviceNum,
) {
  const div = document.createElement("div");
  const label = document.createElement("label");
  label.classList.add("checkbox");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = value;
  checkbox.checked = false;
  checkbox.dataset.service = serviceNum;
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

function filterTable(serviceNum) {
  const input = document.getElementById(`searchInput${serviceNum}`);
  const filter = input.value.toUpperCase();
  const divs = document.querySelectorAll(`#thingList${serviceNum} div`);

  divs.forEach((div) => {
    const label = div.querySelector("label");
    const checkbox = div.querySelector('input[type="checkbox"]');

    if (!label || !checkbox) return;

    const textToSearch = [checkbox.value, label.innerText, label.title]
      .filter(Boolean)
      .join(" ")
      .toUpperCase();

    div.style.display = textToSearch.includes(filter) ? "" : "none";
  });
}

// Search input listeners
let searchTimeout1, searchTimeout2;
document.getElementById("searchInput1").addEventListener("input", () => {
  clearTimeout(searchTimeout1);
  searchTimeout1 = setTimeout(() => filterTable(1), 150);
});
document.getElementById("searchInput2")?.addEventListener("input", () => {
  clearTimeout(searchTimeout2);
  searchTimeout2 = setTimeout(() => filterTable(2), 150);
});

function togglePlotAllDatastreams(serviceNum) {
  const state = services[serviceNum];
  const btn = document.getElementById(`plotAll${serviceNum}`);
  btn.classList.toggle("is-hidden", state.datastreamsToShow.length === 0);
}

function plotAllDatastreams(serviceNum) {
  const divs = document.querySelectorAll(`#datastreamList${serviceNum} div`);

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
            plotGraph(serviceNum);
          },
        },
        {
          text: "Annuler",
          class: "",
          onClick: () => {},
        },
      ],
    });
    return;
  }

  divs.forEach((div) => {
    const checkbox = div.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
  });
  plotGraph(serviceNum);
}

let originalWidth = null;

function toggleFullscreen() {
  const graphColumn = document.getElementById("columnGraph");
  const graphDiv = document.getElementById("graphDiv");

  if (graphColumn.classList.contains("fullscreen")) {
    graphColumn.classList.remove("fullscreen");
    if (originalWidth) {
      graphColumn.style.width = originalWidth;
    }
    graphDiv.style.width = "95%";
    graphDiv.style.height = "400px";
    document.getElementById("fullscreenBtn").innerText = "Plein écran";
    sharedState.fullScreen = false;
  } else {
    originalWidth = graphColumn.offsetWidth + "px";
    graphColumn.style.width = "100%";
    graphColumn.classList.add("fullscreen");
    graphDiv.style.height = "75%";
    document.getElementById("fullscreenBtn").innerText = "Retour";
    sharedState.fullScreen = true;
  }

  sharedState.graph.resize();
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

// ============================================================================
// Plotting Functions
// ============================================================================

function getSeriesKey(serviceNum, datastreamName) {
  return `[Service ${serviceNum}] ${datastreamName}`;
}

async function plotGraph(serviceNum) {
  const state = services[serviceNum];
  const elements = getElements(serviceNum);
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
      const seriesKey = getSeriesKey(serviceNum, info);
      plotToDo[seriesKey] = {
        id: dictInfo.id,
        title: seriesKey,
        originalName: info,
        unit: `unité : ${dictInfo.unitOfMeasurement.name} (${dictInfo.unitOfMeasurement.symbol})`,
        graph: graph,
        serviceNum: serviceNum,
      };
    });

    // Remove deselected series from this service
    state.plotActive = state.plotActive.filter((item) =>
      Object.keys(plotToDo).includes(item),
    );

    for (const key in plotToDo) {
      if (
        !state.plotActive.includes(key) &&
        !sharedState.seriesData.hasOwnProperty(key)
      ) {
        await downloadDataForPlot(
          serviceNum,
          plotToDo[key].id,
          plotToDo[key].title,
          plotToDo[key].unit,
          plotToDo[key].graph,
        );
        state.plotActive.push(key);
      } else {
        sharedState.listAggregation[key] =
          sharedState.listAggregationResume[key];
      }
    }

    plotGraph_internal();
    updateCheckboxColors(elements.sensorList, listNameSensor);
    updateCheckboxColors(elements.thingList, listNameThing);
    document.getElementById("DL_data").style.visibility = "";
  } finally {
    if (Object.keys(sharedState.seriesConfig).length == 0) {
      unzoomGraph();
    }
  }
}

async function downloadDataForPlot(serviceNum, id, titre, unit, graph) {
  const state = services[serviceNum];
  const elements = getElements(serviceNum);
  elements.progressBar2.classList.remove("is-hidden");

  try {
    let dateRange = null;
    let isZoomed = false;

    if (
      sharedState.zoom &&
      sharedState.graph &&
      state.config.modeService === "Frost_Geosas"
    ) {
      const xRange = sharedState.graph.xAxisRange();
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

    sharedState.listAggregation[titre] = aggregation;
    sharedState.listAggregationResume[titre] = aggregation;
    sharedState.seriesData[titre] = {
      data,
      label: titre,
      unit,
      graph,
      aggregation,
      isFiltered: isZoomed,
      serviceNum,
    };

    if (isZoomed) {
      sharedState.dataZoomDict[titre] = data;
    }
  } finally {
    elements.progressBar2.classList.add("is-hidden");
  }
}

function plotGraph_internal() {
  // Get selected values from both services
  const selectedValues1 = getSelectedValues(getElements(1).datastreamList).map(
    (name) => getSeriesKey(1, name),
  );
  const selectedValues2 = services[2].loaded
    ? getSelectedValues(getElements(2).datastreamList).map((name) =>
        getSeriesKey(2, name),
      )
    : [];
  const allSelectedValues = [...selectedValues1, ...selectedValues2];

  const mergedData = [];
  const labels = ["x"];
  sharedState.seriesConfig = {};
  sharedState.dictArgStat = {};

  if (sharedState.zoom) {
    const xRange = sharedState.graph.xAxisRange();

    for (const key of allSelectedValues) {
      if (sharedState.seriesData[key]) {
        const unit = sharedState.seriesData[key].unit;
        mergedData.push(
          sharedState.dataZoomDict[key] || sharedState.seriesData[key].data,
        );
        labels.push(key + " " + unit);
        sharedState.seriesConfig[`${key} ${unit}`] =
          sharedState.seriesData[key].graph === "bar"
            ? { plotter: UtilsGraph.barChartPlotter }
            : {};
        sharedState.dictArgStat[key + " " + unit] =
          sharedState.seriesData[key].graph;
      }
    }

    const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);
    sharedState.graph.updateOptions({
      file: arrayFinal,
      labels: labels,
      series: sharedState.seriesConfig,
      dateWindow: xRange,
    });

    document.getElementById("btn_zoom").style.display = "";
  } else {
    for (const key in sharedState.seriesData) {
      if (allSelectedValues.includes(key)) {
        sharedState.listAggregation[key] =
          sharedState.seriesData[key].aggregation;
        mergedData.push(sharedState.seriesData[key].data);
        labels.push(
          sharedState.seriesData[key].label +
            " " +
            sharedState.seriesData[key].unit,
        );
        sharedState.seriesConfig[
          `${sharedState.seriesData[key].label} ${sharedState.seriesData[key].unit}`
        ] =
          sharedState.seriesData[key].graph === "bar"
            ? { plotter: UtilsGraph.barChartPlotter }
            : {};
        sharedState.dictArgStat[
          sharedState.seriesData[key].label +
            " " +
            sharedState.seriesData[key].unit
        ] = sharedState.seriesData[key].graph;
      }
    }

    const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);
    sharedState.graph.updateOptions({
      file: arrayFinal,
      labels: labels,
      series: sharedState.seriesConfig,
      underlayCallback: null,
    });
  }

  // Calculate and display statistics
  const statistique = UtilsGraph.calculStatGraph(
    sharedState.graph,
    sharedState.dictArgStat,
  );
  UtilsGraph.renderStatisticsTable(
    allSelectedValues,
    statistique,
    document.getElementById("stat_agg"),
    sharedState.seriesData,
    sharedState.listAggregation,
  );
}

async function unzoomGraph() {
  sharedState.zoom = false;

  // Check for datastreams with filtered data and download full dataset
  const selectedValues1 = getSelectedValues(getElements(1).datastreamList).map(
    (name) => getSeriesKey(1, name),
  );
  const selectedValues2 = services[2].loaded
    ? getSelectedValues(getElements(2).datastreamList).map((name) =>
        getSeriesKey(2, name),
      )
    : [];
  const allSelectedValues = [...selectedValues1, ...selectedValues2];
  const filteredSeries = [];

  for (const key of allSelectedValues) {
    if (sharedState.seriesData[key] && sharedState.seriesData[key].isFiltered) {
      filteredSeries.push(key);
    }
  }

  // Download full dataset for filtered series
  if (filteredSeries.length > 0) {
    for (const titre of filteredSeries) {
      const seriesInfo = sharedState.seriesData[titre];
      const serviceNum = seriesInfo.serviceNum;
      const state = services[serviceNum];
      const elements = getElements(serviceNum);
      elements.progressBar2.classList.remove("is-hidden");

      try {
        const originalName = titre.replace(`[Service ${serviceNum}] `, "");
        const dictInfo = state.datastreamDict[originalName];

        const { data, aggregation, limitReached } =
          await UtilsGraph.downloadObservations({
            baseUrl: state.config.urlService,
            datastreamId: dictInfo.id,
            graphType: seriesInfo.graph,
            mode: state.config.modeService,
          });

        if (limitReached) {
          Utils.showNotification(
            `Limite de données atteinte pour ${titre}: affichage des 100 000 premiers enregistrements`,
            "warning",
          );
        }

        sharedState.seriesData[titre] = {
          data,
          label: titre,
          unit: seriesInfo.unit,
          graph: seriesInfo.graph,
          aggregation,
          isFiltered: false,
          serviceNum,
        };
        sharedState.listAggregationResume[titre] = aggregation;
      } catch (error) {
        console.error(`Error downloading full dataset for ${titre}:`, error);
        Utils.showNotification(
          `Erreur lors du téléchargement des données complètes pour ${titre}`,
          "danger",
        );
      } finally {
        elements.progressBar2.classList.add("is-hidden");
      }
    }
  }

  sharedState.graph.updateOptions({ dateWindow: null, valueRange: null });
  document.getElementById("btn_zoom").style.display = "none";
  plotGraph_internal();
  sharedState.listAggregation = {};
  sharedState.dataZoomDict = {};
}

async function updateGraphZoom() {
  if (sharedState.isUpdatingZoom) return;

  sharedState.isUpdatingZoom = true;
  sharedState.zoom = true;
  sharedState.seriesConfig = {};
  const xRange = sharedState.graph.xAxisRange();

  const selectedValues1 = getSelectedValues(getElements(1).datastreamList).map(
    (name) => getSeriesKey(1, name),
  );
  const selectedValues2 = services[2].loaded
    ? getSelectedValues(getElements(2).datastreamList).map((name) =>
        getSeriesKey(2, name),
      )
    : [];
  const allSelectedValues = [...selectedValues1, ...selectedValues2];

  // Process each service separately for Frost_Geosas mode
  for (const serviceNum of [1, 2]) {
    const state = services[serviceNum];
    if (!state.loaded) continue;
    if (state.config.modeService !== "Frost_Geosas") continue;

    const elements = getElements(serviceNum);
    elements.progressBar2.classList.remove("is-hidden");

    const serviceSelectedValues =
      serviceNum === 1 ? selectedValues1 : selectedValues2;

    for (const seriesKey of serviceSelectedValues) {
      const originalName = seriesKey.replace(`[Service ${serviceNum}] `, "");
      const dictInfo = state.datastreamDict[originalName];
      if (!dictInfo) continue;

      const id = dictInfo.id;
      const zoomFilter = `phenomenonTime ge ${new Date(xRange[0]).toISOString()} and phenomenonTime le ${new Date(xRange[1]).toISOString()}`;
      const count = await STAApi.getCount(
        state.config.urlService,
        `Datastreams(${id})/Observations`,
        zoomFilter,
      );
      const group = UtilsGraph.determineAggregation(count);

      if (sharedState.listAggregation[seriesKey] !== group) {
        sharedState.listAggregation[seriesKey] = group;

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
        sharedState.dataZoomDict[seriesKey] =
          UtilsGraph.transformDataArray(result);
      }
    }

    elements.progressBar2.classList.add("is-hidden");
  }

  // Update graph with current data
  const mergedData = [];
  const labels = ["x"];
  for (const key of allSelectedValues) {
    if (sharedState.seriesData[key]) {
      const unit = sharedState.seriesData[key].unit;
      mergedData.push(
        sharedState.dataZoomDict[key] || sharedState.seriesData[key].data,
      );
      labels.push(key + " " + unit);
      sharedState.dictArgStat[key + " " + unit] =
        sharedState.seriesData[key].graph;
    }
  }
  const arrayFinal = UtilsGraph.mergeDataArrays(mergedData);

  sharedState.graph.updateOptions({
    file: arrayFinal,
    labels: labels,
    dateWindow: xRange,
  });

  const statistique = UtilsGraph.calculStatGraph(
    sharedState.graph,
    sharedState.dictArgStat,
  );
  UtilsGraph.renderStatisticsTable(
    allSelectedValues,
    statistique,
    document.getElementById("stat_agg"),
    sharedState.seriesData,
    sharedState.listAggregation,
  );

  document.getElementById("btn_zoom").style.display = "";
  sharedState.isUpdatingZoom = false;
}

// ============================================================================
// Statistics Functions
// ============================================================================

// ============================================================================
// Download Functions
// ============================================================================

function showDownloadModal() {
  if (sharedState.fullScreen) toggleFullscreen();

  const selectedValues1 = getSelectedValues(getElements(1).datastreamList);
  const selectedValues2 = services[2].loaded
    ? getSelectedValues(getElements(2).datastreamList)
    : [];

  if (selectedValues1.length === 0 && selectedValues2.length === 0) {
    Utils.showNotification("Aucune série sélectionnée", "warning");
    return;
  }

  let startDate = "";
  let endDate = "";
  if (sharedState.graph) {
    const xRange = sharedState.graph.xAxisRange();
    if (xRange[0] && xRange[1]) {
      startDate = new Date(xRange[0]).toISOString().slice(0, 16);
      endDate = new Date(xRange[1]).toISOString().slice(0, 16);
    }
  }

  const bodyContent = document.createElement("div");
  bodyContent.innerHTML = `
        <div class="field">
            <label class="radio">
                <input type="radio" name="downloadType" value="raw_all" checked>
                Télécharger toutes les données brutes
            </label>
        </div>
        <hr>
        <p class="has-text-weight-bold mb-2">Télécharger sur une période :</p>
        <div class="box">
            <div class="columns">
                <div class="column">
                    <div class="field">
                        <label class="label">Date de début</label>
                        <input type="datetime-local" id="dlStartDate" class="input" value="${startDate}">
                    </div>
                </div>
                <div class="column">
                    <div class="field">
                        <label class="label">Date de fin</label>
                        <input type="datetime-local" id="dlEndDate" class="input" value="${endDate}">
                    </div>
                </div>
            </div>
            <div class="field">
                <label class="radio">
                    <input type="radio" name="downloadType" value="raw_range">
                    Données brutes
                </label>
            </div>
        </div>
    `;

  Utils.showModal({
    title: "📥 Téléchargement",
    body: bodyContent,
    buttons: [
      {
        text: "Télécharger",
        class: "is-success",
        onClick: () => executeDownload(),
      },
      {
        text: "Annuler",
        class: "",
      },
    ],
  });
}

async function executeDownload() {
  const selectedOption = document.querySelector(
    'input[name="downloadType"]:checked',
  )?.value;
  const startDateInput = document.getElementById("dlStartDate")?.value;
  const endDateInput = document.getElementById("dlEndDate")?.value;

  const selectedValues1 = getSelectedValues(getElements(1).datastreamList);
  const selectedValues2 = services[2].loaded
    ? getSelectedValues(getElements(2).datastreamList)
    : [];

  if (selectedValues1.length === 0 && selectedValues2.length === 0) return;

  if (selectedOption !== "raw_all") {
    if (!startDateInput || !endDateInput) {
      Utils.showNotification("Veuillez sélectionner une période", "warning");
      return;
    }
    if (new Date(startDateInput) >= new Date(endDateInput)) {
      Utils.showNotification(
        "La date de début doit être antérieure à la date de fin",
        "warning",
      );
      return;
    }
  }

  const startDate = startDateInput
    ? new Date(startDateInput).toISOString()
    : null;
  const endDate = endDateInput ? new Date(endDateInput).toISOString() : null;

  progressBar.classList.remove("is-hidden");

  // Download from both services
  for (const serviceNum of [1, 2]) {
    const state = services[serviceNum];
    if (!state.loaded) continue;

    const selectedValues = serviceNum === 1 ? selectedValues1 : selectedValues2;

    for (const info of selectedValues) {
      try {
        const dictInfo = state.datastreamDict[info];
        let url;

        switch (selectedOption) {
          case "raw_all":
            url = STAApi.buildQuery(
              state.config.urlService,
              `Datastreams(${dictInfo.id})/Observations`,
              {
                resultFormat: "csv",
                select: "phenomenonTime,result",
                orderby: "phenomenonTime asc",
              },
            );
            break;

          case "raw_range":
            url = STAApi.buildQuery(
              state.config.urlService,
              `Datastreams(${dictInfo.id})/Observations`,
              {
                resultFormat: "csv",
                select: "phenomenonTime,result",
                orderby: "phenomenonTime asc",
                filter: `phenomenonTime ge ${startDate} and phenomenonTime le ${endDate}`,
              },
            );
            break;
        }

        const csvText = await STAApi.fetchSTA(url);

        let suffix = selectedOption === "raw_range" ? "_time_filtered" : "";
        Utils.downloadFile(
          csvText,
          `Service${serviceNum}_${info}${suffix}.csv`,
          "text/csv",
        );
      } catch (error) {
        console.error(`Error for ${info}:`, error);
        Utils.showNotification(
          `Erreur lors du téléchargement de ${info}`,
          "danger",
        );
      }
    }
  }

  progressBar.classList.add("is-hidden");
  Utils.showNotification("Téléchargement terminé", "info");
}

// ============================================================================
// Service 2 Loading
// ============================================================================

async function loadService2() {
  const urlInput = document.getElementById("service2Url");
  const url = urlInput.value.trim();

  if (!url) {
    Utils.showNotification("Veuillez entrer une URL", "warning");
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    Utils.showNotification("URL invalide", "danger");
    return;
  }

  const loadBtn = document.getElementById("loadService2Btn");
  loadBtn.classList.add("is-loading");
  loadBtn.disabled = true;

  try {
    // Reset service 2 state
    services[2] = createServiceState();
    services[2].config = {
      urlService: url,
      modeService: "standard", // Default to standard mode
      nameService: "Service 2",
    };

    // Try to detect if it's a Frost_Geosas service by testing $groupby support
    try {
      const testUrl = `${url}/Datastreams?$top=1`;
      const response = await fetch(testUrl);
      if (response.ok) {
        // Assume standard for now, user can override if needed
        services[2].config.modeService = "standard";
      }
    } catch (e) {
      console.warn("Could not detect service mode, using standard");
    }

    // Load service 2 data
    await Promise.all([
      loadDatastreamsInfo(2),
      loadSensorsInfo(2),
      loadThingsInfo(2),
      populateObservedPropertiesList(2),
    ]);

    services[2].loaded = true;

    // Show service 2 filters
    document.getElementById("service2Filters").classList.remove("is-hidden");

    Utils.showNotification("Service 2 chargé avec succès", "success");
  } catch (error) {
    console.error("Error loading service 2:", error);
    Utils.showNotification("Erreur lors du chargement du service", "danger");
  } finally {
    loadBtn.classList.remove("is-loading");
    loadBtn.disabled = false;
  }
}

// ============================================================================
// Initialization
// ============================================================================

function initializeGraph() {
  sharedState.graph = UtilsGraph.createDygraph(
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
  // Load service 1 config
  services[1].config = await waitForAppReady();
  services[1].loaded = true;

  initializeGraph();

  await Promise.all([
    loadDatastreamsInfo(1),
    loadSensorsInfo(1),
    loadThingsInfo(1),
    populateObservedPropertiesList(1),
  ]);
}

main();

document
  .getElementById("plotAll1")
  .addEventListener("click", () => plotAllDatastreams(1));
document
  .getElementById("plotAll2")
  .addEventListener("click", () => plotAllDatastreams(2));
document.getElementById("btn_dl").addEventListener("click", showDownloadModal);
document
  .getElementById("fullscreenBtn")
  .addEventListener("click", toggleFullscreen);
document.getElementById("btn_zoom").addEventListener("click", unzoomGraph);
document
  .getElementById("loadService2Btn")
  .addEventListener("click", loadService2);
