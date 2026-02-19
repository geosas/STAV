/**
 * Simple Datastream Plot Page
 * Displays a single datastream with support for three modes:
 * - Frost_Geosas: server-side aggregation + smart zoom
 * - stean: data via $resultFormat=graphDatas
 * - basic: raw data with pagination for large datasets (>pageSize)
 *
 * Features: download CSV (with aggregation options), share URL, unzoom.
 */

import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import {
  getQueryParam,
  showNotification,
  fetchStreamWithSize,
  concatUint8Arrays,
} from "./utils/utils.js";
import {
  barChartPlotter,
  createDygraph,
  downloadObservations,
  transformDataArray,
  getAggregationLabel,
  determineAggregation,
  createThresholdCallback,
  parseGraphDatas,
} from "./utils/utils-graph.js";
import {
  showDownloadModal,
  parseShareParam,
  initShareButton,
  applyShareZoomPagination,
  createPaginationController,
} from "./utils/plot-controls.js";

const PAGE_SIZE = 50000;
const MAX_CACHED_PAGES = 10;

/**
 * Page state
 */
const plotState = {
  graph: null,
  config: null,
  datastreamId: null,
  datastreamInfo: null,
  zoom: false,
  isUpdatingZoom: false,
  currentAggregation: null,
  initialAggregation: null,
  currentData: null,
  paginationCtrl: null,
};

// ============================================================================
// Smart Zoom (Frost_Geosas mode, single datastream)
// ============================================================================

/**
 * Handles zoom events — in Frost_Geosas mode, re-fetches data if
 * the aggregation level changes (raw/hour/day).
 */
async function updateGraphZoom() {
  if (plotState.isUpdatingZoom) return;
  plotState.isUpdatingZoom = true;
  plotState.zoom = true;

  const { name, properties, unitOfMeasurement } = plotState.datastreamInfo;
  const graphType = properties?.graph || "line";

  if (plotState.config.modeService === "Frost_Geosas") {
    const xRange = plotState.graph.xAxisRange();
    const filter = `phenomenonTime ge ${new Date(xRange[0]).toISOString()} and phenomenonTime le ${new Date(xRange[1]).toISOString()}`;
    //Need change, double count some case when raw data
    const count = await STAApi.getCount(
      plotState.config.urlService,
      `Datastreams(${plotState.datastreamId})/Observations`,
      filter,
    );
    const newAgg = determineAggregation(count);

    if (newAgg !== plotState.currentAggregation) {
      plotState.currentAggregation = newAgg;

      const { data } = await downloadObservations({
        baseUrl: plotState.config.urlService,
        datastreamId: plotState.datastreamId,
        graphType,
        mode: "Frost_Geosas",
        dateRange: { start: new Date(xRange[0]), end: new Date(xRange[1]) },
        aggregation: newAgg,
      });

      const aggLabel = getAggregationLabel(newAgg, graphType);
      const graphOptions = {
        file: data,
        title: `${name} (${aggLabel})`,
        dateWindow: xRange,
      };

      const thresholdCallback = createThresholdCallback(properties);
      if (thresholdCallback) graphOptions.underlayCallback = thresholdCallback;
      if (graphType === "bar") {
        graphOptions.plotter = barChartPlotter(2);
        graphOptions.drawPoints = false;
      }

      plotState.graph.updateOptions(graphOptions);
    }
  }

  document.getElementById("btn_zomm").style.visibility = "";
  plotState.isUpdatingZoom = false;
}

/**
 * Resets zoom — restores full dataset in Frost_Geosas mode
 */
async function unzoomGraph() {
  plotState.zoom = false;

  if (
    plotState.config.modeService === "Frost_Geosas" &&
    plotState.currentData
  ) {
    plotState.currentAggregation = plotState.initialAggregation;
    const { name, properties, unitOfMeasurement } = plotState.datastreamInfo;
    const graphType = properties?.graph || "line";
    const aggLabel = getAggregationLabel(
      plotState.initialAggregation,
      graphType,
    );
    updateGraphDisplay(
      plotState.currentData,
      name,
      unitOfMeasurement,
      graphType,
      properties?.Vmin,
      properties?.Vmax,
      `${name} (${aggLabel})`,
    );
  }

  plotState.graph.updateOptions({ dateWindow: null, valueRange: null });
  document.getElementById("btn_zomm").style.visibility = "hidden";
}

// ============================================================================
// Graph display helpers
// ============================================================================

/**
 * Updates the Dygraph with data and options
 */
