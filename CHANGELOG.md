# Changelog

All notable changes to this project are documented here. The project is a simulation lab; all
default latency and throughput values are synthetic and are not hardware measurements.

## [0.5.0] — 2026-11-13

### Added

- Biome lint/format configuration and npm scripts.
- Vitest V8 coverage with enforced statement/branch/function/line thresholds.
- Versioned JSON Schema for benchmark reports, an Ajv validator, and a schema regression test.
- `CONTRIBUTING.md`, issue templates, pull-request template, and this changelog.
- GitHub Pages workflow for the static visualizer, deployed at
  <https://lmjshineee.github.io/tiny-llm-server/>.
- CI and Pages badges plus a live-demo link in the README.
- Node 22/24 CI matrix; lint, format check, coverage, schema validation, and static build gates.

### Changed

- CI now runs benchmark schema validation after the smoke benchmark.
- The Vite build uses relative asset paths so the same artifact works under a Pages project path.
- Package version is `0.5.0`.

### Tests

- 14 test files, 84 tests, including the benchmark schema test.

## [0.4.0] — 2026-11-13

### Added

- React visualizer: timeline playback, scheduler tabs, queue/running/finished request views,
  KV occupancy, prefix-cache status, and FCFS-vs-continuous-batching comparison.
- Per-step KV snapshots and per-request finished metrics (TTFT/TPOT/E2E).
- Deep links for scenario, seed, batch, KV, scheduler tab, and trace step.
- jsdom/Testing Library UI tests and timeline reconstruction tests.
- Headless-Chrome screenshots in `docs/`.

## [0.3.0]

### Added

- Deterministic benchmark harness with five scenarios, a scheduler/batch/chunk/KV matrix,
  P99 metrics, and a versioned JSON report.
- CLI table/JSON workflows and CI smoke coverage for the default, prefix, and benchmark paths.

## [0.2.0]

### Added

- Optional retained prefix cache with block sharing, reference counting, LRU eviction, and hit
  statistics.
- Shared-prefix workload generator and prefix-aware observations.
- Property tests for prefix/cache invariants.

## [0.1.0]

### Added

- Event-driven LLM serving simulator with virtual time, FCFS, and continuous batching.
- Paged KV cache with reservations, block tables, capacity limits, and validation.
- Synthetic analytical cost model, metrics, seed-reproducible workloads, tests, and CI.
