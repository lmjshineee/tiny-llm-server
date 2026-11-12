export * from './errors'
export type * from './types'

export { DEFAULT_ENGINE_CONFIG, SIMULATED_LATENCY_NOTE, createEngineConfig, validateEngineConfig } from './config'
export {
  BENCHMARK_SCENARIO_NAMES,
  BENCHMARK_SCHEMA_VERSION,
  COST_MODEL_VERSION,
  DEFAULT_BENCHMARK_SEED,
  SCHEDULER_KINDS,
  runBenchmark,
} from './benchmark'
export type {
  BenchmarkMatrix,
  BenchmarkOptions,
  BenchmarkReport,
  BenchmarkRun,
  BenchmarkScenario,
  SchedulerKind,
} from './benchmark'
export { estimateStepLatency } from './cost-model'
export { runSimulation } from './engine'
export type { RunSimulationInput, SimulationMeta, SimulationResult } from './engine'
export { PagedKVCache, blocksForTokens, requiredBlocks } from './kv-cache'
export { percentile, summarizeOutcomes, toRequestOutcome } from './metrics'
export { MinHeap } from './min-heap'
export { createRng, sampleExponentialMs, sampleStandardNormal } from './rng'
export type { Rng } from './rng'
export { ContinuousBatchingScheduler } from './schedulers/continuous-batching'
export { FcfsScheduler } from './schedulers/fcfs'
export { DEFAULT_WORKLOAD_CONFIG, createWorkloadConfig, generateWorkload, validateWorkloadConfig } from './workload'
export type { TokenDistribution, WorkloadConfig } from './workload'
