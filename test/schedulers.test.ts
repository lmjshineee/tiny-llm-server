import { describe, expect, it } from 'vitest'
import { ContinuousBatchingScheduler, FcfsScheduler } from '../src/core/index'
import type { SchedulingContext } from '../src/core/index'
import { makeCacheView, makeRequestView, testConfig } from './helpers'

function fcfsContext(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    now: 0,
    waiting: [],
    running: [],
    cache: makeCacheView(),
    config: testConfig(),
    ...overrides,
  }
}

describe('FcfsScheduler', () => {
  it('returns an empty plan when there is no work', () => {
    const plan = new FcfsScheduler().plan(fcfsContext())
    expect(plan).toEqual({ admit: [], prefill: [], decode: [] })
  })

  it('admits and chunks the head request', () => {
    const request = makeRequestView({ id: 'r1', promptTokens: 100 })
    const plan = new FcfsScheduler().plan(
      fcfsContext({
        waiting: [request],
        config: testConfig({ prefillChunkSize: 32 }),
      }),
    )

    expect(plan.admit).toEqual(['r1'])
    expect(plan.prefill).toEqual([{ requestId: 'r1', tokens: 32 }])
    expect(plan.decode).toEqual([])
  })

  it('admits only one request at a time, even with batch headroom', () => {
    const waiting = [
      makeRequestView({ id: 'r1', promptTokens: 8 }),
      makeRequestView({ id: 'r2', promptTokens: 8 }),
    ]
    const plan = new FcfsScheduler().plan(
      fcfsContext({ waiting, config: testConfig({ maxBatchSize: 4 }) }),
    )

    expect(plan.admit).toEqual(['r1'])
    expect(plan.prefill).toEqual([{ requestId: 'r1', tokens: 8 }])
  })

  it('keeps decoding the active request instead of admitting a newcomer', () => {
    const active = makeRequestView({ id: 'r1', state: 'decode', outputTokens: 2 })
    const waiting = [makeRequestView({ id: 'r2', promptTokens: 8 })]
    const plan = new FcfsScheduler().plan(fcfsContext({ running: [active], waiting }))

    expect(plan.decode).toEqual(['r1'])
    expect(plan.admit).toEqual([])
    expect(plan.prefill).toEqual([])
  })

  it('continues a partially prefilled request', () => {
    const active = makeRequestView({
      id: 'r1',
      state: 'prefill',
      promptTokens: 40,
      prefilledTokens: 12,
    })
    const plan = new FcfsScheduler().plan(
      fcfsContext({ running: [active], config: testConfig({ prefillChunkSize: 16 }) }),
    )

    expect(plan.prefill).toEqual([{ requestId: 'r1', tokens: 16 }])
  })

  it('waits when the head request does not fit in available KV blocks', () => {
    const waiting = [
      makeRequestView({ id: 'big', promptTokens: 900, maxNewTokens: 100 }),
      makeRequestView({ id: 'small', promptTokens: 8 }),
    ]
    const plan = new FcfsScheduler().plan(
      fcfsContext({
        waiting,
        cache: makeCacheView({ totalBlocks: 16, blockSize: 4, availableBlocks: 16 }),
      }),
    )

    expect(plan).toEqual({ admit: [], prefill: [], decode: [] })
  })
})

function cbContext(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    now: 0,
    waiting: [],
    running: [],
    cache: makeCacheView({ totalBlocks: 100, blockSize: 4 }),
    config: testConfig({
      maxBatchSize: 4,
      maxNumBatchedTokens: 20,
      prefillChunkSize: 4,
      kv: { blockSize: 4, totalBlocks: 100 },
    }),
    ...overrides,
  }
}

