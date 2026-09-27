/* Build a compact, browser-ready Adelaide walking graph from a Geofabrik OSM PBF.
   Usage: node scripts/build-data.cjs /path/to/south-australia.osm.pbf */
const fs = require('fs');
const path = require('path');
const parseOSM = require('osm-pbf-parser');

const input = process.argv[2];
if (!input) throw new Error('Pass a South Australia .osm.pbf file');
const bounds = { south: -35.035, west: 138.49, north: -34.835, east: 138.69 };
const inBounds = (lat, lon) => lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
const points = new Map();
const ways = [];
const features = [];
const shopPositions = [];
const smallPois = [];
const largePoiPoints = [];
const parkPoiPoints = [];
const places = new Map();
const namedRoads = new Map();
const trailFile = path.join(__dirname, '..', 'sources', 'recreation-trails.geojson');
const officialTrails = fs.existsSync(trailFile) ? JSON.parse(fs.readFileSync(trailFile, 'utf8')).features
  .filter(f => f.properties.trailstatus === 'ACTIVE' && /WALK/.test(f.properties.trailtype || ''))
  .map(f => ({ name: f.properties.trailname || 'Walking trail', line: f.geometry.coordinates.map(p => [p[1], p[0]]).filter(p => inBounds(p[0], p[1])) }))
  .filter(f => f.line.length > 1) : [];
let count = 0;

