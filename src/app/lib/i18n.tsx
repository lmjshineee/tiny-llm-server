import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Language = 'en' | 'zh'

const STORAGE_KEY = 'llm-serving-lab.language'

const EN = {
  'app.documentTitle': 'LLM Serving Lab · Simulated Scheduler Visualizer',
  'app.eyebrow': 'LLM Serving Lab · simulated scheduler visualizer',
  'app.title': 'Inference scheduling, visualized.',
  'app.lede':
    'Step through an event-driven serving simulation. Compare sequential FCFS with continuous batching, inspect queueing and request phases, and watch a paged KV cache fill up and share prefix blocks.',
  'app.badge.simulated': 'SIMULATED',
  'app.badge.noModel': 'no model',
  'app.badge.noHardware': 'no GPU / NPU',
  'app.badge.synthetic': 'synthetic latency model',
  'app.currentRun': 'Current run',
  'app.seed': 'seed {seed}',
  'app.requests': '{count} requests',
  'app.batchKv': 'batch {batch} · KV {kv} blocks',
  'app.language': 'Language',
  'app.language.zh': '中文',
  'app.language.en': 'EN',
  'app.disclaimer.strong': 'Simulation-only.',
  'app.disclaimer.body':
    'Every latency, throughput, and cache number below is produced by a synthetic analytical cost model. No model is executed and no Apple Silicon, CUDA, or Ascend hardware performance is being measured. Prefix identities are synthetic keys, not hashes of real prompt tokens.',
  'app.strip.scenario': 'Scenario',
  'app.strip.model': 'Model',
  'app.strip.trace': 'Trace',
  'app.strip.modelValue': 'none — analytical cost model',
  'app.strip.traceValue': 'FCFS {fcfs} steps · CB {cb} steps',
  'app.footer.core':
    'Headless core: src/core · UI: src/app · All results are reproducible simulations, not benchmarks.',
  'app.footer.note':
    'Built for the {blockSize}-token block size; prefix hits are capped to leave at least one prompt token for the normal prefill path.',
  'controls.kicker': 'Experiment',
  'controls.title': 'Configure the simulation',
  'controls.run': 'Run simulation',
  'controls.scenario': 'Scenario',
  'controls.seed': 'Seed',
  'controls.batch': 'Max batch size',
  'controls.kv': 'KV capacity',
  'controls.seedHint': 'Same seed → same workload and trace.',
  'controls.batchHint': 'FCFS is sequential and ignores this setting.',
  'controls.kvHint': 'Worst-case reservations bound concurrency.',
  'controls.batchOption': '{count} sequences',
  'controls.kvOption': '{count} blocks',
  'controls.error': 'Simulation failed: {message}',
  'scenario.steady.description': 'Moderate Poisson load; no shared prefixes.',
  'scenario.bursty.description':
    'Overloaded arrivals; queueing and head-of-line blocking dominate.',
  'scenario.prefix-heavy.description': '90% of requests reuse one of two 256-token prefixes.',
  'scenario.short-chat.description': 'Short prompts and outputs at a high request rate.',
  'scenario.long-context.description': 'Long prompts with sparse arrivals; KV capacity matters.',
  'comparison.kicker': 'Same workload, same cost model',
  'comparison.title': 'Performance comparison',
  'comparison.simulated': 'simulated',
  'comparison.fcfs': 'FCFS sequential',
  'comparison.cb': 'Continuous batching',
  'comparison.complete': '{completed}/{total} complete · {steps} steps',
  'comparison.metric': 'Metric',
  'comparison.fcfsShort': 'FCFS',
  'comparison.cbShort': 'Continuous batching',
  'comparison.caption':
    'Lower latency is better; higher throughput is better. These are outputs of a synthetic cost model, not hardware measurements.',
  'comparison.higher': 'higher is better',
  'comparison.tableCaption': 'Simulated performance metrics for FCFS and continuous batching',
  'comparison.bar.throughput': 'Throughput (req/s)',
  'comparison.bar.ttft': 'TTFT p95 (ms, shorter is better)',
  'metric.throughput': 'Throughput',
  'metric.throughputHint': 'completed requests / makespan',
  'metric.outputThroughput': 'Output throughput',
  'metric.outputThroughputHint': 'generated tokens / makespan',
  'metric.ttftP50': 'TTFT p50',
  'metric.ttftP50Hint': 'arrival → first token',
  'metric.ttftP95': 'TTFT p95',
  'metric.ttftP95Hint': 'tail queue + prefill',
  'metric.tpotP50': 'TPOT p50',
  'metric.tpotP50Hint': 'mean inter-token latency',
  'metric.tpotP95': 'TPOT p95',
  'metric.tpotP95Hint': 'tail inter-token latency',
  'metric.e2eP95': 'E2E p95',
  'metric.e2eP95Hint': 'arrival → final token',
  'metric.e2eP99': 'E2E p99',
  'metric.e2eP99Hint': 'long-tail completion',
  'metric.prefixHit': 'Prefix hit rate',
  'metric.prefixHitHint': 'prompt tokens reused',
  'metric.peakKv': 'Peak KV',
  'metric.peakKvHint': '{blocks} blocks total',
  'timeline.kicker': 'Trace playback',
  'timeline.title': 'Step-by-step timeline',
  'timeline.noSteps': 'This run has no simulation steps.',
  'timeline.play': 'Play',
  'timeline.pause': 'Pause',
  'timeline.playAria': 'Play timeline',
  'timeline.pauseAria': 'Pause timeline',
  'timeline.stepAria': 'Timeline step',
  'timeline.step': 'Step {current} / {total}',
  'timeline.latency': 'latency {value}',
  'timeline.prefill': '{count} prefill tok',
  'timeline.decode': '{count} decode tok',
  'timeline.batch': 'batch {count}',
  'timeline.queueRunning': 'queue {waiting} · running {running}',
  'timeline.trace': '{label} trace',
  'timeline.schedulerAria': 'Timeline scheduler',
  'scheduler.cb': 'Continuous batching',
  'scheduler.fcfs': 'FCFS (sequential)',
  'request.kicker': 'At the end of the selected step',
  'request.title': 'Queue & request states',
  'request.queue': 'queue {count}',
  'request.running': 'running {count}',
  'request.done': 'done {count}',
  'request.waitingTitle': 'Waiting queue',
  'request.runningTitle': 'Running',
  'request.emptyWaiting': 'No queued requests at this point.',
  'request.emptyRunning': 'No running requests at this point.',
  'request.scrollWaiting': 'Scroll for all {count} queued requests.',
  'request.scrollRunning': 'Scroll for all {count} running requests.',
  'request.finishedTitle': 'Finished at this point',
  'request.emptyFinished': 'No requests have finished yet.',
  'request.tableCaption': 'Per-request metrics for finished requests',
  'request.request': 'Request',
  'request.prefix': 'Prefix',
  'request.finishedHint':
    'Showing 12 of {count} finished requests. All requests contribute to the comparison metrics above.',
  'request.caption':
    'Request state is reconstructed from the step trace. KV blocks in this view are logical per-request usage; physical sharing is summarized in the KV panel.',
  'request.waitingState': 'waiting',
  'request.prefillState': 'prefill',
  'request.decodeState': 'decode',
  'request.prefixBadge': 'prefix {count} tok',
  'request.promptTokens': '{count} prompt tokens',
  'request.outputBudget': '{count} output budget',
  'request.prompt': 'prompt',
  'request.output': 'output',
  'request.logicalBlocks': '{count} logical blocks',
  'request.prefixBlocks': '{count} prefix blocks',
  'request.noSteps': 'No simulation steps to display.',
  'kv.kicker': 'Occupancy at the selected step',
  'kv.title': 'Paged KV cache',
  'kv.blocks': '{blocks} blocks × {tokens} tok',
  'kv.active': 'active',
  'kv.retained': 'retained',
  'kv.free': 'free',
  'kv.shared': 'shared',
  'kv.logical': 'logical',
  'kv.reserved': 'reserved',
  'kv.available': 'available',
  'kv.mapCaption':
    'Capacity map (aggregated; not physical block IDs). Each cell represents a range of blocks. The trace stores occupancy counts, not per-block ownership.',
  'kv.prefixTitle': 'Prefix cache',
  'kv.tokenHit': '{percent} token hit',
  'kv.prefixSummary':
    '{hitRequests}/{totalRequests} requests reused {hitTokens}/{totalPromptTokens} prompt tokens.',
  'kv.noHits': 'No prefix hits in this run. Try the prefix-heavy scenario.',
  'kv.caption':
    'Physical blocks are shared by reference; logical blocks count a shared block per request. Worst-case reservations still bound admission.',
  'kv.noSteps': 'No simulation steps to display.',
  'guide.hide': 'Hide guide',
  'guide.show': 'Show guide',
} as const

