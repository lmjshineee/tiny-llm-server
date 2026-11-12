import {
  ContinuousBatchingScheduler,
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_WORKLOAD_CONFIG,
  FcfsScheduler,
  SIMULATED_LATENCY_NOTE,
  createEngineConfig,
  createWorkloadConfig,
  generateWorkload,
  runSimulation,
} from '../core/index'
import type { SimulationResult } from '../core/index'

const STRATEGY_LABELS: Record<string, string> = {
  fcfs: 'FCFS (sequential)',
  'continuous-batching': 'Continuous batching',
}

const COLUMN_WIDTHS = [24, 8, 10, 10, 10, 10, 10, 11, 15] as const

interface CliOptions {
  requests: number
  rate: number
  seed: number
  promptMean: number
  outputMean: number
  maxBatch: number
  maxBatchedTokens: number
  totalBlocks: number
  prefixCache: boolean
  prefixPool: number
  prefixTokens: number
  prefixProbability: number
  json: boolean
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

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    requests: DEFAULT_WORKLOAD_CONFIG.numRequests,
    rate: DEFAULT_WORKLOAD_CONFIG.arrivalRatePerSecond,
    seed: DEFAULT_WORKLOAD_CONFIG.seed,
    promptMean: DEFAULT_WORKLOAD_CONFIG.promptTokens.mean,
    outputMean: DEFAULT_WORKLOAD_CONFIG.outputTokens.mean,
    maxBatch: DEFAULT_ENGINE_CONFIG.maxBatchSize,
    maxBatchedTokens: DEFAULT_ENGINE_CONFIG.maxNumBatchedTokens,
    totalBlocks: DEFAULT_ENGINE_CONFIG.kv.totalBlocks,
    prefixCache: DEFAULT_WORKLOAD_CONFIG.prefix.enabled,
    prefixPool: DEFAULT_WORKLOAD_CONFIG.prefix.poolSize,
    prefixTokens: DEFAULT_WORKLOAD_CONFIG.prefix.tokens,
    prefixProbability: DEFAULT_WORKLOAD_CONFIG.prefix.requestProbability,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === undefined) continue

    if (raw === '--json') {
      options.json = true
      continue
    }
    if (raw === '--prefix-cache') {
      options.prefixCache = true
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
      case '--requests':
        options.requests = parseNumber(value, flag)
        break
      case '--rate':
        options.rate = parseNumber(value, flag)
        break
      case '--seed':
        options.seed = parseNumber(value, flag)
        break
      case '--prompt-mean':
        options.promptMean = parseNumber(value, flag)
        break
      case '--output-mean':
        options.outputMean = parseNumber(value, flag)
        break
      case '--max-batch':
        options.maxBatch = parseNumber(value, flag)
        break
      case '--budget':
        options.maxBatchedTokens = parseNumber(value, flag)
        break
      case '--blocks':
        options.totalBlocks = parseNumber(value, flag)
        break
      case '--prefix-pool':
        options.prefixPool = parseNumber(value, flag)
        break
      case '--prefix-tokens':
        options.prefixTokens = parseNumber(value, flag)
        break
      case '--prefix-prob':
        options.prefixProbability = parseNumber(value, flag)
        break
      default:
        throw new CliError(`unknown flag "${flag}"`)
    }
  }

  return options
}

function usage(): string {
  return `LLM Serving Lab — Phase 2 prefix cache

Usage:
  pnpm demo [options]

Options:
  --requests <n>       number of requests (default ${DEFAULT_WORKLOAD_CONFIG.numRequests})
  --rate <n>           Poisson arrival rate in req/s (default ${DEFAULT_WORKLOAD_CONFIG.arrivalRatePerSecond})
  --seed <n>           workload seed (default ${DEFAULT_WORKLOAD_CONFIG.seed})
  --prompt-mean <n>    mean prompt tokens (default ${DEFAULT_WORKLOAD_CONFIG.promptTokens.mean})
  --output-mean <n>    mean generated tokens (default ${DEFAULT_WORKLOAD_CONFIG.outputTokens.mean})
  --max-batch <n>      continuous-batching batch size (default ${DEFAULT_ENGINE_CONFIG.maxBatchSize})
  --budget <n>         tokens per step (default ${DEFAULT_ENGINE_CONFIG.maxNumBatchedTokens})
  --blocks <n>         KV cache blocks (default ${DEFAULT_ENGINE_CONFIG.kv.totalBlocks})
  --prefix-cache       enable shared-prefix workload + prefix cache
  --prefix-pool <n>    distinct reusable prefixes (default ${DEFAULT_WORKLOAD_CONFIG.prefix.poolSize})
  --prefix-tokens <n>  target prefix length (default ${DEFAULT_WORKLOAD_CONFIG.prefix.tokens})
  --prefix-prob <p>    fraction of requests using a prefix (default ${DEFAULT_WORKLOAD_CONFIG.prefix.requestProbability})
  --json               print machine-readable summaries
  -h, --help           show this help

All results are SIMULATED with a synthetic analytical cost model.
`
}

