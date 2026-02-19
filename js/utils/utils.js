/**
 * General Utility Functions
 * Common helpers used across the application
 */

// Use import.meta.url to get the default header path relative to this JS file
// maybe it possible to do it a different way
export const BASE_URL = new URL('../..', import.meta.url).href;

/**
 * Gets a query parameter from the current URL
 * @param {string} param - Parameter name
 * @returns {string|null} Parameter value or null
 */
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

/**
 * Formats a date in locale  date code with full details
 * @param {string|Date} dateInput - Date to format
 * * @param {Object} [options] - Intl.DateTimeFormat options (optional)
 * @returns {string} Formatted date string
 */
function parseDate(
  dateInput,
  options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  },
) {
  if (!dateInput) {
    return "Pas d'enregistrement";
  }

  const date = new Date(dateInput);

  if (isNaN(date.getTime())) {
    return "Date invalide";
  }
  // undefined  for have the locale date code
  return date.toLocaleDateString(undefined, options);
}

/**
 * Formats a time difference between two dates in a human-readable (french) format
 * @param {Date} endDate - Earlier date
 * @param {Date} nowDate - Current/later date
 * @returns {string} Formatted time difference (e.g., "3 jours", "2 h", "45 min")
 */
function formatTimeAgo(endDate, nowDate = new Date()) {
  const ecartMs = nowDate.getTime() - endDate.getTime();

  if (ecartMs < 0) {
    return "dans le futur";
  }

  if (ecartMs < 60 * 1000) {
    // Less than 1 minute
    const seconds = Math.floor(ecartMs / 1000);
    return `${seconds} s`;
  }

  if (ecartMs < 60 * 60 * 1000) {
    // Less than 1 hour
    const minutes = Math.floor(ecartMs / (60 * 1000));
    return `${minutes} min`;
  }

  if (ecartMs < 24 * 60 * 60 * 1000) {
    // Less than 24 hours
    const hours = Math.floor(ecartMs / (60 * 60 * 1000));
    return `${hours} h`;
  }

  // More than a day
  const days = Math.floor(ecartMs / (24 * 60 * 60 * 1000));
  return `${days} jour${days !== 1 ? "s" : ""}`;
}

/**
 * Escapes HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (typeof str !== "string") {
    return str;
  }

  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };

  return str.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Debounces one or multiple function (for the filter function,let user time to type)
 * @param {Function|Function[]} funcs - Function to debounce or array of function
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(funcs, wait = 300) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (Array.isArray(funcs)) {
        funcs.forEach((f) => f(...args));
      } else {
        funcs(...args);
      }
    }, wait);
  };
}

/**
 * Creates a DOM element with attributes and children
 * @param {string} tag - HTML tag name
 * @param {Object} attributes - Element attributes
 * @param {Array|string} children - Child elements or text content
 * @returns {HTMLElement} Created element
 */
function createElement(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);

  // Set attributes
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === "className") {
      element.className = value;
    } else if (key === "style" && typeof value === "object") {
      Object.assign(element.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.substring(2).toLowerCase(), value);
    } else {
      element.setAttribute(key, value);
    }
  });

  // Add children
  if (typeof children === "string") {
    element.textContent = children;
  } else if (Array.isArray(children)) {
    children.forEach((child) => {
      if (typeof child === "string") {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof HTMLElement) {
        element.appendChild(child);
      }
    });
  }

  return element;
}

/**
 * Downloads data as a file
 * @param {Array} chunks - Data to download
 * @param {string} filename - Name of the file
 */
