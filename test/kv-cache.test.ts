import { describe, expect, it } from 'vitest'
import {
  CapacityExceededError,
  PagedKVCache,
  ReservationError,
  UnknownRequestError,
} from '../src/core/index'

describe('PagedKVCache', () => {
  it('reserves worst-case blocks and allocates them lazily', () => {
    const cache = new PagedKVCache({ blockSize: 16, totalBlocks: 8 })

    expect(cache.reserve('r1', 48)).toBe(3)
    expect(cache.allocatedBlocks).toBe(0)
    expect(cache.reservedBlocks).toBe(3)
    expect(cache.availableBlocks).toBe(5)

    expect(cache.appendTokens('r1', 10)).toHaveLength(1)
    expect(cache.allocatedBlocks).toBe(1)
    expect(cache.allocatedTokensFor('r1')).toBe(10)

    expect(cache.appendTokens('r1', 20)).toHaveLength(1)
    expect(cache.allocatedBlocks).toBe(2)
    expect(cache.blockIdsFor('r1')).toHaveLength(2)
    expect(cache.freeAllocatedBlocks).toBe(6)

    cache.validate()
  })

  it('rounds token counts up to whole blocks', () => {
    const cache = new PagedKVCache({ blockSize: 16, totalBlocks: 4 })

    expect(cache.reserve('one', 16)).toBe(1)
    expect(cache.reserve('two', 17)).toBe(2)
    expect(cache.reservedBlocks).toBe(3)
    expect(cache.availableBlocks).toBe(1)
  })

  it('enforces capacity through reservations, not just physical allocation', () => {
    const cache = new PagedKVCache({ blockSize: 16, totalBlocks: 2 })
    cache.reserve('r1', 32)

    expect(() => cache.reserve('r2', 16)).toThrow(CapacityExceededError)
    expect(cache.allocatedBlocks).toBe(0)
    expect(cache.availableBlocks).toBe(0)

    cache.free('r1')
    expect(cache.availableBlocks).toBe(2)
    expect(() => cache.reserve('r2', 16)).not.toThrow()
  })

  it('rejects a request that would exceed its own reservation', () => {
    const cache = new PagedKVCache({ blockSize: 16, totalBlocks: 4 })
    cache.reserve('r1', 16)

    expect(() => cache.appendTokens('r1', 17)).toThrow(ReservationError)
    expect(cache.allocatedBlocks).toBe(0)
    expect(cache.availableBlocks).toBe(3)
  })

  it('returns blocks on free and rejects double free / unknown requests', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 2 })
    cache.reserve('r1', 8)
    cache.appendTokens('r1', 8)

    expect(cache.allocatedBlocks).toBe(2)
    expect(cache.free('r1')).toBe(2)
    expect(cache.allocatedBlocks).toBe(0)
    expect(cache.availableBlocks).toBe(2)

    expect(() => cache.free('r1')).toThrow(UnknownRequestError)
    expect(() => cache.appendTokens('r1', 1)).toThrow(UnknownRequestError)
    expect(() => cache.blockIdsFor('r1')).toThrow(UnknownRequestError)
  })

  it('never double-allocates block ids across requests', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 6 })
    cache.reserve('a', 8)
    cache.reserve('b', 12)
    cache.appendTokens('a', 8)
    cache.appendTokens('b', 9)

    const ids = [...cache.blockIdsFor('a'), ...cache.blockIdsFor('b')]
    expect(new Set(ids).size).toBe(ids.length)
    expect(cache.allocatedBlocks).toBe(5)
    cache.validate()
  })

  it('tracks peak allocation and reservation watermarks', () => {
    const cache = new PagedKVCache({ blockSize: 4, totalBlocks: 8 })
    cache.reserve('a', 12)
    cache.appendTokens('a', 12)
    cache.reserve('b', 8)
    cache.appendTokens('b', 8)

    expect(cache.peakAllocatedBlocks).toBe(5)
    expect(cache.peakReservedBlocks).toBe(5)

    cache.free('a')
    expect(cache.allocatedBlocks).toBe(2)
    expect(cache.peakAllocatedBlocks).toBe(5)

    expect(cache.stats).toMatchObject({
      blockSize: 4,
      totalBlocks: 8,
      allocatedBlocks: 2,
      reservedBlocks: 2,
      availableBlocks: 6,
      freeAllocatedBlocks: 6,
      activeRequests: 1,
      peakAllocatedBlocks: 5,
      peakReservedBlocks: 5,
    })
    cache.validate()
  })
})
