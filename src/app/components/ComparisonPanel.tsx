import { useI18n } from '../lib/i18n'
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
  const { t } = useI18n()
  const fcfs = lab.results.fcfs.summary
  const continuous = lab.results['continuous-batching'].summary
  const totalBlocks = lab.engine.kv.totalBlocks

  const metrics: Metric[] = [
    {
      label: t('metric.throughput'),
      hint: t('metric.throughputHint'),
      fcfs: `${formatRate(fcfs.throughputRequestsPerSecond)} req/s`,
      continuous: `${formatRate(continuous.throughputRequestsPerSecond)} req/s`,
    },
    {
      label: t('metric.outputThroughput'),
      hint: t('metric.outputThroughputHint'),
      fcfs: `${formatTokenRate(fcfs.throughputOutputTokensPerSecond)} tok/s`,
      continuous: `${formatTokenRate(continuous.throughputOutputTokensPerSecond)} tok/s`,
    },
    {
      label: t('metric.ttftP50'),
      hint: t('metric.ttftP50Hint'),
      fcfs: formatMs(fcfs.ttftMs.p50),
      continuous: formatMs(continuous.ttftMs.p50),
    },
    {
      label: t('metric.ttftP95'),
      hint: t('metric.ttftP95Hint'),
      fcfs: formatMs(fcfs.ttftMs.p95),
      continuous: formatMs(continuous.ttftMs.p95),
    },
    {
      label: t('metric.tpotP50'),
      hint: t('metric.tpotP50Hint'),
      fcfs: formatMs(fcfs.tpotMs.p50),
      continuous: formatMs(continuous.tpotMs.p50),
    },
    {
      label: t('metric.tpotP95'),
      hint: t('metric.tpotP95Hint'),
      fcfs: formatMs(fcfs.tpotMs.p95),
      continuous: formatMs(continuous.tpotMs.p95),
    },
    {
      label: t('metric.e2eP95'),
      hint: t('metric.e2eP95Hint'),
      fcfs: formatMs(fcfs.e2eMs.p95),
      continuous: formatMs(continuous.e2eMs.p95),
    },
    {
      label: t('metric.e2eP99'),
      hint: t('metric.e2eP99Hint'),
      fcfs: formatMs(fcfs.e2eMs.p99),
      continuous: formatMs(continuous.e2eMs.p99),
    },
    {
      label: t('metric.prefixHit'),
      hint: t('metric.prefixHitHint'),
      fcfs: formatPercent(fcfs.prefixCache.tokenHitRate),
      continuous: formatPercent(continuous.prefixCache.tokenHitRate),
    },
    {
      label: t('metric.peakKv'),
      hint: t('metric.peakKvHint', { blocks: totalBlocks }),
      fcfs: `${fcfs.kvPeakPhysicalBlocks}/${totalBlocks}`,
      continuous: `${continuous.kvPeakPhysicalBlocks}/${totalBlocks}`,
    },
  ]

  const throughputs = [fcfs.throughputRequestsPerSecond, continuous.throughputRequestsPerSecond]
  const throughputMax = Math.max(...throughputs, 1)
  const ttfts = [fcfs.ttftMs.p95 ?? 0, continuous.ttftMs.p95 ?? 0]
  const ttftMax = Math.max(...ttfts, 1)

  return (
    <section className="panel comparison-panel" aria-labelledby="comparison-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">{t('comparison.kicker')}</p>
          <h2 id="comparison-title">{t('comparison.title')}</h2>
        </div>
        <span className="badge badge-muted">{t('comparison.simulated')}</span>
      </div>

      <div className="run-cards">
        <article className="run-card run-card-fcfs">
          <p className="run-card-label">{t('comparison.fcfs')}</p>
          <strong>{formatRate(fcfs.throughputRequestsPerSecond)} req/s</strong>
          <span>
            {t('comparison.complete', {
              completed: fcfs.completedRequests,
              total: fcfs.totalRequests,
              steps: fcfs.totalSteps,
            })}
          </span>
        </article>
        <article className="run-card run-card-cb">
          <p className="run-card-label">{t('comparison.cb')}</p>
          <strong>{formatRate(continuous.throughputRequestsPerSecond)} req/s</strong>
          <span>
            {t('comparison.complete', {
              completed: continuous.completedRequests,
              total: continuous.totalRequests,
              steps: continuous.totalSteps,
            })}
          </span>
        </article>
      </div>

      <div className="bar-charts">
        <BarPair
          label={t('comparison.bar.throughput')}
          directionLabel={t('comparison.higher')}
          fcfsValue={throughputs[0] ?? 0}
          continuousValue={throughputs[1] ?? 0}
          max={throughputMax}
          fcfsLabel={formatRate(throughputs[0] ?? 0)}
          continuousLabel={formatRate(throughputs[1] ?? 0)}
        />
        <BarPair
          label={t('comparison.bar.ttft')}
          directionLabel=""
          fcfsValue={ttfts[0] ?? 0}
          continuousValue={ttfts[1] ?? 0}
          max={ttftMax}
          fcfsLabel={formatMs(fcfs.ttftMs.p95)}
          continuousLabel={formatMs(continuous.ttftMs.p95)}
        />
      </div>

      <div className="table-scroll">
        <table className="compare-table">
          <caption className="sr-only">{t('comparison.tableCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('comparison.metric')}</th>
              <th scope="col">{t('comparison.fcfsShort')}</th>
              <th scope="col">{t('comparison.cbShort')}</th>
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

      <p className="caption">{t('comparison.caption')}</p>
    </section>
  )
}

interface BarPairProps {
  readonly label: string
  readonly directionLabel: string
  readonly fcfsValue: number
  readonly continuousValue: number
  readonly max: number
  readonly fcfsLabel: string
  readonly continuousLabel: string
}

function BarPair({
  label,
  directionLabel,
  fcfsValue,
  continuousValue,
  max,
  fcfsLabel,
  continuousLabel,
}: BarPairProps) {
  return (
    <div className="bar-pair">
      <div className="bar-label">
        <span>{label}</span>
        <span className="bar-direction">{directionLabel}</span>
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
