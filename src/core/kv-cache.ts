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

export interface PrefixReservation {
  /** Synthetic content identity of the reusable prefix. */
  readonly key: string
  /** Requested prefix length; the allocator floors it to whole blocks. */
  readonly tokens: number
}

function prefixBlockKey(prefixKey: string, blockIndex: number): string {
  // Length-prefixing avoids ambiguity if a caller's key contains separators.
  return `${prefixKey.length}:${prefixKey}:${blockIndex}`
}

interface CacheEntry {
  readonly reservedTokens: number
  readonly reservedBlocks: number
  allocatedTokens: number
  readonly blockIds: number[]
  readonly prefixKey: string | null
  readonly prefixTokens: number
  registeredPrefixBlocks: number
  readonly prefixHitTokens: number
}

/**
 * Paged KV cache with optional retained prefix caching.
 *
 * Phase 2 additions:
 * - A request may declare a synthetic prefix identity. Whole cached prefix
 *   blocks are shared by reference instead of copied.
 * - Prefix blocks are retained after their owners finish (ref-count 0) and
 *   evicted LRU when a new allocation needs a physical block.
 * - A hit skips prefill computation for the matched tokens, but admission
 *   reservations remain worst-case over the full sequence. This is
 *   deliberately conservative: sharing reduces physical duplication and
 *   prefill work, not admission headroom. See ARCHITECTURE.md.
 *
 * Accounting:
 * - `allocatedBlocks` = unique physical blocks referenced by active requests.
 * - `cachedBlocks` = retained, unreferenced (idle) prefix blocks.
 * - `physicalBlocks` = allocated + cached.
 * - `logicalBlocks` = sum of active block-table lengths, counting shared blocks
 *   once per request.
 * - `availableBlocks` = total - worst-case reservations (scheduler headroom).
 */
export class PagedKVCache implements CacheView {
  readonly blockSize: number
  readonly totalBlocks: number

  readonly #freeBlocks: number[]
  readonly #entries = new Map<string, CacheEntry>()
  readonly #refCounts: number[]
  readonly #cached: boolean[]
  readonly #blockKeys: Array<string | undefined>
  readonly #lastUsed: number[]
  readonly #idleCachedBlocks = new Set<number>()
  readonly #prefixIndex = new Map<string, number>()

  #clock = 0
  #allocatedBlocks = 0
  #cachedBlocks = 0
  #physicalBlocks = 0
  #logicalBlocks = 0
  #sharedBlocks = 0
  #reservedBlocks = 0

  #peakAllocatedBlocks = 0
  #peakCachedBlocks = 0
  #peakPhysicalBlocks = 0
  #peakLogicalBlocks = 0
  #peakSharedBlocks = 0
  #peakReservedBlocks = 0

