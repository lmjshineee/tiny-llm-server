import type { BenchmarkScenarioInfo } from '../../core/index'
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
  const update = (patch: Partial<LabControls>): void => {
    onChange({ ...controls, ...patch })
  }

  const scenario = scenarios.find((entry) => entry.name === controls.scenario)

  return (
    <section className="panel control-panel" aria-labelledby="controls-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Experiment</p>
          <h2 id="controls-title">Configure the simulation</h2>
        </div>
        <button className="run-button" type="button" onClick={onRun}>
          Run simulation
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
          <span>Scenario</span>
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
          <small>{scenario?.description}</small>
        </label>

        <label className="field">
          <span>Seed</span>
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
          <small>Same seed → same workload and trace.</small>
        </label>

        <label className="field">
          <span>Max batch size</span>
          <select
            value={controls.batchSize}
            onChange={(event) => update({ batchSize: Number(event.target.value) })}
          >
            {BATCH_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} sequences
              </option>
            ))}
          </select>
          <small>FCFS is sequential and ignores this setting.</small>
        </label>

        <label className="field">
          <span>KV capacity</span>
          <select
            value={controls.kvBlocks}
            onChange={(event) => update({ kvBlocks: Number(event.target.value) })}
          >
            {KV_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} blocks
              </option>
            ))}
          </select>
          <small>Worst-case reservations bound concurrency.</small>
        </label>
      </form>

      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
