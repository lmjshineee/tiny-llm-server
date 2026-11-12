/** Lifecycle of a request inside the simulator. */
export const REQUEST_STATES = ['waiting', 'prefill', 'decode', 'finished'] as const

export type RequestState = (typeof REQUEST_STATES)[number]

/** Synthetic content identity for a reusable prompt prefix. */
export interface RequestPrefix {
  /** Identity shared by requests whose prefix tokens are identical. */
  readonly key: string
  /** Declared prefix length in tokens; the cache only shares whole blocks. */
  readonly tokens: number
}

/** Immutable request description produced by the workload generator. */
export interface RequestSpec {
  readonly id: string
  readonly arrivalTime: number
  readonly promptTokens: number
  readonly maxNewTokens: number
  /** Optional shared-prefix metadata. Omit it to disable prefix caching for this request. */
  readonly prefix?: RequestPrefix
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
  /** Tokens skipped because a cached prefix was reused (0 for cache misses). */
  readonly prefixHitTokens?: number
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
  /**
   * Physical blocks referenced by at least one active request. Shared prefix
   * blocks are counted once, not once per owning request.
   */
  readonly allocatedBlocks: number
  /** Worst-case logical blocks promised to active requests (>= allocatedBlocks). */
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
  /** Retained prefix-cache blocks that no active request references (evictable). */
  readonly cachedBlocks: number
  /** allocatedBlocks + cachedBlocks: the real physical footprint. */
  readonly physicalBlocks: number
  /** Sum of active block-table lengths; shared blocks are counted once per request. */
  readonly logicalBlocks: number
  /** Active physical blocks referenced by more than one request. */
  readonly sharedBlocks: number
  /** Physically free blocks (totalBlocks - physicalBlocks); retained cache is not free. */
  readonly freeAllocatedBlocks: number
  readonly peakAllocatedBlocks: number
  readonly peakCachedBlocks: number
  readonly peakPhysicalBlocks: number
  readonly peakLogicalBlocks: number
  readonly peakSharedBlocks: number
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
  readonly prefixHitTokens: number
  readonly ttftMs: number
  readonly tpotMs: number | null
  readonly e2eMs: number
}

export interface PrefixCacheSummary {
  readonly hitRequests: number
  readonly totalRequests: number
  readonly hitTokens: number
  readonly totalPromptTokens: number
  /** Fraction of requests that reused at least one cached prefix block. */
  readonly requestHitRate: number
  /** Fraction of all prompt tokens served from the prefix cache. */
  readonly tokenHitRate: number
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
  readonly prefixCache: PrefixCacheSummary
  readonly kvPeakAllocatedBlocks: number
  readonly kvPeakReservedBlocks: number
  readonly kvPeakCachedBlocks: number
  readonly kvPeakPhysicalBlocks: number
  readonly kvPeakLogicalBlocks: number
  readonly kvPeakSharedBlocks: number
  readonly kvPeakUtilization: number
  readonly kvPeakPhysicalUtilization: number
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
