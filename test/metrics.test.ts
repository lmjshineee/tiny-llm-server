import { describe, expect, it } from 'vitest'
import { percentile, summarizeOutcomes, toRequestOutcome } from '../src/core/index'
import type { CacheStats, RequestOutcome, RequestView, StepRecord } from '../src/core/index'

function outcome(overrides: Partial<RequestOutcome> & Pick<RequestOutcome, 'id'>): RequestOutcome {
  return {
    arrivalTime: 0,
    promptTokens: 4,
    maxNewTokens: 2,
    outputTokens: 2,
    prefixHitTokens: 0,
    timestamps: {
      arrivedAt: 0,
      admittedAt: 0,
      prefillStartedAt: 0,
      firstTokenAt: 5,
      finishedAt: 10,
    },
    ttftMs: 5,
    tpotMs: 5,
    e2eMs: 10,
    ...overrides,
    id: overrides.id,
  }
}

const CACHE: CacheStats = {
  blockSize: 4,
  totalBlocks: 10,
  allocatedBlocks: 0,
  reservedBlocks: 0,
  availableBlocks: 10,
  cachedBlocks: 0,
  physicalBlocks: 0,
  logicalBlocks: 0,
  sharedBlocks: 0,
  freeAllocatedBlocks: 10,
  peakAllocatedBlocks: 6,
  peakCachedBlocks: 0,
  peakPhysicalBlocks: 6,
  peakLogicalBlocks: 8,
  peakSharedBlocks: 2,
  peakReservedBlocks: 8,
  activeRequests: 0,
}

function step(index: number, decodeTokens: number): StepRecord {
  return {
    index,
    startMs: index * 10,
    endMs: index * 10 + 10,
    latencyMs: 10,
    admitted: [],
    prefilled: [],
    decoded: [],
    prefillTokens: 0,
    decodeTokens,
    batchSize: decodeTokens,
    cache: {
      allocatedBlocks: 0,
      cachedBlocks: 0,
      physicalBlocks: 0,
      logicalBlocks: 0,
      sharedBlocks: 0,
      reservedBlocks: 0,
      availableBlocks: 10,
    },
  }
}

describe('percentile', () => {
  it('interpolates linearly and handles the edges', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85)
    expect(percentile([1, 2, 3, 4], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4], 1)).toBe(4)
    expect(percentile([7], 0.95)).toBe(7)
    expect(percentile([], 0.5)).toBeNull()
  })

  it('rejects invalid percentiles', () => {
    expect(() => percentile([1], -0.1)).toThrow(RangeError)
    expect(() => percentile([1], 1.1)).toThrow(RangeError)
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError)
  })
})

describe('toRequestOutcome', () => {
  it('computes TTFT, average TPOT, and end-to-end latency', () => {
    const request: RequestView = {
      id: 'a',
      arrivalTime: 10,
      promptTokens: 4,
      maxNewTokens: 5,
      state: 'finished',
      prefilledTokens: 4,
      outputTokens: 5,
      timestamps: {
        arrivedAt: 10,
        admittedAt: 12,
        prefillStartedAt: 12,
        firstTokenAt: 20,
        finishedAt: 100,
      },
    }

    expect(toRequestOutcome(request)).toMatchObject({
      id: 'a',
      outputTokens: 5,
      ttftMs: 10,
      tpotMs: 20,
      e2eMs: 90,
    })
  })

  it('returns null TPOT for a single-token response', () => {
    const request: RequestView = {
      id: 'a',
      arrivalTime: 0,
      promptTokens: 4,
      maxNewTokens: 1,
      state: 'finished',
      prefilledTokens: 4,
      outputTokens: 1,
      timestamps: {
        arrivedAt: 0,
        admittedAt: 0,
        prefillStartedAt: 0,
        firstTokenAt: 8,
        finishedAt: 8,
      },
    }

    const result = toRequestOutcome(request)
    expect(result.tpotMs).toBeNull()
    expect(result.ttftMs).toBe(8)
    expect(result.e2eMs).toBe(8)
  })

  it('refuses to derive metrics for unfinished requests', () => {
    expect(() =>
      toRequestOutcome({
        id: 'a',
        arrivalTime: 0,
        promptTokens: 4,
        maxNewTokens: 2,
        state: 'decode',
        prefilledTokens: 4,
        outputTokens: 1,
        timestamps: { arrivedAt: 0, admittedAt: 0, prefillStartedAt: 0, firstTokenAt: 8 },
      }),
    ).toThrow(/not finished/)
  })
})

