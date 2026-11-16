import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  DEFAULT_ENGINE_CONFIG,
  createEngineConfig,
  estimateDecodeComputeMs,
  estimateStepLatency,
} from '../src/core/index'
import type { CostModel } from '../src/core/index'

/**
 * Test fixture: 0.5 ms of decode compute per sequence, and a memory term that
 * is cheap enough for the crossover to happen early (visible in the assertions).
 */
const CAPPED: CostModel = {
  stepOverheadMs: 1,
  prefillBaseMs: 5,
  prefillMsPerToken: 0.5,
  decodeBaseMs: 1,
  decodeMsPerRequest: 0.1,
  decodeFlopsPerRequest: 500_000_000,
  decodeFlopsPerSecond: 1_000_000_000_000,
}

/** Same numbers with the cap removed, for the "what changed" comparisons. */
const UNCAPPED: CostModel = {
  stepOverheadMs: CAPPED.stepOverheadMs,
  prefillBaseMs: CAPPED.prefillBaseMs,
  prefillMsPerToken: CAPPED.prefillMsPerToken,
  decodeBaseMs: CAPPED.decodeBaseMs,
  decodeMsPerRequest: CAPPED.decodeMsPerRequest,
}

function decodeStepMs(cost: CostModel, batch: number): number {
  return estimateStepLatency(cost, 0, batch)
}

function aggregateTokensPerSecond(cost: CostModel, batch: number): number {
  return (batch / decodeStepMs(cost, batch)) * 1000
}

describe('decode roofline cap', () => {
  it('leaves the synthetic profile purely additive', () => {
    const cost = DEFAULT_ENGINE_CONFIG.cost
    // Exact equality, not a tolerance: enabling the cap must not move default reports.
    expect(estimateStepLatency(cost, 0, 16)).toBeCloseTo(0.2 + 18 + 16 * 1.2, 10)
    expect(estimateDecodeComputeMs(cost, 16)).toBe(0)
  })

  it('charges the larger of memory and compute', () => {
    expect(estimateDecodeComputeMs(CAPPED, 4)).toBeCloseTo(2, 10)

    // batch 1: memory 1.1 ms beats compute 0.5 ms -> additive step.
    expect(decodeStepMs(CAPPED, 1)).toBeCloseTo(1 + 1.1, 10)
    // batch 3: memory 1.3 ms vs compute 1.5 ms -> compute takes over.
    expect(decodeStepMs(CAPPED, 3)).toBeCloseTo(1 + 1.5, 10)
    // batch 8: compute 4 ms dominates memory 1.8 ms.
    expect(decodeStepMs(CAPPED, 8)).toBeCloseTo(1 + 4, 10)
  })

  it('caps aggregate throughput instead of scaling with batch size', () => {
    // Plateau = decodeFlopsPerSecond / decodeFlopsPerRequest = 2000 tok/s.
    expect(aggregateTokensPerSecond(CAPPED, 2_000)).toBeGreaterThan(1_950)
    expect(aggregateTokensPerSecond(CAPPED, 2_000)).toBeLessThanOrEqual(2_000)

    // Doubling the batch past the knee buys almost nothing...
    const cappedAtSmall = aggregateTokensPerSecond(CAPPED, 64)
    const cappedAtLarge = aggregateTokensPerSecond(CAPPED, 4_000)
    expect(cappedAtLarge - cappedAtSmall).toBeLessThan(150)

    // ...while the uncapped model reaches a far higher bandwidth plateau.
    // At batch 64 the cap costs about 75% of the throughput.
    expect(aggregateTokensPerSecond(UNCAPPED, 64)).toBeGreaterThan(cappedAtSmall * 3)
  })

  it('charges context inside the memory term', () => {
    const cost: CostModel = { ...UNCAPPED, decodeMsPerContextToken: 0.001 }
    // 10 sequences at 1000 KV tokens each: +10 ms of memory-side cost.
    expect(estimateStepLatency(cost, 0, 10, 10_000)).toBeCloseTo(
      estimateStepLatency(cost, 0, 10) + 10,
      10,
    )

    // When the roofline cap makes the step compute-bound, context is not charged
    // twice: memory 1 + 6.4 + 0.1 ms stays below compute 32 ms.
    const capped: CostModel = { ...CAPPED, decodeMsPerContextToken: 1e-7 }
    const computeBound = estimateStepLatency(capped, 0, 64, 1_000_000)
    expect(computeBound).toBeCloseTo(1 + 64 * 0.5, 6)

    // Default profiles have no context term, so this is a no-op for them.
    expect(estimateStepLatency(DEFAULT_ENGINE_CONFIG.cost, 0, 4, 100_000)).toBeCloseTo(
      estimateStepLatency(DEFAULT_ENGINE_CONFIG.cost, 0, 4),
      10,
    )
  })

  it('rejects invalid context arguments and coefficients', () => {
    const cost: CostModel = { ...UNCAPPED, decodeMsPerContextToken: 0.001 }
    expect(() => estimateStepLatency(cost, 0, 1, -1)).toThrow(RangeError)
    expect(() => estimateStepLatency(cost, 0, 1, 1.5)).toThrow(RangeError)
    expect(() =>
      createEngineConfig({ cost: { ...DEFAULT_ENGINE_CONFIG.cost, decodeMsPerContextToken: -1 } }),
    ).toThrow(ConfigError)
    expect(
      'decodeMsPerContextToken' in createEngineConfig({ cost: DEFAULT_ENGINE_CONFIG.cost }).cost,
    ).toBe(false)
  })

  it('rejects a half-configured roofline pair', () => {
    expect(() =>
      createEngineConfig({
        cost: { ...DEFAULT_ENGINE_CONFIG.cost, decodeFlopsPerRequest: 1 },
      }),
    ).toThrow(/must be configured together/)
    expect(() =>
      createEngineConfig({
        cost: { ...DEFAULT_ENGINE_CONFIG.cost, decodeFlopsPerSecond: 1 },
      }),
    ).toThrow(ConfigError)
    expect(() =>
      createEngineConfig({
        cost: {
          ...DEFAULT_ENGINE_CONFIG.cost,
          decodeFlopsPerRequest: 0,
          decodeFlopsPerSecond: 1,
        },
      }),
    ).toThrow(ConfigError)
  })

  it('omits the pair entirely when no profile configures it', () => {
    const uncapped = createEngineConfig({ cost: DEFAULT_ENGINE_CONFIG.cost })
    expect('decodeFlopsPerRequest' in uncapped.cost).toBe(false)
    expect('decodeFlopsPerSecond' in uncapped.cost).toBe(false)

    // The case that matters for the JSON schema: capped configs must serialize.
    const capped = createEngineConfig({ cost: CAPPED })
    expect(capped.cost.decodeFlopsPerRequest).toBe(CAPPED.decodeFlopsPerRequest)
    expect(capped.cost.decodeFlopsPerSecond).toBe(CAPPED.decodeFlopsPerSecond)
  })
})
