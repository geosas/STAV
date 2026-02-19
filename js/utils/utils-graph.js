/**
 * Graph Utility Module
 * Shared Dygraph helpers used across visualization pages.
 */

import * as STAApi from "./sta-api.js";
import { escapeHtml, showModal } from "./utils.js";

/**
 * Creates a bar chart plotter export function for Dygraph
 * @param {number} barWidth - Width of each bar in pixels
 * @returns {Function} Dygraph plotter function
 */
export function barChartPlotter(barWidth) {
  return function (e) {
    const ctx = e.drawingContext;
    const points = e.points;
    ctx.globalAlpha = 1;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const centerX = p.canvasx;
      const centerY = p.canvasy;
      const height = e.dygraph.toDomYCoord(0) - centerY;
      ctx.fillRect(centerX - barWidth / 2, centerY, barWidth, height);
      ctx.strokeRect(centerX - barWidth / 2, centerY, barWidth, height);
    }
  };
}

// ============================================================================
// Data transformation
// ============================================================================

/**
 * Transforms a SensorThings DataArray response into Dygraph-compatible format.
 * Handles component order detection (phenomenonTime can be at any index,
 * because some STA don't respect the $select order).
 * @param {Object} dataArrayResponse - Response from STAApi.fetchSTA() with dataArray format
 * @param {Array} dataArrayResponse.dataArray - Raw data rows
 * @param {Array} dataArrayResponse.components - Column names
 * @returns {Array<Array>} Array of [Date, number] pairs
 */
export function transformDataArray(dataArrayResponse) {
  const { dataArray, components } = dataArrayResponse;
  if (!dataArray || dataArray.length === 0) return [];

  const phenomenonTimeIndex = components.indexOf("phenomenonTime");
  const resultIndex = components.indexOf("result");

  return dataArray.map((row) => [
    new Date(row[phenomenonTimeIndex]),
    row[resultIndex],
  ]);
}

/**
 * Merges multiple single-series data arrays into one multi-series array for Dygraph.
 * Uses getTime() for reliable Date comparison. Missing values filled with null for prettier plot.
 * @param {Array<Array<[Date, number]>>} dataArrays - Array of series, each [[Date, value], ...]
 * @returns {Array<[Date, ...number]>} Merged [[Date, val1, val2, ...], ...] sorted by date
 */
export function mergeDataArrays(dataArrays) {
  if (dataArrays.length === 0) return [];

  const dateSet = new Set();
  //export unique date
  const dataMap = dataArrays.map((series) => {
    const map = new Map();
    series.forEach((row) => {
      const ts = row[0].getTime();
      map.set(ts, row[1]);
      dateSet.add(ts);
    });
    return map;
  });

  // Sort date ascending
  const allDates = Array.from(dateSet).sort((a, b) => a - b);

  return allDates.map((timestamp) => {
    const row = [new Date(timestamp)];
    dataMap.forEach((map) => {
      row.push(map.get(timestamp) !== undefined ? map.get(timestamp) : null);
    });
    return row;
  });
}

/**
 * Parses a graphDatas response from SensorThings API (stean mode).
 * Extracts dates and values from the "datas" string via regex (no eval).
 * @param {Object} response - {infos: "name|unitName|symbol", datas: "[new Date(...), val],..."}
 * @returns {{ data: Array<[Date, number | null]>, name: string, unitName: string, unitSymbol: string }}
 */
export function parseGraphDatas(response) {
  const [name, unitName, unitSymbol] = response.infos.split("|");
  const data = [];
  const regex = /new Date\("([^"]+)"\),\s*([\d.eE+-]+|null)/g;
  let match;
  while ((match = regex.exec(response.datas)) !== null) {
    const date = new Date(match[1]);
    const value = match[2] === "null" ? null : parseFloat(match[2]);
    data.push([date, value]);
  }
  return {
    data,
    name: name.trim(),
    unitName: unitName.trim(),
    unitSymbol: unitSymbol.trim(),
  };
}

// ============================================================================
// Aggregation
// ============================================================================

/**
 * Determines aggregation level based on observation count and
 * the width of the graph in px (only for Frost_Geosas mode).
 * @param {number} count - Number of observations
 * @returns {string|null} 'hour', 'day', or null (raw)
 */
export function determineAggregation(count) {
  const graphDiv = document.getElementById("graphDiv");
  const widthPx = graphDiv.clientWidth;
  const PIXELS_PER_POINT = 1;
  const maxPoints = widthPx / PIXELS_PER_POINT;

  if (count <= maxPoints) return null;

  if (count <= maxPoints * 24) return "hour";

  return "day";
}

