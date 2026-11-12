import { describe, expect, it } from 'vitest'
import {
  ContinuousBatchingScheduler,
  FcfsScheduler,
  PlanValidationError,
  RequestTooLargeError,
  RequestValidationError,
  SimulationLimitError,
  SimulationStalledError,
  createEngineConfig,
  createWorkloadConfig,
  generateWorkload,
  runSimulation,
} from '../src/core/index'
import type { Scheduler, StepPlan } from '../src/core/index'

const FAST_COST = {
  stepOverheadMs: 0.5,
  prefillBaseMs: 1,
  prefillMsPerToken: 1,
  decodeBaseMs: 2,
  decodeMsPerRequest: 1,
} as const

function runWith(
  requests: Parameters<typeof runSimulation>[0]['requests'],
  scheduler: Scheduler,
  overrides: Parameters<typeof createEngineConfig>[0] = {},
) {
  return runSimulation({
    requests,
    scheduler,
    config: createEngineConfig({
      maxBatchSize: 2,
      maxNumBatchedTokens: 8,
      prefillChunkSize: 4,
      kv: { blockSize: 4, totalBlocks: 32 },
      cost: FAST_COST,
      ...overrides,
    }),
  })
}

class StaticScheduler implements Scheduler {
  readonly name: string
  readonly #plan: StepPlan | ((now: number) => StepPlan)

  constructor(name: string, plan: StepPlan | ((now: number) => StepPlan)) {
    this.name = name
    this.#plan = plan
  }

  plan(): StepPlan {
    return typeof this.#plan === 'function' ? this.#plan(0) : this.#plan
  }
}

describe('runSimulation / FCFS', () => {
  it('runs one request at a time and derives exact TTFT/TPOT/E2E', () => {
    const result = runWith(
      [{ id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 }],
      new FcfsScheduler(),
    )

    expect(result.steps).toHaveLength(2)
    expect(result.summary.completedRequests).toBe(1)
    expect(result.requests[0]).toMatchObject({
      id: 'a',
      outputTokens: 2,
      ttftMs: 5.5,
      tpotMs: 3.5,
      e2eMs: 9,
    })
    expect(result.steps[0]).toMatchObject({
      startMs: 0,
      endMs: 5.5,
      prefillTokens: 4,
      decodeTokens: 0,
      batchSize: 1,
    })
    expect(result.steps[1]).toMatchObject({
      startMs: 5.5,
      endMs: 9,
      prefillTokens: 0,
      decodeTokens: 1,
      batchSize: 1,
    })
  })

  it('keeps later arrivals waiting until the active request finishes', () => {
    const result = runWith(
      [
        { id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 },
        { id: 'b', arrivalTime: 1, promptTokens: 4, maxNewTokens: 2 },
      ],
      new FcfsScheduler(),
    )

    expect(result.requests[0]?.timestamps.finishedAt).toBe(9)
    expect(result.requests[1]?.timestamps.admittedAt).toBe(9)
    expect(result.requests[1]?.ttftMs).toBe(13.5)
  })
})

