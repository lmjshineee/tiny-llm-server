import { SIMULATED_LATENCY_NOTE, createEngineConfig } from './config'
import { ConfigError } from './errors'
import { runSimulation } from './engine'
import { ContinuousBatchingScheduler } from './schedulers/continuous-batching'
import { FcfsScheduler } from './schedulers/fcfs'
import { createWorkloadConfig, generateWorkload } from './workload'
import type { DeepPartial, EngineConfig, Scheduler, Summary } from './types'
import type { WorkloadConfig } from './workload'

/** Bump when the JSON shape changes. */
export const BENCHMARK_SCHEMA_VERSION = '1.0' as const
/** Bump when the synthetic cost-model defaults change. */
export const COST_MODEL_VERSION = 'synthetic-v1' as const
export const DEFAULT_BENCHMARK_SEED = 42

export const SCHEDULER_KINDS = ['fcfs', 'continuous-batching'] as const
export type SchedulerKind = (typeof SCHEDULER_KINDS)[number]

interface ScenarioSpec {
  readonly name: string
  readonly description: string
  readonly workload: DeepPartial<WorkloadConfig>
  readonly engine?: DeepPartial<EngineConfig>
}

const SCENARIO_SPECS: readonly ScenarioSpec[] = [
  {
    name: 'steady',
    description: 'Moderate Poisson load; no shared prefixes.',
    workload: {
      numRequests: 60,
      arrivalRatePerSecond: 1.5,
      promptTokens: { mean: 512, stddev: 128, min: 64, max: 2048 },
      outputTokens: { mean: 128, stddev: 32, min: 16, max: 512 },
    },
  },
  {
    name: 'bursty',
    description: 'Overloaded arrivals; queueing and head-of-line blocking dominate.',
    workload: {
      numRequests: 80,
      arrivalRatePerSecond: 6,
      promptTokens: { mean: 256, stddev: 64, min: 64, max: 512 },
      outputTokens: { mean: 96, stddev: 24, min: 16, max: 192 },
    },
  },
  {
    name: 'prefix-heavy',
    description: '90% of requests reuse one of two 256-token prefixes.',
    workload: {
      numRequests: 60,
      arrivalRatePerSecond: 1.5,
      promptTokens: { mean: 512, stddev: 128, min: 128, max: 1024 },
      outputTokens: { mean: 96, stddev: 24, min: 16, max: 192 },
      prefix: {
        enabled: true,
        poolSize: 2,
        tokens: 256,
        requestProbability: 0.9,
      },
    },
  },
  {
    name: 'short-chat',
    description: 'Short prompts and outputs at a high request rate.',
    workload: {
      numRequests: 80,
      arrivalRatePerSecond: 4,
      promptTokens: { mean: 96, stddev: 24, min: 16, max: 256 },
      outputTokens: { mean: 48, stddev: 12, min: 8, max: 128 },
    },
    engine: {
      maxNumBatchedTokens: 2048,
    },
  },
  {
    name: 'long-context',
    description: 'Long prompts with sparse arrivals; KV capacity matters.',
    workload: {
      numRequests: 24,
      arrivalRatePerSecond: 0.5,
      promptTokens: { mean: 2048, stddev: 384, min: 1024, max: 3072 },
      outputTokens: { mean: 96, stddev: 24, min: 16, max: 192 },
    },
  },
]

export const BENCHMARK_SCENARIO_NAMES: readonly string[] = SCENARIO_SPECS.map(
  (scenario) => scenario.name,
)

export interface BenchmarkOptions {
  readonly seed?: number
  readonly scenarios?: readonly string[]
  /** A small deterministic matrix for CI and quick sanity checks. */
  readonly smoke?: boolean
  readonly batchSizes?: readonly number[]
  readonly prefillChunkSizes?: readonly number[]
  readonly kvBlocks?: readonly number[]
}

export interface BenchmarkMatrix {
  readonly batchSizes: readonly number[]
  readonly prefillChunkSizes: readonly number[]
  readonly kvBlocks: readonly number[]
}

export interface BenchmarkRun {
  readonly runId: string
  readonly scheduler: SchedulerKind
  readonly batchSize: number
  readonly prefillChunkSize: number
  readonly kvBlocks: number
  readonly engine: EngineConfig
  readonly summary: Summary
}

export interface BenchmarkScenario {
  readonly name: string
  readonly description: string
  readonly workload: WorkloadConfig
  readonly requestCount: number
  readonly runs: readonly BenchmarkRun[]
}

