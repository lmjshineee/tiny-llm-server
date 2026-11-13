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

## M2 — Optional Prefix Cache ✅

Goal: share identical prompt prefixes at whole-block granularity, retain blocks beyond their
owners, and expose hit/memory statistics.

### Delivered

- [x] Synthetic whole-block content identity (`prefix.key` + token count) because the simulator
      has no real token text. Optional per request.
- [x] Ref-counted shared blocks in the allocator while preserving reserve/append/free semantics.
- [x] Retention after the last owner finishes; LRU eviction of idle cached blocks on demand.
- [x] Per-request `prefixHitTokens`; request/token hit rates in summaries.
- [x] Cache accounting: cached, physical, logical-active, shared, and peak counters; expanded
      invariant checker; validation at the end of every simulation.
- [x] Workload prefix pool, target length, reuse probability, and a separate RNG stream so the
      base arrivals/token counts match an equivalent prefix-off workload.
- [x] Engine lookup at admission, prefill skipping for hit blocks, prefill-intent clamping, and
      a `prompt - 1` hit cap that keeps the normal prefill-first-token path.
- [x] CLI flags (`--prefix-cache`, `--prefix-pool`, `--prefix-tokens`, `--prefix-prob`) and
      prefix hit/memory output.
- [x] Unit, engine, workload, metric, and fast-check property coverage for sharing, free,
      retention, contiguous hits, and eviction.

### Verification record (2026-11-12, Phase 2)

| Check | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | pass |
| Tests | `pnpm test` | 10 files, 73 tests, all pass |
| Default demo | `pnpm demo` | both policies complete 80/80; prefix stats zero |
| Prefix demo | `pnpm demo --prefix-cache` | 58/80 hit requests; 14,848/41,045 prompt tokens (36.2%) |
| JSON API | `pnpm demo --json` | valid JSON; `simulated: true`; summaries include prefix stats |
| CI workflow | `.github/workflows/ci.yml` | includes default + prefix smoke tests; not run on GitHub (no remote) |

Commits:
- `feat: add retained prefix cache and shared-prefix workload`
- `test: cover prefix sharing, eviction, and hit metrics`
- `docs: document prefix cache and update Phase 2 status`

All reported numbers are **simulated**. See README for the captured example.

### Honest simplifications

- Keys are synthetic content identities, not hashes of real prompt tokens.
- Admission still reserves the full worst-case sequence. Prefix hits save prefill work and
  physical duplication, not admission headroom.
- A prefix that covers the whole prompt leaves one block to recompute.
- Concurrent misses on the same prefix can duplicate work.
- Cache lookup/hash latency is not charged; eviction is demand-driven, not background.

## M3 — Benchmark Harness ✅

Goal: reproducible scenario matrix and machine-readable results.

### Delivered

- [x] Five declared scenarios: steady, bursty, prefix-heavy, short-chat, long-context.
- [x] Matrix runner over scheduler × batch size × KV capacity × prefill chunk size
      (default 80 runs).
- [x] Versioned report (`schemaVersion: "1.0"`, `costModelVersion: "synthetic-v1"`), seed,
      normalized matrix, workloads, engine configs, and per-run summaries.
- [x] P99 exposed in CLI tables and JSON; P50/P95/P99 for TTFT, TPOT, and E2E.
- [x] Deterministic reports: no wall-clock fields; same options produce byte-identical JSON.
- [x] `pnpm bench`, `--scenario`, `--seed`, axis overrides, `--out`, `--json`, and `--smoke`.
- [x] Benchmark tests for schema, determinism, matrix overrides, all scenarios, and prefix hits.
- [x] CI benchmark smoke test.

### Verification record (2026-11-12, Phase 3)

| Check | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | pass |
| Tests | `pnpm test` | 11 files, 77 tests, all pass |
| Full benchmark | `pnpm bench` | 80 runs, JSON report written |
| Bench smoke | `pnpm bench --smoke --json` | 2 runs, schema 1.0, all requests complete |
| Determinism | benchmark test | byte-identical JSON across repeated runs |
| CI workflow | `.github/workflows/ci.yml` | default + prefix + benchmark smoke steps; not run on GitHub (no remote) |