  constructor(config: KVCacheConfig) {
    if (!Number.isSafeInteger(config.blockSize) || config.blockSize <= 0) {
      throw new RangeError(`blockSize must be a positive integer, got ${String(config.blockSize)}`)
    }
    if (!Number.isSafeInteger(config.totalBlocks) || config.totalBlocks <= 0) {
      throw new RangeError(
        `totalBlocks must be a positive integer, got ${String(config.totalBlocks)}`,
      )
    }

    this.blockSize = config.blockSize
    this.totalBlocks = config.totalBlocks

    const freeBlocks: number[] = []
    for (let blockId = 0; blockId < config.totalBlocks; blockId += 1) {
      freeBlocks.push(blockId)
    }
    this.#freeBlocks = freeBlocks

    this.#refCounts = new Array<number>(config.totalBlocks).fill(0)
    this.#cached = new Array<boolean>(config.totalBlocks).fill(false)
    this.#blockKeys = new Array<string | undefined>(config.totalBlocks).fill(undefined)
    this.#lastUsed = new Array<number>(config.totalBlocks).fill(0)
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
    return this.totalBlocks - this.#physicalBlocks
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
      cachedBlocks: this.#cachedBlocks,
      physicalBlocks: this.#physicalBlocks,
      logicalBlocks: this.#logicalBlocks,
      sharedBlocks: this.#sharedBlocks,
      freeAllocatedBlocks: this.freeAllocatedBlocks,
      peakAllocatedBlocks: this.#peakAllocatedBlocks,
      peakCachedBlocks: this.#peakCachedBlocks,
      peakPhysicalBlocks: this.#peakPhysicalBlocks,
      peakLogicalBlocks: this.#peakLogicalBlocks,
      peakSharedBlocks: this.#peakSharedBlocks,
      peakReservedBlocks: this.#peakReservedBlocks,
      activeRequests: this.#entries.size,
    }
  }

  /**
   * Reserve worst-case logical capacity for a request. If `prefix` is provided,
   * whole cached prefix blocks are acquired immediately and returned as a hit.
   */
  reserve(requestId: string, totalTokens: number, prefix?: PrefixReservation): number {
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

    let prefixKey: string | null = null
    let prefixTokens = 0
    let hitBlockIds: number[] = []

    if (prefix !== undefined) {
      if (typeof prefix.key !== 'string' || prefix.key.trim().length === 0) {
        throw new ReservationError('prefix key must be a non-empty string')
      }
      if (!Number.isSafeInteger(prefix.tokens) || prefix.tokens < 0) {
        throw new RangeError(
          `prefix tokens must be a non-negative integer, got ${String(prefix.tokens)}`,
        )
      }

      const cappedTokens = Math.min(prefix.tokens, totalTokens)
      prefixTokens = Math.floor(cappedTokens / this.blockSize) * this.blockSize
      if (prefixTokens > 0) {
        prefixKey = prefix.key
        hitBlockIds = this.#acquirePrefixBlocks(prefixKey, prefixTokens / this.blockSize)
      }
    }

    const hitTokens = hitBlockIds.length * this.blockSize
    this.#entries.set(requestId, {
      reservedTokens: totalTokens,
      reservedBlocks,
      allocatedTokens: hitTokens,
      blockIds: hitBlockIds,
      prefixKey,
      prefixTokens,
      registeredPrefixBlocks: hitBlockIds.length,
      prefixHitTokens: hitTokens,
    })

    this.#reservedBlocks += reservedBlocks
    this.#logicalBlocks += hitBlockIds.length
    this.#recordPeaks()

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

    for (let index = 0; index < newBlockCount; index += 1) {
      const blockId = this.#takeBlockForAllocation()
      entry.blockIds.push(blockId)
      newBlockIds.push(blockId)
    }

    entry.allocatedTokens = nextTokens
    this.#logicalBlocks += newBlockCount

    if (entry.prefixKey !== null && entry.prefixTokens > 0) {
      const fullPrefixBlocks = Math.floor(
        Math.min(entry.prefixTokens, entry.allocatedTokens) / this.blockSize,
      )
      for (
        let blockIndex = entry.registeredPrefixBlocks;
        blockIndex < fullPrefixBlocks;
        blockIndex += 1
      ) {
        const blockId = entry.blockIds[blockIndex]
        if (blockId !== undefined) {
          this.#registerPrefixBlock(entry.prefixKey, blockIndex, blockId)
        }
      }
      entry.registeredPrefixBlocks = Math.max(entry.registeredPrefixBlocks, fullPrefixBlocks)
    }

    this.#recordPeaks()
    return newBlockIds
  }

  /**
   * Release a request. Prefix blocks are retained in the cache when no other
   * request references them; other blocks return to the free pool.
   */
  free(requestId: string): number {
    const entry = this.#getEntry(requestId)
    let freedToPool = 0

    for (const blockId of entry.blockIds) {
      if (this.#releaseReference(blockId)) freedToPool += 1
    }

    this.#logicalBlocks -= entry.blockIds.length
    this.#reservedBlocks -= entry.reservedBlocks
    this.#entries.delete(requestId)
    this.#recordPeaks()

    return freedToPool
  }

  has(requestId: string): boolean {
    return this.#entries.has(requestId)
  }

  allocatedTokensFor(requestId: string): number {
    return this.#getEntry(requestId).allocatedTokens
  }

  /** Copy of a request's logical block table, in sequence order. */
  blockIdsFor(requestId: string): readonly number[] {
    return [...this.#getEntry(requestId).blockIds]
  }

  /** Whole-block prefix tokens reused for a request at admission. */
  prefixHitTokensFor(requestId: string): number {
    return this.#getEntry(requestId).prefixHitTokens
  }

  /** Internal-consistency check used by tests and property tests. */
  validate(): void {
    const freeSet = new Set<number>()
    const physical = new Set<number>()
    const references = new Map<number, number>()

    if (this.#freeBlocks.length !== this.totalBlocks - this.#physicalBlocks) {
      throw new Error(
        `KV invariant: free list has ${this.#freeBlocks.length} blocks, expected ${this.totalBlocks - this.#physicalBlocks}`,
      )
    }

    for (const blockId of this.#freeBlocks) {
      if (!Number.isSafeInteger(blockId) || blockId < 0 || blockId >= this.totalBlocks) {
        throw new Error(`KV invariant: free block id ${String(blockId)} is out of range`)
      }
      if (freeSet.has(blockId)) {
        throw new Error(`KV invariant: free list contains duplicate block ${blockId}`)
      }
      freeSet.add(blockId)
    }

    let allocated = 0
    let cachedIdle = 0
    let logical = 0
    let reserved = 0

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
      if (entry.prefixTokens % this.blockSize !== 0 || entry.prefixTokens > entry.reservedTokens) {
        throw new Error(`KV invariant: request "${requestId}" has invalid prefix token count`)
      }
      if (entry.prefixTokens > 0 && entry.prefixKey === null) {
        throw new Error(`KV invariant: request "${requestId}" has prefix tokens without a key`)
      }
      if (entry.prefixTokens === 0 && entry.prefixKey !== null) {
        throw new Error(
          `KV invariant: request "${requestId}" has a prefix key without prefix tokens`,
        )
      }

      const prefixBlockCount = entry.prefixTokens / this.blockSize
      const hitBlocks = entry.prefixHitTokens / this.blockSize
      if (entry.prefixHitTokens % this.blockSize !== 0 || !Number.isSafeInteger(hitBlocks)) {
        throw new Error(`KV invariant: request "${requestId}" has a non-block-aligned prefix hit`)
      }
      if (
        hitBlocks > entry.registeredPrefixBlocks ||
        entry.registeredPrefixBlocks > prefixBlockCount
      ) {
        throw new Error(`KV invariant: request "${requestId}" prefix registration is inconsistent`)
      }
      if (entry.prefixHitTokens > entry.allocatedTokens) {
        throw new Error(`KV invariant: request "${requestId}" hit more prefix tokens than it owns`)
      }

      const seen = new Set<number>()
      for (const blockId of entry.blockIds) {
        if (!Number.isSafeInteger(blockId) || blockId < 0 || blockId >= this.totalBlocks) {
          throw new Error(
            `KV invariant: request "${requestId}" owns out-of-range block ${String(blockId)}`,
          )
        }
        if (seen.has(blockId)) {
          throw new Error(`KV invariant: request "${requestId}" references block ${blockId} twice`)
        }
        seen.add(blockId)
        references.set(blockId, (references.get(blockId) ?? 0) + 1)
        physical.add(blockId)
      }

      logical += entry.blockIds.length
      reserved += entry.reservedBlocks
    }

    let shared = 0
    for (let blockId = 0; blockId < this.totalBlocks; blockId += 1) {
      const refs = references.get(blockId) ?? 0
      const isCached = this.#cached[blockId] === true
      const isFree = freeSet.has(blockId)

      if (this.#refCounts[blockId] !== refs) {
        throw new Error(`KV invariant: block ${blockId} ref count is stale`)
      }

      if (refs > 0) {
        allocated += 1
        if (refs > 1) shared += 1
      } else if (isCached) {
        cachedIdle += 1
        physical.add(blockId)
      }

      if (refs === 0 && !isCached) {
        if (!isFree) {
          throw new Error(`KV invariant: block ${blockId} is neither free nor referenced`)
        }
        if (this.#blockKeys[blockId] !== undefined) {
          throw new Error(`KV invariant: free block ${blockId} still has a prefix key`)
        }
      } else {
        if (isFree) {
          throw new Error(`KV invariant: block ${blockId} is both free and in use`)
        }
        if (isCached) {
          const key = this.#blockKeys[blockId]
          if (key === undefined || this.#prefixIndex.get(key) !== blockId) {
            throw new Error(`KV invariant: cached block ${blockId} has a broken prefix index entry`)
          }
        } else if (this.#blockKeys[blockId] !== undefined) {
          throw new Error(`KV invariant: non-cached block ${blockId} still has a prefix key`)
        }
      }

      if (refs === 0 && isCached && !this.#idleCachedBlocks.has(blockId)) {
        throw new Error(`KV invariant: idle cached block ${blockId} is missing from the idle set`)
      }
      if ((refs > 0 || !isCached) && this.#idleCachedBlocks.has(blockId)) {
        throw new Error(`KV invariant: active/non-cached block ${blockId} is in the idle set`)
      }
    }

    for (const [key, blockId] of this.#prefixIndex) {
      if (!this.#cached[blockId]) {
        throw new Error(`KV invariant: prefix index key "${key}" points at a non-cached block`)
      }
      if (this.#blockKeys[blockId] !== key) {
        throw new Error(`KV invariant: prefix index key "${key}" disagrees with block metadata`)
      }
    }

    if (physical.size !== this.#physicalBlocks) {
      throw new Error(
        `KV invariant: physicalBlocks is ${this.#physicalBlocks}, blocks say ${physical.size}`,
      )
    }
    if (allocated !== this.#allocatedBlocks) {
      throw new Error(
        `KV invariant: allocatedBlocks is ${this.#allocatedBlocks}, references say ${allocated}`,
      )
    }
    if (cachedIdle !== this.#cachedBlocks) {
      throw new Error(
        `KV invariant: cachedBlocks is ${this.#cachedBlocks}, idle cache says ${cachedIdle}`,
      )
    }
    if (shared !== this.#sharedBlocks) {
      throw new Error(
        `KV invariant: sharedBlocks is ${this.#sharedBlocks}, references say ${shared}`,
      )
    }
    if (logical !== this.#logicalBlocks) {
      throw new Error(
        `KV invariant: logicalBlocks is ${this.#logicalBlocks}, block tables say ${logical}`,
      )
    }
    if (reserved !== this.#reservedBlocks) {
      throw new Error(
        `KV invariant: reservedBlocks is ${this.#reservedBlocks}, reservations say ${reserved}`,
      )
    }
    if (reserved > this.totalBlocks) {
      throw new Error(
        `KV invariant: reservations exceed capacity (${reserved} > ${this.totalBlocks})`,
      )
    }
    if (this.#idleCachedBlocks.size !== cachedIdle) {
      throw new Error('KV invariant: idle cache set size does not match cached counters')
    }
    if (this.#peakAllocatedBlocks < this.#allocatedBlocks) {
      throw new Error('KV invariant: peak allocated blocks is below current usage')
    }
    if (this.#peakCachedBlocks < this.#cachedBlocks) {
      throw new Error('KV invariant: peak cached blocks is below current usage')
    }
    if (this.#peakPhysicalBlocks < this.#physicalBlocks) {
      throw new Error('KV invariant: peak physical blocks is below current usage')
    }
    if (this.#peakLogicalBlocks < this.#logicalBlocks) {
      throw new Error('KV invariant: peak logical blocks is below current usage')
    }
    if (this.#peakSharedBlocks < this.#sharedBlocks) {
      throw new Error('KV invariant: peak shared blocks is below current usage')
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

  #acquirePrefixBlocks(prefixKey: string, blockCount: number): number[] {
    const blockIds: number[] = []

    for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
      const blockId = this.#prefixIndex.get(prefixBlockKey(prefixKey, blockIndex))
      if (blockId === undefined) break
      this.#acquireBlock(blockId)
      blockIds.push(blockId)
    }

    return blockIds
  }

  #acquireBlock(blockId: number): void {
    if (!this.#cached[blockId]) {
      throw new Error(`KV invariant: tried to acquire non-cached block ${blockId}`)
    }

    const refs = this.#refCounts[blockId] ?? 0
    if (refs === 0) {
      if (!this.#idleCachedBlocks.delete(blockId)) {
        throw new Error(`KV invariant: idle cached block ${blockId} was not tracked`)
      }
      this.#cachedBlocks -= 1
      this.#allocatedBlocks += 1
    } else if (refs === 1) {
      this.#sharedBlocks += 1
    }

    this.#refCounts[blockId] = refs + 1
    this.#lastUsed[blockId] = this.#nextClock()
    this.#recordPeaks()
  }

  #registerPrefixBlock(prefixKey: string, blockIndex: number, blockId: number): void {
    const key = prefixBlockKey(prefixKey, blockIndex)
    if (this.#prefixIndex.has(key) || this.#cached[blockId]) return

    this.#cached[blockId] = true
    this.#blockKeys[blockId] = key
    this.#prefixIndex.set(key, blockId)
    this.#lastUsed[blockId] = this.#nextClock()
  }

  #releaseReference(blockId: number): boolean {
    const refs = this.#refCounts[blockId] ?? 0
    if (refs <= 0) {
      throw new Error(`KV invariant: block ${blockId} has no reference to release`)
    }

    this.#refCounts[blockId] = refs - 1

    if (refs === 2) {
      this.#sharedBlocks -= 1
    }

    if (refs === 1) {
      this.#allocatedBlocks -= 1
      if (this.#cached[blockId]) {
        this.#cachedBlocks += 1
        this.#idleCachedBlocks.add(blockId)
      } else {
        this.#physicalBlocks -= 1
        this.#blockKeys[blockId] = undefined
        this.#freeBlocks.push(blockId)
        return true
      }
    }

    return false
  }

  #takeBlockForAllocation(): number {
    const freeBlock = this.#freeBlocks.pop()
    if (freeBlock !== undefined) {
      this.#initializeActiveBlock(freeBlock)
      return freeBlock
    }

    const evicted = this.#evictLeastRecentlyUsedCachedBlock()
    if (evicted === undefined) {
      throw new CapacityExceededError(
        'internal invariant violated: no free or evictable block is available for allocation',
      )
    }
    this.#initializeActiveBlock(evicted)
    return evicted
  }

  #initializeActiveBlock(blockId: number): void {
    if ((this.#refCounts[blockId] ?? 0) !== 0 || this.#cached[blockId] === true) {
      throw new Error(`KV invariant: block ${blockId} is not available for allocation`)
    }

    this.#refCounts[blockId] = 1
    this.#cached[blockId] = false
    this.#blockKeys[blockId] = undefined
    this.#lastUsed[blockId] = this.#nextClock()
    this.#allocatedBlocks += 1
    this.#physicalBlocks += 1
    this.#recordPeaks()
  }

  #evictLeastRecentlyUsedCachedBlock(): number | undefined {
    let chosen: number | undefined
    let oldest = Number.POSITIVE_INFINITY

    for (const blockId of this.#idleCachedBlocks) {
      const usedAt = this.#lastUsed[blockId] ?? 0
      if (usedAt < oldest || (usedAt === oldest && (chosen === undefined || blockId < chosen))) {
        chosen = blockId
        oldest = usedAt
      }
    }

    if (chosen === undefined) return undefined

    this.#idleCachedBlocks.delete(chosen)
    this.#cached[chosen] = false
    this.#cachedBlocks -= 1
    this.#physicalBlocks -= 1

    const key = this.#blockKeys[chosen]
    if (key !== undefined) {
      this.#prefixIndex.delete(key)
      this.#blockKeys[chosen] = undefined
    }
    this.#lastUsed[chosen] = 0

    return chosen
  }

  #nextClock(): number {
    this.#clock += 1
    return this.#clock
  }

  #recordPeaks(): void {
    this.#peakAllocatedBlocks = Math.max(this.#peakAllocatedBlocks, this.#allocatedBlocks)
    this.#peakCachedBlocks = Math.max(this.#peakCachedBlocks, this.#cachedBlocks)
    this.#peakPhysicalBlocks = Math.max(this.#peakPhysicalBlocks, this.#physicalBlocks)
    this.#peakLogicalBlocks = Math.max(this.#peakLogicalBlocks, this.#logicalBlocks)
    this.#peakSharedBlocks = Math.max(this.#peakSharedBlocks, this.#sharedBlocks)
    this.#peakReservedBlocks = Math.max(this.#peakReservedBlocks, this.#reservedBlocks)
  }
}
