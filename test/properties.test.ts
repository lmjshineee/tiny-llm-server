import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CapacityExceededError,
  ContinuousBatchingScheduler,
  FcfsScheduler,
  PagedKVCache,
  ReservationError,
  UnknownRequestError,
  blocksForTokens,
  createEngineConfig,
  createWorkloadConfig,
  generateWorkload,
  runSimulation,
} from '../src/core/index'

type CacheOp = {
  kind: 'reserve' | 'append' | 'free'
  id: number
  tokens: number
}

const cacheOpArb: fc.Arbitrary<CacheOp> = fc.record({
  kind: fc.constantFrom('reserve', 'append', 'free'),
  id: fc.integer({ min: 0, max: 3 }),
  tokens: fc.integer({ min: 1, max: 40 }),
})

interface ModelEntry {
  reservedTokens: number
  reservedBlocks: number
  allocatedTokens: number
  allocatedBlocks: number
}

describe('property: paged KV allocator', () => {
  it('keeps capacity, ownership, and accounting invariants under arbitrary valid operations', () => {
    const blockSize = 4
    const capacity = 12

    fc.assert(
      fc.property(fc.array(cacheOpArb, { maxLength: 60 }), (ops) => {
        const cache = new PagedKVCache({ blockSize, totalBlocks: capacity })
        const model = new Map<number, ModelEntry>()
        let expectedReserved = 0
        let expectedAllocated = 0

        for (const op of ops) {
          let expectedSuccess = true

          if (op.kind === 'reserve') {
            const blocks = blocksForTokens(op.tokens, blockSize)
            expectedSuccess = !model.has(op.id) && blocks <= capacity - expectedReserved
            if (expectedSuccess) {
              model.set(op.id, {
                reservedTokens: op.tokens,
                reservedBlocks: blocks,
                allocatedTokens: 0,
                allocatedBlocks: 0,
              })
              expectedReserved += blocks
            }
          } else if (op.kind === 'append') {
            const entry = model.get(op.id)
            expectedSuccess =
              entry !== undefined && entry.allocatedTokens + op.tokens <= entry.reservedTokens
            if (entry !== undefined && expectedSuccess) {
              const nextTokens = entry.allocatedTokens + op.tokens
              const nextBlocks = blocksForTokens(nextTokens, blockSize)
              expectedAllocated += nextBlocks - entry.allocatedBlocks
              entry.allocatedTokens = nextTokens
              entry.allocatedBlocks = nextBlocks
            }
          } else {
            const entry = model.get(op.id)
            expectedSuccess = entry !== undefined
            if (entry !== undefined) {
              expectedReserved -= entry.reservedBlocks
              expectedAllocated -= entry.allocatedBlocks
              model.delete(op.id)
            }
          }

          let succeeded = true
          try {
            if (op.kind === 'reserve') cache.reserve(String(op.id), op.tokens)
            else if (op.kind === 'append') cache.appendTokens(String(op.id), op.tokens)
            else cache.free(String(op.id))
          } catch (error) {
            if (
              error instanceof CapacityExceededError ||
              error instanceof ReservationError ||
              error instanceof UnknownRequestError
            ) {
              succeeded = false
            } else {
              throw error
            }
          }

          expect(succeeded).toBe(expectedSuccess)
          cache.validate()
          expect(cache.allocatedBlocks).toBe(expectedAllocated)
          expect(cache.reservedBlocks).toBe(expectedReserved)
          expect(cache.availableBlocks).toBe(capacity - expectedReserved)
        }
      }),
      { numRuns: 100 },
    )
  })
})

describe('property: end-to-end simulation', () => {
  const caseArb = fc.record({
    seed: fc.integer({ min: 0, max: 100_000 }),
    numRequests: fc.integer({ min: 1, max: 8 }),
    batch: fc.integer({ min: 1, max: 4 }),
    budget: fc.integer({ min: 4, max: 64 }),
    chunk: fc.integer({ min: 1, max: 16 }),
    blocks: fc.integer({ min: 20, max: 200 }),
    rate: fc.integer({ min: 1, max: 8 }),
  })

  it('completes every request and respects batch/token/KV invariants for both schedulers', () => {
    fc.assert(
      fc.property(caseArb, (parameters) => {
        const workload = createWorkloadConfig({
          numRequests: parameters.numRequests,
          seed: parameters.seed,
          arrivalRatePerSecond: parameters.rate,
          promptTokens: { mean: 16, stddev: 8, min: 1, max: 32 },
          outputTokens: { mean: 8, stddev: 4, min: 1, max: 16 },
        })
        const requests = generateWorkload(workload)
        const config = createEngineConfig({
          maxBatchSize: parameters.batch,
          maxNumBatchedTokens: Math.max(parameters.batch, parameters.budget),
          prefillChunkSize: parameters.chunk,
          kv: { blockSize: 4, totalBlocks: parameters.blocks },
          cost: {
            stepOverheadMs: 0.2,
            prefillBaseMs: 1,
            prefillMsPerToken: 0.1,
            decodeBaseMs: 2,
            decodeMsPerRequest: 0.2,
          },
          maxSimTimeMs: 120_000,
          maxSteps: 100_000,
        })

        for (const scheduler of [new FcfsScheduler(), new ContinuousBatchingScheduler()]) {
          const result = runSimulation({ requests, scheduler, config })

          expect(result.summary.completedRequests).toBe(parameters.numRequests)
          expect(result.summary.totalRequests).toBe(parameters.numRequests)
          expect(result.cache.allocatedBlocks).toBe(0)
          expect(result.cache.reservedBlocks).toBe(0)
          expect(result.summary.makespanMs).toBeGreaterThanOrEqual(0)

          for (const step of result.steps) {
            expect(step.prefillTokens + step.decodeTokens).toBeLessThanOrEqual(
              config.maxNumBatchedTokens,
            )
            expect(step.batchSize).toBeLessThanOrEqual(config.maxBatchSize)
            expect(step.endMs).toBeGreaterThan(step.startMs)
          }

          for (const outcome of result.requests) {
            expect(outcome.outputTokens).toBe(outcome.maxNewTokens)
            expect(outcome.timestamps.arrivedAt).toBeLessThanOrEqual(
              outcome.timestamps.admittedAt,
            )
            expect(outcome.timestamps.admittedAt).toBeLessThanOrEqual(
              outcome.timestamps.firstTokenAt,
            )
            expect(outcome.timestamps.firstTokenAt).toBeLessThanOrEqual(
              outcome.timestamps.finishedAt,
            )
            expect(outcome.ttftMs).toBeGreaterThanOrEqual(0)
            expect(outcome.e2eMs).toBeGreaterThanOrEqual(outcome.ttftMs)
            if (outcome.tpotMs !== null) expect(outcome.tpotMs).toBeGreaterThan(0)
          }
        }
      }),
      { numRuns: 25 },
    )
  })
})
