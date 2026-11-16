import type { CostModel } from './types'

/** Smallest step duration, to guarantee that virtual time strictly advances. */
const MIN_STEP_MS = 1e-3

/**
 * Synthetic step-latency model.
 *
 * A prefill step is compute-bound and modelled as linear in prompt tokens.
 * A decode step is memory-bandwidth-bound: reading weights is a fixed cost,
 * while each extra sequence only adds a small KV-read/compute cost. This
 * sublinear decode cost is what makes continuous batching attractive.
 *
 * When prefill and decode share a step, both fixed/base costs are paid. This
 * intentionally over-approximates mixed steps rather than flattering batching.
 *
 * A decode step may additionally carry a roofline cap. When a profile supplies
 * both `decodeFlopsPerRequest` and `decodeFlopsPerSecond`, the step costs
 * `max(memoryMs, computeMs)`; past the knee, extra sequences no longer buy
 * throughput. Without those fields the model is purely additive, so every
 * report produced by `synthetic-v1` is byte-identical to before the cap existed.
 */
export function estimateStepLatency(
  cost: CostModel,
  prefillTokens: number,
  decodeRequests: number,
): number {
  if (!Number.isInteger(prefillTokens) || prefillTokens < 0) {
    throw new RangeError(
      `prefillTokens must be a non-negative integer, got ${String(prefillTokens)}`,
    )
  }
  if (!Number.isInteger(decodeRequests) || decodeRequests < 0) {
    throw new RangeError(
      `decodeRequests must be a non-negative integer, got ${String(decodeRequests)}`,
    )
  }
  if (prefillTokens === 0 && decodeRequests === 0) return 0

  let latencyMs = cost.stepOverheadMs

  if (prefillTokens > 0) {
    latencyMs += cost.prefillBaseMs + prefillTokens * cost.prefillMsPerToken
  }
  if (decodeRequests > 0) {
    const memoryMs = cost.decodeBaseMs + decodeRequests * cost.decodeMsPerRequest
    const computeMs = estimateDecodeComputeMs(cost, decodeRequests)
    latencyMs += Math.max(memoryMs, computeMs)
  }

  return Math.max(latencyMs, MIN_STEP_MS)
}

/**
 * Decode-step compute time, or `0` when the profile does not configure a
 * roofline cap. Exported so tests and reports can show which bound is binding.
 */
export function estimateDecodeComputeMs(cost: CostModel, decodeRequests: number): number {
  const { decodeFlopsPerRequest, decodeFlopsPerSecond } = cost
  if (decodeFlopsPerRequest === undefined || decodeFlopsPerSecond === undefined) return 0
  return (decodeRequests * decodeFlopsPerRequest * 1000) / decodeFlopsPerSecond
}
