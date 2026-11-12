import { requiredBlocks } from '../kv-cache'
import type { PrefillIntent, SchedulingContext, Scheduler, StepPlan } from '../types'
import { emptyPlan } from './empty-plan'

/**
 * Continuous batching (iteration-level scheduling).
 *
 * Each step, in priority order:
 * 1. Decode every running request that has finished prefill (one token each).
 *    Decode-first protects in-flight streams from prefill budget and slot pressure
 *    (a mixed step still pays both prefill and decode latency).
 * 2. Continue partially prefilled running requests in FIFO order.
 * 3. Admit waiting requests in FIFO order while batch slots, token budget, and
 *    KV headroom allow, prefilling a chunk immediately.
 *
 * Admission is strict FIFO: a large head-of-line request that does not fit
 * current KV headroom blocks later (smaller) requests. That is a policy choice,
 * not an engine limitation.
 */
export class ContinuousBatchingScheduler implements Scheduler {
  readonly name = 'continuous-batching'

  plan(context: SchedulingContext): StepPlan {
    const { config, cache } = context
    const decode: string[] = []
    const prefill: PrefillIntent[] = []
    let tokenBudget = config.maxNumBatchedTokens

    for (const request of context.running) {
      if (request.state !== 'decode') continue
      if (tokenBudget === 0) break
      decode.push(request.id)
      tokenBudget -= 1
    }

    for (const request of context.running) {
      if (request.state !== 'prefill' || tokenBudget === 0) continue

      const pendingPromptTokens = request.promptTokens - request.prefilledTokens
      const tokens = Math.min(pendingPromptTokens, config.prefillChunkSize, tokenBudget)
      if (tokens <= 0) continue

      prefill.push({ requestId: request.id, tokens })
      tokenBudget -= tokens
    }

    const admit: string[] = []
    let slots = config.maxBatchSize - context.running.length
    let availableBlocks = cache.availableBlocks

    for (const request of context.waiting) {
      if (slots <= 0 || tokenBudget === 0) break

      const neededBlocks = requiredBlocks(request, cache.blockSize)
      if (neededBlocks > availableBlocks) break

      const tokens = Math.min(request.promptTokens, config.prefillChunkSize, tokenBudget)
      admit.push(request.id)
      prefill.push({ requestId: request.id, tokens })
      tokenBudget -= tokens
      availableBlocks -= neededBlocks
      slots -= 1
    }

    if (decode.length === 0 && prefill.length === 0) return emptyPlan()
    return { admit, prefill, decode }
  }
}