export type MessageKey = keyof typeof EN

const ZH: Record<MessageKey, string> = {
  'app.documentTitle': 'LLM Serving Lab · 大模型推理调度可视化',
  'app.eyebrow': 'LLM Serving Lab · 推理调度可视化',
  'app.title': '把推理调度，看清楚。',
  'app.lede':
    '逐步回放一个事件驱动的 serving 模拟：对比 FCFS 与连续批处理，查看排队与请求阶段，观察分页 KV Cache 如何被占用、前缀块如何共享。整个过程不加载模型。',
  'app.badge.simulated': '模拟',
  'app.badge.noModel': '不加载模型',
  'app.badge.noHardware': '不使用 GPU / NPU',
  'app.badge.synthetic': '合成延迟模型',
  'app.currentRun': '当前运行',
  'app.seed': 'seed {seed}',
  'app.requests': '{count} 个请求',
  'app.batchKv': 'batch {batch} · KV {kv} 块',
  'app.language': '语言',
  'app.language.zh': '中文',
  'app.language.en': 'EN',
  'app.disclaimer.strong': '仅模拟。',
  'app.disclaimer.body':
    '下方所有延迟、吞吐与缓存数字都来自合成解析成本模型。这里没有执行任何模型，也没有测量 Apple Silicon、CUDA 或昇腾的硬件性能。前缀标识是合成 key，不是真实 prompt token 的哈希。',
  'app.strip.scenario': '场景',
  'app.strip.model': '模型',
  'app.strip.trace': '轨迹',
  'app.strip.modelValue': '无模型 — 解析成本模型',
  'app.strip.traceValue': 'FCFS {fcfs} 步 · CB {cb} 步',
  'app.footer.core':
    'Headless core：src/core · UI：src/app · 所有结果都是可复现的模拟，不是 benchmark。',
  'app.footer.note':
    '使用 {blockSize}-token block；prefix 命中会保留至少一个 prompt token 走正常 prefill。',
  'controls.kicker': '实验',
  'controls.title': '配置模拟',
  'controls.run': '运行模拟',
  'controls.scenario': '场景',
  'controls.seed': '随机种子',
  'controls.batch': '最大批大小',
  'controls.kv': 'KV 容量',
  'controls.seedHint': '相同 seed → 相同负载与轨迹。',
  'controls.batchHint': 'FCFS 串行执行，会忽略此设置。',
  'controls.kvHint': '按最坏情况预留 KV，限制并发。',
  'controls.batchOption': '{count} 条序列',
  'controls.kvOption': '{count} 块',
  'controls.error': '模拟失败：{message}',
  'scenario.steady.description': '中等泊松负载；不共享前缀。',
  'scenario.bursty.description': '突发过载；排队与队头阻塞主导。',
  'scenario.prefix-heavy.description': '90% 请求复用两个 256-token 前缀之一。',
  'scenario.short-chat.description': '短 prompt、短输出、高请求率。',
  'scenario.long-context.description': '长 prompt、稀疏到达；KV 容量成为关键。',
  'comparison.kicker': '同一负载，同一成本模型',
  'comparison.title': '性能对比',
  'comparison.simulated': '模拟',
  'comparison.fcfs': 'FCFS 串行',
  'comparison.cb': '连续批处理',
  'comparison.complete': '完成 {completed}/{total} · {steps} 步',
  'comparison.metric': '指标',
  'comparison.fcfsShort': 'FCFS',
  'comparison.cbShort': '连续批处理',
  'comparison.caption': '延迟越低越好，吞吐越高越好。这些是合成成本模型的输出，不是硬件实测。',
  'comparison.higher': '越高越好',
  'comparison.tableCaption': 'FCFS 与连续批处理的模拟性能指标',
  'comparison.bar.throughput': '吞吐（req/s）',
  'comparison.bar.ttft': 'TTFT p95（ms，越短越好）',
  'metric.throughput': '吞吐量',
  'metric.throughputHint': '完成请求数 / makespan',
  'metric.outputThroughput': '输出吞吐',
  'metric.outputThroughputHint': '生成 token / makespan',
  'metric.ttftP50': 'TTFT p50',
  'metric.ttftP50Hint': '到达 → 首 token',
  'metric.ttftP95': 'TTFT p95',
  'metric.ttftP95Hint': '尾部排队 + prefill',
  'metric.tpotP50': 'TPOT p50',
  'metric.tpotP50Hint': '平均 token 间隔',
  'metric.tpotP95': 'TPOT p95',
  'metric.tpotP95Hint': '尾部 token 间隔',
  'metric.e2eP95': 'E2E p95',
  'metric.e2eP95Hint': '到达 → 最后 token',
  'metric.e2eP99': 'E2E p99',
  'metric.e2eP99Hint': '长尾完成时间',
  'metric.prefixHit': '前缀命中率',
  'metric.prefixHitHint': '复用的 prompt token 比例',
  'metric.peakKv': 'KV 峰值',
  'metric.peakKvHint': '{blocks} 块总量',
  'timeline.kicker': '轨迹回放',
  'timeline.title': '逐步时间轴',
  'timeline.noSteps': '本次运行没有模拟步骤。',
  'timeline.play': '播放',
  'timeline.pause': '暂停',
  'timeline.playAria': '播放时间轴',
  'timeline.pauseAria': '暂停时间轴',
  'timeline.stepAria': '时间轴步骤',
  'timeline.step': '第 {current} / {total} 步',
  'timeline.latency': '延迟 {value}',
  'timeline.prefill': '{count} 预填充 tok',
  'timeline.decode': '{count} 解码 tok',
  'timeline.batch': 'batch {count}',
  'timeline.queueRunning': '队列 {waiting} · 运行 {running}',
  'timeline.trace': '{label} 轨迹',
  'timeline.schedulerAria': '时间轴调度器',
  'scheduler.cb': '连续批处理',
  'scheduler.fcfs': 'FCFS（串行）',
  'request.kicker': '所选步骤结束时',
  'request.title': '队列与请求状态',
  'request.queue': '队列 {count}',
  'request.running': '运行 {count}',
  'request.done': '完成 {count}',
  'request.waitingTitle': '等待队列',
  'request.runningTitle': '运行中',
  'request.emptyWaiting': '当前没有排队请求。',
  'request.emptyRunning': '当前没有运行中的请求。',
  'request.scrollWaiting': '滚动查看全部 {count} 个排队请求。',
  'request.scrollRunning': '滚动查看全部 {count} 个运行中的请求。',
  'request.finishedTitle': '此时已完成',
  'request.emptyFinished': '还没有请求完成。',
  'request.tableCaption': '已完成请求的逐请求指标',
  'request.request': '请求',
  'request.prefix': '前缀',
  'request.finishedHint': '显示 {count} 个已完成请求中的 12 个；所有请求都计入上方对比指标。',
  'request.caption':
    '请求状态由 step 轨迹重建。这里的 KV block 是逐请求的逻辑用量；物理共享在 KV 面板汇总。',
  'request.waitingState': '等待',
  'request.prefillState': '预填充',
  'request.decodeState': '解码',
  'request.prefixBadge': '前缀 {count} tok',
  'request.promptTokens': '{count} prompt token',
  'request.outputBudget': '{count} 输出预算',
  'request.prompt': '输入',
  'request.output': '输出',
  'request.logicalBlocks': '{count} 逻辑块',
  'request.prefixBlocks': '{count} 前缀块',
  'request.noSteps': '没有可显示的模拟步骤。',
  'kv.kicker': '所选步骤的占用',
  'kv.title': '分页 KV Cache',
  'kv.blocks': '{blocks} 块 × {tokens} tok',
  'kv.active': '活跃',
  'kv.retained': '保留',
  'kv.free': '空闲',
  'kv.shared': '共享',
  'kv.logical': '逻辑',
  'kv.reserved': '预留',
  'kv.available': '可用',
  'kv.mapCaption':
    '容量示意（聚合，不是物理 block ID）。每个格子代表一段 block；轨迹只保存占用计数，不保存逐 block 归属。',
  'kv.prefixTitle': '前缀缓存',
  'kv.tokenHit': '{percent} token 命中率',
  'kv.prefixSummary':
    '{hitRequests}/{totalRequests} 个请求复用了 {hitTokens}/{totalPromptTokens} 个 prompt token。',
  'kv.noHits': '本次运行没有 prefix 命中。试试 prefix-heavy 场景。',
  'kv.caption': '物理块按引用共享；逻辑块会在每个请求中重复计数。最坏情况预留仍然限制准入。',
  'kv.noSteps': '没有可显示的模拟步骤。',
  'guide.hide': '收起导览',
  'guide.show': '展开导览',
}