function updateGraphDisplay(
  data,
  name,
  unitOfMeasurement,
  graphType,
  Vmin,
  Vmax,
  title,
) {
  const graphOptions = {
    file: data,
    labels: ["x", name],
    ylabel: `${unitOfMeasurement?.name || ""} (${unitOfMeasurement?.symbol || ""})`,
    title,
  };

  const thresholdCallback = createThresholdCallback({ Vmin, Vmax });
  if (thresholdCallback) {
    graphOptions.underlayCallback = thresholdCallback;
  }

  if (graphType === "bar") {
    graphOptions.plotter = barChartPlotter(2);
    graphOptions.drawPoints = false;
  }

  plotState.graph.updateOptions(graphOptions);
}

// ============================================================================
// STEAN mode
// ============================================================================

/**
 * STEAN mode: fetches data via $resultFormat=graphDatas and displays with Dygraph
 */
async function plotStean() {
  const url = `${plotState.config.urlService}/Datastreams(${plotState.datastreamId})/Observations?$resultFormat=graphDatas`;
  const progressBar = document.getElementById("progressBar");
  const chunks = await fetchStreamWithSize(url, progressBar); // for big time series user can see the size download
  const totalArray = concatUint8Arrays(chunks);
  const decoder = new TextDecoder();
  const text = decoder.decode(totalArray);
  const json = JSON.parse(text);
  const { data, name, unitName, unitSymbol } = parseGraphDatas(json[0]);

  if (data.length === 0) {
    showNotification("Aucune observation trouvée", "info");
    return;
  }

  plotState.datastreamInfo = {
    name,
    unitOfMeasurement: { name: unitName, symbol: unitSymbol },
    properties: {},
  };
  plotState.currentData = data;
  updateGraphDisplay(
    data,
    name,
    { name: unitName, symbol: unitSymbol },
    "line",
    null,
    null,
    `${name} (données lissées par moyenne mobile)`,
  );
}

// ============================================================================
// Frost_Geosas mode
// ============================================================================

/**
 * Frost_Geosas mode: uses server-side aggregation + smart zoom
 */
async function plotFrostGeosas() {
  const { name, properties, unitOfMeasurement } = plotState.datastreamInfo;
  const graphType = properties?.graph || "line";

  const { data, aggregation } = await downloadObservations({
    baseUrl: plotState.config.urlService,
    datastreamId: plotState.datastreamId,
    graphType,
    mode: plotState.config.modeService,
  });

  if (data.length === 0) {
    showNotification("Aucune observation trouvée", "info");
    return;
  }

  plotState.currentData = data;
  plotState.currentAggregation = aggregation;
  plotState.initialAggregation = aggregation;

  const aggLabel = getAggregationLabel(aggregation, graphType);
  updateGraphDisplay(
    data,
    name,
    unitOfMeasurement,
    graphType,
    properties?.Vmin,
    properties?.Vmax,
    `${name} (${aggLabel})`,
  );
}

// ============================================================================
// Basic mode
// ============================================================================

/**
 * Basic mode, small dataset: download everything
 */
async function plotAll() {
  const { name, properties, unitOfMeasurement } = plotState.datastreamInfo;
  const graphType = properties?.graph || "line";

  const { data } = await downloadObservations({
    baseUrl: plotState.config.urlService,
    datastreamId: plotState.datastreamId,
    graphType,
    mode: null,
  });

  if (data.length === 0) {
    showNotification("Aucune observation trouvée", "info");
    return;
  }

  plotState.currentData = data;
  updateGraphDisplay(
    data,
    name,
    unitOfMeasurement,
    graphType,
    properties?.Vmin,
    properties?.Vmax,
    name,
  );
}

/**
 * Basic mode, large dataset: paginated navigation with FIFO cache
 * FIFO for first in first out
 */
