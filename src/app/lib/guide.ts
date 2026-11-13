import type { Language } from './i18n'

export interface GuideStep {
  readonly title: string
  readonly body: string
}

export interface GuideMetric {
  readonly term: string
  readonly body: string
}

export interface GuideContent {
  readonly kicker: string
  readonly title: string
  readonly summary: string
  readonly steps: readonly GuideStep[]
  readonly metricsTitle: string
  readonly metrics: readonly GuideMetric[]
  readonly cta: string
}

export const GUIDES: Record<Language, GuideContent> = {
  en: {
    kicker: 'New here?',
    title: 'Understand the lab in 3 minutes',
    summary:
      'This is a simulated serving lab. There is no model and no GPU: every latency number comes from a synthetic cost model. Use it to build intuition about scheduling, not to compare hardware.',
    steps: [
      {
        title: '1. Pick a scenario',
        body: 'steady is the baseline, bursty creates a queue, and prefix-heavy reuses shared prompt blocks.',
      },
      {
        title: '2. Press Run simulation',
        body: 'The same requests run through sequential FCFS and continuous batching with the same cost model.',
      },
      {
        title: '3. Scrub the timeline',
        body: 'Watch waiting/running requests, prefill/decode phases, and KV occupancy change step by step.',
      },
    ],
    metricsTitle: 'A few words to know',
    metrics: [
      {
        term: 'TTFT',
        body: 'Arrival → first token. It includes queueing and prefill; lower is better for interactivity.',
      },
      {
        term: 'TPOT',
        body: 'Average gap between generated tokens. It describes streaming smoothness after the first token.',
      },
      {
        term: 'Throughput',
        body: 'Completed requests per second. Batching can raise it while making individual requests slower.',
      },
      {
        term: 'KV cache',
        body: 'Cached K/V history. More blocks allow more concurrent requests; capacity is a first-class constraint.',
      },
      {
        term: 'Prefix cache',
        body: 'Shared prompt blocks reused across requests. It saves prefill work and physical KV when hits occur.',
      },
    ],
    cta: 'Open an overloaded queue →',
  },
  zh: {
    kicker: '新手导览',
    title: '第一次来？先用 3 分钟看懂',
    summary:
      '这是一个纯模拟的 serving 实验室：没有模型，也没有 GPU，所有延迟都来自合成成本模型。它用来建立调度直觉，不是用来比较硬件性能。',
    steps: [
      {
        title: '1. 选一个场景',
        body: 'steady 是基线；bursty 会制造排队；prefix-heavy 会复用共享前缀块。',
      },
      {
        title: '2. 点“运行模拟”',
        body: '同一批请求会分别跑串行 FCFS 和连续批处理，使用完全相同的成本模型。',
      },
      {
        title: '3. 拖动时间轴',
        body: '逐步观察等待/运行请求、prefill/decode 阶段和 KV 占用的变化。',
      },
    ],
    metricsTitle: '先认识几个词',
    metrics: [
      {
        term: 'TTFT',
        body: '从请求到达，到第一个 token 出现。它包含排队和 prefill；越低，交互越跟手。',
      },
      {
        term: 'TPOT',
        body: '生成阶段每个 token 的平均间隔。首 token 之后，它决定输出是否流畅。',
      },
      {
        term: '吞吐量',
        body: '每秒完成的请求数。batching 可以提高吞吐，但可能让单个请求变慢。',
      },
      {
        term: 'KV Cache',
        body: '缓存历史的 K/V。块越多，可并发的请求越多；容量是这里的一等约束。',
      },
      {
        term: 'Prefix Cache',
        body: '多个请求复用相同前缀块。命中时可以省掉重复 prefill，并减少物理 KV。',
      },
    ],
    cta: '直接打开一个过载场景 →',
  },
}
