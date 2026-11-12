import { createEngineConfig } from '../src/core/index'
import type { CacheView, EngineConfig, RequestState, RequestView } from '../src/core/index'

export interface RequestViewInput {
  id?: string
  arrivalTime?: number
  promptTokens?: number
  maxNewTokens?: number
  state?: RequestState
  prefilledTokens?: number
  outputTokens?: number
}

/** Build a scheduler-facing request view without running the engine. */
export function makeRequestView(input: RequestViewInput = {}): RequestView {
  const promptTokens = input.promptTokens ?? 10
  const state = input.state ?? 'waiting'
  const prefilledTokens =
    input.prefilledTokens ?? (state === 'waiting' ? 0 : promptTokens)
  const outputTokens =
    input.outputTokens ?? (state === 'decode' || state === 'finished' ? 1 : 0)

  return {
    id: input.id ?? 'req-1',
    arrivalTime: input.arrivalTime ?? 0,
    promptTokens,
    maxNewTokens: input.maxNewTokens ?? 8,
    state,
    prefilledTokens,
    outputTokens,
    timestamps: { arrivedAt: input.arrivalTime ?? 0 },
  }
}

export function makeCacheView(overrides: Partial<CacheView> = {}): CacheView {
  const totalBlocks = overrides.totalBlocks ?? 64
  const blockSize = overrides.blockSize ?? 16
  const allocatedBlocks = overrides.allocatedBlocks ?? 0
  const reservedBlocks = overrides.reservedBlocks ?? allocatedBlocks

  return {
    blockSize,
    totalBlocks,
    allocatedBlocks,
    reservedBlocks,
    availableBlocks: overrides.availableBlocks ?? totalBlocks - reservedBlocks,
  }
}

/** Deterministic config used by scheduler-level tests. */
export function testConfig(overrides: Parameters<typeof createEngineConfig>[0] = {}): EngineConfig {
  return createEngineConfig({
    maxNumBatchedTokens: 128,
    maxBatchSize: 4,
    prefillChunkSize: 32,
    kv: { blockSize: 16, totalBlocks: 64 },
    ...overrides,
  })
}
