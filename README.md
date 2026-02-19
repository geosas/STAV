# STAV – SensorThings API Viewer

A lightweight web application for visualizing and understanding SensorThings APIs, designed to make observation data accessible to everyone.

## Table of Contents

- [Context and Motivation](#context-and-motivation)
- [Purpose](#purpose)
- [Features](#features)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Target Users and Interfaces](#target-users-and-interfaces)
- [Extensions to SensorThings](#extensions-to-sensorthings)
- [Technical Stack](#technical-stack)
- [References](#references)

## Context and Motivation

STAV (SensorThings API Viewer) is a lightweight ecosystem dedicated to the visualization and understanding of SensorThings APIs. It is part of a larger project funded by Rennes Métropole and was initially developed to share urban observation data produced within the [CityOrchestra ](https://cityorchestra.metropole.rennes.fr/) project.

In this context, physical sensors were deployed in urban areas to monitor hydrology-related parameters. The funding authority required these data to be published as open data. To collect and disseminate the observations, the [OGC SensorThings API](https://www.ogc.org/fr/standards/sensorthings/) standard was selected.

While SensorThings is well suited for machine-to-machine interoperability, it quickly appeared that it lacks tools for human understanding. The standard is primarily designed for automated systems, which makes it difficult for data producers, external users, or stakeholders unfamiliar with SensorThings to understand the structure, meaning, and provenance of the shared data.

**STAV addresses this gap.**

This project builds on the **GéoSAS** digital services ecosystem (Bera, 2013) and is inspired by previous work from UMR SAS, notably **VIDAE** (Le Henaff, 2018).
It extend the work initiated by the [SOFAIR](https://geosas.fr/sofair-book) group (Sensor Observations Findable Accessible Interoperable Reusable).

## Purpose

The goal of STAV is to facilitate the sharing and understanding of data exposed through a SensorThings API.

STAV follows the **FAIR principles** (Findable, Accessible, Interoperable, Reusable) and aims to make SensorThings data understandable by a broad audience, including users with no prior knowledge of the standard or APIs in general.

STAV was initially designed for **environmental observatories**, where the number of measurement points is limited. It is currently **not intended to visualize more than tens of thousands of measurement points** (future adaptations will make this possible).

## Features

STAV allows users to:

- Understand the data globally, without knowing SensorThings
- Identify how and where the data were produced
- Visualize observation locations on interactive maps
- Explore and visualize time series with interactive graphs
- Download datasets in CSV format
- Identify data producers and access data licensing information through links to ISO 19119 metadata (optionally)
- Sensor Monitoring

STAV provides several dedicated interfaces for different user profiles (scientists, metrologists, new users, general audience):

- **Accueil**: Explore the SensorThings service globally: measured parameters, sensors used, and locations of measurement points
- **Description des points de mesures**: View detailed information for each measurement point, including photos if available
- **Accès aux données**: Visualize time series and download observations
- **Métrologie**: Field operator tools for checking latest observations and sensor status

## Target Users and Interfaces

STAV is designed for multiple user profiles:

### General audience

- **Discovery space**: Explore locations
- **Download space**: Visualize and retrieve time series

### Field Operators and Technicians

- **Metrology page**: Quickly check latest observations and assess sensor status
- **Alert page**: Monitor threshold exceedances and identify problematic sensors

### Scientist

- **Comprehensive overview**: Understand how data are acquired (which sensor, where, etc.)
- **Metadata access**: Access information about data licensing and producers

## Deployment

STAV is not tightly coupled to any specific SensorThings service. It acts purely as a **SensorThings viewer**, capable of reading any compliant SensorThings API.

### Deployment Options

#### 1. Web Server Deployment

Copy the STAV directory to any web server:

```bash
# Copy to your web server
git clone https://github.com/geosas/STAV.git
cp -r stav /var/www/html/
chown -R www-data /var/www/html/stav
chmod -R o+r /var/www/html/stav
```

Access via: `https://your-domain.com/stav/`

#### 2. Direct from GitHub

Use STAV directly from your GitHub Pages (no hosting required).

#### 3. Local Development

Run locally using Python for test:

```bash
git clone https://github.com/geosas/STAV.git
python3 -m http.server 8000
```

Access via: `http://localhost:8000/stav/`

## Configuration

### Step 1: Register a SensorThings Service

Add an entry to `config/stav_config.json`:

```json
{
  "my service": "config/my-service.json"
}
```

### Step 2: Create the Service Configuration File

Create `config/my-service.json`:

```json
{
  "urlService": "https://my-sensorthings.org/v1.0/",
  "nameService": "My observatory",
  "mode": "simple",
  "metadata": "https://my-metadata.org/",
  "description": "My beautiful description",
  "metrology": true
}
```

**Configuration Properties:**

- `urlService` (required): Base URL of the SensorThings API endpoint
- `serviceName` (required): Display name for the service in STAV
- `description` (required): Description of the service
- `mode` (optional): Enable custom STA improvement. Use: `"stean"` for [STEAN](https://github.com/Mario-35/Stean) STA server or `"Frost_Geosas"` for GéoSAS-specific features,
- `metadata` (optional): URL (URI) to metadata record (automatically adds a "Metadonnée" link in the navbar)
- `metrology` (optional): use `true` for enable the metrology page (automatically adds a "Métrologie" link in the navbar),

### Step 3: Access STAV with Your Configuration

```
http://your-domain.com/stav/?config=config/my-service.json
```

The configuration parameter is automatically propagated across all pages.

## Extensions to SensorThings

STAV introduces optional extensions based on the customizable `properties` field of SensorThings entities. These extensions enrich the user experience while **remaining fully interoperable** : services that do not provide these additional properties remain fully usable, with reduced enrichment.

### Use of Structured Vocabularies

All added terms try to rely on structured vocabularies and are aligned as closely as possible with the SensorThings architecture. For example, `image` follows the [schema.org/image](https://schema.org/image) definition, which is a property of a Thing.

### Added Properties

#### Thing

- **`image`**: URL(s) pointing to one or more photos of the measurement location
  - Allows visual identification of measurement points in the field
  - Examples:
    ```json
    "properties": { "image": "https://example.com/photos/sensor-123.jpg" }
    ```
    ```json
    "properties": {
      "image": [
        "https://example.com/photos/sensor-1.jpg",
        "https://example.com/photos/sensor-2.jpg"
      ]
    }
    ```

#### ObservedProperty

- **`theme`**: A grouping concept used to aggregate several observed properties
  - Enables filtering and easier visualization
  - Example:
  ```json
  "properties": { "theme": "Hydrology" }
  ```

#### Datastream

- **`minValue`, `maxValue`**: Minimum and maximum threshold values
  - Used to display alert thresholds in graphs
  - Example:

  ```json
    "properties": { "minValue": 0, "maxValue": 100 }
  ```

- **`graph`**: Graph type selection (line or bar)
  - Adapts visualization to data nature
  - Example:
  ```json
  "properties": { "graph": "bar" }
  ```

These additions respond to concrete needs expressed by field operators, such as the importance of pictures to better identify and understand measurement points.

### Handling Long Time Series

Some time series are too long to be efficiently visualized or downloaded at full resolution. To address this, STAV supports **server-side aggregation** (daily or hourly averages or sums)
based on the width of the user's screen.

This mechanism is currently implemented through specific server-side extensions and will follow ODATA standards in future developments.

To activate this mode, the configuration must include:

```json
{
  "mode": "Frost_Geosas"
}
```

Alternatively, another mode is available for the STEAN server, based on an iframe with server-side graph generation.

To activate STEAN mode, the configuration must include:

```json
{
  "mode": "stean"
}
```

## Technical Stack

STAV is built with:

- **Vanilla JavaScript**
- [Dygraph](https://dygraphs.com/) - Interactive time-series graphs that can handle large datasets with ease
- [OpenLayers](https://openlayers.org/) - Interactive mapping
- [Bulma CSS](https://bulma.io/) - CSS framework

## References

- Rodéric Bera, Hervé Squividant, Genevieve Le Henaff, Pascal Pichelin, Laurent Ruiz, et al.. GeoSAS: A modular and interoperable Open Source Spatial Data Infrastructure for research. IAHS-AISH publication = International Association of Hydrological Sciences-Association Internationale des Sciences Hydrologiques publication, 2015, 368, pp.9-14. [10.5194/piahs-368-9-2015](10.5194/piahs-368-9-2015). [hal-01222416](hal-01222416)
- Genevieve Le Henaff, Hervé Squividant, Ophélie Fovet, Mikaël Faucheux, Yannick Hamon, et al.. De la mesure environnementale à sa diffusion : mise en place d’une chaîne de traitement modulaire et générique pour les données de l’Observatoire de Recherche en Environnement AgrHyS. Cahier des Techniques de l'INRA, 2018, N° Spécial: Données de la recherche, 24 p. [hal-02392180](hal-02392180)
- [OGC SensorThings API](https://www.ogc.org/standards/sensorthings)
- [FAIR Principles](https://www.go-fair.org/fair-principles/)
- [CityOrchestra](https://cityorchestra.metropole.rennes.fr/) Harmoniser les données pour la transition écologique des territoires, Rennes Métropole

---

**STAV** - Making SensorThings data accessible to everyone
