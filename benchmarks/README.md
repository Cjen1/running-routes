# Mid-search CBD benchmark

Run with Node.js 20 or later:

```sh
npm run benchmark
```

The default case uses the application's CBD start (`-34.929, 138.601`), 5 km, the default scores, a width of 32 and a 20-round temperature schedule, with no imported GPX tracks. It captures the boundary after round 10 and measures round 11. The capture contains all 32 beam routes, the complete point-to-point LRU cache in eviction order, tile IDs, route history, counters and the random-number generator state.

Outputs go into the Git-ignored `benchmarks/artifacts/cbd-5k/` directory:

- `checkpoint.json.gz`: the captured routes/cache and inputs, including SHA-256 fingerprints of the engine and static database.
- `report.json`: timings, workload counts, cache-hit rate and sampled CPU phase breakdowns.
- `*.cpuprofile`: CPU profiles, cropped to the iteration's measurement window so inspector startup/shutdown is excluded.

To replay a saved capture in a fresh process:

```sh
npm run benchmark -- --replay benchmarks/artifacts/cbd-5k/checkpoint.json.gz --output benchmarks/artifacts/replay
```

Use `--repeats 3` through `--repeats 50` to change the number of unprofiled CPU trials (default 7). Replays must match the engine and database fingerprints. They verify the resulting suggestions and full beam/cache/RNG state against the original captured round, not just the route score.

## Measurement scope

The initial uninterrupted run profiles the real mid-search iteration. Replay runs restore that state, rebuild the deterministic compressed graph outside the measurement window, warm up twice, and measure one round repeatedly. One set preserves the engine's `setTimeout` yields; another disables only those yields to measure computation separately. Three additional CPU-only profiles use a 250 microsecond sampling interval. Timing trials do not run the profiler.

The window includes control-point mutations, A*/cached legs, complete-route assembly, scoring, external hulls, beam culling, and live suggestion selection. It excludes loading `data.js`, graph preparation, snapshot I/O and DOM/map rendering. The CPU phase buckets attribute each sample to its closest owning search stage, rather than double-counting nested functions. Garbage collection and idle waits are separate buckets.

This is a Node/V8 engine benchmark, not a browser rendering or end-to-end latency benchmark. Browser timer scheduling can differ. The saved state does not include the V8 heap/GC layout; GC and timings can therefore vary between replays even though the search results and cache order are identical. `process.cpuUsage` includes background/runtime threads, so its process-wide CPU milliseconds can exceed wall milliseconds.

The opt-in `options.benchmark` hooks in `beam-engine.js` are used only by the benchmark and tests. Normal browser searches do not capture state or profile rounds. No routing or scoring optimisation is made by the harness.
