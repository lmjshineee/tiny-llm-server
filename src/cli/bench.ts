import { writeFileSync } from 'node:fs'
import {
  BENCHMARK_SCENARIO_NAMES,
  BENCHMARK_SCHEMA_VERSION,
  COST_MODEL_VERSION,
  DEFAULT_BENCHMARK_SEED,
  runBenchmark,
} from '../core/index'
import type { BenchmarkReport, BenchmarkRun } from '../core/index'

const DEFAULT_OUT = 'bench-results.json'
const COLUMN_WIDTHS = [12, 24, 8, 10, 10, 11, 15, 8] as const

interface BenchCliOptions {
  seed: number
  scenarios: string[] | undefined
  smoke: boolean
  json: boolean
  out: string | undefined
  batchSizes: number[] | undefined
  prefillChunkSizes: number[] | undefined
  kvBlocks: number[] | undefined
  help: boolean
}

class CliError extends Error {}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new CliError(`${flag} expects a finite number, got "${value}"`)
  }
  return parsed
}

function parseIntegerList(value: string, flag: string): number[] {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (parts.length === 0) {
    throw new CliError(`${flag} expects a comma-separated list of positive integers`)
  }

  return parts.map((part) => {
    const parsed = Number(part)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new CliError(`${flag} values must be positive integers, got "${part}"`)
    }
    return parsed
  })
}

function parseArgs(argv: readonly string[]): BenchCliOptions {
  const options: BenchCliOptions = {
    seed: DEFAULT_BENCHMARK_SEED,
    scenarios: undefined,
    smoke: false,
    json: false,
    out: undefined,
    batchSizes: undefined,
    prefillChunkSizes: undefined,
    kvBlocks: undefined,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === undefined) continue

    if (raw === '--smoke') {
      options.smoke = true
      continue
    }
    if (raw === '--json') {
      options.json = true
      continue
    }
    if (raw === '--help' || raw === '-h') {
      options.help = true
      continue
    }
    if (!raw.startsWith('--')) {
      throw new CliError(`unexpected argument "${raw}"`)
    }

    const equalsIndex = raw.indexOf('=')
    const flag = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex)
    let value: string | undefined
    if (equalsIndex === -1) {
      value = argv[index + 1]
      index += 1
    } else {
      value = raw.slice(equalsIndex + 1)
    }
    if (value === undefined || value.startsWith('--')) {
      throw new CliError(`missing value for ${flag}`)
    }

    switch (flag) {
      case '--seed':
        options.seed = parseNumber(value, flag)
        break
      case '--out':
        options.out = value
        break
      case '--scenario':
        options.scenarios = [...(options.scenarios ?? []), value]
        break
      case '--batch-sizes':
        options.batchSizes = parseIntegerList(value, flag)
        break
      case '--chunks':
        options.prefillChunkSizes = parseIntegerList(value, flag)
        break
      case '--kv-blocks':
        options.kvBlocks = parseIntegerList(value, flag)
        break
      default:
        throw new CliError(`unknown flag "${flag}"`)
    }
  }

  return options
}

function usage(): string {
  return `LLM Serving Lab — Phase 3 benchmark harness

Usage:
  pnpm bench [options]

Options:
  --scenario <name>       run one scenario (repeatable); default all
  --smoke                 use a small steady scenario + one matrix cell (CI)
  --seed <n>              workload/benchmark seed (default ${DEFAULT_BENCHMARK_SEED})
  --batch-sizes <csv>     batch-size axis (default 8,16)
  --chunks <csv>          prefill-chunk axis (default 256,512)
  --kv-blocks <csv>       KV capacity axis (default 1024,2048)
  --out <path>            write JSON report (default ${DEFAULT_OUT})
  --json                  print the JSON report to stdout
  -h, --help              show this help

Scenarios: ${BENCHMARK_SCENARIO_NAMES.join(', ')}

The full default matrix is 5 scenarios × 2 schedulers × 2 batch sizes × 2 chunk
sizes × 2 KV capacities = 80 runs. All numbers are simulated.
`
}

