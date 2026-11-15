import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_SCENARIO_NAMES,
  BENCHMARK_SCHEMA_VERSION,
  COST_MODEL_VERSION,
  ConfigError,
  runBenchmark,
} from '../src/core/index'

describe('benchmark harness', () => {
  it('prices runs with the requested profile and labels the report', () => {
    const synthetic = runBenchmark({ smoke: true, seed: 7 })
    const measured = runBenchmark({ smoke: true, seed: 7, profileId: 'measured-m5-q4-0.5b' })

    expect(synthetic.costModelVersion).toBe(COST_MODEL_VERSION)
    expect(measured.costModelVersion).toBe('measured-m5-q4-0.5b')
    expect(measured.costModelNote).toContain('Qwen2.5-0.5B')

    // Same workload, same seed: only the cost model differs.
    expect(measured.seed).toBe(synthetic.seed)
    expect(measured.runCount).toBe(synthetic.runCount)
    expect(measured.scenarios[0]?.requestCount).toBe(synthetic.scenarios[0]?.requestCount)

    const measuredTpot = measured.scenarios[0]?.runs[0]?.summary.tpotMs.p50
    const syntheticTpot = synthetic.scenarios[0]?.runs[0]?.summary.tpotMs.p50
    expect(measuredTpot).toBeDefined()
    expect(syntheticTpot).toBeDefined()
    expect(measuredTpot ?? 0).toBeLessThan(syntheticTpot ?? 0)
  })

  it('rejects an unknown cost profile', () => {
    expect(() => runBenchmark({ smoke: true, profileId: 'measured-m4' })).toThrow(ConfigError)
  })

  it('produces a deterministic, versioned, JSON-safe smoke report', () => {
    const first = runBenchmark({ smoke: true })
    const second = runBenchmark({ smoke: true })

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)

    expect(first.schemaVersion).toBe(BENCHMARK_SCHEMA_VERSION)
    expect(first.costModelVersion).toBe(COST_MODEL_VERSION)
    expect(first.simulated).toBe(true)
    expect(first.costModelNote).toMatch(/synthetic/i)
    expect(first.seed).toBe(42)
    expect(first.runCount).toBe(2)
    expect(first.scenarios).toHaveLength(1)
    expect(first.scenarios[0]?.name).toBe('steady')
    expect(first.matrix).toEqual({
      batchSizes: [16],
      prefillChunkSizes: [512],
      kvBlocks: [2048],
    })

    for (const scenario of first.scenarios) {
      expect(scenario.requestCount).toBeGreaterThan(0)
      expect(scenario.runs).toHaveLength(2)
      expect(new Set(scenario.runs.map((run) => run.runId)).size).toBe(2)

      for (const run of scenario.runs) {
        expect(run.summary.completedRequests).toBe(run.summary.totalRequests)
        expect(run.summary.totalRequests).toBe(scenario.requestCount)
        expect(run.summary.e2eMs.p99).not.toBeNull()
        expect(run.summary.ttftMs.p95).not.toBeNull()
        expect(run.engine.maxBatchSize).toBe(16)
        expect(run.engine.prefillChunkSize).toBe(512)
        expect(run.engine.kv.totalBlocks).toBe(2048)
      }
    }
  })

  it('runs every declared scenario under a compact matrix', () => {
    const report = runBenchmark({
      scenarios: [...BENCHMARK_SCENARIO_NAMES],
      batchSizes: [4],
      prefillChunkSizes: [128],
      kvBlocks: [512],
      seed: 7,
    })

    expect(report.runCount).toBe(BENCHMARK_SCENARIO_NAMES.length * 2)
    expect(report.scenarios.map((scenario) => scenario.name)).toEqual([...BENCHMARK_SCENARIO_NAMES])

    for (const scenario of report.scenarios) {
      expect(scenario.workload.seed).toBe(7)
      expect(scenario.runs).toHaveLength(2)
      expect(scenario.runs.map((run) => run.scheduler)).toEqual(['fcfs', 'continuous-batching'])

      for (const run of scenario.runs) {
        expect(run.summary.completedRequests).toBe(scenario.requestCount)
        expect(run.summary.e2eMs.p99).not.toBeNull()
        expect(run.engine.maxBatchSize).toBe(4)
        expect(run.engine.prefillChunkSize).toBe(128)
        expect(run.engine.kv.totalBlocks).toBe(512)
      }
    }

    const prefixScenario = report.scenarios.find((scenario) => scenario.name === 'prefix-heavy')
    expect(prefixScenario).toBeDefined()
    for (const run of prefixScenario?.runs ?? []) {
      expect(run.summary.prefixCache.hitTokens).toBeGreaterThan(0)
      expect(run.summary.prefixCache.tokenHitRate).toBeGreaterThan(0)
    }
  })

  it('honors a custom seed and matrix without duplicate cells', () => {
    const report = runBenchmark({
      scenarios: ['short-chat'],
      seed: 11,
      batchSizes: [8, 8],
      prefillChunkSizes: [256],
      kvBlocks: [1024],
    })

    expect(report.seed).toBe(11)
    expect(report.scenarios[0]?.workload.seed).toBe(11)
    expect(report.matrix).toEqual({
      batchSizes: [8],
      prefillChunkSizes: [256],
      kvBlocks: [1024],
    })
    expect(report.runCount).toBe(2)
    expect(new Set(report.scenarios[0]?.runs.map((run) => run.runId)).size).toBe(2)
  })

  it('rejects unknown scenarios and invalid matrix values', () => {
    expect(() => runBenchmark({ scenarios: ['does-not-exist'] })).toThrow(ConfigError)
    expect(() => runBenchmark({ batchSizes: [] })).toThrow(ConfigError)
    expect(() => runBenchmark({ batchSizes: [0] })).toThrow(ConfigError)
    expect(() => runBenchmark({ kvBlocks: [1.5] })).toThrow(ConfigError)
    expect(() => runBenchmark({ scenarios: [] })).toThrow(ConfigError)
  })
})
