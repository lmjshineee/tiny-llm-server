import { describe, expect, it } from 'vitest'
import { WorkloadConfigError, createWorkloadConfig, generateWorkload } from '../src/core/index'

describe('generateWorkload', () => {
  it('is reproducible from a seed', () => {
    const config = createWorkloadConfig({ numRequests: 40, seed: 123, arrivalRatePerSecond: 2.5 })

    expect(generateWorkload(config)).toEqual(generateWorkload(config))
  })

  it('produces different work for different seeds', () => {
    const first = generateWorkload(createWorkloadConfig({ numRequests: 20, seed: 1 }))
    const second = generateWorkload(createWorkloadConfig({ numRequests: 20, seed: 2 }))

    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second))
  })

  it('emits sorted, bounded, positive token counts with unique ids', () => {
    const config = createWorkloadConfig({
      numRequests: 500,
      seed: 99,
      arrivalRatePerSecond: 8,
      promptTokens: { mean: 300, stddev: 120, min: 32, max: 1024 },
      outputTokens: { mean: 80, stddev: 40, min: 4, max: 256 },
    })
    const requests = generateWorkload(config)

    expect(requests).toHaveLength(500)
    expect(new Set(requests.map((request) => request.id)).size).toBe(500)
    expect(requests[0]?.arrivalTime).toBe(0)

    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index]!
      expect(Number.isSafeInteger(request.promptTokens)).toBe(true)
      expect(request.promptTokens).toBeGreaterThanOrEqual(32)
      expect(request.promptTokens).toBeLessThanOrEqual(1024)
      expect(Number.isSafeInteger(request.maxNewTokens)).toBe(true)
      expect(request.maxNewTokens).toBeGreaterThanOrEqual(4)
      expect(request.maxNewTokens).toBeLessThanOrEqual(256)

      if (index > 0) {
        expect(request.arrivalTime).toBeGreaterThanOrEqual(requests[index - 1]!.arrivalTime)
      }
    }
  })

  it('respects a degenerate zero-variance distribution', () => {
    const requests = generateWorkload(
      createWorkloadConfig({
        numRequests: 5,
        promptTokens: { mean: 64, stddev: 0, min: 1, max: 128 },
        outputTokens: { mean: 8, stddev: 0, min: 1, max: 16 },
      }),
    )

    for (const request of requests) {
      expect(request.promptTokens).toBe(64)
      expect(request.maxNewTokens).toBe(8)
    }
  })

  it('adds deterministic shared-prefix metadata without changing base requests', () => {
    const base = {
      numRequests: 30,
      seed: 9,
      arrivalRatePerSecond: 2,
      promptTokens: { mean: 100, stddev: 20, min: 32, max: 160 },
      outputTokens: { mean: 20, stddev: 4, min: 4, max: 32 },
    }
    const off = generateWorkload(createWorkloadConfig(base))
    const config = createWorkloadConfig({
      ...base,
      prefix: { enabled: true, poolSize: 3, tokens: 64, requestProbability: 1 },
    })
    const on = generateWorkload(config)

    // Prefix assignment uses a separate RNG stream, so A/B workloads match exactly.
    expect(
      on.map((request) => ({
        id: request.id,
        arrivalTime: request.arrivalTime,
        promptTokens: request.promptTokens,
        maxNewTokens: request.maxNewTokens,
      })),
    ).toEqual(off)
    expect(on).toEqual(generateWorkload(config))

    const keys = new Set(on.map((request) => request.prefix?.key))
    expect(keys.size).toBeLessThanOrEqual(3)
    for (const request of on) {
      expect(request.prefix).toBeDefined()
      expect(request.prefix!.tokens).toBe(Math.min(64, request.promptTokens))
      expect(request.prefix!.key).toMatch(/^prefix-[0-2]$/)
    }
  })

  it('keeps prefix metadata off by default and validates its config', () => {
    const requests = generateWorkload(createWorkloadConfig({ numRequests: 5 }))
    for (const request of requests) expect(request.prefix).toBeUndefined()

    expect(() => createWorkloadConfig({ prefix: { enabled: true, poolSize: 0 } })).toThrow(
      WorkloadConfigError,
    )
    expect(() => createWorkloadConfig({ prefix: { enabled: true, tokens: 0 } })).toThrow(
      WorkloadConfigError,
    )
    expect(() =>
      createWorkloadConfig({ prefix: { enabled: true, requestProbability: 1.1 } }),
    ).toThrow(WorkloadConfigError)
  })

  it('rejects invalid workload configs', () => {
    expect(() => createWorkloadConfig({ numRequests: 0 })).toThrow(WorkloadConfigError)
    expect(() => createWorkloadConfig({ arrivalRatePerSecond: 0 })).toThrow(WorkloadConfigError)
    expect(() => createWorkloadConfig({ promptTokens: { min: 100, max: 10 } })).toThrow(
      WorkloadConfigError,
    )
    expect(() => createWorkloadConfig({ outputTokens: { mean: Number.NaN } })).toThrow(
      WorkloadConfigError,
    )
  })
})