describe('runSimulation / continuous batching', () => {
  it('batches admissions and decode steps', () => {
    const result = runWith(
      [
        { id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 },
        { id: 'b', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 },
      ],
      new ContinuousBatchingScheduler(),
    )

    expect(result.steps).toHaveLength(2)
    expect(result.steps[0]).toMatchObject({
      admitted: ['a', 'b'],
      prefillTokens: 8,
      decodeTokens: 0,
      batchSize: 2,
    })
    expect(result.steps[1]).toMatchObject({ decodeTokens: 2, batchSize: 2 })
    expect(result.requests[0]?.ttftMs).toBe(9.5)
    expect(result.requests[0]?.tpotMs).toBe(4.5)
    expect(result.summary.avgDecodeBatchSize).toBe(2)
  })

  it('admits a waiting request only after KV blocks are freed', () => {
    const requests = [1, 2, 3].map((index) => ({
      id: `r${index}`,
      arrivalTime: 0,
      promptTokens: 8,
      maxNewTokens: 4,
    }))

    const result = runWith(requests, new ContinuousBatchingScheduler(), {
      maxBatchSize: 4,
      maxNumBatchedTokens: 32,
      prefillChunkSize: 8,
      kv: { blockSize: 4, totalBlocks: 6 },
    })

    expect(result.summary.completedRequests).toBe(3)
    expect(result.requests[2]?.timestamps.admittedAt).toBe(31)
    expect(result.summary.kvPeakReservedBlocks).toBe(6)
    expect(result.summary.kvPeakAllocatedBlocks).toBe(6)
    expect(result.cache.allocatedBlocks).toBe(0)
    expect(result.cache.reservedBlocks).toBe(0)
  })

  it('queues arrivals that occur during a step until the next scheduling iteration', () => {
    const result = runWith(
      [
        { id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 1 },
        { id: 'b', arrivalTime: 1, promptTokens: 4, maxNewTokens: 1 },
      ],
      new ContinuousBatchingScheduler(),
    )

    expect(result.requests[0]?.timestamps.finishedAt).toBe(5.5)
    expect(result.requests[1]?.timestamps.admittedAt).toBe(5.5)
    expect(result.requests[1]?.ttftMs).toBe(10)
    expect(result.steps.map((step) => step.startMs)).toEqual([0, 5.5])
  })

  it('reuses a shared prefix while the owner is still active, reducing prefill work', () => {
    const result = runWith(
      [
        {
          id: 'a',
          arrivalTime: 0,
          promptTokens: 12,
          maxNewTokens: 2,
          prefix: { key: 'sys', tokens: 8 },
        },
        {
          id: 'b',
          arrivalTime: 5,
          promptTokens: 12,
          maxNewTokens: 2,
          prefix: { key: 'sys', tokens: 8 },
        },
      ],
      new ContinuousBatchingScheduler(),
      {
        maxBatchSize: 2,
        maxNumBatchedTokens: 16,
        prefillChunkSize: 12,
      },
    )

    expect(result.requests[0]?.prefixHitTokens).toBe(0)
    expect(result.requests[1]?.prefixHitTokens).toBe(8)
    expect(result.requests[1]?.timestamps.admittedAt).toBe(13.5)
    expect(result.requests[1]?.timestamps.firstTokenAt).toBe(22)
    expect(result.requests[1]?.ttftMs).toBe(17)
    expect(result.steps[1]).toMatchObject({
      admitted: ['b'],
      prefilled: [{ requestId: 'b', tokens: 4 }],
      decoded: ['a'],
      prefillTokens: 4,
      decodeTokens: 1,
    })
    expect(result.summary.prefixCache).toEqual({
      hitRequests: 1,
      totalRequests: 2,
      hitTokens: 8,
      totalPromptTokens: 24,
      requestHitRate: 0.5,
      tokenHitRate: 8 / 24,
    })
    expect(result.summary).toMatchObject({
      kvPeakAllocatedBlocks: 6,
      kvPeakPhysicalBlocks: 6,
      kvPeakLogicalBlocks: 8,
      kvPeakSharedBlocks: 2,
      kvPeakCachedBlocks: 2,
    })
    expect(result.cache).toMatchObject({
      allocatedBlocks: 0,
      reservedBlocks: 0,
      cachedBlocks: 2,
      physicalBlocks: 2,
      logicalBlocks: 0,
    })
  })

  it('is deterministic for a seeded workload and differs from FCFS', () => {
    const requests = generateWorkload(
      createWorkloadConfig({
        numRequests: 20,
        seed: 7,
        arrivalRatePerSecond: 2,
        promptTokens: { mean: 40, stddev: 8, min: 16, max: 64 },
        outputTokens: { mean: 16, stddev: 4, min: 4, max: 24 },
      }),
    )
    const config = { maxBatchSize: 4, maxNumBatchedTokens: 32, prefillChunkSize: 8 } as const

    const first = runWith(requests, new ContinuousBatchingScheduler(), config)
    const second = runWith(requests, new ContinuousBatchingScheduler(), config)
    const fcfs = runWith(requests, new FcfsScheduler(), config)

    expect(JSON.stringify(first.summary)).toBe(JSON.stringify(second.summary))
    expect(JSON.stringify(first.steps)).toBe(JSON.stringify(second.steps))
    expect(first.summary.throughputRequestsPerSecond).toBeGreaterThan(
      fcfs.summary.throughputRequestsPerSecond,
    )
  })
})

describe('runSimulation / prefix retention', () => {
  it('hits a prefix retained after the previous owner finished', () => {
    const result = runWith(
      [
        {
          id: 'a',
          arrivalTime: 0,
          promptTokens: 12,
          maxNewTokens: 2,
          prefix: { key: 'sys', tokens: 8 },
        },
        {
          id: 'b',
          arrivalTime: 20,
          promptTokens: 12,
          maxNewTokens: 2,
          prefix: { key: 'sys', tokens: 8 },
        },
      ],
      new FcfsScheduler(),
      {
        maxBatchSize: 2,
        maxNumBatchedTokens: 16,
        prefillChunkSize: 12,
      },
    )

    // A pays the full prefill; B reuses two retained blocks (8 tokens).
    expect(result.requests[0]?.ttftMs).toBe(13.5)
    expect(result.requests[1]?.prefixHitTokens).toBe(8)
    expect(result.requests[1]?.timestamps.admittedAt).toBe(20)
    expect(result.requests[1]?.ttftMs).toBe(5.5)
    expect(result.summary.prefixCache.hitRequests).toBe(1)
    expect(result.summary.prefixCache.tokenHitRate).toBeCloseTo(1 / 3)
    expect(result.cache.cachedBlocks).toBe(2)
    expect(result.cache.allocatedBlocks).toBe(0)
  })
})

