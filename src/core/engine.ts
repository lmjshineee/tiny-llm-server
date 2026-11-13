import { SIMULATED_LATENCY_NOTE, createEngineConfig } from './config'
import { estimateStepLatency } from './cost-model'
import {
  PlanValidationError,
  RequestTooLargeError,
  RequestValidationError,
  SimulationLimitError,
  SimulationStalledError,
} from './errors'
import { PagedKVCache, requiredBlocks } from './kv-cache'
import { summarizeOutcomes, toRequestOutcome } from './metrics'
import { MinHeap } from './min-heap'
import type {
  CacheStats,
  DeepPartial,
  EngineConfig,
  PrefillIntent,
  RequestOutcome,
  RequestSpec,
  RequestState,
  RequestTimestamps,
  Scheduler,
  SchedulingContext,
  StepPlan,
  StepRecord,
  Summary,
} from './types'

interface MutableRequest extends RequestSpec {
  state: RequestState
  prefilledTokens: number
  outputTokens: number
  prefixHitTokens: number
  readonly timestamps: RequestTimestamps
}

interface ArrivalEvent {
  readonly kind: 'arrival'
  readonly time: number
  readonly seq: number
  readonly request: MutableRequest
}

interface StepEvent {
  readonly kind: 'step'
  readonly time: number
  readonly seq: number
}

type SimEvent = ArrivalEvent | StepEvent

function compareEvents(a: SimEvent, b: SimEvent): number {
  return a.time - b.time || a.seq - b.seq
}

export interface RunSimulationInput {
  readonly requests: readonly RequestSpec[]
  readonly scheduler: Scheduler
  readonly config?: DeepPartial<EngineConfig>
}

export interface SimulationMeta {
  readonly simulated: true
  readonly strategy: string
  readonly costModelNote: string
  readonly config: EngineConfig
}

export interface SimulationResult {
  readonly meta: SimulationMeta
  readonly requests: readonly RequestOutcome[]
  readonly steps: readonly StepRecord[]
  readonly summary: Summary
  readonly cache: CacheStats
}

/**
 * Resolve config, validate requests, and run one deterministic simulation.
 *
 * The engine owns time, state transitions, and KV allocation. Schedulers only
 * return a plan; every plan is validated before it mutates any state.
 */
export function runSimulation(input: RunSimulationInput): SimulationResult {
  const config = createEngineConfig(input.config ?? {})
  return new Simulator(input.requests, config, input.scheduler).run()
}

class Simulator {
  readonly #config: EngineConfig
  readonly #scheduler: Scheduler
  readonly #cache: PagedKVCache
  readonly #requests: MutableRequest[]
  readonly #byId = new Map<string, MutableRequest>()
  readonly #events: MinHeap<SimEvent>
  readonly #steps: StepRecord[] = []

  #waiting: MutableRequest[] = []
  #running: MutableRequest[] = []
  #now = 0
  #sequence = 0
  #stepScheduled = false

