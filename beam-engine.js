/* Adelaide-only scored closed-walk search. Works in a browser or Node test. */
(function (scope) {
  'use strict';
  const km = (a, b) => Math.hypot((a[0] - b[0]) * 111.1, (a[1] - b[1]) * 91.2);
  function externalHullArea(path, coords, origin) {
    // A tiny planar arrangement of the start/control-point outline. Split all
    // intersections (including collinear overlaps), dissolve duplicate edges,
    // then follow half-edges around each face. No winding rule or convex hull.
    const epsilon = 1e-9; // km: merge sub-micrometre floating-point differences.
    const xy = path.map(node => [(coords[node][1] - origin[1]) * 91.2, (coords[node][0] - origin[0]) * 111.1]);
    if (!xy.length) return 0;
    const first = xy[0], last = xy.at(-1);
    if (first[0] !== last[0] || first[1] !== last[1]) xy.push(first);
    const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
    const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
    const segments = [];
    for (let i = 1; i < xy.length; i++) {
      const vector = subtract(xy[i], xy[i - 1]), length = Math.hypot(...vector);
      if (length > epsilon) segments.push({ a: xy[i - 1], vector, length, cuts: [0, 1] });
    }
    function addCut(segment, t) {
      const tolerance = epsilon / segment.length;
      if (t >= -tolerance && t <= 1 + tolerance) segment.cuts.push(Math.max(0, Math.min(1, t)));
    }
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j], delta = subtract(b.a, a.a), determinant = cross(a.vector, b.vector);
      if (Math.abs(determinant) > epsilon * (a.length + b.length)) {
        const t = cross(delta, b.vector) / determinant, u = cross(delta, a.vector) / determinant;
        if (t >= -epsilon / a.length && t <= 1 + epsilon / a.length && u >= -epsilon / b.length && u <= 1 + epsilon / b.length) {
          addCut(a, t); addCut(b, u);
        }
      } else if (Math.abs(cross(delta, a.vector)) <= epsilon * a.length) {
        // Collinear overlap: cut each segment at the other's endpoints.
        for (const [segment, other] of [[a, b], [b, a]]) for (const t of [0, 1]) {
          const offset = [other.a[0] + t * other.vector[0] - segment.a[0], other.a[1] + t * other.vector[1] - segment.a[1]];
          addCut(segment, (offset[0] * segment.vector[0] + offset[1] * segment.vector[1]) / segment.length ** 2);
        }
      }
    }
    const vertices = [], buckets = new Map(), adjacent = [], edges = new Set();
    function vertex(point) {
      const x = Math.floor(point[0] / epsilon), y = Math.floor(point[1] / epsilon);
      // Check neighbouring buckets, so a rounding boundary cannot split one
      // geometric intersection into two almost-identical graph vertices.
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const id of buckets.get(`${x + dx}:${y + dy}`) || []) {
        if (Math.hypot(vertices[id][0] - point[0], vertices[id][1] - point[1]) <= epsilon) return id;
      }
      const id = vertices.length, key = `${x}:${y}`;
      vertices.push(point); adjacent.push([]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(id);
      return id;
    }
    for (const segment of segments) {
      segment.cuts.sort((a, b) => a - b);
      let previous = null, previousCut = -Infinity;
      for (const t of segment.cuts) {
        if (t - previousCut <= epsilon / segment.length) continue;
        previousCut = t;
        const id = vertex([segment.a[0] + t * segment.vector[0], segment.a[1] + t * segment.vector[1]]);
        if (previous !== null && previous !== id) {
          const key = `${Math.min(previous, id)}:${Math.max(previous, id)}`;
          if (!edges.has(key)) { edges.add(key); adjacent[previous].push(id); adjacent[id].push(previous); }
        }
        previous = id;
      }
    }
    if (edges.size < 3) return 0;
    const next = new Map();
    adjacent.forEach((neighbours, node) => {
      const p = vertices[node];
      neighbours.sort((a, b) => Math.atan2(vertices[a][1] - p[1], vertices[a][0] - p[0]) - Math.atan2(vertices[b][1] - p[1], vertices[b][0] - p[0]));
      for (let i = 0; i < neighbours.length; i++) next.set(`${neighbours[i]}:${node}`, neighbours[(i + neighbours.length - 1) % neighbours.length]);
    });
    const visited = new Set(); let outerArea = 0;
    adjacent.forEach((neighbours, start) => {
      for (const neighbour of neighbours) {
        let a = start, b = neighbour, doubleArea = 0;
        while (!visited.has(`${a}:${b}`)) {
          visited.add(`${a}:${b}`);
          doubleArea += cross(vertices[a], vertices[b]);
          const following = next.get(`${a}:${b}`);
          a = b; b = following;
        }
        // The outline is connected. Its unbounded face encloses every bounded
        // face, including nested loops; its magnitude is the total outer area.
        outerArea = Math.max(outerArea, Math.abs(doubleArea) / 2);
      }
    });
    return outerArea;
  }
  class Heap {
    constructor() { this.items = []; }
    get size() { return this.items.length; }
    push(priority, value) { const a = this.items, item = [priority, value]; let i = a.length; a.push(item); while (i) { const p = (i - 1) >> 1; if (a[p][0] >= priority) break; a[i] = a[p]; i = p; } a[i] = item; }
    pop() { const a = this.items, top = a[0], last = a.pop(); if (a.length) { let i = 0; while (2 * i + 1 < a.length) { let c = 2 * i + 1; if (c + 1 < a.length && a[c + 1][0] > a[c][0]) c++; if (last[0] >= a[c][0]) break; a[i] = a[c]; i = c; } a[i] = last; } return top; }
  }
  const MAX_DIVERSITY_STATES = 10;
  const DIVERSITY_CELL_KM = .5;
  const MAX_MUTATIONS_PER_CHILD = 6;
  function mutationContinuationChance(round, rounds) {
    return rounds < 2 ? 0 : .9 * (1 - round / (rounds - 1));
  }
  function bitCount(word) {
    word -= (word >>> 1) & 0x55555555;
    word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
    return (((word + (word >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  function newTileCount(bits, covered) {
    let count = 0;
    for (let i = 0; i < bits.length; i++) count += bitCount(bits[i] & ~(covered[i] || 0));
    return count;
  }
  function unionBits(a, b) {
    const union = new Uint32Array(Math.max(a.length, b.length));
    for (let i = 0; i < union.length; i++) union[i] = (a[i] || 0) | (b[i] || 0);
    return union;
  }
  function bitsetKey(bits) {
    let end = bits.length;
    while (end && !bits[end - 1]) end--;
    return bits.subarray(0, end).join(',');
  }
  function bitsetDistance(a, b) {
    let different = 0, combined = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0, y = b[i] || 0;
      different += bitCount(x ^ y); combined += bitCount(x | y);
    }
    return combined ? different / combined : 0;
  }
  function routeQuality(route, bestScore, scale) {
    // Scores can be negative. Exponential relative quality remains positive,
    // while a very poor route cannot gain importance merely by adding tiles.
    return Math.exp(Math.max(-40, (route.score - bestScore) / scale));
  }
  function selectBeamRoutes(ranked, width) {
    const selected = ranked.slice(0, Math.ceil(width / 2));
    const chosen = new Set(selected), bestScore = ranked[0]?.score || 0;
    const scale = Math.max(1000, Math.abs(bestScore));
    let covered = new Uint32Array(0);
    for (const route of selected) covered = unionBits(covered, route.tileBits);
    while (selected.length < Math.min(width, ranked.length)) {
      let best = null, bestGain = -Infinity;
      for (const route of ranked) {
        if (chosen.has(route)) continue;
        const gain = routeQuality(route, bestScore, scale) * newTileCount(route.tileBits, covered) / route.tileCount;
        if (gain > bestGain) { best = route; bestGain = gain; }
      }
      if (!best) break;
      selected.push(best); chosen.add(best); covered = unionBits(covered, best.tileBits);
    }
    return selected;
  }
  function pruneStates(states) {
    // The score leaders alone can have nearly identical coverage. Keep the
    // remaining states by their distance from the already retained bitsets.
    states.sort((a, b) => b.value - a.value);
    const unique = [], seen = new Set();
    for (const state of states) {
      const key = bitsetKey(state.bits);
      if (seen.has(key)) continue;
      seen.add(key); unique.push(state);
    }
    if (unique.length <= MAX_DIVERSITY_STATES) return unique;
    const kept = unique.slice(0, Math.ceil(MAX_DIVERSITY_STATES / 2));
    const remaining = unique.slice(kept.length), high = unique[0].value, low = unique.at(-1).value;
    while (kept.length < MAX_DIVERSITY_STATES && remaining.length) {
      let best = 0, bestValue = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const state = remaining[i];
        const separation = Math.min(...kept.map(other => bitsetDistance(state.bits, other.bits)));
        const relativeScore = high === low ? 1 : (state.value - low) / (high - low);
        const value = separation * (.25 + .75 * relativeScore);
        if (value > bestValue) { best = i; bestValue = value; }
      }
      kept.push(remaining.splice(best, 1)[0]);
    }
    return kept.sort((a, b) => b.value - a.value);
  }
  function selectFinalRoutes(candidates, count = 4) {
    if (!candidates.length) return [];
    const ranked = [...candidates].sort((a, b) => b.score - a.score);
    const bestScore = ranked[0].score, scale = Math.max(1000, Math.abs(bestScore) * .5);
    const levels = Array.from({ length: Math.min(count, ranked.length) + 1 }, () => []);
    levels[0].push({ bits: new Uint32Array(0), value: 0, routes: [] });
    for (let i = 0; i < ranked.length; i++) {
      const route = ranked[i];
      for (let size = Math.min(levels.length - 1, i + 1); size >= 1; size--) {
        const extensions = levels[size - 1].map(previous => ({
          bits: unionBits(previous.bits, route.tileBits),
          value: previous.value + routeQuality(route, bestScore, scale) * newTileCount(route.tileBits, previous.bits) / route.tileCount,
          routes: [...previous.routes, route]
        }));
        levels[size] = pruneStates([...levels[size], ...extensions]);
      }
    }
    return (levels.at(-1)[0]?.routes || []).sort((a, b) => b.score - a.score);
  }
  function createBeamEngine(data) {
    const coords = data.nodes;
    function nearest(point) {
      let node = -1, distance = Infinity;
      for (let i = 0; i < coords.length; i++) { const d = km(point, coords[i]); if (d < distance) { node = i; distance = d; } }
      return { node, distance };
    }
    async function generate(root, target, score, width, iterations, popularity, options = {}) {
      // Opt-in round-boundary snapshots and hooks for reproducible benchmarks.
      // Normal browser searches neither serialize state nor pay profiling costs.
      const benchmark = options.benchmark;
      const started = Date.now();
      const searchRadius = target * .6;
      const near = new Uint8Array(coords.length), rootPoint = coords[root];
      // Bound graph preparation, not the length of returned routes.
      for (let i = 0; i < coords.length; i++) near[i] = +(km(coords[i], rootPoint) <= searchRadius);
      const raw = [], adjacency = new Map(), seen = new Map();
      const add = (node, edge) => { if (!adjacency.has(node)) adjacency.set(node, []); adjacency.get(node).push(edge); };
      const signals = data.signals || {};
      for (const item of data.edges) {
        const [a, b, trail, , roadByte, shops, crossings, smallIds = []] = item;
        if (!near[a] || !near[b] || a === b) continue;
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        const length = km(coords[a], coords[b]);
        if (!length || length > .2) continue;
        const average = kind => ((signals[kind]?.[a] || 0) + (signals[kind]?.[b] || 0)) / 2;
        const insideGreen = average('greenInside');
        const green = Math.max(trail ? 1 : 0, insideGreen);
        const large = Math.max(average('largeNear'), average('parkNear') * (1 - insideGreen));
        const majorRoad = (roadByte || 0) / 210;
        const imported = Math.min(1, ((popularity?.[a] || 0) + (popularity?.[b] || 0)) / 2);
        const baseReward = length / .1 * (score.imported * imported - score.majorRoad * majorRoad) + score.shop * (shops || 0);
        const scenicValues = { green, large };
        const scenicParts = new Map();
        const samples = Math.max(1, Math.ceil(length / .025));
        for (let s = 0; s < samples; s++) {
          const t = (s + .5) / samples;
          const lat = coords[a][0] + (coords[b][0] - coords[a][0]) * t;
          const lon = coords[a][1] + (coords[b][1] - coords[a][1]) * t;
          const cell = `${Math.floor(lat * 2220)}:${Math.floor(lon * 1824)}`;
          for (const [kind, value] of Object.entries(scenicValues)) if (value) {
            const key = `${kind}:${cell}`;
            scenicParts.set(key, (scenicParts.get(key) || 0) + length / samples / .1 * value);
          }
        }
        const scenicReward = length / .1 * (score.green * green + score.large * large);
        const reward = baseReward + scenicReward + score.small * smallIds.length - score.crossing * (crossings || 0);
        const edge = { a, b, length, reward, baseReward, scenicParts, smallIds, crossings: crossings || 0, majorRoad, scenic: Math.max(green, large), imported };
        if (seen.has(key)) {
          const prior = raw[seen.get(key)];
          if (edge.reward > prior.reward) Object.assign(prior, edge);
          continue;
        }
        seen.set(key, raw.length); add(a, raw.length); add(b, raw.length); raw.push(edge);
      }
      const junctions = new Set([root]);
      for (const [node, adjacent] of adjacency) if (adjacent.length !== 2) junctions.add(node);
      const edges = [], used = new Uint8Array(raw.length);
      for (const start of junctions) for (const first of adjacency.get(start) || []) {
        if (used[first]) continue;
        let current = start, eid = first, length = 0, baseReward = 0, crossings = 0, roadLength = 0, scenicLength = 0, importedLength = 0;
        const scenicParts = new Map(), smallIds = new Set();
        const path = [start];
        while (!used[eid]) {
          used[eid] = 1;
          const edge = raw[eid];
          length += edge.length; baseReward += edge.baseReward; crossings += edge.crossings;
          for (const [key, value] of edge.scenicParts) scenicParts.set(key, (scenicParts.get(key) || 0) + value);
          for (const id of edge.smallIds) smallIds.add(id);
          roadLength += edge.length * (edge.majorRoad > .25 ? 1 : 0);
          scenicLength += edge.length * (edge.scenic > .35 ? 1 : 0);
          importedLength += edge.length * (edge.imported > 0 ? 1 : 0);
          current = edge.a === current ? edge.b : edge.a; path.push(current);
          if (junctions.has(current)) break;
          eid = (adjacency.get(current) || []).find(i => !used[i]);
          if (eid === undefined) break;
        }
        edges.push({ a: start, b: current, length, baseReward, scenicParts, smallIds, crossings, roadLength, scenicLength, importedLength, path });
      }
      const live = new Map();
      function id(node) { if (!live.has(node)) live.set(node, live.size); return live.get(node); }
      for (const edge of edges) { edge.a = id(edge.a); edge.b = id(edge.b); }
      const rootId = id(root), n = live.size, nodeById = [...live.keys()];
      const links = Array.from({ length: n }, () => []);
      edges.forEach((edge, i) => { links[edge.a].push([edge.b, i]); if (edge.a !== edge.b) links[edge.b].push([edge.a, i]); });
      const graphReady = Date.now();
      const penalty = length => (length >= target ? score.over : score.under) * Math.abs(length - target) / .1;
      const areaBonus = (area, length) => score.area * Math.min(1, area / (length * length / (4 * Math.PI)));
      function routeMetrics(edgeIds) {
        const visited = new Set(), visitedSmall = new Set(), scenic = new Map();
        let reward = 0, crossings = 0, repeatedLength = 0;
        for (const eid of edgeIds) {
          const edge = edges[eid];
          crossings += edge.crossings;
          if (visited.has(eid)) { repeatedLength += edge.length; continue; }
          visited.add(eid);
          reward += edge.baseReward;
          for (const [key, value] of edge.scenicParts) scenic.set(key, Math.min(.5, (scenic.get(key) || 0) + value));
          for (const id of edge.smallIds) visitedSmall.add(id);
        }
        const baseReward = reward, smallReward = score.small * visitedSmall.size;
        reward += smallReward;
        let greenReward = 0, largeReward = 0;
        for (const [key, value] of scenic) {
          const addition = score[key.split(':', 1)[0]] * value;
          reward += addition;
          if (key.startsWith('green:')) greenReward += addition;
          else largeReward += addition;
        }
        const crossingPenalty = score.crossing * crossings, retracePenalty = score.retrace * repeatedLength / .1;
        reward -= crossingPenalty + retracePenalty;
        return { reward, crossings, repeatedLength, parts: { baseReward, smallReward, greenReward, largeReward, crossingPenalty, retracePenalty } };
      }
      // Route-space beam: the beam contains complete closed-loop candidates.
      const cell = p => `${Math.floor(p[0] * 500)},${Math.floor(p[1] * 500)}`;
      const spatial = new Map();
      for (let i = 0; i < n; i++) { const p = coords[nodeById[i]], key = cell(p); if (!spatial.has(key)) spatial.set(key, []); spatial.get(key).push(i); }
      function snap(point) {
        const [cy, cx] = cell(point).split(',').map(Number); let best = -1, distance = .18;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) for (const i of spatial.get(`${cy + dy},${cx + dx}`) || []) {
          const d = km(point, coords[nodeById[i]]); if (d < distance) { best = i; distance = d; }
        }
        return best;
      }
      // Map insertion order gives this bounded pair cache true LRU semantics:
      // cache hits move a pair to the newest position, inserts evict the oldest.
      const legCacheLimit = 3000;
      const legCache = new Map(), stamp = new Int32Array(n), costs = new Float64Array(n), parent = new Int32Array(n), parentEdge = new Int32Array(n);
      let generation = 0, legCalls = 0, legCacheHits = 0;
      function shortestLeg(from, to) {
        if (from === to) return [];
        const low = Math.min(from, to), high = Math.max(from, to), key = `${low}:${high}`;
        let canonical = legCache.get(key);
        if (!canonical) {
          legCalls++; generation++; const mark = generation, queue = new Heap();
          costs[low] = 0; stamp[low] = mark; parent[low] = -1;
          queue.push(-km(coords[nodeById[low]], coords[nodeById[high]]), low);
          while (queue.size) {
            const [negative, u] = queue.pop(), estimate = -negative, actual = stamp[u] === mark ? costs[u] : Infinity;
            if (estimate > actual + km(coords[nodeById[u]], coords[nodeById[high]]) + 1e-8) continue;
            if (u === high) break;
            for (const [v, eid] of links[u]) {
              const next = actual + edges[eid].length;
              if (stamp[v] !== mark || next < costs[v]) {
                costs[v] = next; stamp[v] = mark; parent[v] = u; parentEdge[v] = eid;
                queue.push(-(next + km(coords[nodeById[v]], coords[nodeById[high]])), v);
              }
            }
          }
          if (stamp[high] !== mark) return null;
          const path = []; for (let v = high; v !== low; v = parent[v]) path.push([parentEdge[v], parent[v] === edges[parentEdge[v]].a]);
          path.reverse(); canonical = { path, length: costs[high] }; legCache.set(key, canonical);
          if (legCache.size > legCacheLimit) legCache.delete(legCache.keys().next().value);
        } else { legCacheHits++; legCache.delete(key); legCache.set(key, canonical); }
        return from === low ? canonical.path : [...canonical.path].reverse().map(([eid, forward]) => [eid, !forward]);
      }
      const tileIds = new Map();
      function evaluate(points) {
        const all = [], path = [root]; let length = 0, current = rootId;
        for (const next of [...points, rootId]) {
          const leg = shortestLeg(current, next); if (!leg) return null;
          for (const [eid, forward] of leg) {
            const edge = edges[eid], chain = forward ? edge.path : [...edge.path].reverse();
            all.push(eid); path.push(...chain.slice(1)); length += edge.length;
          }
          current = next;
        }
        if (!length) return null;
        const controls = [root, ...points.map(node => nodeById[node]), root];
        const metrics = routeMetrics(all), area = externalHullArea(controls, coords, rootPoint);
        const tiles = new Set();
        for (let i = 1; i < path.length; i++) {
          const a = coords[path[i - 1]], b = coords[path[i]];
          const steps = Math.max(1, Math.ceil(km(a, b) / .09));
          for (let step = 0; step <= steps; step++) {
            const t = step / steps;
            const x = Math.floor(((a[1] + (b[1] - a[1]) * t) - rootPoint[1]) * 91.2 / DIVERSITY_CELL_KM);
            const y = Math.floor(((a[0] + (b[0] - a[0]) * t) - rootPoint[0]) * 111.1 / DIVERSITY_CELL_KM);
            const key = `${x}:${y}`;
            if (!tileIds.has(key)) tileIds.set(key, tileIds.size);
            tiles.add(tileIds.get(key));
          }
        }
        const tileBits = new Uint32Array(Math.ceil(tileIds.size / 32));
        for (const tile of tiles) tileBits[tile >>> 5] |= 1 << (tile & 31);
        return { points: [...points], edges: all, path, length, area, score: metrics.reward + areaBonus(area, length) - penalty(length), crossings: metrics.crossings, repeatedLength: metrics.repeatedLength, parts: metrics.parts,
          tileBits, tileCount: tiles.size,
          roadLength: all.reduce((s, e) => s + edges[e].roadLength, 0), scenicLength: all.reduce((s, e) => s + edges[e].scenicLength, 0), importedLength: all.reduce((s, e) => s + edges[e].importedLength, 0) };
      }
      let seed = ((root * 2654435761) ^ Math.round(target * 1000)) >>> 0;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      function initialRoute(phase) {
        const count = 3 + phase % 4, points = [], radius = Math.max(.35, target / (2 * Math.PI) * (.75 + phase * .09)), offset = random() * Math.PI * 2;
        for (let i = 0; i < count; i++) {
          const angle = offset + i * Math.PI * 2 / count + (random() - .5) * .35, d = radius * (.8 + random() * .4);
          const node = snap([rootPoint[0] + Math.cos(angle) * d / 111.1, rootPoint[1] + Math.sin(angle) * d / 91.2]);
          if (node >= 0 && (!points.length || points.at(-1) !== node)) points.push(node);
        }
        return points.length >= 2 ? points : null;
      }
      const poiSpatial = new Map();
      for (const kind of ['large', 'small']) for (const point of data.poiAnchors?.[kind] || []) {
        const node = snap(point);
        if (node >= 0 && km(rootPoint, coords[nodeById[node]]) <= searchRadius) {
          const key = cell(coords[nodeById[node]]); if (!poiSpatial.has(key)) poiSpatial.set(key, []); poiSpatial.get(key).push(node);
        }
      }
      function sampleRoute(route) {
        const cumulative = [0];
        for (let i = 1; i < route.path.length; i++) cumulative.push(cumulative[i - 1] + km(coords[route.path[i - 1]], coords[route.path[i]]));
        const at = random() * cumulative.at(-1), index = Math.max(1, cumulative.findIndex(v => v >= at));
        return coords[route.path[Math.min(route.path.length - 1, index)]];
      }
      function nearbyControl(route, poiBias) {
        const point = sampleRoute(route);
        if (poiBias && poiSpatial.size) {
          const [cy, cx] = cell(point).split(',').map(Number), candidates = [];
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) for (const node of poiSpatial.get(`${cy + dy},${cx + dx}`) || [])
            if (km(point, coords[nodeById[node]]) <= .5) candidates.push(node);
          if (candidates.length) return candidates[Math.floor(random() * candidates.length)];
        }
        const angle = random() * Math.PI * 2, distance = .05 + random() * .45;
        return snap([point[0] + Math.cos(angle) * distance / 111.1, point[1] + Math.sin(angle) * distance / 91.2]);
      }
      function mutate(route) {
        const points = [...route.points], choice = random();
        if (choice < .35 && points.length < 8) { const node = nearbyControl(route, false); if (node >= 0) points.splice(Math.floor(random() * (points.length + 1)), 0, node); }
        else if (choice < .68 && points.length < 8) { const node = nearbyControl(route, true); if (node >= 0) points.splice(Math.floor(random() * (points.length + 1)), 0, node); }
        else if (choice < .94 && points.length) { const i = Math.floor(random() * points.length), node = nearbyControl(route, choice > .84); if (node >= 0) points[i] = node; }
        else if (points.length > 2) points.splice(Math.floor(random() * points.length), 1);
        for (let i = points.length - 1; i > 0; i--) if (points[i] === points[i - 1]) points.splice(i, 1);
        return points.length >= 2 ? points : null;
      }
      const maxWidth = Math.max(2, Math.min(100, Number(width) || 32)), rounds = Math.max(1, Math.min(100, Number(iterations) || 20));
      const routeSeen = new Set(), beam = []; let expanded = 0, evaluated = 0, mutationSteps = 0, duplicateCount = 0, longestMutationChain = 0, bestRoute = null;
      const routeKey = route => route.points.join(',');
      const publicRoute = r => ({ id: routeKey(r), path: r.path, length: r.length, scenic: r.scenicLength / r.length, popular: r.importedLength / r.length, road: r.roadLength / r.length, repeated: r.repeatedLength / r.length, crossings: r.crossings, area: r.area, score: r.score, parts: r.parts, controlPoints: r.points.length });
      function keep(route) {
        const key = routeKey(route);
        if (routeSeen.has(key)) { duplicateCount++; return route; }
        routeSeen.add(key);
        if (!bestRoute || route.score > bestRoute.score) bestRoute = route;
        return route;
      }
      const progress = options.onProgress || (() => {}), cancelled = options.cancelled || (() => false);
      const yieldToBrowser = benchmark?.yieldToBrowser || (() => new Promise(resolve => setTimeout(resolve, 0)));
      const settings = { root, target, score, width: maxWidth, iterations: rounds };
      let firstRound = 0;
      function checkpoint(completedRounds) {
        const encodeRoute = route => route && ({ ...route, tileBits: [...route.tileBits] });
        return {
          version: 1, settings, completedRounds, nodeById, compressedEdges: edges.length,
          seed, legCache: [...legCache], tileIds: [...tileIds], routeSeen: [...routeSeen],
          beam: beam.map(encodeRoute), bestRoute: encodeRoute(bestRoute),
          counters: { expanded, evaluated, mutationSteps, duplicateCount, longestMutationChain, legCalls, legCacheHits }
        };
      }
      if (benchmark?.resume) {
        const state = benchmark.resume;
        if (state.version !== 1 || JSON.stringify(state.settings) !== JSON.stringify(settings) ||
            state.compressedEdges !== edges.length || state.nodeById.join(',') !== nodeById.join(',') ||
            !Number.isInteger(state.completedRounds) || state.completedRounds < 0 || state.completedRounds > rounds) {
          throw new Error('Benchmark checkpoint does not match this search graph/settings');
        }
        const decodeRoute = route => route && ({ ...route, tileBits: Uint32Array.from(route.tileBits) });
        firstRound = state.completedRounds; seed = state.seed;
        for (const [key, value] of state.legCache) legCache.set(key, value);
        for (const [key, value] of state.tileIds) tileIds.set(key, value);
        for (const key of state.routeSeen) routeSeen.add(key);
        beam.push(...state.beam.map(decodeRoute)); bestRoute = decodeRoute(state.bestRoute);
        ({ expanded, evaluated, mutationSteps, duplicateCount, longestMutationChain, legCalls, legCacheHits } = state.counters);
      }
      await yieldToBrowser();
      if (cancelled()) return { routes: [], search: { rawEdges: raw.length, compressedEdges: edges.length, expanded: 0, evaluated: 0, candidates: 0, width: maxWidth, iterations: rounds, cancelled: true, timing: { graph: graphReady - started, search: 0 } } };
      for (let i = 0; !benchmark?.resume && i < Math.min(maxWidth, 12); i++) {
        if (cancelled()) break;
        const points = initialRoute(i); if (points) { const route = evaluate(points); if (route) { evaluated++; beam.push(keep(route)); } }
        await yieldToBrowser();
      }
      for (let round = firstRound; round < Math.min(rounds, benchmark?.stopAfterRound ?? rounds) && beam.length; round++) {
        if (cancelled()) break;
        if (benchmark?.beforeRound) await benchmark.beforeRound(round + 1);
        const continuationChance = mutationContinuationChance(round, rounds);
        const pool = [...beam];
        for (const candidate of beam) for (let m = 0; m < 3; m++) {
          let current = candidate;
          for (let step = 0; step < MAX_MUTATIONS_PER_CHILD; step++) {
            if (cancelled()) break;
            const points = mutate(current);
            if (!points || points.join(',') === current.points.join(',')) break;
            const route = evaluate(points);
            if (!route) break;
            evaluated++; mutationSteps++; current = route;
            longestMutationChain = Math.max(longestMutationChain, step + 1);
            await yieldToBrowser();
            if (step + 1 === MAX_MUTATIONS_PER_CHILD || random() >= continuationChance) break;
          }
          if (current !== candidate) { pool.push(keep(current)); expanded++; }
        }
        const unique = new Map();
        for (const route of pool) { const key = routeKey(route), old = unique.get(key); if (!old || route.score > old.score) unique.set(key, route); }
        const ranked = [...unique.values()].sort((a, b) => b.score - a.score);
        beam.splice(0, beam.length, ...selectBeamRoutes(ranked, maxWidth));
        const suggestions = selectFinalRoutes(beam).map(publicRoute);
        progress({ round: round + 1, iterations: rounds, width: maxWidth, evaluated, routes: routeSeen.size, best: bestRoute || beam[0], suggestions, continuationChance, mutationSteps, longestMutationChain });
        await yieldToBrowser();
        if (benchmark?.afterRound) await benchmark.afterRound(round + 1);
        // Capture after profiling has stopped: serialization is not search time.
        if (benchmark?.captureRounds?.includes(round + 1)) benchmark.onCheckpoint(checkpoint(round + 1));
      }
      const routes = selectFinalRoutes(beam).map(publicRoute);
      return { routes, search: { rawEdges: raw.length, compressedEdges: edges.length, expanded, evaluated, mutationSteps, candidates: routeSeen.size, duplicates: duplicateCount, width: maxWidth, iterations: rounds, longestMutationChain, legCalls, legCacheHits, cancelled: cancelled(), timing: { graph: graphReady - started, search: Date.now() - graphReady } } };
    }
    return { nearest, generate };
  }
  scope.createBeamEngine = createBeamEngine;
  createBeamEngine.externalHullArea = externalHullArea;
  createBeamEngine.selectFinalRoutes = selectFinalRoutes;
  createBeamEngine.diversityStateLimit = MAX_DIVERSITY_STATES;
  createBeamEngine.diversityCellKm = DIVERSITY_CELL_KM;
  createBeamEngine.maxMutationsPerChild = MAX_MUTATIONS_PER_CHILD;
  createBeamEngine.mutationContinuationChance = mutationContinuationChance;
  if (typeof module !== 'undefined' && module.exports) module.exports = createBeamEngine;
})(typeof window !== 'undefined' ? window : globalThis);
