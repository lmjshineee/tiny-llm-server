import type {
  RequestOutcome,
  SimulationResult,
  StepCacheSnapshot,
  StepRecord,
} from '../../core/index'

export interface RequestHistoryPoint {
  readonly stepIndex: number
  readonly prefilledTokens: number
  readonly outputTokens: number
  readonly admitted: boolean
}

export type RequestHistories = ReadonlyMap<string, readonly RequestHistoryPoint[]>

interface MutableProgress {
  prefilledTokens: number
  outputTokens: number
  admitted: boolean
}

export interface RequestTimelineState {
  readonly id: string
  readonly promptTokens: number
  readonly maxNewTokens: number
  readonly prefixHitTokens: number
  readonly state: 'waiting' | 'prefill' | 'decode'
  readonly prefilledTokens: number
  readonly outputTokens: number
  readonly promptProgress: number
  readonly outputProgress: number
  readonly logicalBlocks: number
  readonly prefixBlocks: number
}

export interface FinishedRequestState {
  readonly id: string
  readonly promptTokens: number
  readonly maxNewTokens: number
  readonly prefixHitTokens: number
  readonly ttftMs: number
  readonly tpotMs: number | null
  readonly e2eMs: number
}

export interface StepView {
  readonly step: StepRecord
  readonly waiting: readonly RequestTimelineState[]
  readonly running: readonly RequestTimelineState[]
  readonly finished: readonly FinishedRequestState[]
  readonly finishedCount: number
  readonly arrivedCount: number
  readonly cache: StepCacheSnapshot
}

function initialPoint(): RequestHistoryPoint {
  return { stepIndex: -1, prefilledTokens: 0, outputTokens: 0, admitted: false }
}

/**
 * Build per-request progress histories in one pass. The visualizer can then
 * binary-search the state at any timeline step without replaying every step on
 * each render.
 */
export function buildRequestHistories(result: SimulationResult): RequestHistories {
  const outcomesById = new Map(result.requests.map((outcome) => [outcome.id, outcome]))
  const histories = new Map<string, RequestHistoryPoint[]>()
  const current = new Map<string, MutableProgress>()

  for (const outcome of result.requests) {
    histories.set(outcome.id, [initialPoint()])
    current.set(outcome.id, { prefilledTokens: 0, outputTokens: 0, admitted: false })
  }

  for (const step of result.steps) {
    const touched = new Set<string>()

    for (const requestId of step.admitted) {
      const outcome = outcomesById.get(requestId)
      const progress = current.get(requestId)
      if (outcome === undefined || progress === undefined) continue

      progress.admitted = true
      progress.prefilledTokens = outcome.prefixHitTokens
      progress.outputTokens = 0
      touched.add(requestId)
    }

    for (const intent of step.prefilled) {
      const outcome = outcomesById.get(intent.requestId)
      const progress = current.get(intent.requestId)
      if (outcome === undefined || progress === undefined) continue

      progress.prefilledTokens += intent.tokens
      if (progress.prefilledTokens >= outcome.promptTokens && progress.outputTokens === 0) {
        progress.outputTokens = 1
      }
      touched.add(intent.requestId)
    }

    for (const requestId of step.decoded) {
      const progress = current.get(requestId)
      if (progress === undefined) continue
      progress.outputTokens += 1
      touched.add(requestId)
    }

    for (const requestId of touched) {
      const progress = current.get(requestId)
      if (progress === undefined) continue
      histories.get(requestId)?.push({
        stepIndex: step.index,
        prefilledTokens: progress.prefilledTokens,
        outputTokens: progress.outputTokens,
        admitted: progress.admitted,
      })
    }
  }

  return histories
}

function latestPoint(
  points: readonly RequestHistoryPoint[],
  stepIndex: number,
): RequestHistoryPoint {
  let low = 0
  let high = points.length - 1
  let answer = points[0] ?? initialPoint()

  while (low <= high) {
    const middle = (low + high) >> 1
    const point = points[middle]
    if (point === undefined) break

    if (point.stepIndex <= stepIndex) {
      answer = point
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return answer
}

function makeState(
  outcome: RequestOutcome,
  point: RequestHistoryPoint,
  state: 'waiting' | 'prefill' | 'decode',
  blockSize: number,
): RequestTimelineState {
  const sequenceTokens = point.prefilledTokens + point.outputTokens
  return {
    id: outcome.id,
    promptTokens: outcome.promptTokens,
    maxNewTokens: outcome.maxNewTokens,
    prefixHitTokens: point.admitted ? outcome.prefixHitTokens : 0,
    state,
    prefilledTokens: point.prefilledTokens,
    outputTokens: point.outputTokens,
    promptProgress:
      outcome.promptTokens > 0 ? Math.min(1, point.prefilledTokens / outcome.promptTokens) : 0,
    outputProgress:
      outcome.maxNewTokens > 0 ? Math.min(1, point.outputTokens / outcome.maxNewTokens) : 0,
    logicalBlocks: point.admitted ? Math.ceil(sequenceTokens / blockSize) : 0,
    prefixBlocks: point.admitted
      ? Math.ceil(outcome.prefixHitTokens / blockSize)
      : 0,
  }
}

/** Derive the visual state at the end of one step. */
export function deriveStepView(
  result: SimulationResult,
  histories: RequestHistories,
  stepIndex: number,
): StepView | null {
  if (result.steps.length === 0) return null

  const index = Math.min(Math.max(stepIndex, 0), result.steps.length - 1)
  const step = result.steps[index]
  if (step === undefined) return null

  const blockSize = result.meta.config.kv.blockSize
  const tolerance = 1e-9
  const waiting: RequestTimelineState[] = []
  const running: RequestTimelineState[] = []
  const finished: FinishedRequestState[] = []
  let arrivedCount = 0

  for (const outcome of result.requests) {
    if (outcome.arrivalTime > step.endMs + tolerance) continue
    arrivedCount += 1

    const points = histories.get(outcome.id)
    const point = points === undefined ? initialPoint() : latestPoint(points, index)
    const isFinished = outcome.timestamps.finishedAt <= step.endMs + tolerance

    if (isFinished) {
      finished.push({
        id: outcome.id,
        promptTokens: outcome.promptTokens,
        maxNewTokens: outcome.maxNewTokens,
        prefixHitTokens: outcome.prefixHitTokens,
        ttftMs: outcome.ttftMs,
        tpotMs: outcome.tpotMs,
        e2eMs: outcome.e2eMs,
      })
      continue
    }

    if (!point.admitted) {
      waiting.push(makeState(outcome, point, 'waiting', blockSize))
      continue
    }

    const state = point.prefilledTokens >= outcome.promptTokens ? 'decode' : 'prefill'
    running.push(makeState(outcome, point, state, blockSize))
  }

  return {
    step,
    waiting,
    running,
    finished,
    finishedCount: finished.length,
    arrivedCount,
    cache: step.cache,
  }
}

export function lastStepIndex(result: SimulationResult): number {
  return Math.max(0, result.steps.length - 1)
}

/** A representative mid-run step for first paint and run/tab changes. */
export function suggestedStepIndex(result: SimulationResult, fraction = 0.35): number {
  if (result.steps.length <= 1) return 0
  return Math.min(lastStepIndex(result), Math.floor(lastStepIndex(result) * fraction))
}