function formatMs(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function formatRate(value: number, digits: number): string {
  return value.toFixed(digits)
}

function formatRow(cells: readonly string[]): string {
  return cells
    .map((cell, index) => {
      const width = COLUMN_WIDTHS[index] ?? 10
      return index === 0 ? cell.padEnd(width) : cell.padStart(width)
    })
    .join('  ')
}

function printComparison(options: CliOptions, runs: readonly SimulationResult[]): void {
  const header = formatRow([
    'Strategy',
    'Req/s',
    'Out tok/s',
    'TTFT p50',
    'TTFT p95',
    'TPOT p50',
    'TPOT p95',
    'E2E p95',
    'Peak KV',
  ])
  const divider = '─'.repeat(header.length)

  process.stdout.write('\nResults (all values simulated)\n')
  process.stdout.write(`${header}\n${divider}\n`)

  for (const run of runs) {
    const { summary } = run
    const label = STRATEGY_LABELS[summary.strategy] ?? summary.strategy
    const peakKv = `${summary.kvPeakPhysicalBlocks}/${run.cache.totalBlocks} (${(summary.kvPeakPhysicalUtilization * 100).toFixed(1)}%)`
    process.stdout.write(
      `${formatRow([
        label,
        formatRate(summary.throughputRequestsPerSecond, 2),
        formatRate(summary.throughputOutputTokensPerSecond, 0),
        formatMs(summary.ttftMs.p50),
        formatMs(summary.ttftMs.p95),
        formatMs(summary.tpotMs.p50),
        formatMs(summary.tpotMs.p95),
        formatMs(summary.e2eMs.p95),
        peakKv,
      ])}\n`,
    )
  }

  printPrefixStats(options, runs)

  const fcfs = runs.find((run) => run.summary.strategy === 'fcfs')?.summary
  const continuous = runs.find((run) => run.summary.strategy === 'continuous-batching')?.summary

  if (fcfs !== undefined && continuous !== undefined) {
    const throughputGain =
      fcfs.throughputRequestsPerSecond > 0
        ? continuous.throughputRequestsPerSecond / fcfs.throughputRequestsPerSecond
        : null
    const ttftP95 = fcfs.ttftMs.p95
    const cbTtftP95 = continuous.ttftMs.p95
    const ttftReduction =
      ttftP95 !== null && cbTtftP95 !== null && ttftP95 > 0 ? 1 - cbTtftP95 / ttftP95 : null

    process.stdout.write('\nSimulated deltas (continuous batching vs FCFS)\n')
    process.stdout.write(
      `  throughput: ${throughputGain === null ? 'n/a' : `${throughputGain.toFixed(2)}×`}` +
        `   TTFT p95: ${ttftReduction === null ? 'n/a' : `${(ttftReduction * 100).toFixed(1)}% lower`}\n`,
    )
    process.stdout.write(
      `  completed: ${fcfs.completedRequests}/${fcfs.totalRequests} FCFS, ` +
        `${continuous.completedRequests}/${continuous.totalRequests} continuous\n`,
    )
  }

  process.stdout.write('\n')
  process.stdout.write(`${SIMULATED_LATENCY_NOTE}\n`)
  process.stdout.write(
    `The same ${options.requests}-request seeded workload and cost model were used for both runs.\n`,
  )
  process.stdout.write('These are not Apple Silicon, CUDA, or Ascend hardware measurements.\n')
}

function printPrefixStats(options: CliOptions, runs: readonly SimulationResult[]): void {
  if (!options.prefixCache) return

  const anyHits = runs.some((run) => run.summary.prefixCache.hitTokens > 0)
  process.stdout.write('\nPrefix cache (simulated)\n')

  if (!anyHits) {
    process.stdout.write('  no prefix hits in this run (first use of each prefix always misses)\n')
    return
  }

  for (const run of runs) {
    const summary = run.summary
    const prefix = summary.prefixCache
    const label = STRATEGY_LABELS[summary.strategy] ?? summary.strategy
    const hitRequests = `${prefix.hitRequests}/${prefix.totalRequests}`
    const hitTokens = `${prefix.hitTokens}/${prefix.totalPromptTokens}`
    process.stdout.write(
      `  ${label}: ${hitRequests} hit requests, ${hitTokens} prompt tokens ` +
        `(${(prefix.tokenHitRate * 100).toFixed(1)}%)\n`,
    )
    process.stdout.write(
      `    KV peak: physical ${summary.kvPeakPhysicalBlocks}, logical-active ` +
        `${summary.kvPeakLogicalBlocks}, shared ${summary.kvPeakSharedBlocks}, ` +
        `retained ${summary.kvPeakCachedBlocks} blocks\n`,
    )
  }
}

function printScenario(options: CliOptions): void {
  process.stdout.write('LLM Serving Lab · Phase 2 prefix cache\n')
  process.stdout.write('==================================================\n')
  process.stdout.write('SIMULATED — no model is executed and no GPU/NPU is used.\n\n')
  process.stdout.write(
    `Workload: ${options.requests} requests, Poisson @ ${options.rate} req/s, seed ${options.seed}\n`,
  )
  process.stdout.write(
    `  prompt tokens ~ N(${options.promptMean}, ${DEFAULT_WORKLOAD_CONFIG.promptTokens.stddev}) ` +
      `clamped to [${DEFAULT_WORKLOAD_CONFIG.promptTokens.min}, ${DEFAULT_WORKLOAD_CONFIG.promptTokens.max}]\n`,
  )
  process.stdout.write(
    `  output tokens ~ N(${options.outputMean}, ${DEFAULT_WORKLOAD_CONFIG.outputTokens.stddev}) ` +
      `clamped to [${DEFAULT_WORKLOAD_CONFIG.outputTokens.min}, ${DEFAULT_WORKLOAD_CONFIG.outputTokens.max}]\n`,
  )
  process.stdout.write(
    `Engine: maxBatchSize=${options.maxBatch}, maxNumBatchedTokens=${options.maxBatchedTokens}, ` +
      `prefillChunkSize=${DEFAULT_ENGINE_CONFIG.prefillChunkSize}\n`,
  )
  process.stdout.write(
    `KV: ${options.totalBlocks} blocks × ${DEFAULT_ENGINE_CONFIG.kv.blockSize} tokens ` +
      `= ${options.totalBlocks * DEFAULT_ENGINE_CONFIG.kv.blockSize} slots; ` +
      `prefix cache ${options.prefixCache ? 'on' : 'off'}\n`,
  )
  process.stdout.write(
    `Cost model: prefill ${DEFAULT_ENGINE_CONFIG.cost.prefillBaseMs.toFixed(2)} + ` +
      `${DEFAULT_ENGINE_CONFIG.cost.prefillMsPerToken.toFixed(2)}/token ms; decode ` +
      `${DEFAULT_ENGINE_CONFIG.cost.decodeBaseMs.toFixed(2)} + ` +
      `${DEFAULT_ENGINE_CONFIG.cost.decodeMsPerRequest.toFixed(2)}/sequence ms\n`,
  )
  if (options.prefixCache) {
    process.stdout.write(
      `Prefix workload: ${(options.prefixProbability * 100).toFixed(0)}% of requests reuse one of ` +
        `${options.prefixPool} prefixes of up to ${options.prefixTokens} tokens\n`,
    )
  } else {
    process.stdout.write('Prefix workload: off (no shared prefixes generated)\n')
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }

  const workloadConfig = createWorkloadConfig({
    numRequests: options.requests,
    arrivalRatePerSecond: options.rate,
    seed: options.seed,
    promptTokens: { mean: options.promptMean },
    outputTokens: { mean: options.outputMean },
    prefix: {
      enabled: options.prefixCache,
      poolSize: options.prefixPool,
      tokens: options.prefixTokens,
      requestProbability: options.prefixProbability,
    },
  })

  const engineConfig = createEngineConfig({
    maxBatchSize: options.maxBatch,
    maxNumBatchedTokens: options.maxBatchedTokens,
    kv: { totalBlocks: options.totalBlocks },
  })

  const requests = generateWorkload(workloadConfig)
  const runs = [
    runSimulation({ requests, scheduler: new FcfsScheduler(), config: engineConfig }),
    runSimulation({ requests, scheduler: new ContinuousBatchingScheduler(), config: engineConfig }),
  ]

  if (options.json) {
    const payload = {
      simulated: true,
      note: SIMULATED_LATENCY_NOTE,
      workload: workloadConfig,
      engineConfig,
      runs: runs.map((run) => ({
        strategy: run.summary.strategy,
        summary: run.summary,
      })),
    }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }

  printScenario(options)
  printComparison(options, runs)
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
