# CBD mid-run benchmark — 28 September 2026

Historical baseline: this report measures the original area calculation on full mapped route vertices, before the control-point approximation was implemented. Saved checkpoints remain attached to the old engine fingerprint.

Follow-up microbenchmark on the same saved 32 candidates: 640 area evaluations per trial, two warm-up trials and five measured trials, interleaving the old and new implementations. Median time fell from **632 ms to 38 ms (~17× faster)** for area calculation alone (~0.99 ms vs ~0.059 ms per candidate). The baseline helper was loaded from Git commit `2c16574`; the new helper used the start and 6–8 control points from the saved state. This is not a claim about total search speed, and the two area values intentionally differ because the new geometry is an approximation.

## Result

The external hull is the largest CPU cost, followed by point-to-point routing. Near-POI geometry is not scanned in this iteration: the static database already contains proximity attribution. Runtime scenic/POI scoring is about 6% of sampled computation. Diversity selection is less than 1%.

Default CBD start `[-34.929, 138.601]`, 5 km, width 32, round **11 of 20**, default scores, no GPX imports. Node v20.12.2, Linux x64, Intel Core i5-1340P. Database and engine hashes, individual trials and profiles are recorded in [report.json](artifacts/cbd-5k/report.json).

| Timing | Median | Range | Trials |
| --- | ---: | ---: | ---: |
| Computation, timer yields disabled | 333 ms | 323–382 ms | 7 |
| Normal Node timer yields enabled | 598 ms | 583–611 ms | 3 |

These are unprofiled replay timings; profiler startup/stop and graph rebuilding are outside the window. Disabling yields changes only scheduling, not mutations, routes, scoring or LRU order. The ~265 ms difference between medians includes scheduling/runtime/GC effects; it is not a precise measurement of timer sleeping alone. The original uninterrupted round was also profiled, separately from these timing trials.

## Where computation is spent

Pooled, non-overlapping sampled time from three CPU-only profiles at a 250 microsecond sampling interval:

| Phase | Share |
| --- | ---: |
| External hull | 42.90% |
| Point-to-point routing and cache handling | 28.00% |
| Route assembly and covered-tile footprint | 9.24% |
| Control-point mutation and snapping | 7.25% |
| Scenic/POI/retracing scoring | 6.16% |
| Garbage collection | 4.37% |
| Other/runtime | 1.40% |
| Live suggestion diversity DP | 0.65% |
| Beam diversity culling | 0.03% |

The hull is recomputed for each of 157 evaluated complete routes. Its implementation reconstructs unique segment adjacency, sorts neighbours and walks the boundary on every evaluation. This is the first place to investigate for a future optimisation. Routing is second: even with a warm cache, this iteration needs 277 new shortest-path searches. The profile bucket also includes cache-hit handling, so 28% is not exclusively A* time.

## Captured state and workload

- State saved after round 10: 32 complete beam routes, 3,000 cached point pairs (the LRU limit), 58 tile IDs, RNG state, route history and counters.
- Those beam routes have 6–8 control points (median 8) but 196–829 expanded map vertices (median 294). The four round-11 suggestions all have 8 control points and respectively 275, 220, 279 and 336 map vertices, including repeated/closing vertices. The hull works on this expanded geometry, not only the control points.
- Graph: 15,331 compressed nodes and 21,648 compressed edges.
- Round 11: 96 terminal children, 157 evaluated mutation steps, 1,033 leg cache hits and 277 misses — **78.85% hit rate** for nontrivial leg lookups.
- The complete compressed checkpoint is 296,910 bytes (~290 KiB), excluding the separately fingerprinted static database.
- Replay checks reproduce the original suggestions and the **entire resulting beam/cache/RNG state**, including LRU eviction order.

Saved locally (large/generated artifacts are Git-ignored):

- [Checkpoint](artifacts/cbd-5k/checkpoint.json.gz)
- [Original mid-run profile](artifacts/cbd-5k/round-11-yielding-0.cpuprofile)
- [CPU replay profile 1](artifacts/cbd-5k/round-11-cpu-1.cpuprofile)
- [CPU replay profile 2](artifacts/cbd-5k/round-11-cpu-2.cpuprofile)
- [CPU replay profile 3](artifacts/cbd-5k/round-11-cpu-3.cpuprofile)

For reproduction commands and measurement limits, see [the benchmark method](README.md). This pass measures the engine in Node/V8, not browser timer behaviour or map rendering. The V8 heap is not checkpointed, so GC timings vary. No performance optimisation or scoring change was applied during this pass.
