(() => {
  'use strict';
  const data = window.ADELAIDE_DATA;
  const $ = id => document.getElementById(id);
  const status = $('status');
  if (!data || !window.L || !window.createBeamEngine) { status.textContent = 'Map or routing data could not load.'; return; }
  const engine = createBeamEngine(data), coords = data.nodes;
  const popularity = new Uint8Array(coords.length);
  const km = (a, b) => Math.hypot((a[0] - b[0]) * 111.1, (a[1] - b[1]) * 91.2);
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const darkMode = () => document.documentElement.dataset.theme === 'dark';
  function updateThemeButton() {
    const button = $('theme-toggle');
    button.textContent = darkMode() ? '☀ Light' : '☾ Dark';
    button.setAttribute('aria-label', `Switch to ${darkMode() ? 'light' : 'dark'} mode`);
  }
  updateThemeButton();
  $('theme-toggle').addEventListener('click', () => {
    document.documentElement.dataset.theme = darkMode() ? 'light' : 'dark';
    updateThemeButton();
    routeLayer.eachLayer(layer => { if (layer.setStyle) layer.setStyle({ color: $('route-legend-line').classList.contains('preview') ? (darkMode() ? '#f2b854' : '#bd8a36') : (darkMode() ? '#57d7a2' : '#1d805b') }); });
  });
  const map = L.map('map', { zoomControl: false, minZoom: 11, maxZoom: 18 }).setView([-34.929, 138.601], 13);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.de/tiles/osmde/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · tiles: <a href="https://www.openstreetmap.de/">OSM DE</a>'
  }).addTo(map);
  const trailLayer = L.layerGroup().addTo(map), featureLayer = L.layerGroup().addTo(map), routeLayer = L.layerGroup().addTo(map), startLayer = L.layerGroup().addTo(map);
  let startPoint = [-34.929, 138.601], selectedLabel = '', currentRoutes = [], selected = 0, selectedId = null, overlayShown = true, liveSearchActive = false;
  const notableCache = new Map();
  const startIcon = L.divIcon({ className: '', html: '<div class="start-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
  function setStart(point, label) {
    startPoint = point; selectedLabel = label; $('start').value = label; $('suggestions').hidden = true;
    startLayer.clearLayers(); L.marker(point, { icon: startIcon }).addTo(startLayer).bindPopup('Start here');
    map.panTo(point); $('map-tip').textContent = 'Start set · choose a distance and find routes';
  }
  function renderFeatures() {
    featureLayer.clearLayers(); trailLayer.clearLayers();
    if (!overlayShown) { $('overlay-count').textContent = ''; return; }
    const bounds = map.getBounds().pad(.08);
    for (const trail of data.trails || []) {
      if (!trail.line.some(p => bounds.contains(p))) continue;
      L.polyline(trail.line, { color: '#52a39a', weight: 2.5, opacity: .6, interactive: true }).addTo(trailLayer).bindPopup(`<strong>${escapeHtml(trail.name)}</strong><br>SA Government recreation trail`);
    }
    const seen = new Set(); let count = 0;
    for (const f of data.features) {
      if (count >= 220 || !bounds.contains([f.lat, f.lon])) continue;
      const key = f.name.toLowerCase(); if (seen.has(key)) continue;
      seen.add(key); count++;
      L.circleMarker([f.lat, f.lon], { radius: 4, weight: 1.5, color: '#fff', fillColor: f.kind === 'water' ? '#65a9a7' : '#87aa6f', fillOpacity: .85 })
        .addTo(featureLayer).bindPopup(`<strong>${escapeHtml(f.name)}</strong><br>${escapeHtml(f.kind)}`);
    }
    $('overlay-count').textContent = count ? `(${count})` : '';
  }
  function notable(path) {
    if (!path.length) return [];
    const sample = path.filter((_, i) => i % 5 === 0).map(i => coords[i]);
    const chosen = [];
    for (const f of data.features) {
      if (km(coords[path[0]], [f.lat, f.lon]) < .3) continue;
      if (sample.some(p => km(p, [f.lat, f.lon]) < .16)) chosen.push(f);
    }
    const priority = { water: 5, viewpoint: 5, park: 4, nature: 4, coast: 4, landmark: 2 };
    chosen.sort((a, b) => (priority[b.kind] || 0) - (priority[a.kind] || 0));
    return chosen.filter((f, i) => chosen.findIndex(g => g.name === f.name) === i).slice(0, 4);
  }
  function drawRoute(index) {
    selected = index; routeLayer.clearLayers();
    $('route-legend-line').classList.remove('preview'); $('route-legend-label').textContent = 'Selected route';
    const active = currentRoutes[index];
    if (active) {
      L.polyline(active.path.map(n => coords[n]), { color: darkMode() ? '#57d7a2' : '#1d805b', weight: 5, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
      map.fitBounds(L.latLngBounds(active.path.map(n => coords[n])).pad(.18), { maxZoom: 15, padding: [26, 26] });
      $('map-tip').textContent = `Showing Route ${index + 1} only · choose another suggestion to compare`;
    }
    document.querySelectorAll('.route-card').forEach((card, i) => card.classList.toggle('active', i === index));
  }
  let previewFitted = false;
  function drawLivePreview(route, index = 0) {
    if (!route) return;
    selected = index;
    routeLayer.clearLayers();
    const points = route.path.map(n => coords[n]);
    L.polyline(points, { color: darkMode() ? '#f2b854' : '#bd8a36', weight: 5, opacity: .9, dashArray: '8 6', lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    $('route-legend-line').classList.add('preview'); $('route-legend-label').textContent = `Live Route ${index + 1}`;
    if (!previewFitted) { map.fitBounds(L.latLngBounds(points).pad(.18), { maxZoom: 15, padding: [26, 26] }); previewFitted = true; }
    $('map-tip').textContent = `Live Route ${index + 1} · suggestions update as the search runs`;
    document.querySelectorAll('.route-card').forEach((card, i) => card.classList.toggle('active', i === index));
  }
  function gpx(route, index) {
    const points = route.path.map(n => `<trkpt lat="${coords[n][0]}" lon="${coords[n][1]}"></trkpt>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Adelaide Run Finder" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Adelaide route ${index + 1}</name><trkseg>${points}</trkseg></trk></gpx>`;
  }
  function renderResultCards(routes) {
    currentRoutes = routes;
    const pinnedIndex = selectedId === null ? -1 : routes.findIndex(route => route.id === selectedId);
    if (pinnedIndex < 0) selectedId = null;
    selected = pinnedIndex < 0 ? 0 : pinnedIndex;
    const container = $('results'); container.replaceChildren();
    $('result-count').textContent = `${routes.length} route${routes.length === 1 ? '' : 's'}${liveSearchActive ? ' · updating' : ''}`;
    routes.forEach((route, i) => {
      const card = document.createElement('div'); card.className = 'route-card'; card.tabIndex = 0; card.setAttribute('role', 'button');
      if (!notableCache.has(route.id)) notableCache.set(route.id, notable(route.path).slice(0, 3).map(f => escapeHtml(f.name)).join(' · '));
      const names = notableCache.get(route.id);
      card.innerHTML = `<div class="route-top"><span class="route-title">Route ${i + 1}</span><span class="route-badge">${Math.round(route.score)} points</span></div><div class="route-meta"><span>↝ ${route.length.toFixed(1)} km</span><span>${route.area.toFixed(2)} km² approx. area</span><span>${route.crossings} major-road crossings</span><span>${Math.round(route.repeated * 100)}% retraced</span><span>${Math.round(route.road * 100)}% near big roads</span></div><div class="route-features">${names || 'Local paths and streets'}</div><div class="route-actions"><a href="#" download="adelaide-route-${i + 1}.gpx">Download GPX ↓</a></div>`;
      const link = card.querySelector('a');
      link.addEventListener('click', event => {
        event.stopPropagation();
        const url = URL.createObjectURL(new Blob([gpx(route, i)], { type: 'application/gpx+xml' }));
        link.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      });
      const choose = () => {
        selectedId = route.id;
        if (liveSearchActive) { previewFitted = false; drawLivePreview(currentRoutes[i], i); }
        else drawRoute(i);
      };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(); } });
      container.append(card);
    });
  }
  function showResults(routes, target, info) {
    liveSearchActive = false;
    renderResultCards(routes);
    status.textContent = routes.length ? `Routes aiming for ${target} km · ${info.evaluated.toLocaleString()} evaluated (${info.legCacheHits.toLocaleString()} cached leg lookups).` : 'No loop found. Try another start, distance, wider beam or more iterations.';
    if (routes.length) drawRoute(selected);
    else { routeLayer.clearLayers(); $('route-legend-line').classList.remove('preview'); $('route-legend-label').textContent = 'Selected route'; }
  }
  const search = $('start'), distanceInput = $('distance'), beamInput = $('beam-width'), iterationInput = $('iterations');
  let searchGeneration = 0;
  function updateBeamLimit() {
    beamInput.max = '100';
    beamInput.value = String(Math.min(100, Number(beamInput.value) || 32));
    $('beam-value').value = beamInput.value;
  }
  function currentScores() {
    return Object.fromEntries([...document.querySelectorAll('[data-score]')].map(input => [input.dataset.score, Math.max(0, Math.min(Number(input.max), Number(input.value) || 0))]));
  }
  async function findRoutes() {
    if (search.value.trim() !== selectedLabel) {
      const typed = search.value.trim();
      const match = data.places.find(p => p.name.toLowerCase() === typed.toLowerCase());
      if (match) setStart([match.lat, match.lon], match.name);
      else if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(typed)) setStart(typed.split(',').map(Number), typed);
      else { status.textContent = 'Select a suggested place or click the map to set your start.'; return; }
    }
    const target = Number(distanceInput.value);
    if (!Number.isFinite(target) || target < 2 || target > 25) { status.textContent = 'Enter a distance from 2 to 25 km.'; return; }
    updateBeamLimit();
    const snapped = engine.nearest(startPoint);
    if (snapped.distance > .6) { status.textContent = 'That start is too far from a mapped running path. Choose an Adelaide point.'; return; }
    const generation = ++searchGeneration;
    $('find').disabled = true; $('cancel-search').hidden = false;
    liveSearchActive = true; selected = 0; selectedId = null; currentRoutes = []; notableCache.clear();
    $('results').replaceChildren(); $('result-count').textContent = '0 routes · updating';
    previewFitted = false; routeLayer.clearLayers(); $('route-legend-line').classList.add('preview'); $('route-legend-label').textContent = 'Searching';
    status.textContent = 'Preparing the local walking graph…';
    try {
      const result = await engine.generate(snapped.node, target, currentScores(), Number(beamInput.value), Number(iterationInput.value), popularity, {
        cancelled: () => generation !== searchGeneration,
        onProgress: progress => {
          if (generation !== searchGeneration) return;
          renderResultCards(progress.suggestions);
          drawLivePreview(currentRoutes[selected] || progress.best, selected);
          const best = progress.best ? ` · best ${progress.best.length.toFixed(1)} km` : '';
          status.textContent = `Mutation round ${progress.round}/${progress.iterations} · ${Math.round(progress.continuationChance * 100)}% repeat chance · ${progress.width} routes in beam · ${progress.evaluated} evaluated${best} · suggestions updating`;
        }
      });
      if (generation !== searchGeneration) return;
      showResults(result.routes, target, result.search);
    } catch (error) {
      console.error(error);
      if (generation === searchGeneration) {
        liveSearchActive = false; renderResultCards(currentRoutes);
        if (currentRoutes.length) drawRoute(selected);
        else routeLayer.clearLayers();
        status.textContent = 'Could not finish calculating routes. Any suggestions shown are partial.';
      }
    } finally {
      if (generation === searchGeneration) { $('find').disabled = false; $('cancel-search').hidden = true; }
    }
  }
  search.addEventListener('input', () => {
    const term = search.value.trim().toLowerCase(), box = $('suggestions'); box.replaceChildren();
    if (term.length < 2) { box.hidden = true; return; }
    const matches = data.places.filter(p => p.name.toLowerCase().includes(term))
      .sort((a, b) => (a.name.toLowerCase().startsWith(term) ? -1 : 1) - (b.name.toLowerCase().startsWith(term) ? -1 : 1) || a.name.length - b.name.length).slice(0, 8);
    for (const p of matches) {
      const button = document.createElement('button'); button.type = 'button';
      button.innerHTML = `${escapeHtml(p.name)}<small>${escapeHtml(p.kind)}</small>`;
      button.addEventListener('click', () => setStart([p.lat, p.lon], p.name)); box.append(button);
    }
    box.hidden = !matches.length;
  });
  search.addEventListener('keydown', event => { if (event.key === 'Enter') { const first = $('suggestions').querySelector('button'); if (first) { first.click(); event.preventDefault(); } else if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(search.value)) setStart(search.value.split(',').map(Number), search.value); } });
  $('find').addEventListener('click', findRoutes);
  $('cancel-search').addEventListener('click', () => {
    searchGeneration++; liveSearchActive = false; $('find').disabled = false; $('cancel-search').hidden = true;
    $('result-count').textContent = `${currentRoutes.length} route${currentRoutes.length === 1 ? '' : 's'}`;
    if (currentRoutes.length) drawRoute(selected);
    status.textContent = currentRoutes.length ? 'Search cancelled · showing suggestions found so far.' : 'Search cancelled.';
  });
  distanceInput.addEventListener('change', () => { updateBeamLimit(); findRoutes(); });
  beamInput.addEventListener('input', () => { $('beam-value').value = beamInput.value; });
  beamInput.addEventListener('change', findRoutes);
  iterationInput.addEventListener('input', () => { $('iterations-value').value = iterationInput.value; });
  iterationInput.addEventListener('change', findRoutes);
  for (const input of document.querySelectorAll('[data-score]')) input.addEventListener('change', findRoutes);
  $('gpx-files').addEventListener('change', async event => {
    const files = [...event.target.files]; if (!files.length) return;
    const buckets = new Map();
    for (let i = 0; i < coords.length; i++) {
      const key = `${Math.floor(coords[i][0] * 1000)},${Math.floor(coords[i][1] * 1000)}`;
      if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(i);
    }
    let imported = 0;
    for (const file of files) {
      const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
      if (xml.querySelector('parsererror')) continue;
      const raw = [...xml.getElementsByTagNameNS('*', 'trkpt'), ...xml.getElementsByTagNameNS('*', 'rtept')]
        .map(node => [Number(node.getAttribute('lat')), Number(node.getAttribute('lon'))]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (raw.length < 2) continue;
      let touched = 0;
      function mark(point) {
        const y = Math.floor(point[0] * 1000), x = Math.floor(point[1] * 1000);
        let closest = -1, distance = .065;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of buckets.get(`${y + dy},${x + dx}`) || []) {
          const d = km(point, coords[i]); if (d < distance) { distance = d; closest = i; }
        }
        if (closest >= 0) { popularity[closest] = 1; touched++; }
      }
      for (let i = 0; i < raw.length; i++) {
        mark(raw[i]);
        if (i && km(raw[i - 1], raw[i]) < .3) {
          const steps = Math.min(12, Math.ceil(km(raw[i - 1], raw[i]) / .025));
          for (let s = 1; s < steps; s++) mark([raw[i - 1][0] + (raw[i][0] - raw[i - 1][0]) * s / steps, raw[i - 1][1] + (raw[i][1] - raw[i - 1][1]) * s / steps]);
        }
      }
      if (touched) imported++;
    }
    $('gpx-status').textContent = imported ? `${imported} track${imported === 1 ? '' : 's'} added to route scores` : 'No usable GPX track points found';
    if (imported) findRoutes();
  });
  $('locate').addEventListener('click', () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(pos => setStart([pos.coords.latitude, pos.coords.longitude], 'My location'), () => { status.textContent = 'Location unavailable. Click a start point on the map instead.'; }) : status.textContent = 'Location is unavailable in this browser. Click the map instead.');
  $('overlay-toggle').addEventListener('click', event => { overlayShown = !overlayShown; event.currentTarget.setAttribute('aria-pressed', String(overlayShown)); renderFeatures(); });
  map.on('moveend', renderFeatures);
  map.on('click', event => setStart([event.latlng.lat, event.latlng.lng], `${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`));
  const initial = data.places.find(p => p.name.toLowerCase() === 'victoria square / tarntanyangga') || data.places.find(p => p.kind !== 'address' && p.name.toLowerCase().includes('victoria square'));
  setStart(initial ? [initial.lat, initial.lon] : startPoint, initial ? initial.name : 'Victoria Square / Tarntanyangga');
  updateBeamLimit(); renderFeatures();
  status.textContent = `Local routes updated ${data.built}. Choose a start and distance to explore.`;
  setTimeout(findRoutes, 100);
})();