/**
 * Builds the $groupby parameter value for SensorThings aggregation.
 * Next improvement go to $ODATA !
 * @param {string} aggregation - 'hour' or 'day'
 * @param {string} graphType - 'bar' (SUM) or 'line' (MEAN)
 * @returns {string|null} groupby value, e.g., 'hour', 'day,SUM'
 */
export function buildGroupByParam(aggregation, graphType) {
  if (!aggregation) return null;
  return graphType === "bar" ? `${aggregation},SUM` : aggregation;
}

/**
 * Returns a label describing the aggregation applied.
 * @param {string|null} aggregation - 'hour', 'day', or null
 * @param {string} graphType - 'bar' or 'line'
 * @returns {string} e.g., "Données brutes", "Moyenne/heure", "Cumul/jour"
 */
export function getAggregationLabel(aggregation, graphType) {
  if (!aggregation) return "Données brutes";
  if (aggregation === "moving_average") return "Moyenne mobile";
  const method = graphType === "bar" ? "Cumul" : "Moyenne";
  const period = aggregation === "hour" ? "heure" : "jour";
  return `${method}/${period}`;
}

/**
 * Downloads observations for a datastream with automatic count-based aggregation.
 * Handles Frost_Geosas mode (server-side aggregation) and standard mode (raw + limit).
 * @param {Object} params
 * @param {string} params.baseUrl - SensorThings API base URL
 * @param {number|string} params.datastreamId - Datastream ID
 * @param {string} params.graphType - 'bar' or 'line'
 * @param {string|null} params.mode - Service mode ('Frost_Geosas' or other)
 * @param {Object} [params.dateRange=null] - {start: Date, end: Date}
 * @param {string|null} [params.aggregation=null] - Pre-computed aggregation level (skips count if provided)
 * @returns {Promise<{data: Array, aggregation: string|null, limitReached: boolean}>}
 */
export async function downloadObservations(params) {
  const {
    baseUrl,
    datastreamId,
    graphType,
    mode,
    dateRange = null,
    aggregation: precomputedAgg = null,
  } = params;
  const entity = `Datastreams(${datastreamId})/Observations`;

  const filter = dateRange
    ? `phenomenonTime ge ${dateRange.start.toISOString()} and phenomenonTime le ${dateRange.end.toISOString()}`
    : undefined;

  if (mode === "Frost_Geosas") {
    //maybe if else  would be more simple
    const aggregation =
      precomputedAgg ??
      determineAggregation(
        await STAApi.getCount(baseUrl, entity, filter || ""),
      );
    let url;
    if (aggregation) {
      url = STAApi.buildQuery(baseUrl, entity, {
        resultFormat: "dataArray",
        groupby: buildGroupByParam(aggregation, graphType),
        filter,
      });
    } else {
      url = STAApi.buildQuery(baseUrl, entity, {
        resultFormat: "dataArray",
        select: "phenomenonTime,result",
        orderby: "phenomenonTime asc",
        filter,
      });
    }

    const result = await STAApi.fetchSTA(url);
    return {
      data: transformDataArray(result),
      aggregation,
      limitReached: false,
    };
  }

  // Standard mode: raw data with pagination limit
  const url = STAApi.buildQuery(baseUrl, entity, {
    resultFormat: "dataArray",
    select: "phenomenonTime,result",
    orderby: "phenomenonTime asc",
    top: 10000,
    filter,
  });

  const result = await STAApi.fetchSTA(url, { maxRecords: 100000 });
  return {
    data: transformDataArray(result),
    aggregation: null,
    limitReached: result.limitReached || false,
  };
}

// ============================================================================
// Dygraph helpers
// ============================================================================

/**
 * Creates a Dygraph underlayCallback for threshold lines (Vmin/Vmax).
 * @param {Object} thresholds
 * @param {number} thresholds.Vmin - min value
 * @param {number} thresholds.Vmax - max value
 * @returns {Function|null} custom underlay callback or null if no thresholds
 */
export function createThresholdCallback(thresholds) {
  const { Vmin = null, Vmax = null } = thresholds || {};
  if (Vmin == null && Vmax == null) return null;

  return function (canvas, area, g) {
    [Vmin, Vmax].forEach((threshold) => {
      if (threshold == null) return;
      const yPixel = g.toDomYCoord(threshold);
      canvas.beginPath();
      canvas.strokeStyle = "red";
      canvas.lineWidth = 3;
      canvas.setLineDash([4, 2]);
      canvas.moveTo(area.x, yPixel);
      canvas.lineTo(area.x + area.w, yPixel);
      canvas.stroke();
    });
    canvas.setLineDash([]);
  };
}

