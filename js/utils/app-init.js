/**
 * Application Initialization Module
 * For header loading and configuration setup.
 *
 */

import {
  initializeHeader,
  addMetadataLink,
  enableMetrology,
  enableInterventionTerrain,
} from "./header.js";
import { loadConfiguration } from "./config.js";

let configPromise = null;

/**
 * Initializes the application: header injection then configuration loading.
 * @returns {Promise<Object|null>} App configuration or null on failure
 */
async function initialize() {
  const headerOk = await initializeHeader();
  if (!headerOk) {
    console.error("Header init failed");
    return null;
  }

  const { configName, data } = await loadConfiguration();

  if (!configName) {
    console.warn("Application initialized without configuration");
    return {
      urlService: null,
      nameService: null,
      modeService: null,
      configFileName: null,
      metadata: null,
      description: null,
      metrology: null,
      interventionTerrain: null,
    };
  }

  const appConfig = {
    urlService: data?.urlService || null,
    nameService: data?.nameService || null,
    modeService: data?.mode || null,
    configFileName: configName,
    metadata: data?.metadata || null,
    description: data?.description || null,
    metrology: data?.metrology || null,
    interventionTerrain: data?.interventionTerrain || null,
  };

  addMetadataLink(appConfig);
  enableMetrology(appConfig);
  enableInterventionTerrain(appConfig);

  return appConfig;
}

/**
 * Returns a promise that resolves with the app configuration.
 * The initialization runs only once (cached promise).
 * @returns {Promise<Object>} App configuration
 */
export function waitForAppReady() {
  if (!configPromise) configPromise = initialize();
  return configPromise;
}
