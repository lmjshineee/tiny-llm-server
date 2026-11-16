import { describe, expect, it } from 'vitest'
import {
  COST_PROFILES,
  ConfigError,
  DEFAULT_COST_PROFILE_ID,
  DEFAULT_ENGINE_CONFIG,
  createEngineConfig,
  estimateStepLatency,
  getCostProfile,
  isCostProfileId,
  listCostProfileIds,
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

  it('records provenance and the known gaps for the measured profile', () => {
    const measured = getCostProfile(MEASURED_PROFILE_ID)
    expect(measured.provenance).not.toBeNull()
    expect(measured.provenance?.source).toBe('docs/learning/notes/calibration-01.md')
    expect(measured.provenance?.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(measured.limitations.join(' ')).toMatch(/context/i)
    expect(measured.limitations.join(' ')).toMatch(/batch/i)
  })
})
