/**
 * SensorThings API Utility Module
 * Provides buildQuery (URL construction) and fetch (unified download
 * for differents formats) for SensorThings API
 */

/**
 * Builds a SensorThings API query URL with parameters
 * @param {string} baseUrl - Base URL of the service
 * @param {string} entity - Entity path (e.g., 'Things', 'Datastreams(1)/Observations', 'Things(5)')
 * @param {Object} [options] - Query options (STA)
 * @param {string} [options.select] - Fields to select
 * @param {string} [options.expand] - Related entities to expand (supports nested syntax)
 * @param {string} [options.filter] - OData filter expression
 * @param {string} [options.orderby] - Order by clause
 * @param {number} [options.top] - Limit results
 * @param {number} [options.skip] - Skip results
 * @param {boolean} [options.count] - Include count
 * @param {string} [options.resultFormat] - Result format ('dataArray', 'csv')
 * @param {string} [options.groupby] - Aggregation grouping ('day', 'hour', 'day,SUM', 'hour,SUM')
 * @returns {string} Complete query URL
 */
function buildQuery(baseUrl, entity, options = {}) {
  const params = new URLSearchParams();

  if (options.select) params.append("$select", options.select);
  if (options.expand) params.append("$expand", options.expand);
  if (options.filter) params.append("$filter", options.filter);
  if (options.orderby) params.append("$orderby", options.orderby);
  //careful 0 is false
  if (options.top !== undefined) params.append("$top", options.top.toString());
  if (options.skip) params.append("$skip", options.skip.toString());
  if (options.count) params.append("$count", "true");
  if (options.resultFormat)
    params.append("$resultFormat", options.resultFormat);
  if (options.groupby) params.append("$groupby", options.groupby);
  const queryString = params.toString().replace(/\+/g, "%20");

  return `${baseUrl}/${entity}${queryString ? "?" + queryString : ""}`;
}

/**
 * Fetches DataArray format responses with optional record limit
 * @param {string} url - Full URL to the DataArray endpoint
 * @param {number|null} maxRecords - Maximum records to fetch (null = unlimited)
 * @returns {Promise<{dataArray: Array, components: Array, limitReached: boolean}>}
 */
async function _fetchDataArray(url, maxRecords = null) {
  const allDataArrays = [];
  let components = null;
  let nextLink = url;
  let limitReached = false;

  try {
    while (
      nextLink &&
      (maxRecords === null || allDataArrays.length < maxRecords)
    ) {
      const response = await fetch(nextLink);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!components && data.value && data.value.length > 0) {
        components = data.value[0].components || [];
      }

      if (data.value && Array.isArray(data.value)) {
        data.value.forEach((item) => {
          if (item.dataArray && Array.isArray(item.dataArray)) {
            if (maxRecords !== null) {
              const remaining = maxRecords - allDataArrays.length;
              if (remaining > 0) {
                allDataArrays.push(...item.dataArray.slice(0, remaining));
              }
            } else {
              allDataArrays.push(...item.dataArray);
            }
          }
        });
      }

      if (maxRecords !== null && allDataArrays.length >= maxRecords) {
        limitReached = true;
        break;
      }

      nextLink = data["@iot.nextLink"] || null;
    }

    return {
      dataArray: allDataArrays,
      components: components || [],
      limitReached,
    };
  } catch (error) {
    console.error("Failed to fetch DataArray:", error);
    return {
      dataArray: [],
      components: [],
      limitReached: false,
    };
  }
}

/**
 * Unified fetch function for SensorThings API
 * Auto-detects response format from URL:
 *   - $resultFormat=dataArray → {dataArray, components, limitReached}
 *   - $resultFormat=csv → text string
 *   - Response with 'value' array → paginated entity array
 *   - No 'value' array → single entity object
 *
 * @param {string} url - Full URL (from buildQuery)
 * @param {{paginate?: boolean, maxRecords?: number|null}=} options - Fetch options
 *   - `paginate` (default `true`) - Follow @iot.nextLink
 *   - `maxRecords` (default `null`) - Stop after N records, DataArray only
 * @returns {Promise<Array|Object|string|{dataArray: any[], components: any, limitReached: boolean}>}
 */
async function fetchSTA(url, options = {}) {
  const { paginate = true, maxRecords = null } = options;

  if (
    url.includes("$resultFormat=dataArray") ||
    url.includes("%24resultFormat=dataArray")
  ) {
    return _fetchDataArray(url, maxRecords);
  }

  if (
    url.includes("$resultFormat=csv") ||
    url.includes("%24resultFormat=csv")
  ) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      console.error("Failed to fetch CSV:", error);
      throw error;
    }
  }

  const allData = [];
  let currentUrl = url;

  try {
    do {
      const response = await fetch(currentUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.value && Array.isArray(data.value)) {
        allData.push(...data.value);
        currentUrl = paginate ? data["@iot.nextLink"] || null : null;
      } else {
        return data;
      }
    } while (currentUrl);

    return allData;
  } catch (error) {
    console.error(`Failed to fetch from SensorThings API:`, error);
    throw error;
  }
}

/**
 * Gets the count of entities (convenience wrapper)
 * @param {string} baseUrl - Base URL of the SensorThings service
 * @param {string} entity - Entity path (e.g., 'Things', 'Datastreams(1)/Observations')
 * @param {string} filter - Optional $filter expression
 * @returns {Promise<number>} Count of entities (0 on error)
 */
async function getCount(baseUrl, entity, filter = "") {
  if (!baseUrl) {
    throw new Error("SensorThings API base URL is not configured");
  }

  const url = buildQuery(baseUrl, entity, {
    count: true,
    top: 0,
    filter: filter || undefined,
  });
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data["@iot.count"] || 0;
  } catch (error) {
    console.error(`Failed to get count for ${entity}:`, error);
    return 0;
  }
}

export { buildQuery, fetchSTA, getCount };
