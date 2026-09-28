const assert = require('node:assert/strict');
global.window = {};
require('../data.js');
const data = window.ADELAIDE_DATA;
assert.ok(!Object.hasOwn(data, 'heatmapAvailable'), 'Published data must not contain a screenshot-derived heatmap flag');
assert.ok(data.edges.every(edge => edge.length === 7 || edge.length === 8), 'Published edges use the heatmap-free schema');
const createBeamEngine = require('../beam-engine.js');
const browserScope = {};
require('node:vm').runInNewContext(require('node:fs').readFileSync(require.resolve('../beam-engine.js'), 'utf8'), { window: browserScope });
const engine = createBeamEngine(data);
const coordsFromXY = points => points.map(([x, y]) => [y / 111.1, x / 91.2]);
const square = coordsFromXY([[0, 0], [1, 0], [1, 1], [0, 1], [2, 0]]);
const externalArea = (path, coords) => createBeamEngine.externalHullArea(path, coords, coords[0]);
const samplePoints = coordsFromXY([[0, 0], [1, 0], [1, 3]]);
const sampleExpectations = [[0, [0, 0]], [.125, [.5, 0]], [.5, [1, 1]], [1, [1, 3]]];
for (const [fraction, expected] of sampleExpectations) {
  const sample = createBeamEngine.samplePolyline(samplePoints, fraction);
  const target = coordsFromXY([expected])[0];
  assert.ok(sample.every((value, axis) => Math.abs(value - target[axis]) < 1e-12), 'Outline sampling interpolates along segments, weighted by their length');
}
assert.deepEqual(createBeamEngine.samplePolyline([[0, 0], [0, 0]], .5), [0, 0]);
assert.equal(createBeamEngine.samplePolyline([], .5), null);
const bitsetRoute = (name, bits, score) => ({ name, tileBits: Uint32Array.of(bits), tileCount: bits.toString(2).replace(/0/g, '').length, score });
const choices = [bitsetRoute('A', 0b110, 12), bitsetRoute('B', 0b010, 11), bitsetRoute('C', 0b001, 10), bitsetRoute('D', 0b100, 9)];
assert.equal(createBeamEngine.diversityStateLimit, 10);
assert.equal(createBeamEngine.diversityCellKm(2), .5);
assert.equal(createBeamEngine.diversityCellKm(5), 1.25);
assert.equal(createBeamEngine.diversityCellKm(10), 2.5);
assert.equal(createBeamEngine.diversityCellKm(25), 6.25);
assert.equal(createBeamEngine.diversityCellKm(5, .2), 1);
assert.equal(createBeamEngine.diversityCellKm(5, .01), .05);
assert.equal(createBeamEngine.diversityCellKm(5, 0), .05);
assert.equal(createBeamEngine.diversityCellKm(5, 1), 2.5);
assert.equal(createBeamEngine.mutationContinuationChance(0, 20), .9);
assert.equal(createBeamEngine.mutationContinuationChance(9, 20), .9);
assert.equal(createBeamEngine.mutationContinuationChance(10, 21), .9);
assert.equal(createBeamEngine.mutationContinuationChance(15, 21), .45);
assert.equal(createBeamEngine.mutationContinuationChance(20, 21), 0);
assert.equal(createBeamEngine.mutationContinuationChance(19, 20), 0);
assert.equal(createBeamEngine.mutationContinuationChance(0, 1), 0);
assert.deepEqual(createBeamEngine.selectFinalRoutes(choices, 3).map(route => route.name), ['B', 'C', 'D'], 'Competing bitset states must survive a locally better but overlapping prefix');
assert.ok(Math.abs(externalArea([0, 1, 2, 3, 0], square) - 1) < 1e-9);
assert.ok(Math.abs(externalArea([0, 1, 2, 3, 0, 1, 2, 3, 0], square) - 1) < 1e-9, 'Overlapping loops must not double-count area');
assert.ok(Math.abs(externalArea([0, 1, 4, 1, 2, 3, 0], square) - 1) < 1e-9, 'An out-and-back spur must not enlarge the external area');
const adjacentSquares = coordsFromXY([[0, 0], [1, 0], [1, 1], [0, 1], [2, 0], [2, 1]]);
assert.ok(Math.abs(externalArea([0, 1, 2, 3, 0, 1, 4, 5, 2, 1, 0], adjacentSquares) - 2) < 1e-9, 'Attached loops must contribute their outer area once');
const concave = coordsFromXY([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]);
assert.ok(Math.abs(externalArea([0, 1, 2, 3, 4, 5, 0], concave) - 3) < 1e-9, 'The external hull must preserve concavities');
const areaCases = [
  ['bow-tie crossing without a shared input vertex', [[0, 0], [2, 2], [0, 2], [2, 0]], 2],
  ['opposite-direction retracing', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [0, 1], [1, 1], [1, 0], [0, 0]], 1],
  ['partially overlapping, opposite-winding loops', [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0], [1, 0], [1, 2], [3, 2], [3, 0], [1, 0], [0, 0]], 6],
  ['nested loop joined by a retraced spur', [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0], [1, 1], [1, 3], [3, 3], [3, 1], [1, 1], [0, 0]], 16],
  ['two loops joined by a retraced bridge', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [3, 0], [4, 0], [4, 1], [3, 1], [3, 0], [0, 0]], 2],
  ['collinear overlap', [[0, 0], [2, 0], [1, 0], [3, 0], [0, 0]], 0],
  ['duplicate points and pure out-and-back', [[0, 0], [0, 0], [1, 1], [2, 2], [1, 1], [0, 0]], 0]
];
for (const [name, points, expected] of areaCases) for (const reversed of [false, true]) for (const angle of [0, .37]) {
  const rotated = points.map(([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle) + 3, x * Math.sin(angle) + y * Math.cos(angle) - 2]);
  const coordinates = coordsFromXY(reversed ? rotated.reverse() : rotated);
  assert.ok(Math.abs(externalArea(coordinates.map((_, i) => i), coordinates) - expected) < 1e-8, `${name}, reversed=${reversed}, angle=${angle}`);
  assert.ok(Math.abs(browserScope.createBeamEngine.externalHullArea(coordinates.map((_, i) => i), coordinates, coordinates[0]) - expected) < 1e-8, `Browser geometry: ${name}`);
}
const scores = { shop: 10, green: 300, large: 50, small: 40, majorRoad: 1000, crossing: 500, retrace: 1000, area: 10000, imported: 10, over: 150, under: 2000 };
const popularity = new Uint8Array(data.nodes.length);
const connected = new Set(data.edges.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
async function check(point, distance, width = 4, iterations = 2) {
  const root = engine.nearest(point).node;
  let progressEvents = 0, liveBestEvents = 0, liveSuggestions = [];
  const continuationChances = [];
  const result = await engine.generate(root, distance, scores, width, iterations, popularity, { onProgress: event => {
    progressEvents++;
    if (event.best?.path?.length > 1) liveBestEvents++;
    assert.ok(Array.isArray(event.suggestions) && event.suggestions.length <= 4, 'Each round should provide live suggestions');
    assert.ok(event.suggestions.every(route => route.id && route.path[0] === root && route.path.at(-1) === root));
    continuationChances.push(event.continuationChance);
    liveSuggestions = event.suggestions;
  } });
  assert.ok(progressEvents > 0, 'Route-space search should report iteration progress');
  assert.ok(liveBestEvents > 0, 'Search progress should include a route suitable for live map preview');
  assert.deepEqual(liveSuggestions.map(route => route.id), result.routes.map(route => route.id), 'The last live suggestions should match the final result');
  assert.equal(continuationChances[0], iterations > 1 ? .9 : 0);
  assert.equal(continuationChances.at(-1), 0);
  assert.ok(continuationChances.every((chance, i) => i > (iterations - 1) / 2 || iterations === 1 || chance === .9), 'Continuation chance stays at 90% through the first half');
  assert.ok(continuationChances.every((chance, i) => i === 0 || chance <= continuationChances[i - 1]));
  assert.ok(result.search.longestMutationChain >= 1);
  if (iterations > 1) assert.ok(result.search.longestMutationChain > 6, 'Stochastic mutation chains can exceed the former six-mutation cap');
  assert.ok(result.search.mutationSteps >= result.search.expanded, 'A chain can apply several control-point edits before emitting one child');
  assert.ok(result.search.evaluated >= result.search.expanded && result.search.evaluated <= result.search.expanded + Math.min(width, 12), 'Only seeds and terminal children are evaluated');
  assert.ok(result.search.expanded <= width * 3 * iterations, 'Each parent can submit at most three terminal children per round');
  assert.ok(result.search.width === width && result.search.iterations === iterations);
  assert.ok(result.routes.length >= 1, `Expected at least one loop near ${point}`);
  assert.ok(result.routes.length <= 4);
  for (const route of result.routes) {
    assert.equal(route.path[0], root);
    assert.equal(route.path.at(-1), root);
    assert.ok(Number.isFinite(route.length) && route.length > 0);
    assert.ok(Number.isFinite(route.score));
    assert.ok(Number.isInteger(route.crossings) && route.crossings >= 0);
    assert.ok(Number.isFinite(route.area) && route.area >= 0);
    assert.ok(route.controlPoints >= 2);
    for (let i = 1; i < route.path.length; i++) {
      const a = route.path[i - 1], b = route.path[i];
      assert.ok(connected.has(`${Math.min(a, b)}:${Math.max(a, b)}`), `Disconnected route edge ${a}:${b}`);
    }
  }
  for (let i = 1; i < result.routes.length; i++) assert.ok(result.routes[i - 1].score >= result.routes[i].score);
  return result;
}
(async () => {
  const root = engine.nearest([-34.929, 138.601]).node;
  const snapshots = new Map();
  const direct = await engine.generate(root, 5, scores, 4, 4, popularity, { benchmark: {
    yieldToBrowser: async () => {}, stopAfterRound: 3, captureRounds: [2, 3],
    onCheckpoint: state => snapshots.set(state.completedRounds, JSON.parse(JSON.stringify(state)))
  } });
  let replayedState;
  const replayed = await engine.generate(root, 5, scores, 4, 4, popularity, { benchmark: {
    yieldToBrowser: async () => {}, resume: snapshots.get(2), stopAfterRound: 3, captureRounds: [3],
    onCheckpoint: state => { replayedState = JSON.parse(JSON.stringify(state)); }
  } });
  assert.deepEqual(replayed.routes, direct.routes, 'A replay produces the original round suggestions');
  assert.deepEqual(replayedState, snapshots.get(3), 'Replay restores RNG, beam, counters, tile IDs, route history and LRU order exactly');
  const before = snapshots.get(2).counters, after = snapshots.get(3).counters;
  assert.equal(after.evaluated - before.evaluated, after.expanded - before.expanded, 'A mid-run round scores exactly one route per emitted terminal child, never intermediate outlines');
  for (const route of replayedState.beam) {
    const controls = [root, ...route.points.map(node => replayedState.nodeById[node]), root];
    assert.equal(route.area, createBeamEngine.externalHullArea(controls, data.nodes, data.nodes[root]), 'Area is computed from start/control points, not expanded map vertices');
  }
  await assert.rejects(engine.generate(root, 6, scores, 4, 4, popularity, { benchmark: { resume: snapshots.get(2) } }), /does not match/);
  await assert.rejects(engine.generate(root, 5, scores, 4, 4, popularity, { diversityTileFraction: .2, benchmark: { resume: snapshots.get(2) } }), /does not match/);
  const cbd = await check([-34.929, 138.601], 5, 4, 2);
  const clovelly = await check([-35, 138.575], 5, 4, 2);
  await check([-34.929, 138.601], 25, 2, 1);
  const reserve = await check([-34.99866, 138.5807], 5, 12, 8);
  assert.ok(reserve.search.mutationSteps > reserve.search.expanded, 'Early rounds should use multi-mutation chains without admitting intermediate routes');
  const noGreen = await engine.generate(engine.nearest([-34.99866, 138.5807]).node, 5, { ...scores, green: 0 }, 12, 8, popularity);
  assert.notEqual(noGreen.routes[0].score, reserve.routes[0].score, 'Changing a baked feature weight changes route scores');
  assert.ok(data.poiAnchors?.small?.length && data.poiAnchors?.large?.length, 'Static bundle contains POI control-point anchors');
  assert.ok(cbd.search.legCalls > 0 && cbd.search.legCacheHits > 0, 'Repeated point pairs should be served from the LRU leg cache');
  let cancelled = false;
  const partial = await engine.generate(root, 5, scores, 4, 200, popularity, {
    cancelled: () => cancelled, onProgress: () => { cancelled = true; }, benchmark: { yieldToBrowser: async () => {} }
  });
  assert.ok(partial.search.cancelled && partial.routes.length, 'Cancelling retains the last completed beam suggestions');
  assert.equal(partial.search.iterations, 200, 'The engine accepts the full UI iteration range');
  console.log('Route-space checks passed: closed connected loops, annealed mutation chains, bounded diversity states, live suggestions, POI anchors, checkpoint replay, and control-point area with noded crossings.');
})().catch(error => { console.error(error); process.exitCode = 1; });
