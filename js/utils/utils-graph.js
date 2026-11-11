/**
 * Graph Utility Module
 * Shared Dygraph helpers used across visualization pages.
 */

import * as STAApi from "./sta-api.js";
import { escapeHtml, showModal } from "./utils.js";

let modalShown = false;

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
 * Returns 'bar' if the ObservedProperty is in the config's bar list, else 'line'.
 * @param {string|undefined} observedPropertyName
 * @param {string[]} barObservedProperties - from appConfig
 * @returns {'bar'|'line'}
 */
export function getGraphType(observedPropertyName, barObservedProperties = []) {
  return observedPropertyName && barObservedProperties.includes(observedPropertyName)
    ? "bar"
    : "line";
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
  if (graphType === "bar") {
    return aggregation === "hour" ? "Cumul/heure" : "Cumul/jour";
  }
  return aggregation === "hour" ? "Moyenne/heure" : "Moyenne/jour";
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
    top: 50000,
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
// Outliers (gross errors) handling
// ============================================================================

/**
 * A value is a gross error when the gap isolating it from the rest of the
 * series is larger than OUTLIER_GAP_RATIO times the range of that rest.
 * Tested on Beauregard: real extremes (storms, battery drops) stay below 2,
 * sensor errors (-1018 mm of rain) are above 30.
 */
const OUTLIER_GAP_RATIO = 10;
// Only the 5% most extreme values on each side can be flagged
const OUTLIER_MAX_TAIL = 0.05;
const OUTLIER_COLOR = "#d00000";

// Per-graph state: {fences: Map(label -> {low, high}|null), rawFile, maskedFile, outliers, showAll, notice}
const outlierState = new WeakMap();

/**
 * Computes the bounds outside which values of a series are gross errors.
 * @param {ArrayLike<number>} values - Series values (null/NaN ignored)
 * @returns {{low: number, high: number}|null} null if no outlier
 */
export function computeOutlierFences(values) {
  // Float64Array: native numeric sort, much faster than Array.sort with a comparator
  const buffer = new Float64Array(values.length);
  let n = 0;
  for (let k = 0; k < values.length; k++) {
    if (Number.isFinite(values[k])) buffer[n++] = values[k];
  }
  if (n < 10) return null;
  const sorted = buffer.subarray(0, n).sort();

  const tail = Math.max(1, Math.floor(OUTLIER_MAX_TAIL * n));

  // Largest gap in each tail: splits the candidate outliers from the core
  let lowIdx = 1;
  for (let i = 2; i <= tail; i++) {
    if (sorted[i] - sorted[i - 1] > sorted[lowIdx] - sorted[lowIdx - 1]) lowIdx = i;
  }
  let highIdx = n - 2;
  for (let j = n - 3; j >= n - 1 - tail; j--) {
    if (sorted[j + 1] - sorted[j] > sorted[highIdx + 1] - sorted[highIdx]) highIdx = j;
  }

  const coreRange = sorted[highIdx] - sorted[lowIdx];
  // Constant core (e.g. battery always 100%): no reference scale, flag nothing
  if (!(coreRange > 0)) return null;

  const lowGap = sorted[lowIdx] - sorted[lowIdx - 1];
  const highGap = sorted[highIdx + 1] - sorted[highIdx];
  const low = lowGap > OUTLIER_GAP_RATIO * coreRange
    ? (sorted[lowIdx - 1] + sorted[lowIdx]) / 2
    : -Infinity;
  const high = highGap > OUTLIER_GAP_RATIO * coreRange
    ? (sorted[highIdx] + sorted[highIdx + 1]) / 2
    : Infinity;

  return low === -Infinity && high === Infinity ? null : { low, high };
}

/**
 * Tells if a value of a series is a gross error for this graph.
 * @param {Dygraph} dygraph
 * @param {string} label - Series label
 * @param {number} value
 * @returns {boolean}
 */
export function isOutlier(dygraph, label, value) {
  const fences = outlierState.get(dygraph)?.fences.get(label);
  return !!fences && Number.isFinite(value) && (value < fences.low || value > fences.high);
}

/**
 * Computes the fences of each series of a new data array, then returns a copy
 * where outliers are replaced by null (only the affected rows are copied).
 * Fences are computed on unzoomed data only and reused while zoomed, so a zoomed
 * window (where a storm can dwarf a few zeros) never creates new outliers.
 */
function _maskOutliers(state, file, labels, zoomed) {
  if (!zoomed) state.fences = new Map();

  const fenced = [];
  labels.slice(1).forEach((label, s) => {
    const col = s + 1;
    if (!state.fences.has(label)) {
      const values = new Float64Array(file.length);
      for (let r = 0; r < file.length; r++) {
        const y = file[r][col];
        values[r] = y == null ? NaN : y;
      }
      state.fences.set(label, computeOutlierFences(values));
    }
    const fences = state.fences.get(label);
    if (fences) fenced.push({ label, col, ...fences });
  });

  state.outliers = [];
  if (fenced.length === 0) return file;

  let masked = null;
  for (let r = 0; r < file.length; r++) {
    const row = file[r];
    let newRow = null;
    for (const { label, col, low, high } of fenced) {
      const y = row[col];
      if (Number.isFinite(y) && (y < low || y > high)) {
        newRow ??= row.slice();
        newRow[col] = null;
        state.outliers.push({ label, x: +row[0], y });
      }
    }
    if (newRow) {
      masked ??= file.slice();
      masked[r] = newRow;
    }
  }
  return masked ?? file;
}

/**
 * Draws a red arrow on the top/bottom edge for each hidden outlier (drawCallback).
 */
function _drawOutlierMarkers(g) {
  const state = outlierState.get(g);
  if (!state || state.showAll || state.outliers.length === 0) return;

  // hidden_ctx_ is the plot canvas (same one given to underlayCallback)
  const ctx = g.hidden_ctx_;
  const area = g.getArea();
  const [ymin, ymax] = g.yAxisRange();
  ctx.save();
  ctx.fillStyle = OUTLIER_COLOR;
  for (const { x, y } of state.outliers) {
    const px = g.toDomXCoord(x);
    if (px < area.x || px > area.x + area.w) continue;
    const edge = y > ymax ? area.y : y < ymin ? area.y + area.h : null;
    if (edge === null) continue;
    const dir = y > ymax ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(px, edge);
    ctx.lineTo(px - 5, edge + 9 * dir);
    ctx.lineTo(px + 5, edge + 9 * dir);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Shows/updates the message above the graph listing the hidden outliers.
 */
function _renderOutlierNotice(state, toggle) {
  const { notice, outliers } = state;
  if (outliers.length === 0) {
    notice.style.display = "none";
    return;
  }

  // Series names only (telechargement labels end with " unité : ...")
  const names = [...new Set(outliers.map(({ label }) => label.split(" unité :")[0]))];
  const text = state.showAll
    ? "Valeurs aberrantes affichées (toujours exclues des statistiques)."
    : `⚠️ ${outliers.length} valeur(s) aberrante(s) hors échelle, signalée(s) par ▲▼ et exclue(s) des statistiques : ${names.map(escapeHtml).join(", ")}`;

  notice.style.display = "";
  notice.innerHTML = `
    ${text}
    <label class="checkbox" style="margin-left: 8px">
      <input type="checkbox" ${state.showAll ? "checked" : ""}> Afficher toute l'échelle
    </label>`;
  notice.querySelector("input").addEventListener("change", (e) => toggle(e.target.checked));
}

/**
 * Wraps graph.updateOptions so every new data array is prepared before the
 * (single) draw: gaps are broken, then outliers are masked so Dygraph
 * autoscales the y axis on clean data by itself.
 */
function _installDataFilter(g, graphDiv) {
  const notice = document.createElement("div");
  notice.className = "is-size-7 has-text-danger";
  notice.style.margin = "4px 0";
  notice.style.display = "none";
  graphDiv.insertAdjacentElement("beforebegin", notice);

  const state = {
    fences: new Map(),
    rawFile: null,
    maskedFile: null,
    outliers: [],
    showAll: false,
    notice,
  };
  outlierState.set(g, state);

  const originalUpdate = g.updateOptions.bind(g);

  const toggle = (showAll) => {
    state.showAll = showAll;
    originalUpdate({ file: showAll ? state.rawFile : state.maskedFile });
    _renderOutlierNotice(state, toggle);
  };

  g.updateOptions = (options, blockRedraw) => {
    if (options && Array.isArray(options.file)) {
      const labels = options.labels ?? g.getLabels();
      const zoomed = options.dateWindow !== undefined ? options.dateWindow != null : g.isZoomed("x");
      state.rawFile = breakGaps(options.file, labels.length - 1);
      state.maskedFile = _maskOutliers(state, state.rawFile, labels, zoomed);
      options = { ...options, file: state.showAll ? state.rawFile : state.maskedFile };
      _renderOutlierNotice(state, toggle);
    }
    return originalUpdate(options, blockRedraw);
  };
}

// ============================================================================
// Gaps (periods without data)
// ============================================================================

/**
 * A gap is a time step larger than GAP_FACTOR times the usual (median) step
 * of the series: 10 days without data in a daily series, 100 min in a 10 min one.
 */
const GAP_FACTOR = 10;

/**
 * Inserts a NaN row in the middle of each gap of each series so the line is
 * broken there. connectSeparatedPoints (needed for merged multi-series data)
 * makes Dygraph skip null values, but it always breaks the line on NaN.
 * @param {Array<Array>} file - Dygraph data [[Date, v1, v2, ...], ...] sorted by date
 * @param {number} nSeries - Number of series (columns after the date)
 * @returns {Array<Array>} The same array if no gap, else a copy with the break rows
 */
export function breakGaps(file, nSeries) {
  const breaks = []; // [time, column]
  const times = new Float64Array(file.length);

  for (let col = 1; col <= nSeries; col++) {
    let n = 0;
    for (const row of file) {
      if (Number.isFinite(row[col])) times[n++] = +row[0];
    }
    if (n < 3) continue;

    const steps = new Float64Array(n - 1);
    for (let k = 1; k < n; k++) steps[k - 1] = times[k] - times[k - 1];
    const median = steps.slice().sort()[(n - 1) >> 1];
    if (!(median > 0)) continue;

    for (let k = 0; k < n - 1; k++) {
      if (steps[k] > GAP_FACTOR * median) breaks.push([times[k] + steps[k] / 2, col]);
    }
  }
  if (breaks.length === 0) return file;

  breaks.sort((a, b) => a[0] - b[0]);
  const breakRow = ([time, col]) => {
    const row = new Array(nSeries + 1).fill(null);
    row[0] = new Date(time);
    row[col] = NaN;
    return row;
  };

  const result = [];
  let b = 0;
  for (const row of file) {
    while (b < breaks.length && breaks[b][0] < +row[0]) result.push(breakRow(breaks[b++]));
    result.push(row);
  }
  while (b < breaks.length) result.push(breakRow(breaks[b++]));
  return result;
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
  const graph = new Dygraph(graphDiv, [], {
    drawPoints: true,
    connectSeparatedPoints: true,
    digitsAfterDecimal: 3,
    legend: "always",
    labelsDiv: legendDiv,
    drawCallback: _drawOutlierMarkers,
    ...extraOptions,
  });
  _installDataFilter(graph, graphDiv);
  return graph;
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
  if (!modalShown && data.length > 500000) {
    modalShown = true;
    showModal({
      title: "⚠️ Attention",
      body: `Il y a beaucoup de données : ${data.length} observations, 
            votre navigateur  va peut-être subir des ralentissement.
            Ce message ne s'affichera plus.`,
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
        if (y !== null && !isNaN(y) && !isOutlier(dygraph, series[index], y)) {
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