describe('summarizeOutcomes', () => {
  it('aggregates throughput, latency distributions, batch size, and KV peaks', () => {
    const outcomes = [
      outcome({
        id: 'a',
        arrivalTime: 0,
        outputTokens: 5,
        ttftMs: 10,
        tpotMs: 22.5,
        e2eMs: 100,
        timestamps: {
          arrivedAt: 0,
          admittedAt: 0,
          prefillStartedAt: 0,
          firstTokenAt: 10,
          finishedAt: 100,
        },
      }),
      outcome({
        id: 'b',
        arrivalTime: 50,
        outputTokens: 1,
        ttftMs: 50,
        tpotMs: null,
        e2eMs: 200,
        timestamps: {
          arrivedAt: 50,
          admittedAt: 50,
          prefillStartedAt: 50,
          firstTokenAt: 100,
          finishedAt: 250,
        },
      }),
    ]

    const summary = summarizeOutcomes(outcomes, [step(0, 2), step(1, 1)], CACHE, 'test')

    expect(summary).toMatchObject({
      strategy: 'test',
      simulated: true,
      totalRequests: 2,
      completedRequests: 2,
      totalSteps: 2,
      makespanMs: 250,
      kvPeakAllocatedBlocks: 6,
      kvPeakReservedBlocks: 8,
      kvPeakCachedBlocks: 0,
      kvPeakPhysicalBlocks: 6,
      kvPeakLogicalBlocks: 8,
      kvPeakSharedBlocks: 2,
      kvPeakUtilization: 0.6,
      kvPeakPhysicalUtilization: 0.6,
      avgDecodeBatchSize: 1.5,
    })
    expect(summary.prefixCache).toEqual({
      hitRequests: 0,
      totalRequests: 2,
      hitTokens: 0,
      totalPromptTokens: 8,
      requestHitRate: 0,
      tokenHitRate: 0,
    })
    expect(summary.throughputRequestsPerSecond).toBeCloseTo(8)
    expect(summary.throughputOutputTokensPerSecond).toBeCloseTo(24)
    expect(summary.ttftMs).toMatchObject({ count: 2, mean: 30, p50: 30, max: 50 })
    expect(summary.ttftMs.p95).toBeCloseTo(48)
    expect(summary.tpotMs).toMatchObject({ count: 1, mean: 22.5, p50: 22.5, max: 22.5 })
    expect(summary.e2eMs).toMatchObject({ count: 2, mean: 150, p95: 195, max: 200 })
  })

  it('summarizes prefix-cache reuse and hit rates', () => {
    const outcomes = [
      outcome({
        id: 'a',
        promptTokens: 12,
        prefixHitTokens: 8,
        timestamps: {
          arrivedAt: 0,
          admittedAt: 0,
          prefillStartedAt: 0,
          firstTokenAt: 10,
          finishedAt: 100,
        },
      }),
      outcome({
        id: 'b',
        promptTokens: 12,
        prefixHitTokens: 0,
        timestamps: {
          arrivedAt: 0,
          admittedAt: 0,
          prefillStartedAt: 0,
          firstTokenAt: 10,
          finishedAt: 100,
        },
      }),
    ]

    const summary = summarizeOutcomes(outcomes, [], CACHE, 'prefix')

    expect(summary.prefixCache).toEqual({
      hitRequests: 1,
      totalRequests: 2,
      hitTokens: 8,
      totalPromptTokens: 24,
      requestHitRate: 0.5,
      tokenHitRate: 8 / 24,
    })
  })

  it('reports null distributions and zero throughput for an empty run', () => {
    const summary = summarizeOutcomes([], [], CACHE, 'empty')

    expect(summary.totalRequests).toBe(0)
    expect(summary.makespanMs).toBe(0)
    expect(summary.throughputRequestsPerSecond).toBe(0)
    expect(summary.ttftMs.count).toBe(0)
    expect(summary.ttftMs.p95).toBeNull()
    expect(summary.avgDecodeBatchSize).toBe(0)
  })
})