function addPlace(name, lat, lon, kind = 'place') {
  if (!name || !inBounds(lat, lon)) return;
  const key = name.toLowerCase();
  if (!places.has(key)) places.set(key, { name, lat, lon, kind });
}
function featureKind(t) {
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.natural === 'beach') return 'coast';
  if (t.waterway === 'river' || t.natural === 'water') return 'water';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'nature_reserve') return 'park';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'nature';
  if (t.tourism === 'attraction' || t.historic || t.artwork_type || t.tourism === 'artwork') return 'landmark';
  return null;
}
const excludedAmenities = new Set(['bench', 'telephone', 'drinking_water', 'shelter', 'parking', 'parking_entrance', 'parking_space', 'bicycle_parking', 'motorcycle_parking', 'fuel', 'charging_station', 'waste_basket', 'waste_disposal', 'recycling', 'toilets', 'vending_machine', 'post_box', 'atm', 'bank', 'bureau_de_change', 'car_wash', 'car_rental', 'car_sharing', 'taxi', 'bus_station', 'cafe', 'restaurant', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'pharmacy', 'clinic', 'doctors', 'dentist', 'hospital', 'school', 'kindergarten', 'college', 'university']);
const excludedTourism = new Set(['hotel', 'motel', 'hostel', 'guest_house', 'apartment', 'camp_site', 'caravan_site', 'chalet', 'information']);
const excludedLeisure = new Set(['picnic_table', 'outdoor_seating', 'fitness_centre', 'pitch', 'golf_course', 'sports_centre', 'sports_hall', 'stadium', 'swimming_pool', 'track']);
function publicAccess(t) { return !['private', 'no', 'customers'].includes(t.access) && !['private', 'no'].includes(t.foot); }
function greenArea(t) {
  return publicAccess(t) && (['park', 'nature_reserve'].includes(t.leisure) || t.landuse === 'recreation_ground' || ['wood', 'grassland'].includes(t.natural) || t.landuse === 'forest');
}
function poiKind(t, area = 0) {
  if (!publicAccess(t)) return null;
  if (greenArea(t)) return 'park';
  if (['river', 'stream'].includes(t.waterway) || t.natural === 'water' || t.natural === 'beach' || t.leisure === 'garden') return 'large';
  const cultural = (t.tourism && !excludedTourism.has(t.tourism)) || t.historic || t.heritage;
  const amenity = t.amenity && !excludedAmenities.has(t.amenity) && (t.name || t.amenity === 'fountain');
  const leisure = t.leisure && !excludedLeisure.has(t.leisure) && (t.name || t.leisure === 'playground');
  if (t.building && area >= 500 && t.name && (cultural || amenity)) return 'large';
  if (cultural || amenity || leisure) return area >= 500 || t.tourism === 'viewpoint' ? 'large' : 'small';
  return null;
}
function polygonArea(coords) {
  if (coords.length < 4) return 0;
  const origin = coords[0]; let area = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    area += ((a[1] - origin[1]) * (b[0] - origin[0]) - (b[1] - origin[1]) * (a[0] - origin[0])) * 91200 * 111000;
  }
  return Math.abs(area) / 2;
}
function sampleGeometry(coords, target) {
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const length = Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 91200);
    const steps = Math.max(1, Math.ceil(length / 40));
    for (let s = 0; s < steps; s++) target.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]);
  }
  if (coords.length) target.push(coords.at(-1));
}
function walkable(t) {
  const h = t.highway;
  if (!h || ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'construction', 'proposed', 'raceway'].includes(h)) return false;
  if (['private', 'no'].includes(t.access) || ['private', 'no'].includes(t.foot)) return false;
  if (t.area === 'yes') return false;
  if (h === 'cycleway' && !['yes', 'designated', 'permissive'].includes(t.foot)) return false;
  return ['footway', 'path', 'pedestrian', 'steps', 'track', 'living_street', 'residential', 'unclassified', 'service', 'tertiary', 'tertiary_link', 'cycleway'].includes(h);
}
function majorRoad(t) {
  return { motorway: 1.2, motorway_link: 1.1, trunk: 1.2, trunk_link: 1.1, primary: 1, primary_link: .9, secondary: .8, secondary_link: .7, tertiary: .4, tertiary_link: .35 }[t.highway] || 0;
}
function processItem(item) {
  count++;
  const t = item.tags || {};
  if (item.type === 'node') {
    if (!inBounds(item.lat, item.lon)) return;
    points.set(item.id, [item.lat, item.lon]);
    if (t.shop) shopPositions.push([item.lat, item.lon]);
    const poi = poiKind(t);
    if (poi === 'small') smallPois.push([item.lat, item.lon]);
    else if (poi === 'large') largePoiPoints.push([item.lat, item.lon]);
    else if (poi === 'park') parkPoiPoints.push([item.lat, item.lon]);
    const kind = featureKind(t);
    if (kind && t.name) features.push({ name: t.name, kind, lat: item.lat, lon: item.lon });
    if (t.place && t.name) addPlace(t.name, item.lat, item.lon, 'suburb');
    if (t.railway === 'station' && t.name) addPlace(t.name, item.lat, item.lon, 'station');
    if (t.name && (kind || t.amenity === 'library' || t.amenity === 'townhall')) addPlace(t.name, item.lat, item.lon);
    if (t['addr:housenumber'] && t['addr:street']) addPlace(`${t['addr:housenumber']} ${t['addr:street']}`, item.lat, item.lon, 'address');
  } else if (item.type === 'way') {
    if ((walkable(t) || majorRoad(t) || featureKind(t) || poiKind(t) || t.waterway === 'stream') && item.refs.some(id => points.has(id))) ways.push({ refs: item.refs, tags: t });
  }
}

