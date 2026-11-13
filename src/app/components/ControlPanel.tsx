import type { BenchmarkScenarioInfo } from '../../core/index'
import { scenarioDescriptionKey, useI18n } from '../lib/i18n'
import type { LabControls } from '../lib/lab'

interface ControlPanelProps {
  readonly controls: LabControls
  readonly scenarios: readonly BenchmarkScenarioInfo[]
  readonly onChange: (controls: LabControls) => void
  readonly onRun: () => void
  readonly error: string | null
}

const BATCH_OPTIONS = [4, 8, 16] as const
const KV_OPTIONS = [512, 1024, 2048] as const

export function ControlPanel({ controls, scenarios, onChange, onRun, error }: ControlPanelProps) {
  const { t } = useI18n()
  const update = (patch: Partial<LabControls>): void => {
    onChange({ ...controls, ...patch })
  }

  return (
    <section className="panel control-panel" aria-labelledby="controls-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">{t('controls.kicker')}</p>
          <h2 id="controls-title">{t('controls.title')}</h2>
        </div>
        <button className="run-button" type="button" onClick={onRun}>
          {t('controls.run')}
        </button>
      </div>

      <form
        className="control-grid"
        onSubmit={(event) => {
          event.preventDefault()
          onRun()
        }}
      >
        <label className="field">
          <span>{t('controls.scenario')}</span>
          <select
            value={controls.scenario}
            onChange={(event) => update({ scenario: event.target.value })}
          >
            {scenarios.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
          <small>{t(scenarioDescriptionKey(controls.scenario))}</small>
        </label>

        <label className="field">
          <span>{t('controls.seed')}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={controls.seed}
            onChange={(event) => {
              const value = Number(event.target.value)
              update({ seed: Number.isFinite(value) ? value : 0 })
            }}
          />
          <small>{t('controls.seedHint')}</small>
        </label>

        <label className="field">
          <span>{t('controls.batch')}</span>
          <select
            value={controls.batchSize}
            onChange={(event) => update({ batchSize: Number(event.target.value) })}
          >
            {BATCH_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {t('controls.batchOption', { count: value })}
              </option>
            ))}
          </select>
          <small>{t('controls.batchHint')}</small>
        </label>

        <label className="field">
          <span>{t('controls.kv')}</span>
          <select
            value={controls.kvBlocks}
            onChange={(event) => update({ kvBlocks: Number(event.target.value) })}
          >
            {KV_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {t('controls.kvOption', { count: value })}
              </option>
            ))}
          </select>
          <small>{t('controls.kvHint')}</small>
        </label>
      </form>

      {error !== null ? (
        <p className="form-error" role="alert">
          {t('controls.error', { message: error })}
        </p>
      ) : null}
    </section>
  )
}
