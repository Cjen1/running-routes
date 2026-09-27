# Data and third-party licences

The [MIT licence](LICENSE) covers the application's original code and documentation. It does not replace the licences for the geographic data or vendored Leaflet assets.

- `data.js` contains data derived from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database Licence (ODbL 1.0)](https://opendatacommons.org/licenses/odbl/1-0/). The OSM extract was obtained from [Geofabrik's South Australia download](https://download.geofabrik.de/australia-oceania/australia/south-australia.html). The graph-building method is in `scripts/build-data.cjs`.
- `sources/recreation-trails.geojson` and the corresponding trail features in `data.js` are from the Government of South Australia, *Recreation Trails*, sourced on 27 September 2026 from the [Location SA Recreation Trails layer](https://lsa4.geohub.sa.gov.au/server/rest/services/LSA/LocationSAViewerV34/MapServer/97). The source site states a [CC BY 4.0 licence and attribution requirement](https://location.sa.gov.au/viewer/copyright.html). The Government of South Australia does not endorse this application.
- `vendor/leaflet/` retains its own [BSD-2-Clause licence](vendor/leaflet/LICENSE).
- Background map tiles are served by OpenStreetMap Deutschland and are not bundled in this repository. The map displays tile and OSM-data attribution.

The geographic snapshot was built on 27 September 2026. Rebuild it from current source data to account for later changes to paths, access and crossings.
