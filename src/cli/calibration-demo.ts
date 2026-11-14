/**
 * Calibration demo: the same three requests priced by three cost models.
 *
 * Everything this script prints is produced by `estimateStepLatency`, i.e. by the
 * lab's analytical cost model. It is NOT a measurement. The "measured" column is
 * copied from `docs/learning/notes/calibration-01.md` (Apple M5, 8-core GPU,
 * Qwen2.5-0.5B-Instruct Q4_K_M, llama.cpp 0.9.0 + Metal, 2026-11-14) so the two
 * can be read side by side.
 *
 * Run with `pnpm demo:calibration`.
 */
import { DEFAULT_ENGINE_CONFIG, SIMULATED_LATENCY_NOTE, estimateStepLatency } from '../core/index'
import type { CostModel } from '../core/index'

interface Profile {
  readonly name: string
  readonly cost: CostModel
  readonly note: string
}

/**
 * Request set. `real` values are the warm client-side numbers from the measured
 * report: a ~20-token Chinese prompt, a ~20-token English prompt, and a
 * ~1020-token prompt. Long-prompt TPOT is noisy because the model emitted only
 * a few tokens there, so it is shown as reference only.
 */
interface DemoRequest {
  readonly name: string
  readonly promptTokens: number
  readonly outputTokens: number
  /** `realE2E: false` when the live run generated a different token count. */
  readonly real:
    | { readonly ttftMs: number; readonly tpotMs: number; readonly realE2E: boolean }
    | null
}

const PROFILES: readonly Profile[] = [
  {
    name: 'synthetic-v1',
    cost: DEFAULT_ENGINE_CONFIG.cost,
    note: '项目默认值，7B 4-bit 量级',
  },
  {
    name: 'predicted-0.5b',
    cost: {
      stepOverheadMs: 0.4,
      prefillBaseMs: 15,
      prefillMsPerToken: 1.1,
      decodeBaseMs: 5,
      decodeMsPerRequest: 0.16,
    },
    note: '实测前的预注册预测（H5/H6 失败）',
  },
  {
    name: 'measured-0.5b',
    cost: {
      stepOverheadMs: 1.83,
      prefillBaseMs: 4.6,
      prefillMsPerToken: 0.126,
      decodeBaseMs: 2.67,
      decodeMsPerRequest: 0.086,
    },
    note: '五点扫描线性拟合；缺少二次项',
  },
]

const REQUESTS: readonly DemoRequest[] = [
  {
    name: 'zh  ~20 prompt / 64 out',
    promptTokens: 20,
    outputTokens: 64,
    real: { ttftMs: 18.2, tpotMs: 4.49, realE2E: true },
  },
  {
    name: 'en  ~20 prompt / 64 out',
    promptTokens: 20,
    outputTokens: 64,
    real: { ttftMs: 18.1, tpotMs: 4.51, realE2E: true },
  },
  {
    name: 'ctx 1020 prompt / 32 out',
    promptTokens: 1020,
    outputTokens: 32,
    real: { ttftMs: 150.8, tpotMs: 9.54, realE2E: false },
  },
]

function ms(value: number, width = 8): string {
  return value.toFixed(1).padStart(width)
}

function e2e(cost: CostModel, promptTokens: number, outputTokens: number): number {
  const ttft = estimateStepLatency(cost, promptTokens, 0)
  const tpot = estimateStepLatency(cost, 0, 1)
  return ttft + Math.max(outputTokens - 1, 0) * tpot
}

/**
 * The measured profile above is linear in prompt tokens. The 8192-token point
 * showed a quadratic term (attention), so print what a linear model misses.
 */
function quadraticPrefillMs(tokens: number): number {
  return 6.4 + 0.1256 * tokens + 1.39e-5 * tokens * tokens
}

function main(): void {
  console.log('Cost-model comparison. Every row is SIMULATED except the one labelled')
  console.log('"real (client)", which comes from the measured report:')
  console.log('')
  console.log(SIMULATED_LATENCY_NOTE)
  console.log('')

  for (const request of REQUESTS) {
    console.log(`== ${request.name}`)
    console.log(
      `   ${'profile'.padEnd(16)} ${'TTFT ms'.padStart(8)} ${'TPOT ms'.padStart(8)} ${'E2E ms'.padStart(8)}`,
    )
    for (const profile of PROFILES) {
      const ttft = estimateStepLatency(profile.cost, request.promptTokens, 0)
      const tpot = estimateStepLatency(profile.cost, 0, 1)
      console.log(
        `   ${profile.name.padEnd(16)} ${ms(ttft)} ${ms(tpot)} ${ms(e2e(profile.cost, request.promptTokens, request.outputTokens))}`,
      )
    }
    if (request.real) {
      const realE2E = request.real.realE2E
        ? ms(request.real.ttftMs + Math.max(request.outputTokens - 1, 0) * request.real.tpotMs)
        : '       -'
      console.log(
        `   ${'real (client)'.padEnd(16)} ${ms(request.real.ttftMs)} ${ms(request.real.tpotMs)} ${realE2E}`,
      )
    }
    console.log('')
  }

  console.log('== 线性 profile 的盲区：长 prompt 的注意力二次项')
  for (const tokens of [1020, 2048, 8192]) {
    const linear = 6.4 + 0.1256 * tokens
    const measured = quadraticPrefillMs(tokens)
    console.log(
      `   T=${String(tokens).padStart(5)}  linear ${ms(linear)} ms   含二次项 ${ms(measured)} ms   低估 ${((1 - linear / measured) * 100).toFixed(0)}%`,
    )
  }
  console.log('')
  console.log('注 A：长上下文 TPOT 实跑只生成 2 个 token，参考价值低，E2E 不参与比较。')
  console.log('注 B：measured-0.5b 只描述单流短上下文；它无法预测批处理天花板（b≈16）。')
  console.log('注 C：短 prompt 的实测 TTFT 比模型高约 9 ms，1020-token 高约 16 ms；')
  console.log('      这部分是 tokenize / chat template / HTTP 的固定成本，成本模型里没有。')
}

main()