function formatMs(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function formatRow(cells: readonly string[]): string {
  return cells
    .map((cell, index) => {
      const width = COLUMN_WIDTHS[index] ?? 10
      return index < 2 ? cell.padEnd(width) : cell.padStart(width)
    })
    .join('  ')
}

function peakKv(run: BenchmarkRun): string {
  return `${run.summary.kvPeakPhysicalBlocks}/${run.engine.kv.totalBlocks}`
}

function variantLabel(prefix: string, run: BenchmarkRun): string {
  return `${prefix} b${run.batchSize} c${run.prefillChunkSize} k${run.kvBlocks}`
}

function bestContinuousRun(runs: readonly BenchmarkRun[]): BenchmarkRun | undefined {
  return [...runs]
    .filter((run) => run.scheduler === 'continuous-batching')
    .sort(
      (a, b) =>
        b.summary.throughputRequestsPerSecond - a.summary.throughputRequestsPerSecond ||
        a.runId.localeCompare(b.runId),
    )[0]
}

function printTable(report: BenchmarkReport): void {
  const maxBatch = Math.max(...report.matrix.batchSizes)
  const maxChunk = Math.max(...report.matrix.prefillChunkSizes)
  const maxKv = Math.max(...report.matrix.kvBlocks)

  const header = formatRow([
    'Scenario',
    'Policy / variant',
    'Req/s',
    'TTFT p95',
    'TPOT p95',
    'E2E p99',
    'Peak KV',
    'TokHit%',
  ])
  const divider = '─'.repeat(header.length)

  process.stdout.write(
    `\nMatrix runs: ${report.runCount} · schema ${BENCHMARK_SCHEMA_VERSION} · ` +
      `cost model ${COST_MODEL_VERSION} · seed ${report.seed}\n`,
  )
  process.stdout.write(`${header}\n${divider}\n`)

  for (const scenario of report.scenarios) {
    const baselineCell = (run: BenchmarkRun): boolean =>
      run.batchSize === maxBatch && run.prefillChunkSize === maxChunk && run.kvBlocks === maxKv

    const fcfs = scenario.runs.find((run) => run.scheduler === 'fcfs' && baselineCell(run))
    const continuousBaseline = scenario.runs.find(
      (run) => run.scheduler === 'continuous-batching' && baselineCell(run),
    )
    const bestContinuous = bestContinuousRun(scenario.runs)

    const rows: Array<{ label: string; run: BenchmarkRun }> = []
    if (fcfs !== undefined) rows.push({ label: variantLabel('FCFS base', fcfs), run: fcfs })
    if (continuousBaseline !== undefined) {
      rows.push({ label: variantLabel('CB base', continuousBaseline), run: continuousBaseline })
    }
    if (
      bestContinuous !== undefined &&
      (continuousBaseline === undefined ||
        (bestContinuous.runId !== continuousBaseline.runId &&
          bestContinuous.summary.throughputRequestsPerSecond >
            continuousBaseline.summary.throughputRequestsPerSecond + 1e-9))
    ) {
      rows.push({ label: variantLabel('CB best', bestContinuous), run: bestContinuous })
    }

    for (const { label, run } of rows) {
      process.stdout.write(
        `${formatRow([
          scenario.name,
          label,
          run.summary.throughputRequestsPerSecond.toFixed(2),
          formatMs(run.summary.ttftMs.p95),
          formatMs(run.summary.tpotMs.p95),
          formatMs(run.summary.e2eMs.p99),
          peakKv(run),
          (run.summary.prefixCache.tokenHitRate * 100).toFixed(1),
        ])}\n`,
      )
    }
  }

  process.stdout.write('\n')
  process.stdout.write(
    'Base rows use the largest matrix cell (batch/chunk/KV); CB best is the highest-throughput ' +
      'continuous-batching cell.\n',
  )
  process.stdout.write('All values are SIMULATED by a synthetic analytical cost model.\n')
  process.stdout.write('These are not Apple Silicon, CUDA, or Ascend hardware measurements.\n')
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }

  const report = runBenchmark({
    seed: options.seed,
    smoke: options.smoke,
    ...(options.scenarios !== undefined ? { scenarios: options.scenarios } : {}),
    ...(options.batchSizes !== undefined ? { batchSizes: options.batchSizes } : {}),
    ...(options.prefillChunkSizes !== undefined
      ? { prefillChunkSizes: options.prefillChunkSizes }
      : {}),
    ...(options.kvBlocks !== undefined ? { kvBlocks: options.kvBlocks } : {}),
  })

  const serialized = `${JSON.stringify(report, null, 2)}\n`
  const shouldWrite = options.out !== undefined || !options.json
  const outPath = options.out ?? DEFAULT_OUT

  if (shouldWrite) {
    writeFileSync(outPath, serialized)
  }

  if (options.json) {
    process.stdout.write(serialized)
    return
  }

  process.stdout.write('LLM Serving Lab · Phase 3 benchmark harness\n')
  process.stdout.write('==================================================\n')
  process.stdout.write('SIMULATED — no model is executed and no GPU/NPU is used.\n')
  printTable(report)
  process.stdout.write(`\nWrote ${outPath} (simulated report, schema ${BENCHMARK_SCHEMA_VERSION}).\n`)
}

try {
  main()
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(`error: ${error.message}\n\n${usage()}`)
  } else {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.exitCode = 1
}
