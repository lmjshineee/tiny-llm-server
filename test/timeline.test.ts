import { describe, expect, it } from 'vitest'
import {
  FcfsScheduler,
  createEngineConfig,
  runSimulation,
} from '../src/core/index'
import {
  buildRequestHistories,
  deriveStepView,
  lastStepIndex,
} from '../src/app/lib/timeline'
import type { SimulationResult } from '../src/core/index'

const COST = {
  stepOverheadMs: 0.5,
  prefillBaseMs: 1,
  prefillMsPerToken: 1,
  decodeBaseMs: 2,
  decodeMsPerRequest: 1,
} as const

function runTwoRequests(): SimulationResult {
  return runSimulation({
    requests: [
      { id: 'a', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 },
      { id: 'b', arrivalTime: 0, promptTokens: 4, maxNewTokens: 2 },
    ],
    scheduler: new FcfsScheduler(),
    config: createEngineConfig({
      maxBatchSize: 2,
      maxNumBatchedTokens: 8,
      prefillChunkSize: 4,
      kv: { blockSize: 4, totalBlocks: 32 },
      cost: COST,
    }),
  })
}

describe('timeline reconstruction', () => {
  it('reconstructs request phases and KV snapshots at each step', () => {
    const result = runTwoRequests()
    const histories = buildRequestHistories(result)

    expect(lastStepIndex(result)).toBe(3)
    expect(result.steps.map((step) => step.index)).toEqual([0, 1, 2, 3])

    const step0 = deriveStepView(result, histories, 0)
    expect(step0).not.toBeNull()
    expect(step0?.running.map((request) => request.id)).toEqual(['a'])
    expect(step0?.running[0]).toMatchObject({
      state: 'decode',
      prefilledTokens: 4,
      outputTokens: 1,
      logicalBlocks: 2,
    })
    expect(step0?.waiting.map((request) => request.id)).toEqual(['b'])
    expect(step0?.finishedCount).toBe(0)
    expect(step0?.cache).toMatchObject({
      allocatedBlocks: 2,
      physicalBlocks: 2,
      reservedBlocks: 2,
    })

    const step1 = deriveStepView(result, histories, 1)
    expect(step1?.finishedCount).toBe(1)
    expect(step1?.waiting.map((request) => request.id)).toEqual(['b'])

    const step2 = deriveStepView(result, histories, 2)
    expect(step2?.running[0]).toMatchObject({
      id: 'b',
      state: 'decode',
      outputTokens: 1,
    })
    expect(step2?.waiting).toEqual([])

    const last = deriveStepView(result, histories, 3)
    expect(last?.finishedCount).toBe(2)
    expect(last?.finished[0]).toMatchObject({
      id: 'a',
      ttftMs: 5.5,
      tpotMs: 3.5,
      e2eMs: 9,
    })
    expect(last?.finished[1]).toMatchObject({ id: 'b' })
    expect(last?.running).toEqual([])
    expect(last?.cache.physicalBlocks).toBe(0)
  })

  it('clamps out-of-range steps and handles an empty trace', () => {
    const result = runTwoRequests()
    const histories = buildRequestHistories(result)

    expect(deriveStepView(result, histories, 999)?.step.index).toBe(3)
    expect(deriveStepView(result, histories, -10)?.step.index).toBe(0)

    const empty = runSimulation({
      requests: [],
      scheduler: new FcfsScheduler(),
      config: createEngineConfig({}),
    })
    expect(deriveStepView(empty, buildRequestHistories(empty), 0)).toBeNull()
    expect(lastStepIndex(empty)).toBe(0)
  })
})