const MESSAGES: Record<Language, Record<MessageKey, string>> = { en: EN, zh: ZH }

type MessageParams = Record<string, string | number>

function formatMessage(template: string, params?: MessageParams): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key]
    return value === undefined ? match : String(value)
  })
}

function readLanguage(): Language {
  if (typeof window === 'undefined') return 'en'

  const param = new URLSearchParams(window.location.search).get('lang')
  if (param === 'zh' || param === 'en') return param

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    // Storage can be unavailable in private browsing; fall through to navigator.
  }

  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en'
}

interface I18nValue {
  readonly language: Language
  readonly setLanguage: (language: Language) => void
  readonly t: (key: MessageKey, params?: MessageParams) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(readLanguage)

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    document.title = MESSAGES[language]['app.documentTitle']

    try {
      window.localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // Best effort; language still works for this page.
    }

    const url = new URL(window.location.href)
    if (url.searchParams.get('lang') !== language) {
      url.searchParams.set('lang', language)
      window.history.replaceState({}, '', url)
    }
  }, [language])

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => formatMessage(MESSAGES[language][key], params),
    }),
    [language],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (value === null) throw new Error('useI18n must be used inside I18nProvider')
  return value
}

const SCENARIO_KEYS: Record<string, MessageKey> = {
  steady: 'scenario.steady.description',
  bursty: 'scenario.bursty.description',
  'prefix-heavy': 'scenario.prefix-heavy.description',
  'short-chat': 'scenario.short-chat.description',
  'long-context': 'scenario.long-context.description',
}

export function scenarioDescriptionKey(name: string): MessageKey {
  return SCENARIO_KEYS[name] ?? 'scenario.steady.description'
}
