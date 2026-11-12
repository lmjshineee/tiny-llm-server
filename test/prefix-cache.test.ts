import { describe, expect, it } from 'vitest'
import { PagedKVCache, ReservationError } from '../src/core/index'

describe('PagedKVCache / prefix sharing', () => {
  it('shares whole prefix blocks, ref-counts them, and retains them after owners finish', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 16 })

    expect(cache.reserve('a', 16, { key: 'sys', tokens: 8 })).toBe(4)
    expect(cache.prefixHitTokensFor('a')).toBe(0)
    cache.appendTokens('a', 8)
    expect(cache.blockIdsFor('a')).toHaveLength(2)
    expect(cache.stats).toMatchObject({
      allocatedBlocks: 2,
      cachedBlocks: 0,
      physicalBlocks: 2,
      logicalBlocks: 2,
      sharedBlocks: 0,
      reservedBlocks: 4,
      availableBlocks: 12,
    })
    cache.validate()

    cache.reserve('b', 16, { key: 'sys', tokens: 8 })
    expect(cache.prefixHitTokensFor('b')).toBe(8)
    expect(cache.blockIdsFor('b')).toEqual(cache.blockIdsFor('a'))
    expect(cache.allocatedTokensFor('b')).toBe(8)
    expect(cache.stats).toMatchObject({
      allocatedBlocks: 2,
      cachedBlocks: 0,
      physicalBlocks: 2,
      logicalBlocks: 4,
      sharedBlocks: 2,
      reservedBlocks: 8,
      availableBlocks: 8,
    })
    cache.validate()

    cache.appendTokens('b', 8)
    expect(cache.blockIdsFor('b')).toHaveLength(4)
    expect(cache.stats).toMatchObject({
      allocatedBlocks: 4,
      physicalBlocks: 4,
      logicalBlocks: 6,
      sharedBlocks: 2,
    })
    cache.validate()

    // A's prefix blocks are still referenced by B; only B's exclusive blocks free.
    expect(cache.free('a')).toBe(0)
    expect(cache.free('b')).toBe(2)
    expect(cache.stats).toMatchObject({
      allocatedBlocks: 0,
      cachedBlocks: 2,
      physicalBlocks: 2,
      logicalBlocks: 0,
      sharedBlocks: 0,
      reservedBlocks: 0,
      freeAllocatedBlocks: 14,
    })
    cache.validate()

    // Retained blocks are reusable after both owners are gone.
    cache.reserve('c', 16, { key: 'sys', tokens: 8 })
    expect(cache.prefixHitTokensFor('c')).toBe(8)
    expect(cache.stats).toMatchObject({
      allocatedBlocks: 2,
      cachedBlocks: 0,
      physicalBlocks: 2,
      logicalBlocks: 2,
    })
    cache.validate()
  })

  it('reuses only contiguous full blocks, not a partial prefix block', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 16 })

    cache.reserve('a', 16, { key: 'p', tokens: 6 })
    cache.appendTokens('a', 6)
    cache.validate()

    // 6 requested prefix tokens floor to one full block (4 tokens).
    cache.reserve('b', 16, { key: 'p', tokens: 6 })
    expect(cache.prefixHitTokensFor('b')).toBe(4)
    expect(cache.blockIdsFor('b')).toHaveLength(1)
    expect(cache.stats.sharedBlocks).toBe(1)
    cache.validate()
  })

  it('requires a contiguous cache chain and grows hits as more blocks are registered', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 16 })

    cache.reserve('a', 16, { key: 'p', tokens: 8 })
    cache.appendTokens('a', 4)
    cache.validate()

    cache.reserve('b', 16, { key: 'p', tokens: 8 })
    expect(cache.prefixHitTokensFor('b')).toBe(4)

    cache.appendTokens('a', 4)
    cache.reserve('c', 16, { key: 'p', tokens: 8 })
    expect(cache.prefixHitTokensFor('c')).toBe(8)
    expect(cache.blockIdsFor('c')).toEqual(cache.blockIdsFor('a'))
    cache.validate()
  })

  it('does not share divergent prefix identities', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 16 })

    cache.reserve('a', 16, { key: 'tenant-a', tokens: 8 })
    cache.appendTokens('a', 8)
    cache.reserve('b', 16, { key: 'tenant-b', tokens: 8 })

    expect(cache.prefixHitTokensFor('b')).toBe(0)
    expect(cache.blockIdsFor('b')).toEqual([])
    expect(cache.stats.sharedBlocks).toBe(0)
    cache.validate()
  })

  it('evicts only idle cached blocks, least recently used first', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 4 })

    cache.reserve('a', 8, { key: 'p', tokens: 8 })
    cache.appendTokens('a', 8)
    expect(cache.free('a')).toBe(0)
    expect(cache.stats).toMatchObject({ cachedBlocks: 2, physicalBlocks: 2, freeAllocatedBlocks: 2 })

    cache.reserve('b', 16)
    cache.appendTokens('b', 8)
    expect(cache.stats).toMatchObject({ allocatedBlocks: 2, cachedBlocks: 2, freeAllocatedBlocks: 0 })

    // The third block forces eviction of the oldest cached block (index 0).
    cache.appendTokens('b', 4)
    expect(cache.stats).toMatchObject({
      allocatedBlocks: 3,
      cachedBlocks: 1,
      physicalBlocks: 4,
      freeAllocatedBlocks: 0,
    })
    cache.validate()

    expect(cache.free('b')).toBe(3)
    expect(cache.stats).toMatchObject({
      allocatedBlocks: 0,
      cachedBlocks: 1,
      physicalBlocks: 1,
      freeAllocatedBlocks: 3,
    })

    // Block 0 was evicted, so the chain now misses at the first block.
    cache.reserve('c', 8, { key: 'p', tokens: 8 })
    expect(cache.prefixHitTokensFor('c')).toBe(0)
    expect(cache.stats.cachedBlocks).toBe(1)
    cache.validate()
  })

  it('keeps admission headroom based on worst-case reservations, not cache occupancy', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 16 })

    cache.reserve('a', 16, { key: 'sys', tokens: 8 })
    cache.appendTokens('a', 8)
    cache.reserve('b', 16, { key: 'sys', tokens: 8 })

    // Two full reservations; the shared physical block saves memory, not admission room.
    expect(cache.stats).toMatchObject({
      reservedBlocks: 8,
      availableBlocks: 8,
      physicalBlocks: 2,
      freeAllocatedBlocks: 14,
    })

    cache.free('a')
    cache.free('b')
    expect(cache.stats).toMatchObject({
      reservedBlocks: 0,
      availableBlocks: 16,
      cachedBlocks: 2,
      freeAllocatedBlocks: 14,
    })
    cache.validate()
  })

  it('ignores prefixes shorter than one block', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 8 })

    cache.reserve('a', 8, { key: 'tiny', tokens: 3 })
    cache.appendTokens('a', 3)
    cache.free('a')
    expect(cache.stats.cachedBlocks).toBe(0)

    cache.reserve('b', 8, { key: 'tiny', tokens: 3 })
    expect(cache.prefixHitTokensFor('b')).toBe(0)
    cache.validate()
  })

  it('rejects invalid prefix metadata', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 8 })

    expect(() => cache.reserve('a', 8, { key: '', tokens: 4 })).toThrow(ReservationError)
    expect(() => cache.reserve('a', 8, { key: 'p', tokens: -1 })).toThrow(RangeError)
    expect(() => cache.reserve('a', 8, { key: 'p', tokens: Number.NaN })).toThrow(RangeError)
  })
})
