import { describe, expect, it } from 'vitest'
import {
  COST_PROFILES,
  ConfigError,
  DEFAULT_COST_PROFILE_ID,
  DEFAULT_ENGINE_CONFIG,
  FcfsScheduler,
  createEngineConfig,
  estimateStepLatency,
  getCostProfile,
  isCostProfileId,
  listCostProfileIds,
  runSimulation,
} from '../src/core/index'

const MEASURED_PROFILE_ID = 'measured-m5-q4-0.5b'

/** Relative comparison so the assertion states a tolerance, not a magic number. */
function expectRelative(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual / expected - 1)).toBeLessThanOrEqual(tolerance)
}

describe('cost profiles', () => {
  it('has unique, resolvable ids and keeps synthetic-v1 as the default', () => {
    const ids = listCostProfileIds()
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_COST_PROFILE_ID)
    expect(ids[0]).toBe(DEFAULT_COST_PROFILE_ID)

    for (const id of ids) {
      expect(isCostProfileId(id)).toBe(true)
      expect(getCostProfile(id).id).toBe(id)
    }
    expect(isCostProfileId('synthetic-v2')).toBe(false)
  })

  it('keeps the default profile identical to the engine default cost model', () => {
    // The synthetic profile must not drift from DEFAULT_ENGINE_CONFIG.cost:
    // that would silently change every existing report.
    expect(getCostProfile(DEFAULT_COST_PROFILE_ID).cost).toEqual(DEFAULT_ENGINE_CONFIG.cost)
  })

  it('produces engine configs that pass validation for every profile', () => {
    for (const profile of COST_PROFILES) {
      const config = createEngineConfig({ cost: profile.cost })
      expect(config.cost).toEqual(profile.cost)
      expect(profile.label.length).toBeGreaterThan(0)
      expect(profile.limitations.length).toBeGreaterThan(0)
    }
  })

  it('names the valid ids when a profile is unknown', () => {
    expect(() => getCostProfile('measured-m4')).toThrow(ConfigError)
    expect(() => getCostProfile('measured-m4')).toThrow(/expected one of synthetic-v1/)
  })

  it('reproduces the calibration points the measured profile was fitted on', () => {
    const cost = getCostProfile(MEASURED_PROFILE_ID).cost

    // calibration-01.md: pp512 = 67.1 ms, single-stream decode = 4.37 ms/token.
    // The profile is a five-point linear fit, so allow 10%.
    expectRelative(estimateStepLatency(cost, 512, 0), 67.1, 0.1)
    expectRelative(estimateStepLatency(cost, 0, 1), 4.37, 0.1)
  })

  it('reproduces the measured batching ceiling within 15%', () => {
    const cost = getCostProfile(MEASURED_PROFILE_ID).cost
    // calibration-01.md §5: phase-separated aggregate decode throughput.
    const measured = [
      { batch: 8, tokPerSecond: 1100 },
      { batch: 16, tokPerSecond: 1308 },
      { batch: 32, tokPerSecond: 1214 },
    ]

    for (const point of measured) {
      const predicted = (point.batch / estimateStepLatency(cost, 0, point.batch)) * 1000
      expectRelative(predicted, point.tokPerSecond, 0.15)
    }
  })

  it('reproduces the measured context-length decay within 15%', () => {
    const cost = getCostProfile(MEASURED_PROFILE_ID).cost
    // calibration-01.md: tg128 at depth 0/8192/16384/30720, in ms per token.
    const measured = [
      { context: 0, msPerToken: 4.421 },
      { context: 8_192, msPerToken: 6.001 },
      { context: 16_384, msPerToken: 8.547 },
      { context: 30_720, msPerToken: 11.858 },
    ]

    for (const point of measured) {
      const predicted = estimateStepLatency(cost, 0, 1, { decodeContextTokens: point.context })
      expectRelative(predicted, point.msPerToken, 0.15)
    }
  })

  it('makes long prompts slower to decode inside the engine', () => {
    const cost = getCostProfile(MEASURED_PROFILE_ID).cost
    const config = createEngineConfig({
      cost,
      maxBatchSize: 1,
      kv: { blockSize: 16, totalBlocks: 512 },
    })

    const run = (promptTokens: number) =>
      runSimulation({
        requests: [{ id: 'r', arrivalTime: 0, promptTokens, maxNewTokens: 16 }],
        scheduler: new FcfsScheduler(),
        config,
      })

    const shortTpot = run(8).summary.tpotMs.p50 ?? 0
    const longTpot = run(4_000).summary.tpotMs.p50 ?? 0
    expect(longTpot).toBeGreaterThan(shortTpot * 1.15)
  })

  it('reproduces long-prompt prefill within 10%', () => {
    const cost = getCostProfile(MEASURED_PROFILE_ID).cost
    // calibration-01.md: whole-prompt prefill, pairs = T(T-1)/2.
    const measured = [
      { prompt: 8_192, ms: 1_969.9 },
      { prompt: 16_384, ms: 6_019.6 },
      { prompt: 30_720, ms: 17_769.2 },
    ]

    for (const point of measured) {
      const pairs = (point.prompt * (point.prompt - 1)) / 2
      const predicted = estimateStepLatency(cost, point.prompt, 0, {
        prefillAttentionPairs: pairs,
      })
      expectRelative(predicted, point.ms, 0.1)
    }
  })

  it('reproduces a 512-token chunk over a long context within 15%', () => {
    const cost = getCostProfile(MEASURED_PROFILE_ID).cost
    // calibration-01.md: pp512 measured at depth 8192/16384/30720.
    const measured = [
      { depth: 8_192, ms: 184.9 },
      { depth: 16_384, ms: 301.3 },
      { depth: 30_720, ms: 521.1 },
    ]

    for (const point of measured) {
      const chunk = 512
      const pairs = chunk * (point.depth + (chunk - 1) / 2)
      const predicted = estimateStepLatency(cost, chunk, 0, { prefillAttentionPairs: pairs })
      expectRelative(predicted, point.ms, 0.15)
    }
  })

  it('records provenance and the known gaps for the measured profile', () => {
    const measured = getCostProfile(MEASURED_PROFILE_ID)
    expect(measured.provenance).not.toBeNull()
    expect(measured.provenance?.source).toBe('docs/learning/notes/calibration-01.md')
    expect(measured.provenance?.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(measured.limitations.join(' ')).toMatch(/context/i)
    expect(measured.limitations.join(' ')).toMatch(/batch/i)
  })
})
