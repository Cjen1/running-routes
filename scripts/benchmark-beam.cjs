// Capture a real CBD mid-search state, then replay exactly one warm-cache round.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const inspector = require('node:inspector');
const { performance } = require('node:perf_hooks');

global.window = {};
require('../data.js');
const data = window.ADELAIDE_DATA;
const createBeamEngine = require('../beam-engine.js');
const engine = createBeamEngine(data);
const args = process.argv.slice(2);
function argument(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[i + 1];
}
const output = path.resolve(argument('--output', 'benchmarks/artifacts/cbd-5k'));
const repeats = Number(argument('--repeats', '7'));
if (!Number.isInteger(repeats) || repeats < 3 || repeats > 50) throw new Error('--repeats must be 3–50');
const replayFile = argument('--replay', null);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const signatures = Object.fromEntries(['data.js', 'beam-engine.js'].map(file => [file, digest(fs.readFileSync(path.join(__dirname, '..', file)))]));
const defaults = {
  point: [-34.929, 138.601], target: 5, width: 32, iterations: 20, capturedRound: 10,
  score: { shop: 10, green: 300, large: 50, small: 40, majorRoad: 1000, crossing: 500, retrace: 1000, area: 10000, imported: 10, over: 150, under: 2000 }
};
const session = new inspector.Session();
session.connect();
const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
const saveJson = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const noYield = async () => {};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = trials => Object.fromEntries(['wallMs', 'cpuMs', 'heapDeltaMiB'].map(key => [key, {
  median: median(trials.map(trial => trial[key])), min: Math.min(...trials.map(trial => trial[key])), max: Math.max(...trials.map(trial => trial[key]))
}]));

function profileBreakdown(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const phases = new Map([
    ['shortestLeg', 'Point-to-point routing/cache'], ['externalHullArea', 'External hull'],
    ['routeMetrics', 'Scenic/POI/retracing scoring'], ['evaluate', 'Route assembly/footprint'],
    ['mutate', 'Control-point mutation'], ['nearbyControl', 'Control-point mutation'],
    ['sampleRoute', 'Control-point mutation'], ['snap', 'Control-point mutation'],
    ['selectBeamRoutes', 'Beam diversity culling'], ['selectFinalRoutes', 'Suggestion diversity DP']
  ]);
  const groups = new Map(), selfTimes = new Map();
  for (let i = 0; i < (profile.samples || []).length; i++) {
    let id = profile.samples[i];
    const leaf = nodes.get(id), ms = profile.timeDeltas[i] / 1000;
    const frame = leaf.callFrame;
    const selfKey = `${frame.functionName || '(anonymous)'} ${frame.url ? path.basename(frame.url) + ':' + (frame.lineNumber + 1) : ''}`.trim();
    selfTimes.set(selfKey, (selfTimes.get(selfKey) || 0) + ms);
    let category = frame.functionName === '(idle)' ? 'Idle/yield waits' : frame.functionName === '(garbage collector)' ? 'Garbage collection' : null;
    while (!category && id !== undefined) {
      const node = nodes.get(id);
      if (node.callFrame.url.endsWith('beam-engine.js')) category = phases.get(node.callFrame.functionName);
      id = parents.get(id);
    }
    category ||= 'Other/runtime';
    groups.set(category, (groups.get(category) || 0) + ms);
  }
  const activeMs = [...groups].filter(([name]) => name !== 'Idle/yield waits').reduce((sum, [, ms]) => sum + ms, 0);
  return {
    sampledActiveMs: activeMs,
    phases: [...groups].map(([phase, sampledMs]) => ({ phase, sampledMs, activePercent: phase === 'Idle/yield waits' ? null : sampledMs / activeMs * 100 })).sort((a, b) => b.sampledMs - a.sampledMs),
    topSelfTime: [...selfTimes].map(([functionName, sampledMs]) => ({ functionName, sampledMs })).sort((a, b) => b.sampledMs - a.sampledMs).slice(0, 20)
  };
}

