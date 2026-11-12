import { CapacityExceededError, ReservationError, UnknownRequestError } from './errors'
import type { CacheStats, CacheView, KVCacheConfig, RequestSpec } from './types'

/** Number of fixed-size blocks needed to store `tokens` positions. */
export function blocksForTokens(tokens: number, blockSize: number): number {
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    throw new RangeError(`tokens must be a non-negative integer, got ${String(tokens)}`)
  }
  if (!Number.isSafeInteger(blockSize) || blockSize <= 0) {
    throw new RangeError(`blockSize must be a positive integer, got ${String(blockSize)}`)
  }
  return Math.ceil(tokens / blockSize)
}

/** Worst-case blocks a request may ever need (prompt + generated tokens). */
export function requiredBlocks(
  request: Pick<RequestSpec, 'promptTokens' | 'maxNewTokens'>,
  blockSize: number,
): number {
  return blocksForTokens(request.promptTokens + request.maxNewTokens, blockSize)
}

interface CacheEntry {
  readonly reservedTokens: number
  readonly reservedBlocks: number
  allocatedTokens: number
  readonly blockIds: number[]
}

/**
 * Paged KV cache with per-request block tables.
 *
 * Phase 1 design:
 * - A request reserves blocks for its *worst case* sequence length at admission.
 *   Actual blocks are allocated lazily as tokens are computed. Reservations
 *   guarantee forward progress without preemption, which keeps the simulator
 *   deterministic and deadlock-free.
 * - `availableBlocks` (reserved-aware headroom) is what admission control uses;
 *   `allocatedBlocks` is the real memory footprint.
 * - Blocks are fixed-size, never shared. Prefix sharing is a later milestone.
 */
export class PagedKVCache implements CacheView {
  readonly blockSize: number
  readonly totalBlocks: number

  readonly #freeBlocks: number[]
  readonly #entries = new Map<string, CacheEntry>()
  #allocatedBlocks = 0
  #reservedBlocks = 0
  #peakAllocatedBlocks = 0
  #peakReservedBlocks = 0

  constructor(config: KVCacheConfig) {
    if (!Number.isSafeInteger(config.blockSize) || config.blockSize <= 0) {
      throw new RangeError(`blockSize must be a positive integer, got ${String(config.blockSize)}`)
    }
    if (!Number.isSafeInteger(config.totalBlocks) || config.totalBlocks <= 0) {
      throw new RangeError(`totalBlocks must be a positive integer, got ${String(config.totalBlocks)}`)
    }

    this.blockSize = config.blockSize
    this.totalBlocks = config.totalBlocks

    const freeBlocks: number[] = []
    for (let blockId = 0; blockId < config.totalBlocks; blockId += 1) {
      freeBlocks.push(blockId)
    }
    this.#freeBlocks = freeBlocks
  }

  get allocatedBlocks(): number {
    return this.#allocatedBlocks
  }

  get reservedBlocks(): number {
    return this.#reservedBlocks
  }

  get availableBlocks(): number {
    return this.totalBlocks - this.#reservedBlocks
  }

  get freeAllocatedBlocks(): number {
    return this.totalBlocks - this.#allocatedBlocks
  }

  get peakAllocatedBlocks(): number {
    return this.#peakAllocatedBlocks
  }

  get peakReservedBlocks(): number {
    return this.#peakReservedBlocks
  }

  get activeRequests(): number {
    return this.#entries.size
  }

  get stats(): CacheStats {
    return {
      blockSize: this.blockSize,
      totalBlocks: this.totalBlocks,
      allocatedBlocks: this.#allocatedBlocks,
      reservedBlocks: this.#reservedBlocks,
      availableBlocks: this.availableBlocks,
      freeAllocatedBlocks: this.freeAllocatedBlocks,
      peakAllocatedBlocks: this.#peakAllocatedBlocks,
      peakReservedBlocks: this.#peakReservedBlocks,
      activeRequests: this.#entries.size,
    }
  }

