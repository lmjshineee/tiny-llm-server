import { ConfigError } from './errors'
import type { DeepPartial, EngineConfig } from './types'

/**
 * Defaults chosen to be roughly plausible for a 7B-class model in 4-bit on an
 * Apple-silicon-class machine. They are illustrative, NOT measurements.
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = deepFreeze({
  maxNumBatchedTokens: 4096,
  maxBatchSize: 16,
  prefillChunkSize: 512,
  kv: {
    blockSize: 16,
    totalBlocks: 2048,
  },
  cost: {
    stepOverheadMs: 0.2,
    prefillBaseMs: 2,
    prefillMsPerToken: 0.35,
    decodeBaseMs: 18,
    decodeMsPerRequest: 1.2,
  },
  maxSteps: 200_000,
  maxSimTimeMs: 600_000,
})

export const SIMULATED_LATENCY_NOTE =
  'All latency and throughput numbers are produced by a synthetic analytical cost model, not by hardware measurements.'

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got ${String(value)}`)
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${name} must be a finite non-negative number, got ${String(value)}`)
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} must be a finite positive number, got ${String(value)}`)
  }
}

export function validateEngineConfig(config: EngineConfig): void {
  assertPositiveInteger(config.maxNumBatchedTokens, 'config.maxNumBatchedTokens')
  assertPositiveInteger(config.maxBatchSize, 'config.maxBatchSize')
  assertPositiveInteger(config.prefillChunkSize, 'config.prefillChunkSize')
  assertPositiveInteger(config.kv.blockSize, 'config.kv.blockSize')
  assertPositiveInteger(config.kv.totalBlocks, 'config.kv.totalBlocks')
  assertPositiveInteger(config.maxSteps, 'config.maxSteps')
  assertPositiveFinite(config.maxSimTimeMs, 'config.maxSimTimeMs')

  if (config.maxNumBatchedTokens < config.maxBatchSize) {
    throw new ConfigError(
      'config.maxNumBatchedTokens must be >= config.maxBatchSize so that every running request can decode',
    )
  }

  const cost = config.cost
  assertNonNegativeFinite(cost.stepOverheadMs, 'config.cost.stepOverheadMs')
  assertNonNegativeFinite(cost.prefillBaseMs, 'config.cost.prefillBaseMs')
  assertPositiveFinite(cost.prefillMsPerToken, 'config.cost.prefillMsPerToken')
  assertNonNegativeFinite(cost.decodeBaseMs, 'config.cost.decodeBaseMs')
  assertPositiveFinite(cost.decodeMsPerRequest, 'config.cost.decodeMsPerRequest')
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

/** Merge user overrides with the defaults, validate, and return a frozen config. */
export function createEngineConfig(overrides: DeepPartial<EngineConfig> = {}): EngineConfig {
  const base = DEFAULT_ENGINE_CONFIG
  const config: EngineConfig = {
    maxNumBatchedTokens: overrides.maxNumBatchedTokens ?? base.maxNumBatchedTokens,
    maxBatchSize: overrides.maxBatchSize ?? base.maxBatchSize,
    prefillChunkSize: overrides.prefillChunkSize ?? base.prefillChunkSize,
    kv: {
      blockSize: overrides.kv?.blockSize ?? base.kv.blockSize,
      totalBlocks: overrides.kv?.totalBlocks ?? base.kv.totalBlocks,
    },
    cost: {
      stepOverheadMs: overrides.cost?.stepOverheadMs ?? base.cost.stepOverheadMs,
      prefillBaseMs: overrides.cost?.prefillBaseMs ?? base.cost.prefillBaseMs,
      prefillMsPerToken: overrides.cost?.prefillMsPerToken ?? base.cost.prefillMsPerToken,
      decodeBaseMs: overrides.cost?.decodeBaseMs ?? base.cost.decodeBaseMs,
      decodeMsPerRequest: overrides.cost?.decodeMsPerRequest ?? base.cost.decodeMsPerRequest,
    },
    maxSteps: overrides.maxSteps ?? base.maxSteps,
    maxSimTimeMs: overrides.maxSimTimeMs ?? base.maxSimTimeMs,
  }

  validateEngineConfig(config)
  return deepFreeze(config)
}
