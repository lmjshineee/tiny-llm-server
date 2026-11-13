import type { SimulationResult } from '../../core/index'
import type { StepView } from '../lib/timeline'
import { formatCount, formatPercent } from '../lib/format'

interface KvPanelProps {
  readonly view: StepView | null
  readonly result: SimulationResult
}

const CELL_COUNT = 64

export function KvPanel({ view, result }: KvPanelProps) {
  if (view === null) {
    return (
      <section className="panel kv-panel" aria-labelledby="kv-title">
        <h2 id="kv-title">KV cache</h2>
        <p className="empty-state">No simulation steps to display.</p>
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
          <p className="panel-kicker">Occupancy at the selected step</p>
          <h2 id="kv-title">Paged KV cache</h2>
        </div>
        <span className="badge badge-muted">
          {formatCount(totalBlocks)} blocks × {blockSize} tok
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
            <i className="dot dot-active" /> active {formatCount(cache.allocatedBlocks)}
          </span>
          <span>
            <i className="dot dot-retained" /> retained {formatCount(cache.cachedBlocks)}
          </span>
          <span>
            <i className="dot dot-free" /> free {formatCount(free)}
          </span>
        </div>
      </div>

      <div className="kv-map" aria-hidden="true">
        {Array.from({ length: CELL_COUNT }, (_, index) => {
          const state =
            index < activeCells
              ? 'active'
              : index < activeCells + retainedCells
                ? 'retained'
                : 'free'
          return <span key={index} className={`kv-cell kv-cell-${state}`} />
        })}
      </div>
      <p className="caption">
        Capacity map (aggregated; not physical block IDs). Each cell represents a range of
        blocks. The trace stores occupancy counts, not per-block ownership.
      </p>

      <dl className="kv-stats">
        <div>
          <dt>Active</dt>
          <dd>{formatCount(cache.allocatedBlocks)}</dd>
        </div>
        <div>
          <dt>Retained</dt>
          <dd>{formatCount(cache.cachedBlocks)}</dd>
        </div>
        <div>
          <dt>Shared</dt>
          <dd>{formatCount(cache.sharedBlocks)}</dd>
        </div>
        <div>
          <dt>Logical</dt>
          <dd>{formatCount(cache.logicalBlocks)}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{formatCount(cache.reservedBlocks)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{formatCount(cache.availableBlocks)}</dd>
        </div>
      </dl>

      <div className="prefix-summary">
        <div className="prefix-summary-head">
          <h3>Prefix cache</h3>
          <span className="mini-pill">
            {formatPercent(prefix.tokenHitRate)} token hit
          </span>
        </div>
        <p>
          {prefix.hitRequests}/{prefix.totalRequests} requests reused{' '}
          {formatCount(prefix.hitTokens)}/{formatCount(prefix.totalPromptTokens)} prompt tokens.
        </p>
        {prefix.hitTokens === 0 ? (
          <p className="muted">No prefix hits in this run. Try the prefix-heavy scenario.</p>
        ) : null}
        <p className="caption">
          Physical blocks are shared by reference; logical blocks count a shared block per
          request. Worst-case reservations still bound admission.
        </p>
      </div>
    </section>
  )
}
