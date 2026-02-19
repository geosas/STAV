/**
 * Configuration Management Module
 * Handles loading and managing the JSON application configuration
 * from the URL parameters config
 *
 */
/**

/**
 * Fetches and parses a configuration JSON file
 * @param {string} configUrl - URL of the configuration file
 * @returns {Promise<Object|null>} Configuration object or null on error
 */
async function fetchConfigFile(configUrl) {
  try {
    const response = await fetch(configUrl);
    if (!response.ok) {
      console.error(
        `Failed to load config file: ${configUrl} (Status: ${response.status})`,
      );
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching config:", error);
    return null;
  }
}

/**
 * Ensures the config parameter is present in the URL
 * ceinture et bretelle old code but i keep it in case
 * @param {string} configName - Configuration file name
 */
function ensureConfigInUrl(configName) {
  if (!configName) return;

  const currentUrl = new URL(window.location.href);
  if (!currentUrl.searchParams.has("config")) {
    currentUrl.searchParams.set("config", configName);
    history.replaceState(null, "", currentUrl.toString());
  }
}

/**
 * Adds the config parameter to all navigation links
 * @param {string} configName - Configuration file name
 * @param {string} selector - CSS selector for links to update (default: '.navbar-item[href]')
 */
function propagateConfigToLinks(configName, selector = ".navbar-item[href]") {
  if (!configName) return;

  const links = document.querySelectorAll(selector);
  links.forEach((link) => {
    try {
      const url = new URL(link.href, window.location.origin);
      url.searchParams.set("config", configName);
      link.href = url.toString();
    } catch (error) {
      console.warn("Failed to update link:", link.href, error);
    }
  });
}

/**
 * Loads and initializes the application configuration
 * Priority: URL parameter > sessionStorage
 * @returns {Promise<Object>} { configName, data }
 */
async function loadConfiguration() {
  const urlParams = new URLSearchParams(window.location.search);
  const configFromUrl = urlParams.get("config");

  if (configFromUrl) {
    sessionStorage.setItem("config", configFromUrl);
  }

  const configName = configFromUrl || sessionStorage.getItem("config");

  if (!configName) {
    console.warn("No configuration parameter found in URL or sessionStorage");
    return { configName: null, data: null };
  }

  ensureConfigInUrl(configName);

  const configData = await fetchConfigFile(configName);

  if (!configData) {
    console.warn(`Failed to load configuration from: ${configName}`);
    return { configName, data: null };
  }

  propagateConfigToLinks(configName);

  return {
    configName,
    data: configData,
  };
}

export { loadConfiguration };
