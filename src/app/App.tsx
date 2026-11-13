import { useEffect, useMemo, useState } from 'react'
import { listBenchmarkScenarios } from '../core/index'
import { ComparisonPanel } from './components/ComparisonPanel'
import { ControlPanel } from './components/ControlPanel'
import { KvPanel } from './components/KvPanel'
import { RequestBoard } from './components/RequestBoard'
import { TimelinePanel } from './components/TimelinePanel'
import { DEFAULT_LAB_CONTROLS, runLab } from './lib/lab'
import type { LabControls, LabRun, SchedulerTab } from './lib/lab'
import { buildRequestHistories, deriveStepView, suggestedStepIndex } from './lib/timeline'
import { formatCount } from './lib/format'

const SCENARIOS = listBenchmarkScenarios()
const BATCH_OPTIONS = [4, 8, 16] as const
const KV_OPTIONS = [512, 1024, 2048] as const

function readInitialControls(): LabControls {
  if (typeof window === 'undefined') return DEFAULT_LAB_CONTROLS

  const params = new URLSearchParams(window.location.search)
  const scenarioParam = params.get('scenario')
  const scenario = SCENARIOS.some((entry) => entry.name === scenarioParam)
    ? (scenarioParam as string)
    : DEFAULT_LAB_CONTROLS.scenario

  const seedRaw = params.get('seed')
  const batchRaw = params.get('batch')
  const kvRaw = params.get('kv')
  const seedParam = seedRaw === null ? Number.NaN : Number(seedRaw)
  const batchParam = batchRaw === null ? Number.NaN : Number(batchRaw)
  const kvParam = kvRaw === null ? Number.NaN : Number(kvRaw)

  return {
    scenario,
    seed: Number.isFinite(seedParam) ? seedParam : DEFAULT_LAB_CONTROLS.seed,
    batchSize: BATCH_OPTIONS.includes(batchParam as 4 | 8 | 16)
      ? batchParam
      : DEFAULT_LAB_CONTROLS.batchSize,
    kvBlocks: KV_OPTIONS.includes(kvParam as 512 | 1024 | 2048)
      ? kvParam
      : DEFAULT_LAB_CONTROLS.kvBlocks,
  }
}

function readInitialTab(): SchedulerTab {
  if (typeof window === 'undefined') return 'continuous-batching'
  const tab = new URLSearchParams(window.location.search).get('tab')
  return tab === 'fcfs' || tab === 'continuous-batching' ? tab : 'continuous-batching'
}

function readInitialStepFraction(): number {
  if (typeof window === 'undefined') return 0.35
  const raw = new URLSearchParams(window.location.search).get('step')
  const value = raw === null ? Number.NaN : Number(raw)
  if (!Number.isFinite(value)) return 0.35
  return Math.min(1, Math.max(0, value))
}

