import { describe, expect, it } from 'vitest'
import { MinHeap } from '../src/core/index'

describe('MinHeap', () => {
  it('pops values in ascending order', () => {
    const heap = new MinHeap<number>((a, b) => a - b)
    for (const value of [5, 3, 8, 1, 9, 2, 7]) heap.push(value)

    expect(heap.peek()).toBe(1)
    expect(heap.size).toBe(7)

    const popped: number[] = []
    for (let value = heap.pop(); value !== undefined; value = heap.pop()) {
      popped.push(value)
    }

    expect(popped).toEqual([1, 2, 3, 5, 7, 8, 9])
    expect(heap.size).toBe(0)
    expect(heap.pop()).toBeUndefined()
  })

  it('uses the comparator tie-breaker for stable ordering', () => {
    interface Item {
      time: number
      seq: number
    }
    const heap = new MinHeap<Item>((a, b) => a.time - b.time || a.seq - b.seq)

    const items: Item[] = [
      { time: 2, seq: 0 },
      { time: 1, seq: 1 },
      { time: 2, seq: 2 },
      { time: 1, seq: 3 },
    ]
    for (const item of items) heap.push(item)

    expect(heap.pop()).toEqual({ time: 1, seq: 1 })
    expect(heap.pop()).toEqual({ time: 1, seq: 3 })
    expect(heap.pop()).toEqual({ time: 2, seq: 0 })
    expect(heap.pop()).toEqual({ time: 2, seq: 2 })
    expect(heap.pop()).toBeUndefined()
  })

  it('handles an empty heap', () => {
    const heap = new MinHeap<number>((a, b) => a - b)
    expect(heap.peek()).toBeUndefined()
    expect(heap.pop()).toBeUndefined()
    expect(heap.size).toBe(0)
  })
})
