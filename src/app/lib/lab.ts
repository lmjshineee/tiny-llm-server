import {
  ContinuousBatchingScheduler,
  FcfsScheduler,
  createBenchmarkScenarioInput,
  createEngineConfig,
  runSimulation,
} from '../../core/index'
import type {
  BenchmarkScenarioInput,
  EngineConfig,
  SimulationResult,
} from '../../core/index'

export type SchedulerTab = 'fcfs' | 'continuous-batching'

export interface LabControls {
  readonly scenario: string
  readonly seed: number
  readonly batchSize: number
  readonly kvBlocks: number
}

export interface LabRun {
  readonly controls: LabControls
  readonly input: BenchmarkScenarioInput
  readonly engine: EngineConfig
  readonly results: Readonly<Record<SchedulerTab, SimulationResult>>
}

export const DEFAULT_LAB_CONTROLS: LabControls = {
  scenario: 'steady',
  seed: 42,
  batchSize: 16,
  kvBlocks: 2048,
}

export const SCHEDULER_TABS: ReadonlyArray<{
  readonly id: SchedulerTab
  readonly label: string
}> = [
  { id: 'continuous-batching', label: 'Continuous batching' },
  { id: 'fcfs', label: 'FCFS (sequential)' },
]

export function schedulerLabel(tab: SchedulerTab): string {
  return SCHEDULER_TABS.find((entry) => entry.id === tab)?.label ?? tab
}

/** Run both policies on the same scenario requests and engine config. */
export function runLab(controls: LabControls): LabRun {
  const input = createBenchmarkScenarioInput(controls.scenario, controls.seed)
  const engine = createEngineConfig({
    ...input.engineOverrides,
    maxBatchSize: controls.batchSize,
    prefillChunkSize: 512,
    kv: {
      ...(input.engineOverrides.kv ?? {}),
      totalBlocks: controls.kvBlocks,
    },
  })

  const fcfs = runSimulation({
    requests: input.requests,
    scheduler: new FcfsScheduler(),
    config: engine,
  })
  const continuous = runSimulation({
    requests: input.requests,
    scheduler: new ContinuousBatchingScheduler(),
    config: engine,
  })

  return {
    controls: { ...controls },
    input,
    engine,
    results: {
      fcfs,
      'continuous-batching': continuous,
    },
  }
}