Commits:
- `feat: add deterministic benchmark harness and scenario matrix`
- `test: cover benchmark schema, matrix, and determinism`
- `docs: document benchmark harness and update Phase 3 status`

### Scope notes

- Reports are summary-only (no step traces) and always marked `simulated: true`.
- No hardware benchmark claims; the cost model is synthetic.
- FCFS batch/KV matrix cells are often behaviorally identical because FCFS is sequential.
  This is expected and useful as an invariance check.

## M4 — React Visualizer ✅

Goal: visualize queueing, request states, KV occupancy, and metric comparisons while keeping
the scheduler core headless.

### Delivered

- [x] Vite + React + TypeScript app importing `src/core` directly.
- [x] Controls for scenario, seed, max batch size, and KV capacity; both policies run against
      identical requests and engine config.
- [x] Timeline playback (play/pause/scrub), scheduler tabs, and per-step timing/token chips.
- [x] Waiting queue and running prefill/decode states with prompt/output progress, prefix-hit
      badges, and logical block counts.
- [x] Per-request finished-request table with TTFT, TPOT, E2E, and prefix-hit tokens.
- [x] KV occupancy from per-step snapshots: active, retained, shared, logical, reserved,
      available, and an explicitly aggregate capacity map. Physical block IDs are not traced.
- [x] Comparison of throughput, output throughput, TTFT/TPOT/E2E P50/P95/P99, prefix hit rate,
      and KV peaks, with simulated-data banners.
- [x] Deep links for scenario, seed, batch, KV, tab, and step fraction.
- [x] jsdom + Testing Library tests for rendering, reruns, scrubbing, and deep links.
- [x] Vite production build in CI; screenshots verified with local headless Chrome at 1440,
      1280, and 820 px widths.
- [x] Core stays headless; the UI only consumes results and trace snapshots.

### Verification record (2026-11-13, Phase 4)

| Check | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | pass |
| Tests | `pnpm test` | 13 files, 83 tests, all pass |
| Web build | `pnpm build:web` | pass (`dist-web/`) |
| UI render | local Vite preview + headless Chrome | screenshots in `docs/` |
| Deep links | `?scenario=prefix-heavy&tab=fcfs` test | pass |
| CI workflow | `.github/workflows/ci.yml` | includes `pnpm build:web`; not run on GitHub (no remote) |

Commits:
- `feat: add React scheduler visualizer`
- `test: cover visualizer timeline, UI, and deep links`
- `docs: document visualizer and update Phase 4 status`

### Honest limitations

- The KV map is aggregate occupancy, not physical block IDs; the trace stores snapshots.
- Simulations run synchronously on the main thread; no Web Worker yet.
- The UI uses the five benchmark scenarios; arbitrary prompt text is not supported.
- Screenshots contain simulated values and are labeled accordingly.

## M5 — Hardening and OSS polish ⏳

- [ ] Coverage thresholds and CI reporting.
- [ ] Optional ESLint/Prettier decision and formatting check.
- [ ] Node 22/24 CI matrix (or a documented minimum-version test).
- [ ] More property tests: event ordering, plan validity, and metrics edge cases.
- [ ] Performance guard for large simulations (streaming traces / bounded memory).
- [ ] CONTRIBUTING, issue templates, and release notes.
- [ ] Document cost-model assumptions and how to replace them with measured traces.

## Backlog / deliberately out of scope

- ⛔ Real GPU/ANE/CUDA/Ascend execution or hardware benchmark claims.
- ⛔ Distributed serving, multi-node, tensor/pipeline parallelism.
- ⛔ Speculative decoding, constrained decoding, multi-model routing.
- ☐ Preemption/swapping and prefix-aware KV admission.
- ☐ Real token-content hashing; charge cache lookup/hash latency; avoid duplicate concurrent misses.
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
- `docs: add architecture, roadmap, README, and CI`
- `feat: add retained prefix cache and shared-prefix workload`
- `test: cover prefix sharing, eviction, and hit metrics`
- `docs: document prefix cache and update Phase 2 status`
- `feat: add deterministic benchmark harness and scenario matrix`
- `test: cover benchmark schema, matrix, and determinism`
- `docs: document benchmark harness and update Phase 3 status`
- `feat: add React scheduler visualizer`
- `test: cover visualizer timeline, UI, and deep links`
- `docs: document visualizer and update Phase 4 status`
