/** Minimal binary min-heap. Stable only if the comparator includes a tie-breaker. */
export class MinHeap<T> {
  readonly #items: T[] = []
  readonly #compare: (a: T, b: T) => number

  constructor(compare: (a: T, b: T) => number) {
    this.#compare = compare
  }

  get size(): number {
    return this.#items.length
  }

  peek(): T | undefined {
    return this.#items[0]
  }

  push(value: T): void {
    this.#items.push(value)
    this.#siftUp(this.#items.length - 1)
  }

  pop(): T | undefined {
    const items = this.#items
    if (items.length === 0) return undefined

    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last !== undefined) {
      items[0] = last
      this.#siftDown(0)
    }
    return top
  }

  #siftUp(startIndex: number): void {
    let index = startIndex
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const current = this.#items[index]
      const parent = this.#items[parentIndex]
      if (current === undefined || parent === undefined) return
      if (this.#compare(current, parent) >= 0) return

      this.#items[index] = parent
      this.#items[parentIndex] = current
      index = parentIndex
    }
  }

  #siftDown(startIndex: number): void {
    let index = startIndex
    const size = this.#items.length

    for (;;) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index

      const smallestValue = this.#items[smallest]
      const leftValue = left < size ? this.#items[left] : undefined
      const rightValue = right < size ? this.#items[right] : undefined

      if (leftValue !== undefined && smallestValue !== undefined && this.#compare(leftValue, smallestValue) < 0) {
        smallest = left
      }
      const candidate = this.#items[smallest]
      if (rightValue !== undefined && candidate !== undefined && this.#compare(rightValue, candidate) < 0) {
        smallest = right
      }

      if (smallest === index) return

      const value = this.#items[index]
      const next = this.#items[smallest]
      if (value === undefined || next === undefined) return
      this.#items[index] = next
      this.#items[smallest] = value
      index = smallest
    }
  }
}
