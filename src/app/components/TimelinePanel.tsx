import type { SimulationResult } from '../../core/index'
import { useI18n } from '../lib/i18n'
import type { SchedulerTab } from '../lib/lab'
import { SCHEDULER_TABS } from '../lib/lab'
import type { StepView } from '../lib/timeline'
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
  const { t } = useI18n()
  const lastIndex = Math.max(0, result.steps.length - 1)
  const disabled = result.steps.length <= 1
  const selectedTabLabel = tab === 'fcfs' ? t('scheduler.fcfs') : t('scheduler.cb')

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">{t('timeline.kicker')}</p>
          <h2 id="timeline-title">{t('timeline.title')}</h2>
        </div>
        <fieldset className="tab-group">
          <legend className="sr-only">{t('timeline.schedulerAria')}</legend>
          {SCHEDULER_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === tab ? 'tab tab-active' : 'tab'}
              aria-pressed={entry.id === tab}
              onClick={() => onTabChange(entry.id)}
            >
              {entry.id === 'fcfs' ? t('scheduler.fcfs') : t('scheduler.cb')}
            </button>
          ))}
        </fieldset>
      </div>

      {view === null ? (
        <p className="empty-state">{t('timeline.noSteps')}</p>
      ) : (
        <>
          <div className="timeline-controls">
            <button
              type="button"
              className="play-button"
              onClick={onTogglePlay}
              disabled={disabled}
              aria-label={playing ? t('timeline.pauseAria') : t('timeline.playAria')}
            >
              {playing ? t('timeline.pause') : t('timeline.play')}
            </button>
            <input
              className="step-range"
              type="range"
              min={0}
              max={lastIndex}
              step={1}
              value={Math.min(stepIndex, lastIndex)}
              aria-label={t('timeline.stepAria')}
              disabled={disabled}
              onChange={(event) => onStepChange(Number(event.target.value))}
            />
            <div className="step-readout">
              <strong>
                {t('timeline.step', {
                  current: Math.min(stepIndex, lastIndex) + 1,
                  total: result.steps.length,
                })}
              </strong>
              <span>
                {formatMs(view.step.startMs)} → {formatMs(view.step.endMs)}
              </span>
            </div>
          </div>

          <div className="timeline-chips">
            <span className="chip">
              {t('timeline.latency', { value: formatMs(view.step.latencyMs) })}
            </span>
            <span className="chip">
              {t('timeline.prefill', { count: formatCount(view.step.prefillTokens) })}
            </span>
            <span className="chip">
              {t('timeline.decode', { count: formatCount(view.step.decodeTokens) })}
            </span>
            <span className="chip">{t('timeline.batch', { count: view.step.batchSize })}</span>
            <span className="chip">
              {t('timeline.queueRunning', {
                waiting: view.waiting.length,
                running: view.running.length,
              })}
            </span>
            <span className="chip chip-accent">
              {t('timeline.trace', { label: selectedTabLabel })}
            </span>
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
