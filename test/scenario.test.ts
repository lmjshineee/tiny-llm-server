import { describe, expect, it } from 'vitest'
import {
  ContinuousBatchingScheduler,
  FcfsScheduler,
  createEngineConfig,
  createWorkloadConfig,
  generateWorkload,
  runSimulation,
} from '../src/core/index'

/**
 * This is the lab's headline comparison under the *synthetic* cost model.
 * It is a regression test for scheduler behavior, not a hardware benchmark.
 */
describe('scenario: steady load, sequential vs continuous batching', () => {
  it('continuous batching improves throughput and tail latency for the same workload', () => {
    const requests = generateWorkload(
      createWorkloadConfig({
        numRequests: 80,
        arrivalRatePerSecond: 1.5,
        seed: 2026,
      }),
    )
    const config = createEngineConfig({
      maxBatchSize: 16,
      maxNumBatchedTokens: 4096,
      prefillChunkSize: 512,
      kv: { blockSize: 16, totalBlocks: 2048 },
    })

    const fcfs = runSimulation({ requests, scheduler: new FcfsScheduler(), config })
    const continuous = runSimulation({
      requests,
      scheduler: new ContinuousBatchingScheduler(),
      config,
    })

    expect(fcfs.summary.completedRequests).toBe(80)
    expect(continuous.summary.completedRequests).toBe(80)

    expect(continuous.summary.throughputRequestsPerSecond).toBeGreaterThan(
      fcfs.summary.throughputRequestsPerSecond * 2,
    )
    expect(continuous.summary.throughputOutputTokensPerSecond).toBeGreaterThan(
      fcfs.summary.throughputOutputTokensPerSecond * 2,
    )

    expect(fcfs.summary.ttftMs.p95).not.toBeNull()
    expect(continuous.summary.ttftMs.p95).not.toBeNull()
    expect(continuous.summary.ttftMs.p95!).toBeLessThan(fcfs.summary.ttftMs.p95! * 0.25)

    expect(continuous.summary.e2eMs.p95).not.toBeNull()
    expect(fcfs.summary.e2eMs.p95).not.toBeNull()
    expect(continuous.summary.e2eMs.p95!).toBeLessThan(fcfs.summary.e2eMs.p95!)

    // Both runs must clean up all KV state and use the same synthetic workload.
    for (const result of [fcfs, continuous]) {
      expect(result.cache.allocatedBlocks).toBe(0)
      expect(result.cache.reservedBlocks).toBe(0)
      expect(result.meta.simulated).toBe(true)
      expect(result.meta.costModelNote).toMatch(/synthetic/i)
    }
  })
})