function downloadFile(chunks, filename) {
  const mimeType = filename.endsWith(".geojson")
    ? "application/geo+json"
    : "text/csv";
  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Parses phenomenon time range from SensorThings format
 * maybe put it in sta-api.js
 * @param {string} phenomenonTime - Time range string (e.g., "2024-01-01T00:00:00Z/2024-12-31T23:59:59Z")
 * @returns {{start: string, end: string}} Start and end times
 */
function parsePhenomenonTime(phenomenonTime) {
  if (!phenomenonTime) {
    return { start: "", end: "" };
  }

  const parts = phenomenonTime.split("/");
  return {
    start: parts[0] || "",
    end: parts[1] || "",
  };
}

/**
 * Shows a notification message, in bulma style
 * @param {string} message - Message to display
 * @param {string} type - Type of notification ('success', 'warning', 'danger', 'info')
 * @param {number} duration - Duration in ms (0 = permanent)
 */
function showNotification(message, type = "info", duration = 3000) {
  const notification = document.createElement("div");
  notification.className = `notification is-${type}`;
  notification.style.position = "fixed";
  notification.style.top = "20px";
  notification.style.right = "20px";
  notification.style.zIndex = "9999";
  notification.style.minWidth = "300px";
  notification.textContent = message;

  document.body.appendChild(notification);

  if (duration > 0) {
    setTimeout(() => {
      notification.remove();
    }, duration);
  }

  return notification;
}

/**
 * Show a Bulma modal with custom content and buttons
 * @param {Object} options
 * @param {string} options.title - Titre du modal
 * @param {string|HTMLElement} options.body - Contenu du modal (texte ou HTML)
 * @param {Array} options.buttons - Liste des boutons [{text:'Continuer', class:'is-success', onClick:()=>{}}]
 */
function showModal({ title = "Info", body = "", buttons = [] }) {
  // Créer le modal
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
        <div class="modal-background"></div>
        <div class="modal-card">
            <header class="modal-card-head">
                <p class="modal-card-title">${title}</p>
                <button class="delete" aria-label="close"></button>
            </header>
            <section class="modal-card-body"></section>
            <footer class="modal-card-foot"></footer>
        </div>
    `;

  // Ajouter le contenu
  const bodyEl = modal.querySelector(".modal-card-body");
  if (typeof body === "string") {
    bodyEl.textContent = body;
  } else {
    bodyEl.appendChild(body);
  }

  // Ajouter les boutons
  const footerEl = modal.querySelector(".modal-card-foot");
  const buttonsWrapper = document.createElement("div");
  buttonsWrapper.className = "buttons";
  buttons.forEach((btn) => {
    const b = document.createElement("button");
    b.className = "button " + (btn.class || "");
    b.textContent = btn.text || "OK";
    b.addEventListener("click", () => {
      if (btn.onClick) btn.onClick();
      document.body.removeChild(modal); // fermer modal
    });
    buttonsWrapper.appendChild(b);
  });
  footerEl.appendChild(buttonsWrapper);
  // Fermer avec background ou croix
  modal
    .querySelector(".modal-background")
    .addEventListener("click", () => document.body.removeChild(modal));
  modal
    .querySelector(".delete")
    .addEventListener("click", () => document.body.removeChild(modal));

  // Ajouter au DOM
  document.body.appendChild(modal);
  modal.classList.add("is-active");
}

/**
 * Filters the thing list in bulma cards based on search input
 */
function filterCards() {
  const input = document.getElementById("searchInput");
  const filter = input.value.toUpperCase();
  const cards = document.querySelectorAll("#formContainer .column");

  cards.forEach((card) => {
    const contentDiv = card.querySelector(".content");
    if (!contentDiv) return;

    const textToSearch = contentDiv.innerText.toUpperCase();

    card.style.display = textToSearch.includes(filter) ? "" : "none";
  });
}

/**
 * Concatenate multiple Uint8Array
 * @param {Uint8Array[]} arrays
 * @returns {Uint8Array}
 */
function concatUint8Arrays(arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Fetches a URL using streaming, displaying the transfer size in real-time
 * next to a reference element (e.g., a progress bar).
 * @param {string} url - URL to fetch
 * @param {HTMLElement|null} refElement - Element next to which the size label is inserted
 * @param {string} [label=''] - Optional prefix label (e.g., datastream name)
 * @returns {Promise<Uint8Array[]>} An array of chunks (Uint8Array) representing the response body
 */
async function fetchStreamWithSize(url, refElement, label = "") {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  let sizeLabel = null;
  if (refElement) {
    sizeLabel = document.createElement("span");
    sizeLabel.style.fontWeight = "bold";
    sizeLabel.style.marginLeft = "8px";
    refElement.insertAdjacentElement("afterend", sizeLabel);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  const prefix = label ? `${label} : ` : "";
  let lastUpdate = performance.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;

    if (sizeLabel && performance.now() - lastUpdate > 1000) {
      sizeLabel.textContent = `${prefix}${(receivedBytes / 1048576).toFixed(2)} Mo`;
      lastUpdate = performance.now();
    }
  }

  if (sizeLabel) sizeLabel.remove();

  return chunks;
}

export {
  getQueryParam,
  parseDate,
  formatTimeAgo,
  escapeHtml,
  debounce,
  createElement,
  downloadFile,
  parsePhenomenonTime,
  showNotification,
  showModal,
  filterCards,
  fetchStreamWithSize,
  concatUint8Arrays,
};