fs.createReadStream(input).pipe(parseOSM()).on('data', batch => batch.forEach(processItem)).on('end', () => {
  const graphNodes = new Map();
  const nodes = [];
  const edges = [];
  const parkPolygons = [];
  const waterLines = [];
  const roadSegments = [];
  function nodeIndex(id) {
    if (!graphNodes.has(id)) {
      graphNodes.set(id, nodes.length);
      nodes.push(points.get(id));
    }
    return graphNodes.get(id);
  }
  for (const way of ways) {
    const t = way.tags;
    const coords = way.refs.map(id => points.get(id)).filter(Boolean);
    if (!coords.length) continue;
    const lat = coords.reduce((n, p) => n + p[0], 0) / coords.length;
    const lon = coords.reduce((n, p) => n + p[1], 0) / coords.length;
    if (t.shop && inBounds(lat, lon)) shopPositions.push([lat, lon]);
    const closed = coords.length > 3 && way.refs[0] === way.refs[way.refs.length - 1];
    const poi = poiKind(t, closed ? polygonArea(coords) : 0);
    if (poi === 'park') {
      if (closed) parkPolygons.push(coords);
      sampleGeometry(coords, parkPoiPoints);
    } else if (poi === 'large') sampleGeometry(coords, largePoiPoints);
    else if (poi === 'small') smallPois.push([lat, lon]);
    const kind = featureKind(t);
    if (kind && t.name && inBounds(lat, lon)) {
      features.push({ name: t.name, kind, lat, lon });
      addPlace(t.name, lat, lon);
    }
    if (t.waterway === 'river' || t.waterway === 'stream') waterLines.push(coords);
    if (majorRoad(t)) for (let i = 1; i < way.refs.length; i++) {
      const a = points.get(way.refs[i - 1]), b = points.get(way.refs[i]);
      if (a && b) roadSegments.push([a, b, majorRoad(t)]);
    }
    if (walkable(t)) {
      if (t.name && !namedRoads.has(t.name.toLowerCase()) && inBounds(lat, lon)) namedRoads.set(t.name.toLowerCase(), { name: t.name, lat, lon, kind: 'street' });
      for (let i = 1; i < way.refs.length; i++) {
        const a = way.refs[i - 1], b = way.refs[i];
        if (!points.has(a) || !points.has(b)) continue;
        const highway = t.highway;
        const scenic = highway === 'path' || (highway === 'track' && t.foot === 'designated') ? 1 : 0;
        const penalty = highway === 'steps' ? 2 : highway === 'tertiary' || highway === 'service' ? 1 : 0;
        edges.push([nodeIndex(a), nodeIndex(b), scenic, penalty]);
      }
    }
  }
  for (const road of namedRoads.values()) addPlace(road.name, road.lat, road.lon, road.kind);
  const uniqueFeatures = [...new Map(features.map(f => [`${f.name.toLowerCase()}:${f.kind}`, f])).values()];
  const scenery = new Uint8Array(nodes.length);
  const signals = { green: new Uint8Array(nodes.length), water: new Uint8Array(nodes.length), landmark: new Uint8Array(nodes.length), trail: new Uint8Array(nodes.length) };
  const greenInside = new Uint8Array(nodes.length), parkNear = new Uint8Array(nodes.length), largeNear = new Uint8Array(nodes.length);
  const grid = new Map();
  const cell = (lat, lon) => `${Math.floor(lat * 400)},${Math.floor(lon * 400)}`;
  function indexFeature(lat, lon, kind, value) {
    const key = cell(lat, lon);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([lat, lon, kind, value]);
  }
  const values = { park: ['green', 2.5], nature: ['green', 2.2], water: ['water', 2.4], coast: ['water', 3], viewpoint: ['landmark', 2.4], landmark: ['landmark', 1.2] };
  for (const f of uniqueFeatures) {
    const [kind, value] = values[f.kind] || ['landmark', 1];
    indexFeature(f.lat, f.lon, kind, value);
  }
  for (const line of waterLines) for (const p of line) indexFeature(p[0], p[1], 'water', 2.5);
  for (const trail of officialTrails) for (let i = 0; i < trail.line.length; i++) {
    const p = trail.line[i]; indexFeature(p[0], p[1], 'trail', 2.7);
    if (i) {
      const previous = trail.line[i - 1];
      const steps = Math.min(20, Math.ceil(Math.hypot((p[0] - previous[0]) * 111000, (p[1] - previous[1]) * 91200) / 60));
      for (let s = 1; s < steps; s++) indexFeature(previous[0] + (p[0] - previous[0]) * s / steps, previous[1] + (p[1] - previous[1]) * s / steps, 'trail', 2.7);
    }
  }
  const polygonBuckets = new Map();
  for (const poly of parkPolygons) {
    const lats = poly.map(p => p[0]), lons = poly.map(p => p[1]);
    const minY = Math.floor(Math.min(...lats) * 400), maxY = Math.floor(Math.max(...lats) * 400);
    const minX = Math.floor(Math.min(...lons) * 400), maxX = Math.floor(Math.max(...lons) * 400);
    if ((maxY - minY + 1) * (maxX - minX + 1) > 2000) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = `${y},${x}`;
      if (!polygonBuckets.has(key)) polygonBuckets.set(key, []);
      polygonBuckets.get(key).push(poly);
    }
  }
  function inside(p, poly) {
    let yes = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[0] > p[0]) !== (b[0] > p[0]) && p[1] < (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]) + a[1]) yes = !yes;
    }
    return yes;
  }
  nodes.forEach((p, i) => {
    const y = Math.floor(p[0] * 400), x = Math.floor(p[1] * 400);
    const value = { green: 0, water: 0, landmark: 0, trail: 0 };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const [lat, lon, kind, weight] of grid.get(`${y + dy},${x + dx}`) || []) {
        const metres = Math.hypot((p[0] - lat) * 111000, (p[1] - lon) * 91200);
        if (metres < 180) value[kind] = Math.max(value[kind], weight * (1 - metres / 300));
      }
    }
    for (const poly of polygonBuckets.get(`${y},${x}`) || []) if (inside(p, poly)) { value.green = Math.max(value.green, 2.7); greenInside[i] = 1; break; }
    for (const kind of Object.keys(signals)) signals[kind][i] = Math.min(255, Math.round(value[kind] * 85));
    scenery[i] = Math.max(signals.green[i], signals.water[i], signals.landmark[i], signals.trail[i]);
  });
  const proximityGrid = points => {
    const grid = new Map();
    for (const p of points) {
      const key = `${Math.floor(p[0] * 1000)},${Math.floor(p[1] * 1000)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
    }
    return grid;
  };
  const parkGrid = proximityGrid(parkPoiPoints), largeGrid = proximityGrid(largePoiPoints);
  function withinDistance(p, grid, metres) {
    const y = Math.floor(p[0] * 1000), x = Math.floor(p[1] * 1000);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      for (const q of grid.get(`${y + dy},${x + dx}`) || []) {
        if (Math.hypot((p[0] - q[0]) * 111000, (p[1] - q[1]) * 91200) <= metres) return 1;
      }
    }
    return 0;
  }
  nodes.forEach((p, i) => { parkNear[i] = withinDistance(p, parkGrid, 100); largeNear[i] = withinDistance(p, largeGrid, 100); });
  const officialTrailPoints = [];
  for (const trail of officialTrails) sampleGeometry(trail.line, officialTrailPoints);
  const officialTrailGrid = proximityGrid(officialTrailPoints);
  for (const edge of edges) {
    if (edge[2]) continue;
    const a = nodes[edge[0]], b = nodes[edge[1]];
    if (withinDistance([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], officialTrailGrid, 20)) edge[2] = 1;
  }
  // Major-road exposure is evaluated at edge midpoints, with an alignment term.
  // A short crossing is therefore much cheaper than a footpath parallel to a main road.
  const roadGrid = new Map();
  const roadCell = (lat, lon) => `${Math.floor(lat * 1000)},${Math.floor(lon * 1000)}`;
  for (const segment of roadSegments) {
    const [a, b] = segment;
    const minY = Math.floor(Math.min(a[0], b[0]) * 1000) - 1, maxY = Math.floor(Math.max(a[0], b[0]) * 1000) + 1;
    const minX = Math.floor(Math.min(a[1], b[1]) * 1000) - 1, maxX = Math.floor(Math.max(a[1], b[1]) * 1000) + 1;
    if ((maxY - minY + 1) * (maxX - minX + 1) > 250) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = `${y},${x}`;
      if (!roadGrid.has(key)) roadGrid.set(key, []);
      roadGrid.get(key).push(segment);
    }
  }
  const roadExposure = new Uint8Array(nodes.length);
  for (const edge of edges) {
    const a = nodes[edge[0]], b = nodes[edge[1]];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const vx = (b[1] - a[1]) * 91200, vy = (b[0] - a[0]) * 111000;
    const edgeLength = Math.hypot(vx, vy);
    let exposure = 0;
    for (const [r1, r2, severity] of roadGrid.get(roadCell(mid[0], mid[1])) || []) {
      const wx = (r2[1] - r1[1]) * 91200, wy = (r2[0] - r1[0]) * 111000;
      const roadLength = Math.hypot(wx, wy);
      if (!edgeLength || !roadLength) continue;
      const ax = (mid[1] - r1[1]) * 91200, ay = (mid[0] - r1[0]) * 111000;
      const t = Math.max(0, Math.min(1, (ax * wx + ay * wy) / (roadLength * roadLength)));
      const distance = Math.hypot(ax - t * wx, ay - t * wy);
      const maxDistance = severity >= 1 ? 100 : severity >= .7 ? 75 : 45;
      if (distance >= maxDistance) continue;
      const alignment = Math.abs((vx * wx + vy * wy) / (edgeLength * roadLength));
      const parallel = Math.max(0, (alignment - .35) / .65);
      exposure = Math.max(exposure, severity * (1 - distance / maxDistance) * parallel);
    }
    edge.push(Math.min(255, Math.round(exposure * 210)));
    roadExposure[edge[0]] = Math.max(roadExposure[edge[0]], edge[4]);
    roadExposure[edge[1]] = Math.max(roadExposure[edge[1]], edge[4]);
  }
  // Count transverse intersections with major-road centre lines. Parallel
  // footways beside a road do not count as crossings. A shared endpoint is
  // counted only once across the two incident walking segments.
  const crossingCounts = new Uint8Array(edges.length);
  for (const [edgeIndex, edge] of edges.entries()) {
    const a = nodes[edge[0]], b = nodes[edge[1]];
    const vx = (b[1] - a[1]) * 91200, vy = (b[0] - a[0]) * 111000;
    const length = Math.hypot(vx, vy);
    let crossings = 0;
    const crossingLocations = new Set();
    const minY = Math.floor(Math.min(a[0], b[0]) * 1000), maxY = Math.floor(Math.max(a[0], b[0]) * 1000);
    const minX = Math.floor(Math.min(a[1], b[1]) * 1000), maxX = Math.floor(Math.max(a[1], b[1]) * 1000);
    const checked = new Set();
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      for (const road of roadGrid.get(`${y},${x}`) || []) {
        if (checked.has(road)) continue;
        checked.add(road);
        const [r1, r2, severity] = road;
        if (severity < .7 || !length) continue;
        const wx = (r2[1] - r1[1]) * 91200, wy = (r2[0] - r1[0]) * 111000;
        const roadLength = Math.hypot(wx, wy);
        if (!roadLength || Math.abs((vx * wx + vy * wy) / (length * roadLength)) > .7) continue;
        const px = (r1[1] - a[1]) * 91200, py = (r1[0] - a[0]) * 111000;
        const cross = vx * wy - vy * wx;
        if (Math.abs(cross) < 1e-8) continue;
        const t = (px * wy - py * wx) / cross;
        const u = (px * vy - py * vx) / cross;
        if (t >= 0 && t < 1 && u >= 0 && u <= 1) {
          const location = Math.round(t * 10000);
          if (!crossingLocations.has(location)) { crossingLocations.add(location); crossings++; }
        }
      }
    }
    crossingCounts[edgeIndex] = Math.min(255, crossings);
  }
  // Assign each shop to one nearby walking segment so passing it gives a
  // single point reward even when the route traverses that segment twice.
  const edgeGrid = new Map();
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i], p = nodes[a], q = nodes[b];
    const key = roadCell((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    if (!edgeGrid.has(key)) edgeGrid.set(key, []);
    edgeGrid.get(key).push(i);
  }
  const shopCounts = new Uint8Array(edges.length);
  const uniqueShops = new Set();
  let assignedShops = 0;
  for (const shop of shopPositions) {
    const dedupe = `${Math.round(shop[0] * 100000)},${Math.round(shop[1] * 100000)}`;
    if (uniqueShops.has(dedupe)) continue;
    uniqueShops.add(dedupe);
    const y = Math.floor(shop[0] * 1000), x = Math.floor(shop[1] * 1000);
    let nearest = -1, best = 80;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      for (const index of edgeGrid.get(`${y + dy},${x + dx}`) || []) {
        const [a, b] = edges[index], p = nodes[a], q = nodes[b];
        const vx = (q[1] - p[1]) * 91200, vy = (q[0] - p[0]) * 111000;
        const wx = (shop[1] - p[1]) * 91200, wy = (shop[0] - p[0]) * 111000;
        const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
        const d = Math.hypot(wx - t * vx, wy - t * vy);
        if (d < best) { best = d; nearest = index; }
      }
    }
    if (nearest >= 0) { shopCounts[nearest] = Math.min(255, shopCounts[nearest] + 1); assignedShops++; }
  }
  for (let i = 0; i < edges.length; i++) edges[i].push(shopCounts[i], crossingCounts[i]);
  const uniqueSmallPois = [...new Map(smallPois.map(p => [`${Math.round(p[0] * 100000)},${Math.round(p[1] * 100000)}`, p])).values()];
  const uniqueLargePois = [...new Map(largePoiPoints.map(p => [`${Math.round(p[0] * 10000)},${Math.round(p[1] * 10000)}`, p])).values()];
  const smallGrid = new Map();
  uniqueSmallPois.forEach((p, id) => {
    const key = roadCell(p[0], p[1]);
    if (!smallGrid.has(key)) smallGrid.set(key, []);
    smallGrid.get(key).push(id);
  });
  let smallAttributions = 0;
  for (const edge of edges) {
    const p = nodes[edge[0]], q = nodes[edge[1]];
    const minY = Math.floor(Math.min(p[0], q[0]) * 1000) - 2, maxY = Math.floor(Math.max(p[0], q[0]) * 1000) + 2;
    const minX = Math.floor(Math.min(p[1], q[1]) * 1000) - 2, maxX = Math.floor(Math.max(p[1], q[1]) * 1000) + 2;
    const vx = (q[1] - p[1]) * 91200, vy = (q[0] - p[0]) * 111000, size = vx * vx + vy * vy;
    const nearby = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) for (const id of smallGrid.get(`${y},${x}`) || []) {
      const spot = uniqueSmallPois[id], wx = (spot[1] - p[1]) * 91200, wy = (spot[0] - p[0]) * 111000;
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (size || 1)));
      if (Math.hypot(wx - t * vx, wy - t * vy) <= 100) nearby.push(id);
    }
    if (nearby.length) { edge[7] = nearby; smallAttributions += nearby.length; }
  }
  const output = { source: 'OpenStreetMap contributors via Geofabrik South Australia extract; SA Government Recreation Trails', built: new Date().toISOString().slice(0, 10), bounds, nodes, edges, scenery: [...scenery], signals: { ...Object.fromEntries(Object.entries(signals).map(([kind, values]) => [kind, [...values]])), greenInside: [...greenInside], parkNear: [...parkNear], largeNear: [...largeNear] }, smallPoiCount: uniqueSmallPois.length, poiAnchors: { small: uniqueSmallPois, large: uniqueLargePois }, roadExposure: [...roadExposure], features: uniqueFeatures, trails: officialTrails, places: [...places.values()] };
  const file = path.join(__dirname, '..', 'data.js');
  fs.writeFileSync(file, 'window.ADELAIDE_DATA = ' + JSON.stringify(output) + ';\n');
  console.log(`Read ${count} OSM objects; wrote ${nodes.length} route nodes, ${edges.length} edges (${assignedShops} shops assigned, ${smallAttributions} small-POI attributions), ${roadSegments.length} major-road segments, ${uniqueFeatures.length} scenic features, ${officialTrails.length} official trails, ${places.size} searchable places to ${file}`);
}).on('error', err => { throw err; });
