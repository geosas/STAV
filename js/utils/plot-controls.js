/**
 * Plot Controls Module
 * Shared UI controls for Dygraph-based visualization pages:
 * - Download modal (CSV export with raw/aggregated options)
 * - Share URL (Base64-encoded state in ?share= parameter)
 * - Pagination controller (prev/next/indicator with manual input)
 */

import * as STAApi from "./sta-api.js";
import {
  showNotification,
  showModal,
  downloadFile,
  getQueryParam,
  fetchStreamWithSize,
} from "./utils.js";

// ============================================================================
// Download Modal (with bulma style)
// ============================================================================

/**
 * Shows a download modal (with bulma style) with options for raw and aggregated CSV export.
 * @param {Object} params
 * @param {Object|null} params.graph - Dygraph instance (for date range pre-fill)
 * @param {Array<{id: number|string, name: string}>} params.datastreams - Datastreams to download
 * @param {string} params.urlService - SensorThings base URL
 * @param {string|null} params.modeService - 'Frost_Geosas', 'stean', or null
 * @param {HTMLElement|null} params.progressBar - Progress bar element to show/hide
 * @param {Function|null} [params.beforeShow=null] - Optional callback before showing modal
 */
export function showDownloadModal({
  graph,
  datastreams,
  urlService,
  modeService,
  progressBar,
  beforeShow = null,
}) {
  if (beforeShow) beforeShow();

  if (!datastreams || datastreams.length === 0) {
    showNotification("Aucune série sélectionnée", "warning");
    return;
  }

  // Get current date range from graph if available
  let startDate = "";
  let endDate = "";
  if (graph) {
    const xRange = graph.xAxisRange();
    if (xRange[0] && xRange[1]) {
      startDate = new Date(xRange[0]).toISOString().slice(0, 16);
      endDate = new Date(xRange[1]).toISOString().slice(0, 16);
    }
  }

  // Build modal body
  const bodyContent = document.createElement("div");
  let html = `
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
    `;

  if (modeService === "Frost_Geosas") {
    html += `
        <div class="field">
            <label class="radio">
                <input type="radio" name="downloadType" value="agg_hour">
                Données agrégées à l'heure
            </label>
        </div>
        <div class="field">
            <label class="radio">
                <input type="radio" name="downloadType" value="agg_day">
                Données agrégées au jour
            </label>
        </div>
        <div id="aggTypeContainer" class="field" style="display:none; margin-top: 10px;">
            <label class="label">Type d'agrégation :</label>
            <div class="control">
                <div class="select">
                    <select id="aggTypeSelect">
                        <option value="MEAN">Moyenne</option>
                        <option value="SUM">Somme</option>
                    </select>
                </div>
            </div>
        </div>
        `;
  }
  html += `</div>`;
  bodyContent.innerHTML = html;

  // Toggle aggregation type visibility
  const radios = bodyContent.querySelectorAll('input[name="downloadType"]');
  const aggContainer = bodyContent.querySelector("#aggTypeContainer");
  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!aggContainer) return;
      if (
        radio.checked &&
        (radio.value === "agg_hour" || radio.value === "agg_day")
      ) {
        aggContainer.style.display = "block";
      } else if (radio.checked) {
        aggContainer.style.display = "none";
      }
    });
  });

  showModal({
    title: "📥 Téléchargement",
    body: bodyContent,
    buttons: [
      {
        text: "Télécharger",
        class: "is-success",
        onClick: () =>
          _executeDownload(datastreams, urlService, modeService, progressBar),
      },
      {
        text: "Annuler",
        class: "",
      },
    ],
  });
}

/**
 * Executes the CSV download based on modal form values.
 * @param {Array<{id, name}>} datastreams
 * @param {string} urlService
 * @param {string|null} modeService
 * @param {HTMLElement|null} progressBar
 */
