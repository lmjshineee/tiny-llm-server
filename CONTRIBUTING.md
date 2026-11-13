# Contributing to LLM Serving Lab

Thanks for taking a look. This project is a **simulation lab** for LLM request scheduling, not
a production serving engine. Contributions that improve clarity, reproducibility, tests, and
honest documentation are especially welcome.

## Setup

Requirements: Node.js ≥ 22.12 and pnpm 12.x (developed with Node 24.22.2 and pnpm 12.18.0).

```bash
pnpm install
pnpm dev:web        # local visualizer
pnpm demo           # FCFS vs continuous batching
pnpm check          # typecheck + lint + tests
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm test` | unit, property, benchmark, timeline, and UI tests |
| `pnpm test:coverage` | coverage report with thresholds |
| `pnpm lint` | Biome lint |
| `pnpm format` | apply Biome formatting |
| `pnpm format:check` | verify formatting (CI) |
| `pnpm typecheck` | strict TypeScript |
| `pnpm build:web` | production Vite build |
| `pnpm validate:bench <file>` | validate a benchmark report against JSON Schema |

`pnpm check` is the fast local gate. Before opening a PR, also run `pnpm format:check`,
`pnpm test:coverage`, `pnpm build:web`, and the relevant smoke commands from CI.

## Architecture boundaries

- `src/core/` must stay headless: no DOM, React, Node built-ins, or file/network access.
- Schedulers return a plan; the engine validates and applies state transitions.
- The React app imports core types/results and must not duplicate scheduling logic.
- New result fields should remain JSON-serializable.
- Keep the simulated/measured distinction explicit in code, UI, docs, and tests.

If a change touches KV reservation, prefix sharing, or admission, add an invariant or
property test, not only a happy-path example.

## Simulation policy

- Every latency/throughput number in the default path is **simulated**.
- Do not present synthetic numbers as hardware measurements.
- If you add a measured profile, record machine, model, quantization, runtime, warm-up,
  repetitions, and variance; keep it opt-in and clearly labelled.
- Do not fabricate benchmark results, screenshots, or "production" claims.

## Tests and coverage

CI runs Node 22 and 24, Biome, TypeScript, coverage, the Vite build, JSON smoke tests, and
benchmark schema validation. Current coverage thresholds are in `vitest.config.ts`.

- Fix the behavior, not the assertion, unless the test encoded a wrong assumption.
- Prefer deterministic tests; no wall-clock timing assertions.
- For UI changes, add or update a jsdom test and (if visual) a screenshot.
- If coverage drops, either add tests or explain why the threshold should change in the PR.

## Benchmark report changes

`schemas/benchmark-report.schema.json` is the contract for exported reports.

If you change the report shape:

1. Update `BenchmarkReport` / related types.
2. Bump `BENCHMARK_SCHEMA_VERSION` when the JSON shape changes.
3. Update the schema and `test/benchmark-schema.test.ts`.
4. Run `pnpm bench --smoke --json > bench-smoke.json && pnpm validate:bench bench-smoke.json`.

## Formatting

Biome is the formatter and linter (`biome.json`). Do not hand-format around it:

```bash
pnpm format
pnpm lint
```

## Commits and pull requests

- Keep commits scoped: core, UI, tests, docs, CI.
- Write imperative subjects, e.g. `fix: release KV blocks on preemption`.
- Include the command(s) you ran and the observed result in the PR.
- Note simulated vs measured results explicitly.
- Link related issues; keep PRs reviewable.

### PR checklist

- [ ] `pnpm check` passes.
- [ ] `pnpm format:check` passes.
- [ ] Coverage thresholds pass (`pnpm test:coverage`).
- [ ] `pnpm build:web` passes for UI changes.
- [ ] New behavior has a test or a documented reason.
- [ ] Simulated numbers are labelled; no hardware claims.
- [ ] Docs/CHANGELOG updated when behavior or contracts change.

## Learning track

The Chinese learning materials live in [`docs/learning/`](docs/learning/README.md). They are
optional for contributors but useful for understanding the design trade-offs.

## Questions

Open an issue with the bug/feature template. For security-sensitive reports, avoid posting
exploit details publicly; describe the impact and ask for a private channel.