/**
 * Creates a Dygraph instance with standard options.
 * @param {HTMLElement} graphDiv - Graph container element
 * @param {HTMLElement} legendDiv - Legend container element
 * @param {Object} [extraOptions={}] - Additional Dygraph options
 * @returns {Dygraph} Configured Dygraph instance
 */
export function createDygraph(graphDiv, legendDiv, extraOptions = {}) {
  return new Dygraph(graphDiv, [], {
    drawPoints: true,
    connectSeparatedPoints: true,
    digitsAfterDecimal: 3,
    legend: "always",
    labelsDiv: legendDiv,
    ...extraOptions,
  });
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Calculates summary statistics from visible graph data.
 * For 'bar' series: sum. For 'line' series: mean.
 * @param {Dygraph} dygraph - Dygraph instance
 * @param {Object} seriesTypeDict - {seriesLabel: 'bar'|'line'}
 * @returns {Object} {seriesLabel: {value: number, color: string}}
 */
export function calculStatGraph(dygraph, seriesTypeDict) {
  const data = dygraph.file_;
  if (!data || data.length === 0) return {};

  const colors = dygraph.getColors();
  const series = dygraph.getLabels().slice(1);
  const [xmin, xmax] = dygraph.xAxisRange();

  const sums = new Array(series.length).fill(0);
  const counts = new Array(series.length).fill(0);
  if (data.length > 500000) {
    showModal({
      title: "⚠️ Attention",
      body: `Il y a beaucoup de données : ${data.length} observations, 
            votre navigateur  va peut-être subir des ralentissement.`,
      buttons: [
        {
          text: "Continuer",
          class: "is-success",
        },
      ],
    });
  }
  data.forEach((row) => {
    const x = row[0];
    //only visible row -> betwen xmin and xmax
    if (x >= xmin && x <= xmax) {
      series.forEach((_, index) => {
        const y = row[index + 1];
        if (y !== null && !isNaN(y)) {
          sums[index] += y;
          counts[index]++;
        }
      });
    }
  });

  const result = {};
  for (let i = 0; i < series.length; i++) {
    const type = seriesTypeDict[series[i]];
    result[series[i]] = {
      value:
        type === "bar"
          ? Math.round(sums[i] * 100) / 100
          : counts[i] > 0
            ? Math.round((sums[i] / counts[i]) * 100) / 100
            : 0,
      color: colors[i],
    };
  }
  return result;
}

/**
 * Renders a statistics table into a container.
 * @param {Array<string>} selectedKeys - Series keys (datastream names)
 * @param {Object} statistique - From calculStatGraph()
 * @param {HTMLElement} container - Target DOM element
 * @param {Object} seriesDataDict - {key: {unit, graph, aggregation}}
 * @param {Object} aggregationDict - {key: 'hour'|'day'|null}
 */
export function renderStatisticsTable(
  selectedKeys,
  statistique,
  container,
  seriesDataDict,
  aggregationDict,
) {
  const table = document.createElement("table");
  table.className = "table is-striped is-bordered is-fullwidth";
  table.innerHTML = `
        <thead>
            <tr>
                <th>Variable</th>
                <th>Fréquence</th>
                <th>Aggrégation (visuelle)</th>
                <th>Statistique sur la période affichée</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

  const tbody = table.querySelector("tbody");

  for (const key of selectedKeys) {
    if (!seriesDataDict[key]) continue;

    const aggLabel = getAggregationLabel(
      aggregationDict[key],
      seriesDataDict[key].graph,
    );
    const unit = seriesDataDict[key].unit;
    const statKey = key + " " + unit;
    const statGeneral =
      seriesDataDict[key].graph === "bar" ? "Cumul" : "Moyenne";

    const frequency =
      seriesDataDict[key]?.properties?.frequency ?? "Non renseignée";

    const row = document.createElement("tr");
    row.innerHTML = `
            <td style="color:${statistique[statKey]?.color || "black"}"><b>${escapeHtml(key)}</b></td>
            <td>${frequency}</td>
            <td><b>${aggLabel}</b></td>
            <td>${statGeneral}: ${statistique[statKey]?.value || 0} ${escapeHtml(unit)}</td>
        `;
    tbody.appendChild(row);
  }

  container.innerHTML = "";
  container.appendChild(table);
}
