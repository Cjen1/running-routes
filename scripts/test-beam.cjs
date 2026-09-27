const assert = require('node:assert/strict');
global.window = {};
require('../data.js');
const data = window.ADELAIDE_DATA;
assert.ok(!Object.hasOwn(data, 'heatmapAvailable'), 'Published data must not contain a screenshot-derived heatmap flag');
assert.ok(data.edges.every(edge => edge.length === 7 || edge.length === 8), 'Published edges use the heatmap-free schema');
const createBeamEngine = require('../beam-engine.js');
const engine = createBeamEngine(data);
const coordsFromXY = points => points.map(([x, y]) => [y / 111.1, x / 91.2]);
const square = coordsFromXY([[0, 0], [1, 0], [1, 1], [0, 1], [2, 0]]);
const externalArea = (path, coords) => createBeamEngine.externalHullArea(path, coords, coords[0]);
const bitsetRoute = (name, bits, score) => ({ name, tileBits: Uint32Array.of(bits), tileCount: bits.toString(2).replace(/0/g, '').length, score });
const choices = [bitsetRoute('A', 0b110, 12), bitsetRoute('B', 0b010, 11), bitsetRoute('C', 0b001, 10), bitsetRoute('D', 0b100, 9)];
assert.equal(createBeamEngine.diversityStateLimit, 10);
assert.equal(createBeamEngine.diversityCellKm, .5);
assert.equal(createBeamEngine.maxMutationsPerChild, 6);
assert.equal(createBeamEngine.mutationContinuationChance(0, 20), .9);
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
  assert.ok(continuationChances.every((chance, i) => i === 0 || chance <= continuationChances[i - 1]));
  assert.ok(result.search.longestMutationChain >= 1 && result.search.longestMutationChain <= createBeamEngine.maxMutationsPerChild);
  assert.ok(result.search.mutationSteps >= result.search.expanded, 'Intermediate mutations are evaluated before one terminal child enters the beam pool');
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
  const cbd = await check([-34.929, 138.601], 5, 4, 2);
  const clovelly = await check([-35, 138.575], 5, 4, 2);
  await check([-34.929, 138.601], 25, 2, 1);
  const reserve = await check([-34.99866, 138.5807], 5, 12, 8);
  assert.ok(reserve.search.mutationSteps > reserve.search.expanded, 'Early rounds should use multi-mutation chains without admitting intermediate routes');
  const noGreen = await engine.generate(engine.nearest([-34.99866, 138.5807]).node, 5, { ...scores, green: 0 }, 12, 8, popularity);
  assert.notEqual(noGreen.routes[0].score, reserve.routes[0].score, 'Changing a baked feature weight changes route scores');
  assert.ok(data.poiAnchors?.small?.length && data.poiAnchors?.large?.length, 'Static bundle contains POI control-point anchors');
  assert.ok(cbd.search.legCalls > 0 && cbd.search.legCacheHits > 0, 'Repeated point pairs should be served from the LRU leg cache');
  console.log('Route-space checks passed: closed connected loops, annealed mutation chains, bounded diversity states, live suggestions, control points, POI anchors, and external hull area.');
})().catch(error => { console.error(error); process.exitCode = 1; });