  constructor(requestSpecs: readonly RequestSpec[], config: EngineConfig, scheduler: Scheduler) {
    this.#config = config
    this.#scheduler = scheduler
    this.#cache = new PagedKVCache(config.kv)
    this.#events = new MinHeap<SimEvent>(compareEvents)
    this.#requests = this.#prepareRequests(requestSpecs)

    for (const request of this.#requests) {
      this.#byId.set(request.id, request)
      this.#events.push({
        kind: 'arrival',
        time: request.arrivalTime,
        seq: this.#sequence,
        request,
      })
      this.#sequence += 1
    }

    const first = this.#requests[0]
    if (first !== undefined) {
      this.#scheduleStep(Math.max(this.#now, first.arrivalTime))
    }
  }

  run(): SimulationResult {
    while (this.#events.size > 0) {
      const event = this.#events.pop()
      if (event === undefined) break

      this.#now = Math.max(this.#now, event.time)

      if (event.kind === 'arrival') {
        this.#waiting.push(event.request)
        if (!this.#stepScheduled) this.#scheduleStep(this.#now)
        continue
      }

      this.#stepScheduled = false
      this.#executeStep()

      if (this.#waiting.length > 0 || this.#running.length > 0) {
        this.#scheduleStep(this.#now)
      }
    }

    const unfinished = this.#requests.filter((request) => request.state !== 'finished')
    if (unfinished.length > 0) {
      const ids = unfinished.map((request) => request.id).join(', ')
      throw new SimulationStalledError(
        `simulation ended with ${unfinished.length} unfinished request(s): ${ids}`,
      )
    }

    this.#cache.validate()
    return this.#buildResult()
  }

  #prepareRequests(specs: readonly RequestSpec[]): MutableRequest[] {
    const seenIds = new Set<string>()

    for (const spec of specs) {
      if (typeof spec.id !== 'string' || spec.id.trim().length === 0) {
        throw new RequestValidationError('request id must be a non-empty string')
      }
      if (seenIds.has(spec.id)) {
        throw new RequestValidationError(`duplicate request id "${spec.id}"`)
      }
      seenIds.add(spec.id)

      if (!Number.isFinite(spec.arrivalTime) || spec.arrivalTime < 0) {
        throw new RequestValidationError(`request "${spec.id}" has an invalid arrivalTime`)
      }
      if (!Number.isSafeInteger(spec.promptTokens) || spec.promptTokens <= 0) {
        throw new RequestValidationError(`request "${spec.id}" must have promptTokens >= 1`)
      }
      if (!Number.isSafeInteger(spec.maxNewTokens) || spec.maxNewTokens <= 0) {
        throw new RequestValidationError(`request "${spec.id}" must have maxNewTokens >= 1`)
      }

      const worstCaseTokens = spec.promptTokens + spec.maxNewTokens
      if (!Number.isSafeInteger(worstCaseTokens)) {
        throw new RequestValidationError(`request "${spec.id}" is too large to represent safely`)
      }

      if (spec.prefix !== undefined) {
        if (typeof spec.prefix.key !== 'string' || spec.prefix.key.trim().length === 0) {
          throw new RequestValidationError(`request "${spec.id}" has an empty prefix key`)
        }
        if (!Number.isSafeInteger(spec.prefix.tokens) || spec.prefix.tokens <= 0) {
          throw new RequestValidationError(`request "${spec.id}" has an invalid prefix token count`)
        }
        if (spec.prefix.tokens > spec.promptTokens) {
          throw new RequestValidationError(
            `request "${spec.id}" declares a prefix longer than its prompt`,
          )
        }
      }

      const blocks = requiredBlocks(spec, this.#cache.blockSize)
      if (blocks > this.#cache.totalBlocks) {
        throw new RequestTooLargeError(
          `request "${spec.id}" needs ${blocks} KV blocks but the cache only has ${this.#cache.totalBlocks}`,
        )
      }
    }

    const sorted = specs
      .map((spec, originalIndex) => ({ spec, originalIndex }))
      .sort((a, b) => a.spec.arrivalTime - b.spec.arrivalTime || a.originalIndex - b.originalIndex)

    return sorted.map(({ spec }) => {
      const request: MutableRequest = {
        id: spec.id,
        arrivalTime: spec.arrivalTime,
        promptTokens: spec.promptTokens,
        maxNewTokens: spec.maxNewTokens,
        state: 'waiting',
        prefilledTokens: 0,
        outputTokens: 0,
        prefixHitTokens: 0,
        timestamps: { arrivedAt: spec.arrivalTime },
      }

      if (spec.prefix !== undefined) {
        return { ...request, prefix: { ...spec.prefix } }
      }
      return request
    })
  }

  #scheduleStep(time: number): void {
    this.#events.push({ kind: 'step', time, seq: this.#sequence })
    this.#sequence += 1
    this.#stepScheduled = true
  }

  #context(): SchedulingContext {
    return {
      now: this.#now,
      waiting: this.#waiting,
      running: this.#running,
      cache: this.#cache,
      config: this.#config,
    }
  }

  #executeStep(): void {
    if (this.#steps.length >= this.#config.maxSteps) {
      throw new SimulationLimitError(
        `simulation exceeded maxSteps=${this.#config.maxSteps}; check the scheduler or raise the guard`,
      )
    }

    const plan = this.#scheduler.plan(this.#context())
    this.#validatePlan(plan)

    const startMs = this.#now
    const waitingById = new Map(this.#waiting.map((request) => [request.id, request]))
    const admittedIds = new Set(plan.admit)

    for (const requestId of plan.admit) {
      const request = waitingById.get(requestId)
      if (request === undefined) {
        // Unreachable after validation; keeps the execution phase defensive.
        throw new PlanValidationError(`cannot admit unknown waiting request "${requestId}"`)
      }

      const prefixTokens = this.#prefixTokensFor(request)
      const prefix = request.prefix
      this.#cache.reserve(
        requestId,
        request.promptTokens + request.maxNewTokens,
        prefix !== undefined && prefixTokens > 0
          ? { key: prefix.key, tokens: prefixTokens }
          : undefined,
      )

      const hitTokens = this.#cache.prefixHitTokensFor(requestId)
      request.prefilledTokens = hitTokens
      request.prefixHitTokens = hitTokens
      request.state = 'prefill'
      request.timestamps.admittedAt = startMs
      request.timestamps.prefillStartedAt = startMs
      this.#running.push(request)
    }

    if (admittedIds.size > 0) {
      this.#waiting = this.#waiting.filter((request) => !admittedIds.has(request.id))
    }

    // The scheduler planned against pre-hit state. A prefix hit can reduce the
    // remaining prompt, so its intent is an upper bound; clamp to the suffix.
    const prefilled: PrefillIntent[] = []
    let prefillTokens = 0

    for (const intent of plan.prefill) {
      const request = this.#byId.get(intent.requestId)
      if (request === undefined) {
        throw new PlanValidationError(`cannot prefill unknown request "${intent.requestId}"`)
      }

      const remainingPromptTokens = request.promptTokens - request.prefilledTokens
      const tokens = Math.min(intent.tokens, remainingPromptTokens)
      if (tokens <= 0) continue

      prefilled.push({ requestId: request.id, tokens })
      prefillTokens += tokens
    }

    const decodeTokens = plan.decode.length

    if (prefillTokens + decodeTokens === 0) {
      throw new SimulationStalledError(
        `scheduler "${this.#scheduler.name}" produced no work while ` +
          `${this.#waiting.length} request(s) are waiting and ${this.#running.length} are running`,
      )
    }

    const latencyMs = estimateStepLatency(this.#config.cost, prefillTokens, decodeTokens)
    const endMs = startMs + latencyMs

    if (endMs > this.#config.maxSimTimeMs) {
      throw new SimulationLimitError(
        `simulation reached ${endMs.toFixed(1)}ms, beyond maxSimTimeMs=${this.#config.maxSimTimeMs}`,
      )
    }

    for (const intent of prefilled) {
      const request = this.#byId.get(intent.requestId)
      if (request === undefined) {
        throw new PlanValidationError(`cannot prefill unknown request "${intent.requestId}"`)
      }

      this.#cache.appendTokens(request.id, intent.tokens)
      request.prefilledTokens += intent.tokens

      if (request.prefilledTokens === request.promptTokens) {
        request.state = 'decode'
        request.outputTokens = 1
        this.#cache.appendTokens(request.id, 1)
        request.timestamps.firstTokenAt = endMs
      }
    }

    for (const requestId of plan.decode) {
      const request = this.#byId.get(requestId)
      if (request === undefined) {
        throw new PlanValidationError(`cannot decode unknown request "${requestId}"`)
      }

      this.#cache.appendTokens(request.id, 1)
      request.outputTokens += 1
      if (request.timestamps.firstTokenAt === undefined) {
        request.timestamps.firstTokenAt = endMs
      }
    }

    const stillRunning: MutableRequest[] = []
    for (const request of this.#running) {
      if (request.outputTokens >= request.maxNewTokens) {
        this.#cache.free(request.id)
        request.state = 'finished'
        request.timestamps.finishedAt = endMs
      } else {
        stillRunning.push(request)
      }
    }
    this.#running = stillRunning

    const batchIds = new Set<string>([
      ...plan.admit,
      ...prefilled.map((intent) => intent.requestId),
      ...plan.decode,
    ])

    const cache = this.#cache.stats
    this.#steps.push({
      index: this.#steps.length,
      startMs,
      endMs,
      latencyMs,
      admitted: [...plan.admit],
      prefilled: prefilled.map((intent) => ({
        requestId: intent.requestId,
        tokens: intent.tokens,
      })),
      decoded: [...plan.decode],
      prefillTokens,
      decodeTokens,
      batchSize: batchIds.size,
      cache: {
        allocatedBlocks: cache.allocatedBlocks,
        cachedBlocks: cache.cachedBlocks,
        physicalBlocks: cache.physicalBlocks,
        logicalBlocks: cache.logicalBlocks,
        sharedBlocks: cache.sharedBlocks,
        reservedBlocks: cache.reservedBlocks,
        availableBlocks: cache.availableBlocks,
      },
    })

    this.#now = endMs
  }

  /** Block-aligned prefix length, keeping at least one prompt token to prefill. */
  #prefixTokensFor(request: MutableRequest): number {
    const prefix = request.prefix
    if (prefix === undefined) return 0

    const capped = Math.min(prefix.tokens, request.promptTokens - 1)
    return Math.max(0, Math.floor(capped / this.#cache.blockSize) * this.#cache.blockSize)
  }

  #validatePlan(plan: StepPlan): void {
    const config = this.#config
    const waitingById = new Map(this.#waiting.map((request) => [request.id, request]))
    const runningById = new Map(this.#running.map((request) => [request.id, request]))
    const admitted = new Set<string>()

    if (this.#running.length + plan.admit.length > config.maxBatchSize) {
      throw new PlanValidationError(
        `plan would run ${this.#running.length + plan.admit.length} requests, ` +
          `exceeding maxBatchSize=${config.maxBatchSize}`,
      )
    }

    for (const requestId of plan.admit) {
      if (admitted.has(requestId)) {
        throw new PlanValidationError(`request "${requestId}" appears twice in plan.admit`)
      }
      const request = waitingById.get(requestId)
      if (request === undefined) {
        throw new PlanValidationError(
          `request "${requestId}" cannot be admitted: it is not waiting`,
        )
      }
      if (request.state !== 'waiting') {
        throw new PlanValidationError(
          `request "${requestId}" cannot be admitted in state "${request.state}"`,
        )
      }
      if (this.#cache.has(requestId)) {
        throw new PlanValidationError(
          `waiting request "${requestId}" already holds a KV reservation`,
        )
      }
      admitted.add(requestId)
    }

    const prefilled = new Set<string>()
    let totalTokens = 0

    for (const intent of plan.prefill) {
      if (!Number.isSafeInteger(intent.tokens) || intent.tokens <= 0) {
        throw new PlanValidationError(
          `prefill intent for "${intent.requestId}" must have a positive integer token count`,
        )
      }
      if (prefilled.has(intent.requestId)) {
        throw new PlanValidationError(`request "${intent.requestId}" appears twice in plan.prefill`)
      }
      prefilled.add(intent.requestId)

      const request = admitted.has(intent.requestId)
        ? waitingById.get(intent.requestId)
        : runningById.get(intent.requestId)

      if (request === undefined) {
        throw new PlanValidationError(
          `cannot prefill "${intent.requestId}": it is neither waiting nor running`,
        )
      }

      if (admitted.has(intent.requestId)) {
        if (request.state !== 'waiting') {
          throw new PlanValidationError(
            `newly admitted request "${request.id}" must still be waiting`,
          )
        }
      } else if (request.state !== 'prefill') {
        throw new PlanValidationError(
          `cannot prefill "${request.id}" in state "${request.state}"; only running prefill requests continue`,
        )
      }

      const remainingPromptTokens = request.promptTokens - request.prefilledTokens
      if (intent.tokens > remainingPromptTokens) {
        throw new PlanValidationError(
          `prefill for "${request.id}" asks for ${intent.tokens} tokens but only ${remainingPromptTokens} remain`,
        )
      }

      totalTokens += intent.tokens
    }

    for (const requestId of plan.admit) {
      if (!prefilled.has(requestId)) {
        throw new PlanValidationError(`admitted request "${requestId}" has no prefill intent`)
      }
    }

    const decoded = new Set<string>()
    for (const requestId of plan.decode) {
      if (decoded.has(requestId)) {
        throw new PlanValidationError(`request "${requestId}" appears twice in plan.decode`)
      }
      if (admitted.has(requestId) || prefilled.has(requestId)) {
        throw new PlanValidationError(
          `request "${requestId}" cannot prefill and decode (or be admitted and decoded) in the same step`,
        )
      }

      const request = runningById.get(requestId)
      if (request === undefined || request.state !== 'decode') {
        throw new PlanValidationError(
          `request "${requestId}" cannot decode: it is not a running decode request`,
        )
      }
      if (request.outputTokens >= request.maxNewTokens) {
        throw new PlanValidationError(
          `request "${requestId}" already generated all requested tokens`,
        )
      }

      decoded.add(requestId)
      totalTokens += 1
    }

    if (totalTokens > config.maxNumBatchedTokens) {
      throw new PlanValidationError(
        `plan uses ${totalTokens} tokens, exceeding maxNumBatchedTokens=${config.maxNumBatchedTokens}`,
      )
    }

    let requiredAdmissionBlocks = 0
    for (const requestId of plan.admit) {
      const request = waitingById.get(requestId)
      if (request !== undefined) {
        requiredAdmissionBlocks += requiredBlocks(request, this.#cache.blockSize)
      }
    }
    if (requiredAdmissionBlocks > this.#cache.availableBlocks) {
      throw new PlanValidationError(
        `plan asks for ${requiredAdmissionBlocks} KV blocks but only ${this.#cache.availableBlocks} are available`,
      )
    }
  }

  #buildResult(): SimulationResult {
    const outcomes: RequestOutcome[] = []
    for (const request of this.#requests) {
      if (request.outputTokens !== request.maxNewTokens) {
        throw new Error(
          `request "${request.id}" finished with ${request.outputTokens}/${request.maxNewTokens} tokens`,
        )
      }
      outcomes.push(toRequestOutcome(request))
    }

    const cache = this.#cache.stats
    const summary = summarizeOutcomes(outcomes, this.#steps, cache, this.#scheduler.name)

    return {
      meta: {
        simulated: true,
        strategy: this.#scheduler.name,
        costModelNote: SIMULATED_LATENCY_NOTE,
        config: this.#config,
      },
      requests: outcomes,
      steps: this.#steps,
      summary,
      cache,
    }
  }
}