export interface BenchmarkReport {
  readonly schemaVersion: typeof BENCHMARK_SCHEMA_VERSION
  readonly simulated: true
  readonly costModelVersion: typeof COST_MODEL_VERSION
  readonly costModelNote: string
  readonly seed: number
  readonly matrix: BenchmarkMatrix
  readonly runCount: number
  readonly scenarios: readonly BenchmarkScenario[]
}

function normalizePositiveIntegers(
  values: readonly number[] | undefined,
  fallback: readonly number[],
  name: string,
): readonly number[] {
  const source = values ?? fallback
  if (source.length === 0) {
    throw new ConfigError(`benchmark.${name} must contain at least one value`)
  }

  const unique: number[] = []
  const seen = new Set<number>()
  for (const value of source) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ConfigError(`benchmark.${name} values must be positive integers, got ${String(value)}`)
    }
    if (!seen.has(value)) {
      seen.add(value)
      unique.push(value)
    }
  }
  return unique
}

function selectScenarios(options: BenchmarkOptions): readonly ScenarioSpec[] {
  const names = options.scenarios ?? (options.smoke ? ['steady'] : BENCHMARK_SCENARIO_NAMES)

  if (names.length === 0) {
    throw new ConfigError('benchmark.scenarios must contain at least one scenario')
  }

  const unknown = names.filter((name) => !BENCHMARK_SCENARIO_NAMES.includes(name))
  if (unknown.length > 0) {
    throw new ConfigError(
      `unknown benchmark scenario(s): ${unknown.join(', ')}; available: ${BENCHMARK_SCENARIO_NAMES.join(', ')}`,
    )
  }

  return SCENARIO_SPECS.filter((scenario) => names.includes(scenario.name))
}

function createScheduler(kind: SchedulerKind): Scheduler {
  return kind === 'fcfs' ? new FcfsScheduler() : new ContinuousBatchingScheduler()
}

/**
 * Run a deterministic benchmark matrix.
 *
 * No wall-clock timestamp is included, so the same options produce byte-identical
 * JSON. Results are summaries only; per-request traces stay in the live simulator.
 */
export function runBenchmark(options: BenchmarkOptions = {}): BenchmarkReport {
  const seed = options.seed ?? DEFAULT_BENCHMARK_SEED
  if (!Number.isFinite(seed)) {
    throw new ConfigError('benchmark.seed must be finite')
  }

  const scenarios = selectScenarios(options)
  const matrix: BenchmarkMatrix = {
    batchSizes: options.smoke
      ? [16]
      : normalizePositiveIntegers(options.batchSizes, [8, 16], 'batchSizes'),
    prefillChunkSizes: options.smoke
      ? [512]
      : normalizePositiveIntegers(options.prefillChunkSizes, [256, 512], 'prefillChunkSizes'),
    kvBlocks: options.smoke
      ? [2048]
      : normalizePositiveIntegers(options.kvBlocks, [1024, 2048], 'kvBlocks'),
  }

  const scenarioReports: BenchmarkScenario[] = []

  for (const scenario of scenarios) {
    const workload = createWorkloadConfig({ ...scenario.workload, seed })
    const requests = generateWorkload(workload)
    const runs: BenchmarkRun[] = []

    for (const schedulerKind of SCHEDULER_KINDS) {
      for (const batchSize of matrix.batchSizes) {
        for (const prefillChunkSize of matrix.prefillChunkSizes) {
          for (const kvBlocks of matrix.kvBlocks) {
            const engine = createEngineConfig({
              ...scenario.engine,
              maxBatchSize: batchSize,
              prefillChunkSize,
              kv: {
                ...(scenario.engine?.kv ?? {}),
                totalBlocks: kvBlocks,
              },
            })

            const result = runSimulation({
              requests,
              scheduler: createScheduler(schedulerKind),
              config: engine,
            })

            runs.push({
              runId:
                `${scenario.name}--${schedulerKind}` +
                `--b${batchSize}--c${prefillChunkSize}--k${kvBlocks}`,
              scheduler: schedulerKind,
              batchSize,
              prefillChunkSize,
              kvBlocks,
              engine,
              summary: result.summary,
            })
          }
        }
      }
    }

    scenarioReports.push({
      name: scenario.name,
      description: scenario.description,
      workload,
      requestCount: requests.length,
      runs,
    })
  }

  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    simulated: true,
    costModelVersion: COST_MODEL_VERSION,
    costModelNote: SIMULATED_LATENCY_NOTE,
    seed,
    matrix,
    runCount: scenarioReports.reduce((total, scenario) => total + scenario.runs.length, 0),
    scenarios: scenarioReports,
  }
}