export function App() {
  const [controls, setControls] = useState<LabControls>(readInitialControls)
  const [lab, setLab] = useState<LabRun>(() => runLab(readInitialControls()))
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<SchedulerTab>(readInitialTab)
  const [stepFraction] = useState(readInitialStepFraction)
  const [stepIndex, setStepIndex] = useState(() =>
    suggestedStepIndex(lab.results[readInitialTab()], stepFraction),
  )
  const [playing, setPlaying] = useState(false)

  const result = lab.results[tab]
  const lastIndex = Math.max(0, result.steps.length - 1)

  const histories = useMemo(
    () => ({
      fcfs: buildRequestHistories(lab.results.fcfs),
      'continuous-batching': buildRequestHistories(lab.results['continuous-batching']),
    }),
    [lab],
  )

  const view = useMemo(
    () => deriveStepView(result, histories[tab], Math.min(stepIndex, lastIndex)),
    [result, histories, tab, stepIndex, lastIndex],
  )

  useEffect(() => {
    if (!playing || result.steps.length <= 1) return

    const stride = Math.max(1, Math.ceil(result.steps.length / 240))
    const timer = window.setInterval(() => {
      setStepIndex((current) => Math.min(lastIndex, current + stride))
    }, 90)

    return () => window.clearInterval(timer)
  }, [playing, result, lastIndex])

  useEffect(() => {
    if (result.steps.length <= 1) {
      setPlaying(false)
      return
    }
    if (stepIndex >= lastIndex) setPlaying(false)
  }, [stepIndex, lastIndex, result.steps.length])

  useEffect(() => {
    setStepIndex(suggestedStepIndex(lab.results[tab], stepFraction))
    setPlaying(false)
  }, [lab, tab, stepFraction])

  const handleRun = (): void => {
    try {
      const next = runLab(controls)
      setLab(next)
      setStepIndex(suggestedStepIndex(next.results[tab], stepFraction))
      setPlaying(false)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPlaying(false)
    }
  }

  const handleTabChange = (next: SchedulerTab): void => {
    setTab(next)
    setStepIndex(suggestedStepIndex(lab.results[next], stepFraction))
    setPlaying(false)
  }

  const handleStepChange = (next: number): void => {
    setStepIndex(next)
    setPlaying(false)
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">LLM Serving Lab · Phase 4 visualizer</p>
          <h1>Inference scheduling, visualized.</h1>
          <p className="lede">
            Step through an event-driven serving simulation. Compare sequential FCFS with
            continuous batching, inspect queueing and request phases, and watch a paged KV
            cache fill up and share prefix blocks.
          </p>
          <div className="badge-row">
            <span className="badge badge-warn">SIMULATED</span>
            <span className="badge badge-muted">no model</span>
            <span className="badge badge-muted">no GPU / NPU</span>
            <span className="badge badge-muted">synthetic latency model</span>
          </div>
        </div>
        <div className="hero-aside" aria-label="Current run summary">
          <p className="aside-label">Current run</p>
          <strong>{lab.controls.scenario}</strong>
          <span>seed {lab.controls.seed}</span>
          <span>{formatCount(lab.input.requests.length)} requests</span>
          <span>
            batch {lab.engine.maxBatchSize} · KV {lab.engine.kv.totalBlocks} blocks
          </span>
        </div>
      </header>

      <div className="disclaimer" role="note">
        <strong>Simulation-only.</strong> Every latency, throughput, and cache number below is
        produced by a synthetic analytical cost model. No model is executed and no Apple
        Silicon, CUDA, or Ascend hardware performance is being measured. Prefix identities are
        synthetic keys, not hashes of real prompt tokens.
      </div>

      <ControlPanel
        controls={controls}
        scenarios={SCENARIOS}
        onChange={setControls}
        onRun={handleRun}
        error={error}
      />

      <div className="scenario-strip">
        <div>
          <span className="strip-label">Scenario</span>
          <strong>{lab.input.description}</strong>
        </div>
        <div>
          <span className="strip-label">Model</span>
          <strong>none — analytical cost model</strong>
        </div>
        <div>
          <span className="strip-label">Trace</span>
          <strong>
            FCFS {formatCount(lab.results.fcfs.steps.length)} steps · CB{' '}
            {formatCount(lab.results['continuous-batching'].steps.length)} steps
          </strong>
        </div>
      </div>

      <ComparisonPanel lab={lab} />

      <TimelinePanel
        result={result}
        tab={tab}
        stepIndex={Math.min(stepIndex, lastIndex)}
        playing={playing}
        view={view}
        onTabChange={handleTabChange}
        onStepChange={handleStepChange}
        onTogglePlay={() => setPlaying((value) => !value)}
      />

      <div className="detail-grid">
        <RequestBoard view={view} />
        <KvPanel view={view} result={result} />
      </div>

      <footer className="footer">
        <p>
          Headless core: <code>src/core</code> · UI: <code>src/app</code> · All results are
          reproducible simulations, not benchmarks.
        </p>
        <p>
          Built for the {`${lab.engine.kv.blockSize}`}-token block size; prefix hits are capped
          to leave at least one prompt token for the normal prefill path.
        </p>
      </footer>
    </main>
  )
}
