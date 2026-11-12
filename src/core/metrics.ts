import type {
  CacheStats,
  DistributionSummary,
  RequestOutcome,
  RequestView,
  StepRecord,
  Summary,
} from './types'

/**
 * Linear-interpolated percentile over an unsorted sample.
 * Returns `null` for an empty sample. `p` must be in [0, 1].
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError(`p must be in [0, 1], got ${String(p)}`)
  }
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const rank = (sorted.length - 1) * p
  const lowerIndex = Math.floor(rank)
  const upperIndex = Math.ceil(rank)
  const lower = sorted[lowerIndex]
  const upper = sorted[upperIndex]

  if (lower === undefined || upper === undefined) return null
  if (lowerIndex === upperIndex) return lower
  return lower + (upper - lower) * (rank - lowerIndex)
}

function summarizeValues(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, mean: null, p50: null, p95: null, p99: null, max: null }
  }

  const sorted = [...values].sort((a, b) => a - b)
  let sum = 0
  for (const value of values) sum += value

  return {
    count: values.length,
    mean: sum / values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? null,
  }
}

/** Derive per-request latency metrics from a finished request. */
export function toRequestOutcome(request: RequestView): RequestOutcome {
  const { arrivedAt, admittedAt, prefillStartedAt, firstTokenAt, finishedAt } = request.timestamps

  if (
    admittedAt === undefined ||
    prefillStartedAt === undefined ||
    firstTokenAt === undefined ||
    finishedAt === undefined
  ) {
    throw new Error(`request "${request.id}" is not finished and has no outcome`)
  }

  const tokenIntervals = request.outputTokens - 1
  const tpotMs = tokenIntervals > 0 ? (finishedAt - firstTokenAt) / tokenIntervals : null

  return {
    id: request.id,
    arrivalTime: request.arrivalTime,
    promptTokens: request.promptTokens,
    maxNewTokens: request.maxNewTokens,
    timestamps: { arrivedAt, admittedAt, prefillStartedAt, firstTokenAt, finishedAt },
    outputTokens: request.outputTokens,
    ttftMs: firstTokenAt - arrivedAt,
    tpotMs,
    e2eMs: finishedAt - arrivedAt,
  }
}

/** Build the comparable summary used by the CLI, tests, and (later) the web UI. */
export function summarizeOutcomes(
  outcomes: readonly RequestOutcome[],
  steps: readonly StepRecord[],
  cache: CacheStats,
  strategy: string,
): Summary {
  const completed = outcomes.length
  let outputTokens = 0
  let firstArrivalMs = Number.POSITIVE_INFINITY
  let lastFinishMs = Number.NEGATIVE_INFINITY

  const ttftValues: number[] = []
  const tpotValues: number[] = []
  const e2eValues: number[] = []

  for (const outcome of outcomes) {
    outputTokens += outcome.outputTokens
    firstArrivalMs = Math.min(firstArrivalMs, outcome.arrivalTime)
    lastFinishMs = Math.max(lastFinishMs, outcome.timestamps.finishedAt)
    ttftValues.push(outcome.ttftMs)
    e2eValues.push(outcome.e2eMs)
    if (outcome.tpotMs !== null) tpotValues.push(outcome.tpotMs)
  }

  const makespanMs = completed > 0 ? lastFinishMs - firstArrivalMs : 0
  const seconds = makespanMs / 1000
  const throughputRequestsPerSecond = seconds > 0 ? completed / seconds : 0
  const throughputOutputTokensPerSecond = seconds > 0 ? outputTokens / seconds : 0

  let decodeSteps = 0
  let decodedTokens = 0
  for (const step of steps) {
    if (step.decodeTokens > 0) {
      decodeSteps += 1
      decodedTokens += step.decodeTokens
    }
  }

  return {
    strategy,
    simulated: true,
    totalRequests: completed,
    completedRequests: completed,
    makespanMs,
    throughputRequestsPerSecond,
    throughputOutputTokensPerSecond,
    ttftMs: summarizeValues(ttftValues),
    tpotMs: summarizeValues(tpotValues),
    e2eMs: summarizeValues(e2eValues),
    totalSteps: steps.length,
    avgDecodeBatchSize: decodeSteps > 0 ? decodedTokens / decodeSteps : 0,
    kvPeakAllocatedBlocks: cache.peakAllocatedBlocks,
    kvPeakReservedBlocks: cache.peakReservedBlocks,
    kvPeakUtilization: cache.totalBlocks > 0 ? cache.peakAllocatedBlocks / cache.totalBlocks : 0,
  }
}