async function _executeDownload(
  datastreams,
  urlService,
  modeService,
  progressBar,
) {
  const selectedOption = document.querySelector(
    'input[name="downloadType"]:checked',
  )?.value;
  const startDateInput = document.getElementById("dlStartDate")?.value;
  const endDateInput = document.getElementById("dlEndDate")?.value;

  if (datastreams.length === 0) return;

  // Validate date range for non-raw_all options
  if (selectedOption !== "raw_all") {
    if (!startDateInput || !endDateInput) {
      showNotification("Veuillez sélectionner une période", "warning");
      return;
    }
    if (new Date(startDateInput) >= new Date(endDateInput)) {
      showNotification(
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
  const aggTypeValue = document.getElementById("aggTypeSelect")?.value;

  if (progressBar) {
    progressBar.classList.remove("is-hidden");
    progressBar.style.display = "";
  }

  for (const ds of datastreams) {
    try {
      let url;
      let aggType;

      switch (selectedOption) {
        case "raw_all":
          url = STAApi.buildQuery(
            urlService,
            `Datastreams(${ds.id})/Observations`,
            {
              resultFormat: "csv",
              select: "phenomenonTime,result",
              orderby: "phenomenonTime asc",
            },
          );
          break;

        case "raw_range":
          url = STAApi.buildQuery(
            urlService,
            `Datastreams(${ds.id})/Observations`,
            {
              resultFormat: "csv",
              select: "phenomenonTime,result",
              orderby: "phenomenonTime asc",
              filter: `phenomenonTime ge ${startDate} and phenomenonTime le ${endDate}`,
            },
          );
          break;

        case "agg_hour":
          if (modeService === "Frost_Geosas") {
            const groupby = aggTypeValue === "SUM" ? "hour,SUM" : "hour";
            aggType = aggTypeValue;
            url = STAApi.buildQuery(
              urlService,
              `Datastreams(${ds.id})/Observations`,
              {
                resultFormat: "csv",
                filter: `phenomenonTime ge ${startDate} and phenomenonTime le ${endDate}`,
                groupby,
              },
            );
          } else {
            showNotification(
              `Agrégation non supportée pour ${ds.name}`,
              "warning",
            );
            continue;
          }
          break;

        case "agg_day":
          if (modeService === "Frost_Geosas") {
            const groupby = aggTypeValue === "SUM" ? "day,SUM" : "day";
            aggType = aggTypeValue;
            url = STAApi.buildQuery(
              urlService,
              `Datastreams(${ds.id})/Observations`,
              {
                resultFormat: "csv",
                filter: `phenomenonTime ge ${startDate} and phenomenonTime le ${endDate}`,
                groupby,
              },
            );
          } else {
            showNotification(
              `Agrégation non supportée pour ${ds.name}`,
              "warning",
            );
            continue;
          }
          break;
      }

      if (modeService === "stean") {
        window.open(url, "_blank");
      } else {
        const csvText = await fetchStreamWithSize(
          url,
          progressBar,
          datastreams.length > 1 ? ds.name : "",
        );

        let suffix = "";
        if (selectedOption === "agg_hour") suffix = "_hourly";
        else if (selectedOption === "agg_day") suffix = "_daily";
        else if (selectedOption === "raw_range") suffix = "_time_filtered";

        if (aggType == null) aggType = "RAW";
        suffix += "_" + aggType;

        downloadFile(csvText, `${ds.name}${suffix}.csv`);
      }
    } catch (error) {
      console.error(`Error for ${ds.name}:`, error);
      showNotification(
        `Erreur lors du téléchargement de ${ds.name}`,
        "danger",
        5000,
      );
    }
  }

  if (progressBar) {
    progressBar.classList.add("is-hidden");
    progressBar.style.display = "";
  }
  showNotification("Téléchargement terminé", "info");
}

// ============================================================================
// Share URL
// ============================================================================

/**
 * Parses the ?share= URL parameter, Base64-decodes and JSON-parses it.
 * @returns {Object|null} Parsed share data or null if absent/invalid
 */
export function parseShareParam() {
  const shareParam = getQueryParam("share");
  if (!shareParam) return null;

  try {
    const jsonStr = atob(shareParam);
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("Invalid share parameter:", err);
    showNotification("Lien de partage invalide", "danger");
    return null;
  }
}

/**
 * Generates a shareable URL by encoding data as Base64 JSON in ?share= param.
 * @param {Function} getShareData - Callback returning the share data object, or null if nothing to share
 * @returns {string|null} The share URL or null
 */
function generateShareUrl(getShareData) {
  const shareData = getShareData();
  if (!shareData) return null;

  const jsonStr = JSON.stringify(shareData);
  const base64 = btoa(jsonStr);

  const url = new URL(window.location.href);
  url.searchParams.set("share", base64);

  return url.toString();
}

/**
 * Generates share URL and copies to clipboard with notification.
 * @param {Function} getShareData - Callback returning the share data object
 */
async function copyShareUrl(getShareData) {
  const url = generateShareUrl(getShareData);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showNotification("Lien copié dans le presse-papier", "info", 5000);
  } catch (err) {
    prompt("Copiez ce lien :", url);
  }
}

/**
 * Sets up a share button that copies a shareable URL to the clipboard.
 * Builds the share data by merging page-specific data (from getPageSpecificData)
 * with zoom and pagination state.
 * @param {string} btnId - ID of the share button element
 * @param {Object} params
 * @param {Function} params.getGraph - Returns the current Dygraph instance (or null)
 * @param {Function} params.getPageSpecificData - Returns page-specific share data ({id} or {ds:[...]}) or null
 * @param {Function} [params.isZoomed=() => false] - Returns whether the graph is currently zoomed
 * @param {Function} [params.getPaginationCtrl=() => null] - Returns the pagination controller (or null)
 */
export function initShareButton(
  btnId,
  {
    getGraph,
    getPageSpecificData,
    isZoomed = () => false,
    getPaginationCtrl = () => null,
  },
) {
  document.getElementById(btnId).addEventListener("click", () => {
    copyShareUrl(() => {
      const pageData = getPageSpecificData();
      if (!pageData) return null;
      const shareData = { ...pageData };
      const graph = getGraph();
      if (isZoomed() && graph) {
        const xr = graph.xAxisRange();
        shareData.z = [Math.round(xr[0]), Math.round(xr[1])];
      }
      const pagCtrl = getPaginationCtrl();
      if (pagCtrl && pagCtrl.getCurrentPage() > 1) {
        shareData.p = pagCtrl.getCurrentPage();
      }
      return shareData;
    });
  });
}

/**
 * Applies zoom and pagination state from share data.
 * Called by pages after their own share state restoration (e.g. checkbox selection).
 * @param {Object} shareData - Parsed share data object
 * @param {Object} params
 * @param {Object|null} params.graph - Dygraph instance
 * @param {Object|null} params.paginationCtrl - Pagination controller (or null)
 * @param {Function} [params.updateGraphZoom] - Async function to handle zoom update (smart zoom in Frost_Geosas, basic zoom flag in other modes)
 */
export async function applyShareZoomPagination(
  shareData,
  { graph, paginationCtrl, updateGraphZoom },
) {
  // Apply pagination if present
  if (shareData.p && paginationCtrl) {
    const total = paginationCtrl.getTotalPages();
    const page = Math.min(shareData.p, total);
    await paginationCtrl.goToPage(page);
  }
  // Apply zoom if present
  if (shareData.z && shareData.z.length === 2 && graph) {
    graph.updateOptions({ dateWindow: [shareData.z[0], shareData.z[1]] });
    if (updateGraphZoom) {
      await updateGraphZoom();
    }
  }
}

// ============================================================================
// Pagination Controller
// ============================================================================

/**
 * Creates a reusable pagination controller bound to DOM elements.
 * Manages prev/next navigation, page indicator display, and manual page input.
 * @param {Object} params
 * @param {HTMLElement} params.prevBtn - Previous page button
 * @param {HTMLElement} params.nextBtn - Next page button
 * @param {HTMLElement} params.indicator - Page indicator span (clickable for manual input)
 * @param {HTMLElement} params.container - Pagination controls container (to show/hide)
 * @param {Function} params.onPageChange - async (pageNum: number) => void
 * @returns {Object} Controller with show/hide/update/getCurrentPage/getTotalPages/reset methods
 */
export function createPaginationController({
  prevBtn,
  nextBtn,
  indicator,
  container,
  onPageChange,
}) {
  let currentPage = 1;
  let totalPages = 1;

  function updateIndicator() {
    indicator.textContent = `${currentPage} / ${totalPages}`;
  }

  // Previous page
  prevBtn.addEventListener("click", async () => {
    if (currentPage <= 1) return;
    currentPage--;
    updateIndicator();
    await onPageChange(currentPage);
  });

  // Next page
  nextBtn.addEventListener("click", async () => {
    if (currentPage >= totalPages) return;
    currentPage++;
    updateIndicator();
    await onPageChange(currentPage);
  });

  // Click on indicator → manual page input
  indicator.addEventListener("click", () => {
    if (indicator.querySelector("input")) return;

    const input = document.createElement("input");
    input.type = "number";
    input.className = "input is-small";
    input.style.width = "60px";
    input.style.textAlign = "center";
    input.min = 1;
    input.max = totalPages;
    input.value = currentPage;

    const okBtn = document.createElement("button");
    okBtn.className = "button is-small is-success";
    okBtn.textContent = "OK";
    okBtn.style.marginLeft = "4px";

    indicator.textContent = "";
    indicator.classList.remove("is-static");
    indicator.appendChild(input);
    indicator.appendChild(okBtn);
    input.focus();
    input.select();

    const goToPage = async () => {
      const page = parseInt(input.value, 10);
      indicator.classList.add("is-static");
      if (page >= 1 && page <= totalPages && page !== currentPage) {
        currentPage = page;
        updateIndicator();
        await onPageChange(currentPage);
      } else {
        updateIndicator();
      }
    };

    okBtn.addEventListener("click", goToPage);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        goToPage();
      } else if (e.key === "Escape") {
        updateIndicator();
      }
    });
  });

  return {
    /** Shows the pagination controls */
    show() {
      container.style.display = "";
    },
    /** Hides the pagination controls */
    hide() {
      container.style.display = "none";
    },
    /**
     * Updates page state and indicator text
     * @param {number} page - Current page number
     * @param {number} total - Total page count
     */
    update(page, total) {
      currentPage = page;
      totalPages = total;
      updateIndicator();
    },
    /** @returns {number} Current page number */
    getCurrentPage() {
      return currentPage;
    },
    /** @returns {number} Total page count */
    getTotalPages() {
      return totalPages;
    },
    /**
     * Navigates to a specific page: updates state, indicator, and triggers onPageChange
     * @param {number} pageNum - Target page number
     */
    async goToPage(pageNum) {
      if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage) {
        currentPage = pageNum;
        updateIndicator();
        await onPageChange(currentPage);
      }
    },
    /** Resets to page 1, hides controls */
    reset() {
      currentPage = 1;
      totalPages = 1;
      updateIndicator();
      container.style.display = "none";
    },
  };
}