function trimProfile(profile, startUs, endUs) {
  // V8 TimeTicks and process.hrtime use the same monotonic clock here. Clip
  // away inspector startup/stop overhead, which otherwise dwarfs short rounds.
  assert.ok(startUs >= profile.startTime && endUs <= profile.endTime, 'Profiler and round timers must share a clock');
  let time = profile.startTime;
  const samples = [], timeDeltas = [], hits = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const previous = time;
    time += profile.timeDeltas[i];
    const overlap = Math.min(time, endUs) - Math.max(previous, startUs);
    if (overlap <= 0) continue;
    const id = profile.samples[i];
    samples.push(id); timeDeltas.push(overlap); hits.set(id, (hits.get(id) || 0) + 1);
  }
  return { ...profile, nodes: profile.nodes.map(node => ({ ...node, hitCount: hits.get(node.id) || 0 })), startTime: startUs, endTime: endUs, samples, timeDeltas };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 250 });
  let state, parameters = defaults, naturalTrial, referenceRoutes, referenceStateHash;
  const profiles = [];
  if (replayFile) {
    const saved = JSON.parse(zlib.gunzipSync(fs.readFileSync(replayFile)));
    assert.deepEqual(saved.signatures, signatures, 'Replay requires the same engine and static database');
    ({ state, parameters, referenceRoutes, referenceStateHash } = saved);
  }
  const root = engine.nearest(parameters.point).node;
  const round = parameters.capturedRound + 1;
  const popularity = new Uint8Array(data.nodes.length);
  async function run(resume, yielding, profile, capture) {
    let started, startUs, cpu, heap, trial, resultState;
    const result = await engine.generate(root, parameters.target, parameters.score, parameters.width, parameters.iterations, popularity, { benchmark: {
      resume, stopAfterRound: round, captureRounds: capture ? [parameters.capturedRound, round] : [],
      ...(yielding ? {} : { yieldToBrowser: noYield }),
      beforeRound: async current => {
        if (current !== round) return;
        if (profile) await post('Profiler.start');
        heap = process.memoryUsage().heapUsed; cpu = process.cpuUsage(); started = performance.now(); startUs = Number(process.hrtime.bigint() / 1000n);
      },
      afterRound: async current => {
        if (current !== round) return;
        const endUs = Number(process.hrtime.bigint() / 1000n), wallMs = performance.now() - started, used = process.cpuUsage(cpu);
        trial = { wallMs, cpuMs: (used.user + used.system) / 1000, heapDeltaMiB: (process.memoryUsage().heapUsed - heap) / 2 ** 20 };
        if (profile) {
          const { profile: raw } = await post('Profiler.stop');
          const recorded = trimProfile(raw, startUs, endUs);
          const name = `round-${round}-${yielding ? 'yielding' : 'cpu'}-${profiles.length}.cpuprofile`;
          saveJson(name, recorded); profiles.push({ file: name, ...profileBreakdown(recorded) });
        }
      },
      onCheckpoint: captured => {
        if (captured.completedRounds === parameters.capturedRound) state = JSON.parse(JSON.stringify(captured));
        else resultState = captured;
      }
    } });
    if (referenceRoutes) assert.deepEqual(result.routes, referenceRoutes, 'Round replay must retain the original suggestions');
    if (referenceStateHash && resultState) assert.equal(digest(JSON.stringify(resultState)), referenceStateHash, 'Round replay must reproduce the entire beam and LRU cache order');
    return { trial, result, resultState };
  }
  if (!state) {
    console.log(`Capturing CBD ${parameters.target} km, width ${parameters.width}, iteration ${round}/${parameters.iterations}…`);
    const natural = await run(null, true, true, true);
    naturalTrial = natural.trial; referenceRoutes = natural.result.routes;
    referenceStateHash = digest(JSON.stringify(natural.resultState));
  }
  const captured = { signatures, parameters, state, referenceRoutes, referenceStateHash };
  fs.writeFileSync(path.join(output, 'checkpoint.json.gz'), zlib.gzipSync(JSON.stringify(captured)));
  const originalStateHash = digest(JSON.stringify(state));
  for (let i = 0; i < 2; i++) await run(state, false, false, false);
  const cpuTrials = [], yieldingTrials = [];
  let finalResult;
  for (let i = 0; i < repeats; i++) {
    const trial = await run(state, false, false, i === 0);
    cpuTrials.push(trial.trial); finalResult = trial.result;
    console.log(`CPU replay ${i + 1}/${repeats}: ${trial.trial.wallMs.toFixed(1)} ms`);
  }
  for (let i = 0; i < 3; i++) yieldingTrials.push((await run(state, true, false, false)).trial);
  for (let i = 0; i < 3; i++) await run(state, false, true, false);
  assert.equal(digest(JSON.stringify(state)), originalStateHash, 'Replays must not mutate the saved checkpoint');
  const counters = Object.fromEntries(['evaluated', 'mutationSteps', 'expanded', 'legCalls', 'legCacheHits'].map(key => [key, finalResult.search[key] - state.counters[key]]));
  const report = {
    created: new Date().toISOString(), parameters, signatures,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
    checkpoint: { completedRounds: state.completedRounds, beamRoutes: state.beam.length, cacheEntries: state.legCache.length, cacheLimit: 3000, tiles: state.tileIds.length, graphNodes: state.nodeById.length, compressedEdges: state.compressedEdges, gzipBytes: fs.statSync(path.join(output, 'checkpoint.json.gz')).size },
    counters, cacheHitPercent: counters.legCacheHits / (counters.legCalls + counters.legCacheHits) * 100,
    naturalTrial, cpuReplay: summarize(cpuTrials), yieldingReplay: summarize(yieldingTrials), cpuTrials, yieldingTrials,
    profiles, replayVerified: true,
    scope: 'One mid-run engine iteration, including expansion, culling and live suggestion selection. Excludes database loading, graph preparation, checkpoint I/O and DOM/map rendering. Node/V8, not a browser benchmark; heap/GC layout is not checkpointed.'
  };
  saveJson('report.json', report);
  console.log(JSON.stringify({ checkpoint: report.checkpoint, counters, cacheHitPercent: report.cacheHitPercent, cpuReplay: report.cpuReplay, yieldingReplay: report.yieldingReplay, profiles: profiles.map(p => ({ file: p.file, phases: p.phases })) }, null, 2));
  console.log(`Saved checkpoint, CPU profiles and report to ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => session.disconnect());
