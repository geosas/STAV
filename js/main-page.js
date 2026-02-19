/**
 * Main Landing Page
 * Displays available observatories from configuration
 */

import { escapeHtml, BASE_URL } from "./utils/utils.js";

const colIds = ["column1", "column2", "column3"];
const cols = colIds.map((id) => document.getElementById(id));
const container = document.getElementById("columns");

if (!container) {
  console.error("Div #columns not found");
} else {
  try {
    // Fetch configuration list
    const response = await fetch("./config/stav_config.json");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const entries = Object.entries(data);

    if (entries.length === 0) {
      container.innerHTML =
        '<div class="column"><p class="notification is-warning">Aucune configuration trouvée.</p></div>';
    } else {
      // Create cards for each observatory
      for (let i = 0; i < entries.length; i++) {
        const [label, filename] = entries[i];
        const targetCol = cols[i % 3];
        const url = `espace/decouverte/?config=${BASE_URL}config/${encodeURIComponent(filename)}`;

        // Fetch config file to get description
        let description = "";
        try {
          const configResponse = await fetch(`./config/${filename}`);
          if (configResponse.ok) {
            const configData = await configResponse.json();
            description = configData.description || "";
          }
        } catch (error) {
          console.warn(`Failed to fetch config for ${filename}:`, error);
        }

        const cardCol = document.createElement("div");
        cardCol.innerHTML = `
                    <div class="card">
                        <header class="card-header">
                            <p class="card-header-title" title="${escapeHtml(label)}">
                                ${escapeHtml(label)}
                            </p>
                        </header>
                        <div class="card-content">
                            <div class="content">
                                ${description ? `<p>${escapeHtml(description)}</p>` : ""}
                                <a href="${url}" target="_blank" rel="noopener noreferrer">
                                    Ouvrir l'observatoire
                                </a>
                            </div>
                        </div>
                    </div>
                `;

        targetCol.appendChild(cardCol);
      }
    }
  } catch (error) {
    console.error("Error loading configurations:", error);
    container.innerHTML = `
            <div class="column">
                <p class="notification is-danger">
                    Erreur lors du chargement des configurations : ${escapeHtml(error.message)}
                </p>
            </div>
        `;
  }
}
