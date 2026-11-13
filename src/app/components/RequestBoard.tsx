import type { RequestTimelineState, StepView } from '../lib/timeline'
import { formatCount, formatMs, formatPercent, formatTokens } from '../lib/format'

interface RequestBoardProps {
  readonly view: StepView | null
}

export function RequestBoard({ view }: RequestBoardProps) {
  if (view === null) {
    return (
      <section className="panel request-board" aria-labelledby="request-board-title">
        <h2 id="request-board-title">Requests</h2>
        <p className="empty-state">No simulation steps to display.</p>
      </section>
    )
  }

  return (
    <section className="panel request-board" aria-labelledby="request-board-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">At the end of the selected step</p>
          <h2 id="request-board-title">Queue &amp; request states</h2>
        </div>
        <div className="count-badges">
          <span className="count-badge">queue {view.waiting.length}</span>
          <span className="count-badge">running {view.running.length}</span>
          <span className="count-badge">done {view.finishedCount}</span>
        </div>
      </div>

      <div className="request-columns">
        <div>
          <h3 className="subheading">
            Waiting queue <span className="subheading-count">{view.waiting.length}</span>
          </h3>
          {view.waiting.length === 0 ? (
            <p className="empty-state">No queued requests at this point.</p>
          ) : (
            <ul className="request-list" aria-label="Waiting requests">
              {view.waiting.map((request) => (
                <WaitingRow key={request.id} request={request} />
              ))}
            </ul>
          )}
          {view.waiting.length > 4 ? (
            <p className="list-hint">Scroll for all {view.waiting.length} queued requests.</p>
          ) : null}
        </div>

        <div>
          <h3 className="subheading">
            Running <span className="subheading-count">{view.running.length}</span>
          </h3>
          {view.running.length === 0 ? (
            <p className="empty-state">No running requests at this point.</p>
          ) : (
            <ul className="request-list" aria-label="Running requests">
              {view.running.map((request) => (
                <RunningRow key={request.id} request={request} />
              ))}
            </ul>
          )}
          {view.running.length > 4 ? (
            <p className="list-hint">Scroll for all {view.running.length} running requests.</p>
          ) : null}
        </div>
      </div>

      <div className="finished-section">
        <h3 className="subheading">
          Finished at this point <span className="subheading-count">{view.finished.length}</span>
        </h3>
        {view.finished.length === 0 ? (
          <p className="empty-state">No requests have finished yet.</p>
        ) : (
          <div className="table-scroll finished-table-wrap">
            <table className="finished-table">
              <caption className="sr-only">Per-request metrics for finished requests</caption>
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">TTFT</th>
                  <th scope="col">TPOT</th>
                  <th scope="col">E2E</th>
                  <th scope="col">Prefix</th>
                </tr>
              </thead>
              <tbody>
                {view.finished.slice(0, 12).map((request) => (
                  <tr key={request.id}>
                    <td>{request.id}</td>
                    <td>{formatMs(request.ttftMs)}</td>
                    <td>{formatMs(request.tpotMs)}</td>
                    <td>{formatMs(request.e2eMs)}</td>
                    <td>{request.prefixHitTokens > 0 ? `${request.prefixHitTokens} tok` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.finished.length > 12 ? (
              <p className="list-hint">
                Showing 12 of {view.finished.length} finished requests. All requests contribute to
                the comparison metrics above.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <p className="caption">
        Request state is reconstructed from the step trace. KV blocks in this view are logical
        per-request usage; physical sharing is summarized in the KV panel.
      </p>
    </section>
  )
}

function WaitingRow({ request }: { readonly request: RequestTimelineState }) {
  return (
    <li className="request-row">
      <div className="request-main">
        <span className="request-id">{request.id}</span>
        <span className="state-badge state-waiting">waiting</span>
      </div>
      <div className="request-meta">
        <span>{formatTokens(request.promptTokens)} prompt tokens</span>
        <span>{Math.max(0, request.maxNewTokens - request.outputTokens)} output budget</span>
      </div>
    </li>
  )
}

function RunningRow({ request }: { readonly request: RequestTimelineState }) {
  return (
    <li className="request-row">
      <div className="request-main">
        <span className="request-id">{request.id}</span>
        <span
          className={
            request.state === 'prefill' ? 'state-badge state-prefill' : 'state-badge state-decode'
          }
        >
          {request.state}
        </span>
        {request.prefixHitTokens > 0 ? (
          <span className="state-badge state-prefix">prefix {request.prefixHitTokens} tok</span>
        ) : null}
      </div>

      <div className="progress-block">
        <div className="progress-label">
          <span>prompt</span>
          <span>
            {formatCount(request.prefilledTokens)}/{formatCount(request.promptTokens)} ·{' '}
            {formatPercent(request.promptProgress, 0)}
          </span>
        </div>
        <div className="progress-track" aria-hidden="true">
          <div
            className="progress-fill progress-fill-prompt"
            style={{ width: `${request.promptProgress * 100}%` }}
          />
        </div>
      </div>

      <div className="progress-block">
        <div className="progress-label">
          <span>output</span>
          <span>
            {formatCount(request.outputTokens)}/{formatCount(request.maxNewTokens)}
          </span>
        </div>
        <div className="progress-track" aria-hidden="true">
          <div
            className="progress-fill progress-fill-output"
            style={{ width: `${request.outputProgress * 100}%` }}
          />
        </div>
      </div>

      <div className="request-meta">
        <span>{request.logicalBlocks} logical blocks</span>
        {request.prefixBlocks > 0 ? <span>{request.prefixBlocks} prefix blocks</span> : null}
      </div>
    </li>
  )
}
