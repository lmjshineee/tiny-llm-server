/**
 * Replay the burst workload from `drive-burst.py` through the simulator.
 *
 * The request set matches the real one: 24 requests, eight each at 132/523/1033
 * prompt tokens (the measured token counts), 64 output tokens, all arriving at
 * t = 0. Engine shape approximates the server: 8 slots, 512-token prefill chunk.
 *
 * Run with `pnpm tsx docs/learning/notes/tools/run-burst-sim.ts`.
 */
import {
  ContinuousBatchingScheduler,
  FcfsScheduler,
  createEngineConfig,
  getCostProfile,
  runSimulation,
} from '../../../../src/core/index'
import type { RequestSpec, SimulationResult } from '../../../../src/core/index'

const PROMPT_TOKENS = [132, 523, 1033]
const MAX_NEW_TOKENS = 64

const requests: RequestSpec[] = Array.from({ length: 24 }, (_, index) => ({
  id: `r${String(index).padStart(2, '0')}`,
  arrivalTime: 0,
  promptTokens: PROMPT_TOKENS[index % PROMPT_TOKENS.length] ?? 523,
  maxNewTokens: MAX_NEW_TOKENS,
}))

const profile = getCostProfile('measured-m5-q4-0.5b')
const config = createEngineConfig({
  cost: profile.cost,
  maxBatchSize: 8,
  maxNumBatchedTokens: 4096,
  prefillChunkSize: 512,
  kv: { blockSize: 16, totalBlocks: 2048 },
})

function summarize(result: SimulationResult) {
  const s = result.summary
  return {
    strategy: s.strategy,
    makespan_ms: s.makespanMs,
    ttft_p50: s.ttftMs.p50,
    ttft_p95: s.ttftMs.p95,
    tpot_p50: s.tpotMs.p50,
    e2e_p95: s.e2eMs.p95,
    output_tok_per_s: s.throughputOutputTokensPerSecond,
    avg_decode_batch: s.avgDecodeBatchSize,
  }
}

const runs = [
  runSimulation({ requests, scheduler: new FcfsScheduler(), config }),
  runSimulation({ requests, scheduler: new ContinuousBatchingScheduler(), config }),
]

process.stdout.write(
  `${JSON.stringify(
    {
      source: 'simulator',
      costProfile: profile.id,
      engine: {
        maxBatchSize: config.maxBatchSize,
        prefillChunkSize: config.prefillChunkSize,
        maxNumBatchedTokens: config.maxNumBatchedTokens,
        kvBlocks: config.kv.totalBlocks,
      },
      runs: runs.map(summarize),
    },
    null,
    2,
  )}\n`,
)
