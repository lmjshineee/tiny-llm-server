import { requiredBlocks } from '../kv-cache'
import type { PrefillIntent, SchedulingContext, Scheduler, StepPlan } from '../types'
import { emptyPlan } from './empty-plan'

/**
 * Classic first-come-first-served, one request at a time.
 *
 * This is deliberately the naive baseline: while a request is running, no new
 * request is admitted, even if the KV cache and token budget are idle. Prompt
 * prefill is chunked only to respect the token budget; there is no batching and
 * no overlap between prefill and decode. The resulting head-of-line blocking is
 * exactly what continuous batching is meant to remove.
 */
export class FcfsScheduler implements Scheduler {
  readonly name = 'fcfs'

  plan(context: SchedulingContext): StepPlan {
    const { config } = context
    const current = context.running[0]

    if (current !== undefined) {
      if (current.state === 'decode') {
        return { admit: [], prefill: [], decode: [current.id] }
      }

      const pendingPromptTokens = current.promptTokens - current.prefilledTokens
      const tokens = Math.min(
        pendingPromptTokens,
        config.prefillChunkSize,
        config.maxNumBatchedTokens,
      )
      const prefill: PrefillIntent[] = tokens > 0 ? [{ requestId: current.id, tokens }] : []
      return { admit: [], prefill, decode: [] }
    }

    const head = context.waiting[0]
    if (head === undefined) return emptyPlan()

    const neededBlocks = requiredBlocks(head, context.cache.blockSize)
    if (neededBlocks > context.cache.availableBlocks) return emptyPlan()

    const tokens = Math.min(head.promptTokens, config.prefillChunkSize, config.maxNumBatchedTokens)
    return {
      admit: [head.id],
      prefill: [{ requestId: head.id, tokens }],
      decode: [],
    }
  }
}
