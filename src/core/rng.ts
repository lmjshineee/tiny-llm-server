/**
 * Small, dependency-free deterministic PRNG helpers.
 *
 * We use mulberry32 so that a workload is reproducible from a single integer
 * seed on every platform. Do not swap in `Math.random()` anywhere in the core.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
    },
  }
}

/** Standard normal sample via the Box-Muller transform. */
export function sampleStandardNormal(rng: Rng): number {
  const u1 = Math.max(rng.next(), Number.EPSILON)
  const u2 = rng.next()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Exponential inter-arrival time in milliseconds for a Poisson process. */
export function sampleExponentialMs(rng: Rng, ratePerSecond: number): number {
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
    throw new RangeError(`ratePerSecond must be a finite positive number, got ${String(ratePerSecond)}`)
  }
  const u = Math.min(Math.max(rng.next(), Number.EPSILON), 1 - Number.EPSILON)
  return (-Math.log(u) / ratePerSecond) * 1000
}
