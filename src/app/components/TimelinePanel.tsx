import type { SimulationResult } from '../../core/index'
import type { SchedulerTab } from '../lib/lab'
import type { StepView } from '../lib/timeline'
import { SCHEDULER_TABS, schedulerLabel } from '../lib/lab'
import { formatCount, formatMs } from '../lib/format'

interface TimelinePanelProps {
  readonly result: SimulationResult
  readonly tab: SchedulerTab
  readonly stepIndex: number
  readonly playing: boolean
  readonly view: StepView | null
  readonly onTabChange: (tab: SchedulerTab) => void
  readonly onStepChange: (stepIndex: number) => void
  readonly onTogglePlay: () => void
}

export function TimelinePanel({
  result,
  tab,
  stepIndex,
  playing,
  view,
  onTabChange,
  onStepChange,
  onTogglePlay,
}: TimelinePanelProps) {
  const lastIndex = Math.max(0, result.steps.length - 1)
  const disabled = result.steps.length <= 1

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Trace playback</p>
          <h2 id="timeline-title">Step-by-step timeline</h2>
        </div>
        <fieldset className="tab-group">
          <legend className="sr-only">Timeline scheduler</legend>
          {SCHEDULER_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === tab ? 'tab tab-active' : 'tab'}
              aria-pressed={entry.id === tab}
              onClick={() => onTabChange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </fieldset>
      </div>

      {view === null ? (
        <p className="empty-state">This run has no simulation steps.</p>
      ) : (
        <>
          <div className="timeline-controls">
            <button
              type="button"
              className="play-button"
              onClick={onTogglePlay}
              disabled={disabled}
              aria-label={playing ? 'Pause timeline' : 'Play timeline'}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              className="step-range"
              type="range"
              min={0}
              max={lastIndex}
              step={1}
              value={Math.min(stepIndex, lastIndex)}
              aria-label="Timeline step"
              disabled={disabled}
              onChange={(event) => onStepChange(Number(event.target.value))}
            />
            <div className="step-readout">
              <strong>
                Step {Math.min(stepIndex, lastIndex) + 1} / {result.steps.length}
              </strong>
              <span>
                {formatMs(view.step.startMs)} → {formatMs(view.step.endMs)}
              </span>
            </div>
          </div>

          <div className="timeline-chips">
            <span className="chip">latency {formatMs(view.step.latencyMs)}</span>
            <span className="chip">{formatCount(view.step.prefillTokens)} prefill tok</span>
            <span className="chip">{formatCount(view.step.decodeTokens)} decode tok</span>
            <span className="chip">batch {view.step.batchSize}</span>
            <span className="chip">
              queue {view.waiting.length} · running {view.running.length}
            </span>
            <span className="chip chip-accent">{schedulerLabel(tab)} trace</span>
          </div>

          <div className="mini-timeline" aria-hidden="true">
            <div
              className="mini-timeline-progress"
              style={{
                width: `${result.steps.length > 0 ? ((Math.min(stepIndex, lastIndex) + 1) / result.steps.length) * 100 : 0}%`,
              }}
            />
          </div>
        </>
      )}
    </section>
  )
}
