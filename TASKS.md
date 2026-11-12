# Tasks & Milestones

This file is the execution plan and verification record. Each milestone must land with tests,
runnable commands, and a Git commit. Do not mark a milestone complete without a passing
`pnpm check` (typecheck + tests) and an honest note about what is simulated.

Legend: ✅ done · ⏳ next · ☐ planned · ⛔ out of scope

## M0 — Environment and scaffold ✅

- [x] Verify Apple Silicon / memory / OS and Node toolchain.
- [x] Initialize Git repository and strict TypeScript project.
- [x] Add Vitest, fast-check, tsx, and a workspace-local pnpm store.
- [x] Add `.gitignore`, MIT license, and reproducible lockfile.

Environment verified on 2026-11-12:

| Item | Value |
| --- | --- |
| Machine | Apple M5, 16 GB RAM, macOS 27.3 (arm64) |
| Node.js | 24.22.2 |
| pnpm | 12.18.0 |
| TypeScript | 5.9.3 |
| Test runner | Vitest 5.1.0 |
| Property testing | fast-check 4.10.2 |
| Accelerator used | **none** — simulation only |

Commit: `chore: scaffold TypeScript simulation workspace`

## M1 — Minimal event-driven scheduling prototype ✅

Goal: a runnable and tested headless lab for FCFS vs continuous batching.

### Delivered

- [x] Virtual millisecond clock with a min-heap of arrival and step events.
- [x] Request state machine: `waiting → prefill → decode → finished`.
- [x] Prefill and decode phases with chunked prefill and first-token-on-prefill semantics.
- [x] FCFS sequential baseline (one request at a time, no batching).
- [x] Continuous batching: decode-first, FIFO admission, batch/token/KV limits.
- [x] Paged KV cache: configurable block size/capacity, reservations, lazy block growth,
      release, peak accounting, and an invariant checker.
- [x] Plan validation in the engine; schedulers cannot corrupt state.
- [x] Seeded Poisson workload generator with bounded prompt/output distributions.
- [x] TTFT, TPOT, E2E, throughput, P50/P95/P99, average decode batch, KV peaks.
- [x] CLI comparison with matching workload/config and simulated-data warning.
- [x] Unit tests, property tests, deterministic scenario regression test.
- [x] Architecture, README, task plan, and GitHub Actions workflow.

### Verification record (2026-11-12)

| Check | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | pass |
| Tests | `pnpm test` | 9 files, 57 tests, all pass |
| Demo | `pnpm demo` | both policies complete 80/80 requests |
| JSON API | `pnpm demo --json` | valid JSON; `simulated: true`; 2 runs |
| CI workflow | `.github/workflows/ci.yml` | present; not executed on GitHub (no remote yet) |

Commits:
- `feat: add event-driven scheduler simulator and paged KV cache`
- `test: cover scheduler, KV, and simulation invariants`

Reported demo numbers are **simulated**. See README for the captured output and disclaimer.

### Explicit non-goals for M1

- No prefix cache, preemption, real model execution, React UI, or benchmark matrix.
- No hardware benchmark claims.

## M2 — Optional Prefix Cache ⏳

Goal: share identical prompt prefixes at block granularity and expose hit/memory statistics.

### Design tasks

- [ ] Add content-addressed block hashing (hash of block tokens plus parent hash to encode
      position in the sequence).
- [ ] Add ref-counted shared blocks to the allocator while preserving `allocate/free` semantics.
- [ ] Track per-request `sharedBlocks`, `prefixHitTokens`, and `prefixHitBlocks`.
- [ ] Extend `CacheView`/`CacheStats` with shared, unique, and saved-memory counters.
- [ ] Add a workload option for shared prefixes (e.g., a pool of prefixes with per-request
      reuse probability) so hits are meaningful and reproducible.
- [ ] Report hit rate, hit tokens, peak physical vs logical KV usage, and saved prefill tokens.
- [ ] Keep cache hits visible in the CLI summary and future UI.

### Tests / acceptance

- [ ] Two requests with the same 256-token prefix share physical blocks; ref counts stay correct.
- [ ] Divergent suffixes do not share blocks.
- [ ] Freeing one request does not evict blocks still referenced by another.
- [ ] Property test: physical allocated ≤ logical tokens; no double free; ref counts balanced.
- [ ] Same seed produces identical hit statistics.
- [ ] CLI before/after comparison, labeled simulated.

## M3 — Benchmark Harness ⏳

Goal: reproducible scenario matrix and machine-readable results.

- [ ] Declare scenarios: steady, bursty/overloaded, prefix-heavy, short-chat, long-context.
- [ ] Add a matrix runner over scheduler × batch size × KV capacity × prefill chunk size.
- [ ] Expose P99 in the CLI/report (JSON summaries already compute it) and add per-request percentiles.
- [ ] Version the result schema (`schemaVersion`) and include config/seed metadata.
- [ ] Add a `pnpm bench` command with a deterministic smoke scenario for CI.
- [ ] Test schema stability and deterministic summaries.

Acceptance: one command produces a reproducible JSON report; every report carries
`simulated: true`, the cost-model version, and the seed. No hardware claims.

## M4 — React Visualizer ⏳

Goal: visualize queueing, request states, KV block ownership, and metric comparisons.

- [ ] Vite + React + TypeScript app importing `src/core` directly.
- [ ] Scenario controls (seed, load, batch size, KV capacity, prefix cache toggle later).
- [ ] Timeline playback of steps with play/pause/scrub.
- [ ] Queue and running tables with request states and per-request TTFT/TPOT.
- [ ] KV block grid showing free/reserved/allocated/shared blocks.
- [ ] Comparison charts for throughput, TTFT, TPOT, E2E P50/P95, with simulated-data banner.
- [ ] Component tests and a production build check in CI.
- [ ] Core stays headless; UI only consumes `SimulationResult`.

Acceptance: the app runs locally, is usable at 1280×800, and never presents simulated numbers
without the disclaimer.

## M5 — Hardening and OSS polish ☐

- [ ] Coverage thresholds and CI reporting.
- [ ] Optional ESLint/Prettier decision and formatting check.
- [ ] Node 22/24 CI matrix (or a documented minimum-version test).
- [ ] More property tests: event ordering, plan validity, prefix ref-counts, metrics.
- [ ] Performance guard for large simulations (streaming traces / bounded memory).
- [ ] CONTRIBUTING, issue templates, and release notes.
- [ ] Document cost-model assumptions and how to replace them with measured traces.

## Backlog / deliberately out of scope

- ⛔ Real GPU/ANE/CUDA/Ascend execution or hardware benchmark claims.
- ⛔ Distributed serving, multi-node, tensor/pipeline parallelism.
- ⛔ Speculative decoding, constrained decoding, multi-model routing.
- ☐ Preemption/swapping and exact KV admission (revisit after prefix cache).
- ☐ Priority/deadline/SLA-aware scheduling.

## Definition of done (every milestone)

1. `pnpm typecheck` and `pnpm test` pass, including at least one new invariant or property test.
2. A runnable command is documented in README; output is labeled simulated where applicable.
3. Result types remain JSON-serializable and UI-agnostic.
4. No fabricated benchmarks, no hidden hardware assumptions, no out-of-repo writes.
5. Changes are committed with a scoped message; TASKS.md status is updated.

## Commit log (subjects)

- `chore: scaffold TypeScript simulation workspace`
- `feat: add event-driven scheduler simulator and paged KV cache`
- `test: cover scheduler, KV, and simulation invariants`
- `docs: add architecture, roadmap, README, and CI` (this file)
