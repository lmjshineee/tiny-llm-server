import type { LabRun } from '../lib/lab'
import { formatMs, formatPercent, formatRate, formatTokenRate } from '../lib/format'

interface ComparisonPanelProps {
  readonly lab: LabRun
}

interface Metric {
  readonly label: string
  readonly hint: string
  readonly fcfs: string
  readonly continuous: string
}

export function ComparisonPanel({ lab }: ComparisonPanelProps) {
  const fcfs = lab.results.fcfs.summary
  const continuous = lab.results['continuous-batching'].summary
  const totalBlocks = lab.engine.kv.totalBlocks

  const metrics: Metric[] = [
    {
      label: 'Throughput',
      hint: 'completed requests / makespan',
      fcfs: `${formatRate(fcfs.throughputRequestsPerSecond)} req/s`,
      continuous: `${formatRate(continuous.throughputRequestsPerSecond)} req/s`,
    },
    {
      label: 'Output throughput',
      hint: 'generated tokens / makespan',
      fcfs: `${formatTokenRate(fcfs.throughputOutputTokensPerSecond)} tok/s`,
      continuous: `${formatTokenRate(continuous.throughputOutputTokensPerSecond)} tok/s`,
    },
    {
      label: 'TTFT p50',
      hint: 'arrival → first token',
      fcfs: formatMs(fcfs.ttftMs.p50),
      continuous: formatMs(continuous.ttftMs.p50),
    },
    {
      label: 'TTFT p95',
      hint: 'tail queue + prefill',
      fcfs: formatMs(fcfs.ttftMs.p95),
      continuous: formatMs(continuous.ttftMs.p95),
    },
    {
      label: 'TPOT p50',
      hint: 'mean inter-token latency',
      fcfs: formatMs(fcfs.tpotMs.p50),
      continuous: formatMs(continuous.tpotMs.p50),
    },
    {
      label: 'TPOT p95',
      hint: 'tail inter-token latency',
      fcfs: formatMs(fcfs.tpotMs.p95),
      continuous: formatMs(continuous.tpotMs.p95),
    },
    {
      label: 'E2E p95',
      hint: 'arrival → final token',
      fcfs: formatMs(fcfs.e2eMs.p95),
      continuous: formatMs(continuous.e2eMs.p95),
    },
    {
      label: 'E2E p99',
      hint: 'long-tail completion',
      fcfs: formatMs(fcfs.e2eMs.p99),
      continuous: formatMs(continuous.e2eMs.p99),
    },
    {
      label: 'Prefix hit rate',
      hint: 'prompt tokens reused',
      fcfs: formatPercent(fcfs.prefixCache.tokenHitRate),
      continuous: formatPercent(continuous.prefixCache.tokenHitRate),
    },
    {
      label: 'Peak KV',
      hint: `${totalBlocks} blocks total`,
      fcfs: `${fcfs.kvPeakPhysicalBlocks}/${totalBlocks}`,
      continuous: `${continuous.kvPeakPhysicalBlocks}/${totalBlocks}`,
    },
  ]

  const throughputs = [
    fcfs.throughputRequestsPerSecond,
    continuous.throughputRequestsPerSecond,
  ]
  const throughputMax = Math.max(...throughputs, 1)
  const ttfts = [fcfs.ttftMs.p95 ?? 0, continuous.ttftMs.p95 ?? 0]
  const ttftMax = Math.max(...ttfts, 1)

  return (
    <section className="panel comparison-panel" aria-labelledby="comparison-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Same workload, same cost model</p>
          <h2 id="comparison-title">Performance comparison</h2>
        </div>
        <span className="badge badge-muted">simulated</span>
      </div>

      <div className="run-cards">
        <article className="run-card run-card-fcfs">
          <p className="run-card-label">FCFS sequential</p>
          <strong>{formatRate(fcfs.throughputRequestsPerSecond)} req/s</strong>
          <span>
            {fcfs.completedRequests}/{fcfs.totalRequests} complete · {fcfs.totalSteps} steps
          </span>
        </article>
        <article className="run-card run-card-cb">
          <p className="run-card-label">Continuous batching</p>
          <strong>{formatRate(continuous.throughputRequestsPerSecond)} req/s</strong>
          <span>
            {continuous.completedRequests}/{continuous.totalRequests} complete ·{' '}
            {continuous.totalSteps} steps
          </span>
        </article>
      </div>

      <div className="bar-charts" aria-label="Headline metric comparison">
        <BarPair
          label="Throughput (req/s)"
          fcfsValue={throughputs[0] ?? 0}
          continuousValue={throughputs[1] ?? 0}
          max={throughputMax}
          fcfsLabel={formatRate(throughputs[0] ?? 0)}
          continuousLabel={formatRate(throughputs[1] ?? 0)}
          higherIsBetter
        />
        <BarPair
          label="TTFT p95 (ms, shorter is better)"
          fcfsValue={ttfts[0] ?? 0}
          continuousValue={ttfts[1] ?? 0}
          max={ttftMax}
          fcfsLabel={formatMs(fcfs.ttftMs.p95)}
          continuousLabel={formatMs(continuous.ttftMs.p95)}
        />
      </div>

      <div className="table-scroll">
        <table className="compare-table">
          <caption className="sr-only">
            Simulated performance metrics for FCFS and continuous batching
          </caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">FCFS</th>
              <th scope="col">Continuous batching</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.label}>
                <th scope="row">
                  {metric.label}
                  <small>{metric.hint}</small>
                </th>
                <td>{metric.fcfs}</td>
                <td>{metric.continuous}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="caption">
        Lower latency is better; higher throughput is better. These are outputs of a synthetic
        cost model, not hardware measurements.
      </p>
    </section>
  )
}

interface BarPairProps {
  readonly label: string
  readonly fcfsValue: number
  readonly continuousValue: number
  readonly max: number
  readonly fcfsLabel: string
  readonly continuousLabel: string
  readonly higherIsBetter?: boolean
}

function BarPair({
  label,
  fcfsValue,
  continuousValue,
  max,
  fcfsLabel,
  continuousLabel,
  higherIsBetter = false,
}: BarPairProps) {
  return (
    <div className="bar-pair">
      <div className="bar-label">
        <span>{label}</span>
        <span className="bar-direction">{higherIsBetter ? 'higher is better' : ''}</span>
      </div>
      <div className="bar-row">
        <span className="bar-name">FCFS</span>
        <div className="bar-track" aria-hidden="true">
          <div
            className="bar-fill bar-fill-fcfs"
            style={{ width: `${Math.max(2, (fcfsValue / max) * 100)}%` }}
          />
        </div>
        <span className="bar-value">{fcfsLabel}</span>
      </div>
      <div className="bar-row">
        <span className="bar-name">CB</span>
        <div className="bar-track" aria-hidden="true">
          <div
            className="bar-fill bar-fill-cb"
            style={{ width: `${Math.max(2, (continuousValue / max) * 100)}%` }}
          />
        </div>
        <span className="bar-value">{continuousLabel}</span>
      </div>
    </div>
  )
}
