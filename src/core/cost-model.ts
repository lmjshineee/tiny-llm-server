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
    latencyMs += cost.decodeBaseMs + decodeRequests * cost.decodeMsPerRequest
  }

  return Math.max(latencyMs, MIN_STEP_MS)
}
