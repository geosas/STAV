/**
 * Header Management Module
 * Handles header injection and navigation highlighting
 */

/**
 * Injects header HTML into the page, in <div id="header"></div>
 * @param {string} headerPath - Path to the header HTML file
 * @param {string} targetSelector - CSS selector for the container element
 * @returns {Promise<boolean>} Success status
 */
async function injectHeader(headerPath, targetSelector = "#header") {
  try {
    const response = await fetch(headerPath);

    if (!response.ok) {
      console.error(
        `Failed to load header: ${headerPath} (Status: ${response.status})`,
      );
      return false;
    }

    const html = await response.text();
    const container = document.querySelector(targetSelector);

    if (!container) {
      console.error(`Header container not found: ${targetSelector}`);
      return false;
    }

    container.innerHTML = html;
    return true;
  } catch (error) {
    console.error("Error injecting header:", error);
    return false;
  }
}

/**
 * Highlights the active navigation link based on current path
 * Also renames parent dropdown menu to match the active child
 * @param {string} linkSelector - CSS selector for navigation links
 */
function highlightActiveLink(linkSelector = ".navbar-item[href]") {
  const currentPath = window.location.pathname;
  const links = document.querySelectorAll(linkSelector);

  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;

    try {
      const linkPath = new URL(href, window.location.origin).pathname;

      if (currentPath.includes(linkPath)) {
        link.style.backgroundColor = "#4a4a4a";
        link.style.color = "white";

        const parentDropdown = link.closest(".has-dropdown");
        if (parentDropdown) {
          const parentLink = parentDropdown.querySelector(".navbar-link");
          if (parentLink) {
            parentLink.textContent = link.textContent.trim();
            parentLink.style.backgroundColor = "#4a4a4a";
            parentLink.style.color = "white";
          }
        }

        break;
      }
    } catch (error) {
      console.warn("Failed to process link:", href, error);
    }
  }
}

/**
 * Adds a Metadata link to the navbar if the config has a metadata URL
 * @param {Object} config - Configuration object
 */
function addMetadataLink(config) {
  if (!config || !config.metadata) return;

  const navbarStart = document.querySelector(
    "#navbarBasicExample .navbar-start",
  );
  if (!navbarStart) {
    console.warn("navbar-start not found, cannot add metadata link");
    return;
  }

  const existingMetadataLink = navbarStart.querySelector(
    "a[data-metadata-link]",
  );
  if (existingMetadataLink) {
    existingMetadataLink.href = config.metadata;
    return;
  }

  const metadataLink = document.createElement("a");
  metadataLink.className = "navbar-item";
  metadataLink.href = config.metadata;
  metadataLink.textContent = "Metadonnée";
  metadataLink.target = "_blank";
  metadataLink.rel = "noopener";
  metadataLink.setAttribute("data-metadata-link", "true");

  const directItems = Array.from(navbarStart.children).filter(
    (child) =>
      child.classList.contains("navbar-item") &&
      !child.classList.contains("has-dropdown"),
  );

  if (directItems.length > 0) {
    directItems[directItems.length - 1].insertAdjacentElement(
      "afterend",
      metadataLink,
    );
  } else {
    navbarStart.insertBefore(metadataLink, navbarStart.firstChild);
  }
}

/**
 * Enable Metrology link to the navbar if the config has enable Metrology
 * @param {Object} config - Configuration object
 */
function enableMetrology(config) {
  const metrologyLink = document.getElementById("metrology");
  if (!metrologyLink) return;

  if (!config.hasOwnProperty("metrology") || !config.metrology) {
    metrologyLink.remove();
  }
}

/**
 * Removes the intervention terrain link if not configured
 * @param {Object} config - Configuration object
 */
function enableInterventionTerrain(config) {
  const link = document.getElementById("interventionTerrainLink");
  if (!link) return;

  if (!config.interventionTerrain) {
    link.remove();
  }
}

/**
 * Initializes the header: injects HTML and highlights active link
 * Uses import.meta.url to find header.html relative to this JS module
 * @param {Object} options - Configuration options
 * @param {string} [options.targetSelector] - Container selector
 * @param {string} [options.linkSelector] - Navigation link selector
 * @returns {Promise<boolean>} Success status
 */
async function initializeHeader(options = {}) {
  const { targetSelector = "#header", linkSelector = ".navbar-item[href]" } =
    options;

  // Use import.meta.url to get the default header path relative to this JS file
  // maybe it possible to do it a different way
  const defaultHeaderPath = new URL("../../header.html", import.meta.url).href;

  const success = await injectHeader(defaultHeaderPath, targetSelector);

  if (success) {
    highlightActiveLink(linkSelector);

    // Navbar burger toggle for mobile/small screens
    document.querySelectorAll(".navbar-burger").forEach((burger) => {
      burger.addEventListener("click", () => {
        const target = document.getElementById(burger.dataset.target);
        burger.classList.toggle("is-active");
        target.classList.toggle("is-active");
      });
    });
  }

  return success;
}

export {
  initializeHeader,
  addMetadataLink,
  enableMetrology,
  enableInterventionTerrain,
};
