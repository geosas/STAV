/**
 * Alerting Page
 * Monitors datastreams for anomalies (values outside min/max thresholds, missing data)
 * 7 days ago fot the check
 */

import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import * as Utils from "./utils/utils.js";

const selectEl = document.getElementById("searchSelectCause");
if (selectEl) selectEl.selectedIndex = 0;

// Event listeners for filters
document.getElementById("searchInput").addEventListener("keyup", filterTable);
document
  .getElementById("searchSelectCause")
  .addEventListener("change", filterTableCause);

/**
 * Main initialization function
 */
async function main() {
  const config = await waitForAppReady();
  const tbody = document.getElementById("datastreamsBody");
  const progressBar = document.getElementById("progressBar");
  const titleProgress = document.getElementById("titleProgress");
  const serviceNameEl = document.getElementById("serviceName");

  // Update page title
  if (serviceNameEl && config.nameService) {
    serviceNameEl.textContent = config.nameService;
  }

  if (!tbody) {
    console.error("Element #datastreamsBody not found");
    return;
  }

  try {
    // Calculate date 7 days ago
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString().replace(".000", "");

    // Fetch all Things with their Datastreams
    const thingsUrl = STAApi.buildQuery(config.urlService, "Things", {
      select: "name,id",
      expand:
        "Datastreams($select=id,name,phenomenonTime,properties,unitOfMeasurement;$expand=Sensor,ObservedProperty),Locations",
    });
    const things = await STAApi.fetchSTA(thingsUrl);

    if (things.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5">Aucun point de mesure trouvé.</td></tr>';
      return;
    }

    // Process each Thing's Datastreams
    const processingPromises = [];

    things.forEach((thing) => {
      thing.Datastreams.forEach((datastream) => {
        // Only process datastreams with Vmin/Vmax properties
        if (hasAlertThresholds(datastream)) {
          const promise = checkDatastreamForAlerts(
            config.urlService,
            datastream,
            sevenDaysAgoISO,
            now,
            config.configFileName,
          ).then((row) => {
            if (row) tbody.appendChild(row);
          });
          processingPromises.push(promise);
        }
      });
    });

    // Wait for all datastreams to be processed
    await Promise.all(processingPromises);

    // Hide progress indicators
    if (titleProgress) titleProgress.classList.add("is-hidden");
    if (progressBar) progressBar.classList.add("is-hidden");
  } catch (error) {
    console.error("Error loading alert data:", error);
    tbody.innerHTML =
      '<tr><td colspan="5" class="notification is-danger">Impossible de charger les données.</td></tr>';
  }
}

/**
 * Checks if a datastream has alert thresholds defined
 * @param {Object} datastream - Datastream entity
 * @returns {boolean} True if Vmin and Vmax are defined
 */
function hasAlertThresholds(datastream) {
  return (
    datastream.properties &&
    typeof datastream.properties.Vmin !== "undefined" &&
    typeof datastream.properties.Vmax !== "undefined"
  );
}

/**
 * Checks a datastream for alerts (anomalous values or missing data)
 * @param {string} baseUrl - SensorThings API base URL
 * @param {Object} datastream - Datastream entity
 * @param {string} sevenDaysAgoISO - ISO date string for 7 days ago
 * @param {Date} now - Current date
 * @param {string} configFileName - Configuration file name
 * @returns {Promise<HTMLElement|null>} Table row element or null
 */
async function checkDatastreamForAlerts(
  baseUrl,
  datastream,
  sevenDaysAgoISO,
  now,
  configFileName,
) {
  const { Vmin, Vmax } = datastream.properties;

  try {
    // Query for observations outside the threshold
    const url = STAApi.buildQuery(
      baseUrl,
      `Datastreams(${datastream["@iot.id"]})/Observations`,
      {
        select: "result",
        resultFormat: "dataArray",
        filter: `phenomenonTime gt ${sevenDaysAgoISO} and (result gt ${Vmax} or result lt ${Vmin})`,
      },
    );
    const data = await STAApi.fetchSTA(url);

    // Parse phenomenon time
    const { start, end } = Utils.parsePhenomenonTime(datastream.phenomenonTime);
    const endDate = end ? new Date(end) : null;

    // Create table row
    const tr = document.createElement("tr");
    let alertMessage = "";
    let rowClass = "";

    // Check for anomalous values
    if (data.dataArray && data.dataArray.length > 0) {
      let anomalousValue = data.dataArray[0]?.[0];
      if (anomalousValue !== undefined) {
        if (isNaN(anomalousValue)) {
          anomalousValue = "N/A";
        } else {
          anomalousValue = anomalousValue.toFixed(3);
        }
        const unit = datastream.unitOfMeasurement?.symbol || "";
        alertMessage = `Valeur aberrante : ${anomalousValue} ${unit}`;
        rowClass = "is-warning";
      }
    } else {
      // No anomalous values found
      alertMessage = "∅";
      rowClass = "is-selected";
    }

    // Add last measurement time
    if (endDate) {
      const timeAgo = Utils.formatTimeAgo(endDate, now);
      alertMessage += `<br>Dernière mesure : ${timeAgo}`;

      // Check if data is too old (>7 days)
      if (endDate < new Date(sevenDaysAgoISO)) {
        alertMessage = `No data since ${timeAgo}`;
        rowClass = "is-info";
      }
    }

    // Apply row class
    if (rowClass) {
      tr.classList.add(rowClass);
    }

    // Build row HTML
    tr.innerHTML = `
            <th>
                <a
                    href="${Utils.BASE_URL}/espace/simple-plot?id=${datastream["@iot.id"]}&type=datastream&config=${configFileName}"
                    target="_blank"
                    class="has-text-link"
                >
                    ${Utils.escapeHtml(datastream.name)}
                </a>
            </th>
            <td>${Utils.escapeHtml(start)} <br> ${Utils.escapeHtml(end)}</td>
            <td>${alertMessage}</td>
            <td>
                <a href="${Utils.escapeHtml(datastream.Sensor.metadata)}" target="_blank" class="has-text-link">
                    ${Utils.escapeHtml(datastream.Sensor.name)}
                </a>
            </td>
            <td>
                <a href="${Utils.escapeHtml(datastream.ObservedProperty.definition)}" target="_blank" class="has-text-link">
                    ${Utils.escapeHtml(datastream.ObservedProperty.name)}
                </a>
            </td>
        `;

    return tr;
  } catch (error) {
    console.error(`Error checking datastream ${datastream.name}:`, error);
    return null;
  }
}

/**
 * Filters table rows by name (search input)
 * next improvement merge filter with metrology page andother page
 */
function filterTable() {
  const input = document.getElementById("searchInput");
  const filter = input.value.toUpperCase();
  const table = document.getElementById("tableDatastreams");
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
}

/**
 * Filters table rows by alert cause (select dropdown)
 */
function filterTableCause() {
  const select = document.getElementById("searchSelectCause");
  const filter = select.value.toUpperCase();
  const table = document.getElementById("tableDatastreams");
  const rows = table.getElementsByTagName("tr");

  for (let i = 1; i < rows.length; i++) {
    const td = rows[i].getElementsByTagName("td")[1]; // "Alerte" column
    if (td) {
      const txtValue = td.textContent || td.innerText;
      rows[i].style.display =
        filter === "" || txtValue.toUpperCase().includes(filter) ? "" : "none";
    }
  }
}

main();
