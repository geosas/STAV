/**
 * Intervention Terrain Page
 * Displays a table of field interventions from a configured Datastream.
 * The Datastream ID comes from config.interventionTerrain.
 */

import { waitForAppReady } from "./utils/app-init.js";
import * as STAApi from "./utils/sta-api.js";
import { parseDate, showNotification } from "./utils/utils.js";

/**
 * Main initialization function
 */
async function main() {
  const config = await waitForAppReady();
  const tbody = document.getElementById("tableField");
  const progressBar = document.getElementById("progressBar");
  const serviceNameEl = document.getElementById("serviceName");

  if (serviceNameEl && config.nameService) {
    serviceNameEl.textContent = config.nameService;
  }

  if (!config.interventionTerrain) {
    showNotification("Aucun datastream d'intervention configuré", "warning");
    if (progressBar) progressBar.remove();
    return;
  }

  try {
    const url = STAApi.buildQuery(
      config.urlService,
      `Datastreams(${config.interventionTerrain})/Observations`,
      {
        select: "phenomenonTime,result",
        orderby: "phenomenonTime asc",
      },
    );
    const observations = await STAApi.fetchSTA(url);

    if (observations.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="2">Aucune intervention enregistrée.</td></tr>';
      return;
    }

    observations.forEach((obs) => {
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = parseDate(obs.phenomenonTime, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const tdResult = document.createElement("td");
      tdResult.innerHTML = obs.result;
      tr.appendChild(tdDate);
      tr.appendChild(tdResult);
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error("Error loading intervention data:", error);
    tbody.innerHTML =
      '<tr><td colspan="2" class="notification is-danger">Impossible de charger les données.</td></tr>';
  } finally {
    if (progressBar) progressBar.remove();
  }
}

main();
