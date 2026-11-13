import type { SimulationResult } from '../../core/index'
import { useI18n } from '../lib/i18n'
import type { StepView } from '../lib/timeline'
import { formatCount, formatPercent } from '../lib/format'

interface KvPanelProps {
  readonly view: StepView | null
  readonly result: SimulationResult
}

const CELL_COUNT = 64
const CELL_IDS = Array.from({ length: CELL_COUNT }, (_, index) => `kv-cell-${index}`)

export function KvPanel({ view, result }: KvPanelProps) {
  const { t } = useI18n()

  if (view === null) {
    return (
      <section className="panel kv-panel" aria-labelledby="kv-title">
        <h2 id="kv-title">{t('kv.title')}</h2>
        <p className="empty-state">{t('kv.noSteps')}</p>
      </section>
    )
  }

  const totalBlocks = result.cache.totalBlocks
  const blockSize = result.meta.config.kv.blockSize
  const cache = view.cache
  const free = Math.max(0, totalBlocks - cache.physicalBlocks)
  const prefix = result.summary.prefixCache

  const activeCells = Math.min(
    CELL_COUNT,
    cache.allocatedBlocks > 0
      ? Math.max(1, Math.round((cache.allocatedBlocks / totalBlocks) * CELL_COUNT))
      : 0,
  )
  const retainedCells = Math.min(
    CELL_COUNT - activeCells,
    cache.cachedBlocks > 0
      ? Math.max(1, Math.round((cache.cachedBlocks / totalBlocks) * CELL_COUNT))
      : 0,
  )

  return (
    <section className="panel kv-panel" aria-labelledby="kv-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">{t('kv.kicker')}</p>
          <h2 id="kv-title">{t('kv.title')}</h2>
        </div>
        <span className="badge badge-muted">
          {t('kv.blocks', { blocks: formatCount(totalBlocks), tokens: blockSize })}
        </span>
      </div>

      <div className="kv-bar-wrap">
        <div className="kv-bar" aria-hidden="true">
          <div
            className="kv-segment kv-segment-active"
            style={{ width: `${(cache.allocatedBlocks / totalBlocks) * 100}%` }}
          />
          <div
            className="kv-segment kv-segment-retained"
            style={{ width: `${(cache.cachedBlocks / totalBlocks) * 100}%` }}
          />
          <div
            className="kv-segment kv-segment-free"
            style={{ width: `${(free / totalBlocks) * 100}%` }}
          />
        </div>
        <div className="kv-legend">
          <span>
            <i className="dot dot-active" /> {t('kv.active')} {formatCount(cache.allocatedBlocks)}
          </span>
          <span>
            <i className="dot dot-retained" /> {t('kv.retained')} {formatCount(cache.cachedBlocks)}
          </span>
          <span>
            <i className="dot dot-free" /> {t('kv.free')} {formatCount(free)}
          </span>
        </div>
      </div>

      <div className="kv-map" aria-hidden="true">
        {CELL_IDS.map((cellId, index) => {
          const state =
            index < activeCells
              ? 'active'
              : index < activeCells + retainedCells
                ? 'retained'
                : 'free'
          return <span key={cellId} className={`kv-cell kv-cell-${state}`} />
        })}
      </div>
      <p className="caption">{t('kv.mapCaption')}</p>

      <dl className="kv-stats">
        <div>
          <dt>{t('kv.active')}</dt>
          <dd>{formatCount(cache.allocatedBlocks)}</dd>
        </div>
        <div>
          <dt>{t('kv.retained')}</dt>
          <dd>{formatCount(cache.cachedBlocks)}</dd>
        </div>
        <div>
          <dt>{t('kv.shared')}</dt>
          <dd>{formatCount(cache.sharedBlocks)}</dd>
        </div>
        <div>
          <dt>{t('kv.logical')}</dt>
          <dd>{formatCount(cache.logicalBlocks)}</dd>
        </div>
        <div>
          <dt>{t('kv.reserved')}</dt>
          <dd>{formatCount(cache.reservedBlocks)}</dd>
        </div>
        <div>
          <dt>{t('kv.available')}</dt>
          <dd>{formatCount(cache.availableBlocks)}</dd>
        </div>
      </dl>

      <div className="prefix-summary">
        <div className="prefix-summary-head">
          <h3>{t('kv.prefixTitle')}</h3>
          <span className="mini-pill">
            {t('kv.tokenHit', { percent: formatPercent(prefix.tokenHitRate) })}
          </span>
        </div>
        <p>
          {t('kv.prefixSummary', {
            hitRequests: prefix.hitRequests,
            totalRequests: prefix.totalRequests,
            hitTokens: formatCount(prefix.hitTokens),
            totalPromptTokens: formatCount(prefix.totalPromptTokens),
          })}
        </p>
        {prefix.hitTokens === 0 ? <p className="muted">{t('kv.noHits')}</p> : null}
        <p className="caption">{t('kv.caption')}</p>
      </div>
    </section>
  )
}
