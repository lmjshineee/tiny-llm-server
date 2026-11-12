import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  DEFAULT_ENGINE_CONFIG,
  createEngineConfig,
  estimateStepLatency,
} from '../src/core/index'
import type { CostModel } from '../src/core/index'

const COST: CostModel = {
  stepOverheadMs: 0.5,
  prefillBaseMs: 1,
  prefillMsPerToken: 1,
  decodeBaseMs: 2,
  decodeMsPerRequest: 1,
}

describe('createEngineConfig', () => {
  it('exposes a valid, deeply frozen default config', () => {
    const config = createEngineConfig()

    expect(config.maxBatchSize).toBe(DEFAULT_ENGINE_CONFIG.maxBatchSize)
    expect(Object.isFrozen(DEFAULT_ENGINE_CONFIG)).toBe(true)
    expect(Object.isFrozen(DEFAULT_ENGINE_CONFIG.cost)).toBe(true)
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.kv)).toBe(true)
    expect(Object.isFrozen(config.cost)).toBe(true)
    expect(config.maxNumBatchedTokens).toBeGreaterThanOrEqual(config.maxBatchSize)
  })

  it('deep-merges overrides without mutating defaults', () => {
    const config = createEngineConfig({ kv: { totalBlocks: 128 }, cost: { decodeBaseMs: 10 } })

    expect(config.kv.totalBlocks).toBe(128)
    expect(config.kv.blockSize).toBe(DEFAULT_ENGINE_CONFIG.kv.blockSize)
    expect(config.cost.decodeBaseMs).toBe(10)
    expect(config.cost.prefillMsPerToken).toBe(DEFAULT_ENGINE_CONFIG.cost.prefillMsPerToken)
    expect(DEFAULT_ENGINE_CONFIG.kv.totalBlocks).not.toBe(128)
  })

  it('rejects configs where a full decode batch cannot fit in the token budget', () => {
    expect(() => createEngineConfig({ maxBatchSize: 8, maxNumBatchedTokens: 4 })).toThrow(
      ConfigError,
    )
  })

  it('rejects invalid KV and latency parameters', () => {
    expect(() => createEngineConfig({ kv: { blockSize: 0 } })).toThrow(ConfigError)
    expect(() => createEngineConfig({ kv: { totalBlocks: -1 } })).toThrow(ConfigError)
    expect(() =>
      createEngineConfig({ cost: { prefillMsPerToken: 0 } }),
    ).toThrow(ConfigError)
    expect(() =>
      createEngineConfig({ cost: { stepOverheadMs: Number.NaN } }),
    ).toThrow(ConfigError)
  })
})

describe('estimateStepLatency', () => {
  it('returns zero for an empty step', () => {
    expect(estimateStepLatency(COST, 0, 0)).toBe(0)
  })

  it('prices prefill, decode, and mixed steps with the documented formula', () => {
    expect(estimateStepLatency(COST, 4, 0)).toBe(5.5)
    expect(estimateStepLatency(COST, 0, 2)).toBe(4.5)
    expect(estimateStepLatency(COST, 4, 2)).toBe(9.5)
  })

  it('rejects invalid token counts', () => {
    expect(() => estimateStepLatency(COST, -1, 0)).toThrow(RangeError)
    expect(() => estimateStepLatency(COST, 0, 1.5)).toThrow(RangeError)
  })
})
