import { WorkloadConfigError } from './errors'
import { createRng, sampleExponentialMs, sampleStandardNormal } from './rng'
import type { DeepPartial, RequestSpec } from './types'

export interface TokenDistribution {
  readonly mean: number
  readonly stddev: number
  readonly min: number
  readonly max: number
}

export interface PrefixWorkloadConfig {
  /** Opt-in switch; off keeps the original workload and emits no prefix metadata. */
  readonly enabled: boolean
  /** Number of distinct reusable prefixes. */
  readonly poolSize: number
  /** Target prefix length; clamped to each request's prompt. */
  readonly tokens: number
  /** Fraction of requests that draw a prefix from the pool (0..1). */
  readonly requestProbability: number
}

export interface WorkloadConfig {
  readonly numRequests: number
  /** Poisson arrival rate: average requests per virtual second. */
  readonly arrivalRatePerSecond: number
  readonly seed: number
  readonly promptTokens: TokenDistribution
  readonly outputTokens: TokenDistribution
  readonly prefix: PrefixWorkloadConfig
}

export const DEFAULT_WORKLOAD_CONFIG: WorkloadConfig = {
  numRequests: 80,
  arrivalRatePerSecond: 1.5,
  seed: 42,
  promptTokens: { mean: 512, stddev: 128, min: 64, max: 2048 },
  outputTokens: { mean: 128, stddev: 32, min: 16, max: 512 },
  prefix: {
    enabled: false,
    poolSize: 4,
    tokens: 256,
    requestProbability: 0.75,
  },
}

function assertDistribution(distribution: TokenDistribution, name: string): void {
  if (!Number.isFinite(distribution.mean) || distribution.mean <= 0) {
    throw new WorkloadConfigError(`${name}.mean must be a finite positive number`)
  }
  if (!Number.isFinite(distribution.stddev) || distribution.stddev < 0) {
    throw new WorkloadConfigError(`${name}.stddev must be a finite non-negative number`)
  }
  if (!Number.isSafeInteger(distribution.min) || distribution.min < 1) {
    throw new WorkloadConfigError(`${name}.min must be an integer >= 1`)
  }
  if (!Number.isSafeInteger(distribution.max) || distribution.max < distribution.min) {
    throw new WorkloadConfigError(`${name}.max must be an integer >= ${name}.min`)
  }
}

export function validateWorkloadConfig(config: WorkloadConfig): void {
  if (!Number.isSafeInteger(config.numRequests) || config.numRequests <= 0) {
    throw new WorkloadConfigError('workload.numRequests must be a positive integer')
  }
  if (!Number.isFinite(config.arrivalRatePerSecond) || config.arrivalRatePerSecond <= 0) {
    throw new WorkloadConfigError('workload.arrivalRatePerSecond must be a finite positive number')
  }
  if (!Number.isFinite(config.seed)) {
    throw new WorkloadConfigError('workload.seed must be finite')
  }
  assertDistribution(config.promptTokens, 'workload.promptTokens')
  assertDistribution(config.outputTokens, 'workload.outputTokens')

  const prefix = config.prefix
  if (!Number.isSafeInteger(prefix.poolSize) || prefix.poolSize <= 0) {
    throw new WorkloadConfigError('workload.prefix.poolSize must be a positive integer')
  }
  if (!Number.isSafeInteger(prefix.tokens) || prefix.tokens <= 0) {
    throw new WorkloadConfigError('workload.prefix.tokens must be a positive integer')
  }
  if (
    !Number.isFinite(prefix.requestProbability) ||
    prefix.requestProbability < 0 ||
    prefix.requestProbability > 1
  ) {
    throw new WorkloadConfigError('workload.prefix.requestProbability must be in [0, 1]')
  }
}

export function createWorkloadConfig(overrides: DeepPartial<WorkloadConfig> = {}): WorkloadConfig {
  const base = DEFAULT_WORKLOAD_CONFIG
  const config: WorkloadConfig = {
    numRequests: overrides.numRequests ?? base.numRequests,
    arrivalRatePerSecond: overrides.arrivalRatePerSecond ?? base.arrivalRatePerSecond,
    seed: overrides.seed ?? base.seed,
    promptTokens: {
      mean: overrides.promptTokens?.mean ?? base.promptTokens.mean,
      stddev: overrides.promptTokens?.stddev ?? base.promptTokens.stddev,
      min: overrides.promptTokens?.min ?? base.promptTokens.min,
      max: overrides.promptTokens?.max ?? base.promptTokens.max,
    },
    outputTokens: {
      mean: overrides.outputTokens?.mean ?? base.outputTokens.mean,
      stddev: overrides.outputTokens?.stddev ?? base.outputTokens.stddev,
      min: overrides.outputTokens?.min ?? base.outputTokens.min,
      max: overrides.outputTokens?.max ?? base.outputTokens.max,
    },
    prefix: {
      enabled: overrides.prefix?.enabled ?? base.prefix.enabled,
      poolSize: overrides.prefix?.poolSize ?? base.prefix.poolSize,
      tokens: overrides.prefix?.tokens ?? base.prefix.tokens,
      requestProbability: overrides.prefix?.requestProbability ?? base.prefix.requestProbability,
    },
  }

  validateWorkloadConfig(config)
  return config
}

function sampleClampedTokenCount(
  distribution: TokenDistribution,
  rng: ReturnType<typeof createRng>,
): number {
  const raw =
    distribution.stddev === 0
      ? distribution.mean
      : distribution.mean + sampleStandardNormal(rng) * distribution.stddev
  const rounded = Math.round(raw)
  return Math.min(distribution.max, Math.max(distribution.min, rounded))
}

/**
 * Deterministic synthetic workload: Poisson arrivals with log-normal-ish
 * (normal, clamped) prompt and output lengths.
 *
 * The same seed always produces the same request list. Shared prefixes use a
 * synthetic content key rather than real tokens: the simulator has no prompt
 * text, so `prefix.key` stands in for a hash of the prefix tokens.
 *
 * Prefix assignment uses a separate RNG stream. Enabling prefix metadata
 * therefore leaves arrivals and token lengths identical to the prefix-off
 * workload, which makes A/B comparisons fair.
 */
export function generateWorkload(config: WorkloadConfig): RequestSpec[] {
  validateWorkloadConfig(config)

  const rng = createRng(config.seed)
  const requests: RequestSpec[] = []
  const idWidth = Math.max(3, String(config.numRequests).length)
  let arrivalTime = 0

  for (let index = 0; index < config.numRequests; index += 1) {
    if (index > 0) {
      arrivalTime += sampleExponentialMs(rng, config.arrivalRatePerSecond)
    }

    const promptTokens = sampleClampedTokenCount(config.promptTokens, rng)
    const maxNewTokens = sampleClampedTokenCount(config.outputTokens, rng)

    requests.push({
      id: `req-${String(index + 1).padStart(idWidth, '0')}`,
      arrivalTime,
      promptTokens,
      maxNewTokens,
    })
  }

  if (!config.prefix.enabled) return requests

  const prefixRng = createRng((config.seed ^ 0x9e3779b9) >>> 0)
  return requests.map((request) => {
    const usesPrefix = prefixRng.next() < config.prefix.requestProbability
    if (!usesPrefix) return request

    const poolIndex = Math.min(
      config.prefix.poolSize - 1,
      Math.floor(prefixRng.next() * config.prefix.poolSize),
    )
    const tokens = Math.min(config.prefix.tokens, request.promptTokens)

    return {
      ...request,
      prefix: {
        key: `prefix-${poolIndex}`,
        tokens,
      },
    }
  })
}