async function initPagination(totalCount) {
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const cache = {};
  const pageOrder = [];

  const { name, properties, unitOfMeasurement } = plotState.datastreamInfo;
  const graphType = properties?.graph || "line";

  async function loadPage(pageNum) {
    // Reset zoom when changing page
    if (plotState.zoom) {
      plotState.zoom = false;
      plotState.graph.updateOptions({ dateWindow: null, valueRange: null });
      document.getElementById("btn_zomm").style.visibility = "hidden";
    }

    let data = cache[pageNum];
    if (!data) {
      const progressBar = document.getElementById("progressBar");
      if (progressBar) progressBar.style.display = "";

      const skip = (pageNum - 1) * PAGE_SIZE;
      const url = STAApi.buildQuery(
        plotState.config.urlService,
        `Datastreams(${plotState.datastreamId})/Observations`,
        {
          resultFormat: "dataArray",
          select: "phenomenonTime,result",
          orderby: "phenomenonTime asc",
          top: PAGE_SIZE,
          skip: skip || undefined,
        },
      );
      const result = await STAApi.fetchSTA(url, { paginate: false });
      data = transformDataArray(result);

      // FIFO cache
      cache[pageNum] = data;
      pageOrder.push(pageNum);
      while (pageOrder.length > MAX_CACHED_PAGES) {
        const oldest = pageOrder.shift();
        delete cache[oldest];
      }

      if (progressBar) progressBar.style.display = "none";
    }

    if (data.length === 0) {
      showNotification("Aucune donnée pour cette page", "info");
      return;
    }

    const page = plotState.paginationCtrl.getCurrentPage();
    const total = plotState.paginationCtrl.getTotalPages();
    updateGraphDisplay(
      data,
      name,
      unitOfMeasurement,
      graphType,
      properties?.Vmin,
      properties?.Vmax,
      `${name} — page ${page}/${total}`,
    );
  }

  plotState.paginationCtrl = createPaginationController({
    prevBtn: document.getElementById("btn_prev_page"),
    nextBtn: document.getElementById("btn_next_page"),
    indicator: document.getElementById("pageIndicator"),
    container: document.getElementById("paginationControls"),
    onPageChange: loadPage,
  });

  plotState.paginationCtrl.update(1, totalPages);
  plotState.paginationCtrl.show();
  await loadPage(1);
}

// ============================================================================
// Main
// ============================================================================

/**
 * Main initialization function
 */
async function main() {
  plotState.config = await waitForAppReady();
  plotState.datastreamId = getQueryParam("id");

  if (!plotState.datastreamId) {
    showNotification("Aucun ID de datastream fourni dans l'URL", "danger");
    return;
  }

  // Create Dygraph for all modes
  plotState.graph = createDygraph(
    document.getElementById("graphDiv"),
    document.getElementById("customLegend"),
    {
      zoomCallback: async function () {
        await updateGraphZoom();
      },
    },
  );

  // Unzoom button
  document.getElementById("btn_zomm").addEventListener("click", unzoomGraph);

  // Download button
  document.getElementById("btn_dl").addEventListener("click", () => {
    showDownloadModal({
      graph: plotState.graph,
      datastreams: [
        {
          id: plotState.datastreamId,
          name: plotState.datastreamInfo?.name || "datastream",
        },
      ],
      urlService: plotState.config.urlService,
      modeService: plotState.config.modeService,
      progressBar: document.getElementById("progressBar"),
    });
  });

  // Share button
  initShareButton("btn_share", {
    getGraph: () => plotState.graph,
    getPageSpecificData: () => ({ id: plotState.datastreamId }),
    isZoomed: () => plotState.zoom,
    getPaginationCtrl: () => plotState.paginationCtrl,
  });

  try {
    if (plotState.config.modeService === "stean") {
      // STEAN mode: fetch graphDatas, no separate datastream info needed
      await plotStean();
    } else {
      // Fetch datastream info for Frost_Geosas and basic modes
      const datastreamUrl = STAApi.buildQuery(
        plotState.config.urlService,
        `Datastreams(${plotState.datastreamId})`,
        {
          select: "name,properties,unitOfMeasurement",
        },
      );
      const datastream = await STAApi.fetchSTA(datastreamUrl, {
        paginate: false,
      });
      plotState.datastreamInfo = datastream;

      if (plotState.config.modeService === "Frost_Geosas") {
        await plotFrostGeosas();
      } else {
        // Basic mode: check count for pagination
        const count = await STAApi.getCount(
          plotState.config.urlService,
          `Datastreams(${plotState.datastreamId})/Observations`,
        );

        if (count <= PAGE_SIZE) {
          await plotAll();
        } else {
          await initPagination(count);
        }
      }
    }

    // Restore share state if present
    const shareData = parseShareParam();
    if (shareData) {
      await applyShareZoomPagination(shareData, {
        graph: plotState.graph,
        paginationCtrl: plotState.paginationCtrl,
        updateGraphZoom,
      });
    }
  } catch (error) {
    console.error("Error loading datastream plot:", error);
    showNotification("Erreur lors du chargement des données", "danger");
  } finally {
    const progressBar = document.getElementById("progressBar");
    if (progressBar) progressBar.style.display = "none";
  }
}

main();