describe('ContinuousBatchingScheduler', () => {
  it('decodes, continues prefills, and admits into remaining capacity', () => {
    const running = [
      makeRequestView({ id: 'd1', state: 'decode', outputTokens: 1 }),
      makeRequestView({ id: 'd2', state: 'decode', outputTokens: 3 }),
      makeRequestView({
        id: 'p1',
        state: 'prefill',
        promptTokens: 8,
        prefilledTokens: 4,
      }),
    ]
    const waiting = [
      makeRequestView({ id: 'w1', promptTokens: 8 }),
      makeRequestView({ id: 'w2', promptTokens: 8 }),
    ]

    const plan = new ContinuousBatchingScheduler().plan(cbContext({ running, waiting }))

    expect(plan.decode).toEqual(['d1', 'd2'])
    expect(plan.prefill).toEqual([
      { requestId: 'p1', tokens: 4 },
      { requestId: 'w1', tokens: 4 },
    ])
    expect(plan.admit).toEqual(['w1'])
  })

  it('never exceeds the token budget when continuing prefills', () => {
    const running = [
      makeRequestView({ id: 'd1', state: 'decode', outputTokens: 1 }),
      makeRequestView({ id: 'd2', state: 'decode', outputTokens: 1 }),
      makeRequestView({
        id: 'p1',
        state: 'prefill',
        promptTokens: 8,
        prefilledTokens: 4,
      }),
    ]
    const waiting = [makeRequestView({ id: 'w1', promptTokens: 8 })]
    const config = testConfig({
      maxBatchSize: 4,
      maxNumBatchedTokens: 6,
      prefillChunkSize: 4,
      kv: { blockSize: 4, totalBlocks: 100 },
    })

    const plan = new ContinuousBatchingScheduler().plan(cbContext({ running, waiting, config }))

    const totalTokens =
      plan.decode.length + plan.prefill.reduce((sum, intent) => sum + intent.tokens, 0)
    expect(plan.decode).toEqual(['d1', 'd2'])
    expect(plan.prefill).toEqual([{ requestId: 'p1', tokens: 4 }])
    expect(plan.admit).toEqual([])
    expect(totalTokens).toBe(6)
  })

  it('admits strictly in FIFO order and does not skip a blocked head', () => {
    const waiting = [
      makeRequestView({ id: 'big', promptTokens: 400, maxNewTokens: 400 }),
      makeRequestView({ id: 'small', promptTokens: 4, maxNewTokens: 4 }),
    ]
    const cache = makeCacheView({
      blockSize: 4,
      totalBlocks: 100,
      reservedBlocks: 95,
      allocatedBlocks: 95,
      availableBlocks: 5,
    })

    const plan = new ContinuousBatchingScheduler().plan(cbContext({ waiting, cache }))

    expect(plan).toEqual({ admit: [], prefill: [], decode: [] })
  })

  it('accounts for cumulative KV reservations within one plan', () => {
    const waiting = [0, 1, 2, 3].map((index) =>
      makeRequestView({
        id: `r${index}`,
        promptTokens: 16,
        maxNewTokens: 16,
      }),
    )
    const cache = makeCacheView({ blockSize: 4, totalBlocks: 20, availableBlocks: 20 })

    const plan = new ContinuousBatchingScheduler().plan(
      cbContext({
        waiting,
        cache,
        config: testConfig({
          maxBatchSize: 4,
          maxNumBatchedTokens: 64,
          prefillChunkSize: 4,
          kv: { blockSize: 4, totalBlocks: 20 },
        }),
      }),
    )

    // Each request reserves ceil(32 / 4) = 8 blocks; only two fit in 20 blocks.
    expect(plan.admit).toEqual(['r0', 'r1'])
  })

  it('respects maxBatchSize when all slots are occupied', () => {
    const running = [0, 1, 2].map((index) =>
      makeRequestView({ id: `d${index}`, state: 'decode', outputTokens: 1 }),
    )
    const waiting = [makeRequestView({ id: 'w1', promptTokens: 8 })]
    const config = testConfig({
      maxBatchSize: 3,
      maxNumBatchedTokens: 20,
      kv: { blockSize: 4, totalBlocks: 100 },
    })

    const plan = new ContinuousBatchingScheduler().plan(cbContext({ running, waiting, config }))

    expect(plan.decode).toHaveLength(3)
    expect(plan.admit).toEqual([])
  })
})