describe('runSimulation / empty workload', () => {
  it('handles an empty workload', () => {
    const result = runWith([], new FcfsScheduler())

    expect(result.requests).toEqual([])
    expect(result.steps).toEqual([])
    expect(result.summary.completedRequests).toBe(0)
    expect(result.summary.makespanMs).toBe(0)
    expect(result.summary.ttftMs.p95).toBeNull()
    expect(result.cache.allocatedBlocks).toBe(0)
  })
})

describe('engine guards and plan validation', () => {
  it('rejects an empty plan while work exists', () => {
    const scheduler = new StaticScheduler('stall', { admit: [], prefill: [], decode: [] })
    expect(() =>
      runWith([{ id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 }], scheduler),
    ).toThrow(SimulationStalledError)
  })

  it('rejects prefill plans that exceed the prompt', () => {
    const scheduler = new StaticScheduler('over-prefill', {
      admit: ['a'],
      prefill: [{ requestId: 'a', tokens: 100 }],
      decode: [],
    })

    expect(() =>
      runWith([{ id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 }], scheduler),
    ).toThrow(PlanValidationError)
  })

  it('rejects decoding a request that never prefilled', () => {
    const scheduler = new StaticScheduler('bad-decode', {
      admit: [],
      prefill: [],
      decode: ['a'],
    })

    expect(() =>
      runWith([{ id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 }], scheduler),
    ).toThrow(PlanValidationError)
  })

  it('rejects admissions that overcommit KV headroom', () => {
    const scheduler = new StaticScheduler('over-admit', {
      admit: ['a', 'b'],
      prefill: [
        { requestId: 'a', tokens: 4 },
        { requestId: 'b', tokens: 4 },
      ],
      decode: [],
    })

    expect(() =>
      runWith(
        [
          { id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 4 },
          { id: 'b', arrivalTime: 0, promptTokens: 4, maxNewTokens: 4 },
        ],
        scheduler,
        { kv: { blockSize: 4, totalBlocks: 2 } },
      ),
    ).toThrow(PlanValidationError)
  })

  it('rejects requests larger than the whole KV cache', () => {
    expect(() =>
      runWith([{ id: 'a', arrivalTime: 0, promptTokens: 8, maxNewTokens: 4 }], new FcfsScheduler(), {
        kv: { blockSize: 4, totalBlocks: 2 },
      }),
    ).toThrow(RequestTooLargeError)
  })

  it('rejects invalid prefix metadata', () => {
    expect(() =>
      runWith(
        [
          {
            id: 'a',
            arrivalTime: 0,
            promptTokens: 4,
            maxNewTokens: 2,
            prefix: { key: '', tokens: 4 },
          },
        ],
        new FcfsScheduler(),
      ),
    ).toThrow(RequestValidationError)

    expect(() =>
      runWith(
        [
          {
            id: 'a',
            arrivalTime: 0,
            promptTokens: 4,
            maxNewTokens: 2,
            prefix: { key: 'p', tokens: 8 },
          },
        ],
        new FcfsScheduler(),
      ),
    ).toThrow(RequestValidationError)
  })

  it('rejects invalid and duplicate request specs', () => {
    expect(() =>
      runWith([{ id: 'a', arrivalTime: 0, promptTokens: 0, maxNewTokens: 2 }], new FcfsScheduler()),
    ).toThrow(RequestValidationError)

    expect(() =>
      runWith(
        [
          { id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 },
          { id: 'a', arrivalTime: 1, promptTokens: 4, maxNewTokens: 2 },
        ],
        new FcfsScheduler(),
      ),
    ).toThrow(RequestValidationError)
  })

  it('enforces the maxSteps and maxSimTime guards', () => {
    expect(() =>
      runWith([{ id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 5 }], new FcfsScheduler(), {
        maxSteps: 1,
      }),
    ).toThrow(SimulationLimitError)

    expect(() =>
      runWith([{ id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 }], new FcfsScheduler(), {
        maxSimTimeMs: 1,
      }),
    ).toThrow(SimulationLimitError)
  })
})
