/** Lifecycle of a request inside the simulator. */
export const REQUEST_STATES = ['waiting', 'prefill', 'decode', 'finished'] as const

export type RequestState = (typeof REQUEST_STATES)[number]

/** Immutable request description produced by the workload generator. */
export interface RequestSpec {
  readonly id: string
  readonly arrivalTime: number
  readonly promptTokens: number
  readonly maxNewTokens: number
}

/** Virtual-clock timestamps, in milliseconds. */
export interface RequestTimestamps {
  arrivedAt: number
  admittedAt?: number
  prefillStartedAt?: number
  firstTokenAt?: number
  finishedAt?: number
}

/** Read-only view of a request exposed to schedulers. */
export interface RequestView extends RequestSpec {
  readonly state: RequestState
  readonly prefilledTokens: number
  readonly outputTokens: number
  readonly timestamps: Readonly<RequestTimestamps>
}

/** A chunk of prompt tokens to compute in one step. */
export interface PrefillIntent {
  readonly requestId: string
  readonly tokens: number
}

/**
 * Everything a scheduler may do in one engine step.
 *
 * Invariants (enforced by the engine before execution):
 * - `admit` only contains waiting requests, each with a non-empty prefill intent.
 * - `prefill` targets an admitted request or a running request still in prefill.
 * - `decode` targets running requests that already finished prefill.
 * - Total prefill tokens + decode tokens never exceed `maxNumBatchedTokens`.
 * - Running + admitted requests never exceed `maxBatchSize`.
 * - New admissions must fit in the KV cache's *available* blocks.
 */
export interface StepPlan {
  readonly admit: readonly string[]
  readonly prefill: readonly PrefillIntent[]
  readonly decode: readonly string[]
}

/** Read-only KV cache accounting exposed to schedulers. */
export interface CacheView {
  readonly blockSize: number
  readonly totalBlocks: number
  /** Blocks currently holding real tokens. */
  readonly allocatedBlocks: number
  /** Worst-case blocks promised to active requests (>= allocatedBlocks). */
  readonly reservedBlocks: number
  /** Blocks that may still be promised to new requests (totalBlocks - reservedBlocks). */
  readonly availableBlocks: number
}

export interface SchedulingContext {
  readonly now: number
  readonly waiting: readonly RequestView[]
  readonly running: readonly RequestView[]
  readonly cache: CacheView
  readonly config: EngineConfig
}

/** A scheduling policy. Implementations must be deterministic and side-effect free. */
export interface Scheduler {
  readonly name: string
  plan(context: SchedulingContext): StepPlan
}

export interface KVCacheConfig {
  readonly blockSize: number
  readonly totalBlocks: number
}

/**
 * Synthetic latency model. All values are milliseconds and are *not* measured
 * on real hardware. See ARCHITECTURE.md for the rationale.
 */
export interface CostModel {
  /** Per-step scheduling/bookkeeping overhead. */
  readonly stepOverheadMs: number
  /** Fixed kernel launch / weight-read cost of a prefill step. */
  readonly prefillBaseMs: number
  /** Compute cost of one prefill token. */
  readonly prefillMsPerToken: number
  /** Fixed weight-read cost of a decode step (roughly constant in batch size). */
  readonly decodeBaseMs: number
  /** Incremental decode cost of each additional sequence in the batch. */
  readonly decodeMsPerRequest: number
}

export interface EngineConfig {
  readonly maxNumBatchedTokens: number
  readonly maxBatchSize: number
  readonly prefillChunkSize: number
  readonly kv: KVCacheConfig
  readonly cost: CostModel
  readonly maxSteps: number
  readonly maxSimTimeMs: number
}

export interface CacheStats extends CacheView {
  /** Blocks not holding tokens right now (can be reserved for future use). */
  readonly freeAllocatedBlocks: number
  readonly peakAllocatedBlocks: number
  readonly peakReservedBlocks: number
  readonly activeRequests: number
}

export interface StepRecord {
  readonly index: number
  readonly startMs: number
  readonly endMs: number
  readonly latencyMs: number
  readonly admitted: readonly string[]
  readonly prefilled: readonly PrefillIntent[]
  readonly decoded: readonly string[]
  readonly prefillTokens: number
  readonly decodeTokens: number
  /** Number of distinct requests that received compute in this step. */
  readonly batchSize: number
}

/** Aggregated latency statistics. `null` means "no observations". */
export interface DistributionSummary {
  readonly count: number
  readonly mean: number | null
  readonly p50: number | null
  readonly p95: number | null
  readonly p99: number | null
  readonly max: number | null
}

/** A finished request together with derived metrics (all times in ms). */
export interface RequestOutcome extends RequestSpec {
  readonly timestamps: Readonly<Required<RequestTimestamps>>
  readonly outputTokens: number
  readonly ttftMs: number
  readonly tpotMs: number | null
  readonly e2eMs: number
}

export interface Summary {
  readonly strategy: string
  readonly simulated: true
  readonly totalRequests: number
  readonly completedRequests: number
  readonly makespanMs: number
  readonly throughputRequestsPerSecond: number
  readonly throughputOutputTokensPerSecond: number
  readonly ttftMs: DistributionSummary
  readonly tpotMs: DistributionSummary
  readonly e2eMs: DistributionSummary
  readonly totalSteps: number
  /** Mean number of sequences decoded per step, over steps that decoded anything. */
  readonly avgDecodeBatchSize: number
  readonly kvPeakAllocatedBlocks: number
  readonly kvPeakReservedBlocks: number
  readonly kvPeakUtilization: number
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