  /** Reserve worst-case capacity for a request. Does not allocate blocks yet. */
  reserve(requestId: string, totalTokens: number): number {
    if (!Number.isSafeInteger(totalTokens) || totalTokens <= 0) {
      throw new RangeError(`totalTokens must be a positive integer, got ${String(totalTokens)}`)
    }
    if (this.#entries.has(requestId)) {
      throw new ReservationError(`request "${requestId}" already has a KV reservation`)
    }

    const reservedBlocks = blocksForTokens(totalTokens, this.blockSize)
    if (reservedBlocks > this.availableBlocks) {
      throw new CapacityExceededError(
        `request "${requestId}" needs ${reservedBlocks} blocks, only ${this.availableBlocks} available ` +
          `(${this.#reservedBlocks}/${this.totalBlocks} blocks already reserved)`,
      )
    }

    this.#entries.set(requestId, {
      reservedTokens: totalTokens,
      reservedBlocks,
      allocatedTokens: 0,
      blockIds: [],
    })
    this.#reservedBlocks += reservedBlocks
    this.#peakReservedBlocks = Math.max(this.#peakReservedBlocks, this.#reservedBlocks)

    return reservedBlocks
  }

  /** Grow a request's block table so it can hold `tokens` more positions. */
  appendTokens(requestId: string, tokens: number): readonly number[] {
    if (!Number.isSafeInteger(tokens) || tokens <= 0) {
      throw new RangeError(`tokens must be a positive integer, got ${String(tokens)}`)
    }
    const entry = this.#getEntry(requestId)
    const nextTokens = entry.allocatedTokens + tokens
    if (nextTokens > entry.reservedTokens) {
      throw new ReservationError(
        `request "${requestId}" would use ${nextTokens} tokens but only reserved ${entry.reservedTokens}`,
      )
    }

    const targetBlocks = blocksForTokens(nextTokens, this.blockSize)
    const newBlockCount = targetBlocks - entry.blockIds.length
    const newBlockIds: number[] = []

    for (let i = 0; i < newBlockCount; i += 1) {
      const blockId = this.#freeBlocks.pop()
      if (blockId === undefined) {
        // Reservations should make this unreachable; surface it as an engine bug.
        throw new CapacityExceededError(
          `internal invariant violated: request "${requestId}" needs a block but the free list is empty`,
        )
      }
      entry.blockIds.push(blockId)
      newBlockIds.push(blockId)
    }

    entry.allocatedTokens = nextTokens
    this.#allocatedBlocks += newBlockCount
    this.#peakAllocatedBlocks = Math.max(this.#peakAllocatedBlocks, this.#allocatedBlocks)

    return newBlockIds
  }

  /** Release all blocks and the reservation held by a request. */
  free(requestId: string): number {
    const entry = this.#getEntry(requestId)
    const freedBlocks = entry.blockIds.length

    for (const blockId of entry.blockIds) {
      this.#freeBlocks.push(blockId)
    }
    this.#allocatedBlocks -= freedBlocks
    this.#reservedBlocks -= entry.reservedBlocks
    this.#entries.delete(requestId)

    return freedBlocks
  }

  has(requestId: string): boolean {
    return this.#entries.has(requestId)
  }

  allocatedTokensFor(requestId: string): number {
    return this.#getEntry(requestId).allocatedTokens
  }

  /** Copy of a request's block table, in allocation order. */
  blockIdsFor(requestId: string): readonly number[] {
    return [...this.#getEntry(requestId).blockIds]
  }

  /** Internal-consistency check used by tests and property tests. */
  validate(): void {
    const used = new Set<number>()
    const free = new Set<number>()
    let allocated = 0
    let reserved = 0

    if (this.#freeBlocks.length !== this.totalBlocks - this.#allocatedBlocks) {
      throw new Error(
        `KV invariant: free list has ${this.#freeBlocks.length} blocks, expected ${this.totalBlocks - this.#allocatedBlocks}`,
      )
    }

    for (const blockId of this.#freeBlocks) {
      if (!Number.isSafeInteger(blockId) || blockId < 0 || blockId >= this.totalBlocks) {
        throw new Error(`KV invariant: free block id ${String(blockId)} is out of range`)
      }
      if (free.has(blockId)) {
        throw new Error(`KV invariant: free list contains duplicate block ${blockId}`)
      }
      free.add(blockId)
    }

    for (const [requestId, entry] of this.#entries) {
      const expectedReservedBlocks = blocksForTokens(entry.reservedTokens, this.blockSize)
      const expectedAllocatedBlocks = blocksForTokens(entry.allocatedTokens, this.blockSize)

      if (entry.reservedBlocks !== expectedReservedBlocks) {
        throw new Error(`KV invariant: request "${requestId}" reservedBlocks is stale`)
      }
      if (entry.allocatedTokens > entry.reservedTokens) {
        throw new Error(`KV invariant: request "${requestId}" allocated more tokens than reserved`)
      }
      if (entry.blockIds.length !== expectedAllocatedBlocks) {
        throw new Error(`KV invariant: request "${requestId}" block table length is wrong`)
      }

      for (const blockId of entry.blockIds) {
        if (!Number.isSafeInteger(blockId) || blockId < 0 || blockId >= this.totalBlocks) {
          throw new Error(`KV invariant: request "${requestId}" owns out-of-range block ${String(blockId)}`)
        }
        if (used.has(blockId)) {
          throw new Error(`KV invariant: block ${blockId} is owned by more than one request`)
        }
        if (free.has(blockId)) {
          throw new Error(`KV invariant: block ${blockId} is both free and allocated`)
        }
        used.add(blockId)
      }

      allocated += entry.blockIds.length
      reserved += entry.reservedBlocks
    }

    if (allocated !== this.#allocatedBlocks) {
      throw new Error(`KV invariant: allocatedBlocks is ${this.#allocatedBlocks}, block tables say ${allocated}`)
    }
    if (reserved !== this.#reservedBlocks) {
      throw new Error(`KV invariant: reservedBlocks is ${this.#reservedBlocks}, reservations say ${reserved}`)
    }
    if (reserved > this.totalBlocks) {
      throw new Error(`KV invariant: reservations exceed capacity (${reserved} > ${this.totalBlocks})`)
    }
    if (this.#peakAllocatedBlocks < this.#allocatedBlocks) {
      throw new Error('KV invariant: peak allocated blocks is below current usage')
    }
    if (this.#peakReservedBlocks < this.#reservedBlocks) {
      throw new Error('KV invariant: peak reserved blocks is below current reservations')
    }
  }

  #getEntry(requestId: string): CacheEntry {
    const entry = this.#entries.get(requestId)
    if (entry === undefined) {
      throw new UnknownRequestError(`request "${requestId}" has no KV reservation`)
    }
    return entry
  }
}
