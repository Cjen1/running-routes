# Adelaide Run Finder

A static, Adelaide-only running route planner. Pick a local place, street, address or map point; choose 2–25 km; and explore several loop routes. The map displays only the selected suggestion so overlapping alternatives cannot look like a single tangled route. The page ships with local routing and scenic data. Internet access is used only for the background map tiles and optional web fonts.

## Open it

From this folder, run a simple local web server and open its URL in your browser:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`. You can also open `index.html` directly, but `localhost` is more reliable for map tiles and browser location access. The map starts with up to four 5 km suggestions from Victoria Square; search or click the map to change the start. Selecting a card highlights its route; each route has a GPX download.

## How routing uses the data

The local `data.js` contains an OpenStreetMap walking graph, scenic features, precomputed 100 m POI proximity for graph nodes and edges, POI control-point anchors, and an Adelaide place index. The browser does not scan POI geometry while searching for routes. `sources/recreation-trails.geojson` is a local extract of the South Australian Government [Recreation Trails layer](https://lsa4.geohub.sa.gov.au/server/rest/services/LSA/LocationSAViewerV34/MapServer/97). The page uses [OpenStreetMap Deutschland](https://www.openstreetmap.de/) tiles for the background map and credits both tile and data providers on the map.

Each walkable graph edge gets separate local signals for distance inside green space or on trails, distance within 100 m of a large point of interest, and distinct small points of interest within 100 m. Green polygons come from broad OSM `leisure=*`, `natural=*` and `landuse=*` green-space families; OSM `highway=path` and the local SA recreation trails count as trails. Larger features use geometry from water, park/garden, public/cultural `tourism=*`, `historic=*` and `amenity=*` objects. Small points use public-facing features from those same broad families, while routine street furniture such as benches, telephones, shelters and picnic tables is excluded. Unnamed generic amenities are excluded except fountains, and unnamed leisure features are excluded except playgrounds. Private/restricted features and obvious utility, parking and lodging tags are excluded. Named public/cultural buildings require a mapped footprint of at least 500 m²; ordinary large buildings do not count.

Green-space distance comes from paths inside mapped polygons, not proximity to each park's centre. Park boundaries also feed the large-feature proximity score, but a path already inside that park does not collect both rewards. Large-feature and green-space exposure saturate within roughly 50 m map cells, so weaving along neighbouring streets cannot repeatedly collect full points for the same frontage. Small POIs and OSM shops score once per distinct feature. Ordinary roads have no positive reward, and there is no turn score. Major roads cost 1,000 points per 100 m, major-road crossings cost 500 points each, and retracing costs 1,000 points per repeated 100 m by default. The under-distance penalty is 2,000 points per 100 m.

The enclosed-area control rewards a broad route. It computes the **external boundary** of the route's unique street segments, not a convex hull or a sum of individual loops. Attached loops contribute their combined outer area once, concavities remain, and an out-and-back spur adds no area. The external area is scaled against the largest area theoretically possible at that route length (a circle); the default maximum is 10,000 points. The calculation assumes mapped street intersections share OSM graph nodes, so grade-separated or uncoupled crossings may not form the boundary a human would draw.

The browser uses a route-space beam search. Each candidate is a closed loop defined by an ordered list of control points; the app routes each consecutive leg on the local walking graph, including the final leg back to the start. A mutation can add a point near the current route, add one at a nearby precomputed large/small POI anchor, move an existing point using either rule, or remove a point. Each child gets one mutation; the chance of another mutation in the same round falls linearly from 90% in the first round to 0% in the last, with a cap of six mutations per child. Intermediate routes are evaluated to guide the next mutation, but only the final route in a chain enters beam culling. After scoring complete loops, each round keeps half the beam by route score and fills the rest by score-weighted coverage of new 500 m map tiles. “Iterations” controls the number of mutation rounds; “beam width” controls the number of whole route candidates retained after each round. Defaults are 32 routes × 20 rounds; both controls can be raised to 100, though the broadest searches can take a long time. The suggestion cards and selected map preview update after each round; users can switch between live suggestions, download a GPX, or cancel and keep the partial results. Progress yields between mutations so the user can cancel. Point-to-point paths use a bounded 3,000-entry LRU cache. The final suggestions come from the final beam.

Each physical segment earns its positive score only once, even if retraced; distance, crossings and retracing penalties count every traversal. There is no hard ±10% distance cutoff: under/over distance incurs the configured point penalty per 100 m. Search candidates are scored as full routes (including external hull area). Final suggestions use a bounded dynamic program that keeps up to 10 competing covered-tile bitsets per selection count. Adding a route contributes its positive relative quality, `exp((route score − best score) / scale)`, times the fraction of its tiles not already covered. Raw route scores remain unchanged; the relative quality avoids letting large negative scores reverse the diversity objective. The 10-state cap makes this approximate, not globally optimal. Control-point mutations explore a flexible route space, but each leg is shortest-path routed between its control points; adding many iterations/width can be slow, and the result depends on those sampled mutations and local graph topology.

The interface starts in dark mode, with a light-mode switch. Both themes use the same OpenStreetMap background tiles; dark mode applies a colour filter to those raster tiles.

Crossing counts are inferred from transverse intersections between mapped walking segments and OSM major-road centre lines. They can miss crossings at shared endpoints or where OSM geometry is incomplete, and they do not indicate whether a crossing is controlled or safe. Check the actual route before running.

You can optionally import your own GPX tracks. The importer snaps track points to the local graph and adds the configured preference score to those segments. Files remain in the browser tab; nothing is uploaded.

The local data snapshot was built on 27 September 2026 from a [Geofabrik South Australia OSM extract](https://download.geofabrik.de/australia-oceania/australia/south-australia.html) and the SA Government trails layer. The current coverage bounds are 138.49–138.69° E and 35.035–34.835° S, covering Adelaide CBD and inner suburbs including Clovelly Park. Route data is a snapshot: check current closures and crossings before running.

## Refresh the local data

The optional build script needs Node.js and dependencies installed with `npm install`. Download a current South Australia `.osm.pbf` extract from Geofabrik, then run:

```sh
npm run build:data -- /path/to/south-australia-latest.osm.pbf
```

The build script reads the bundled SA recreation trails GeoJSON and writes a new `data.js`. To refresh that trail source, download the public, active walking features from the linked ArcGIS layer with a query constrained to the coverage bounds.

## Licence

The original application code is [MIT-licensed](LICENSE). Bundled OpenStreetMap, Government of South Australia and Leaflet material retains its own terms and attribution; see [data and third-party licences](DATA_SOURCES.md).
