import { useI18n } from '../lib/i18n'
import type { RequestTimelineState, StepView } from '../lib/timeline'
import { formatCount, formatMs, formatPercent, formatTokens } from '../lib/format'

interface RequestBoardProps {
  readonly view: StepView | null
}

export function RequestBoard({ view }: RequestBoardProps) {
  const { t } = useI18n()

  if (view === null) {
    return (
      <section className="panel request-board" aria-labelledby="request-board-title">
        <h2 id="request-board-title">{t('request.title')}</h2>
        <p className="empty-state">{t('request.noSteps')}</p>
      </section>
    )
  }

  return (
    <section className="panel request-board" aria-labelledby="request-board-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">{t('request.kicker')}</p>
          <h2 id="request-board-title">{t('request.title')}</h2>
        </div>
        <div className="count-badges">
          <span className="count-badge">{t('request.queue', { count: view.waiting.length })}</span>
          <span className="count-badge">
            {t('request.running', { count: view.running.length })}
          </span>
          <span className="count-badge">{t('request.done', { count: view.finishedCount })}</span>
        </div>
      </div>

      <div className="request-columns">
        <div>
          <h3 className="subheading">
            {t('request.waitingTitle')}{' '}
            <span className="subheading-count">{view.waiting.length}</span>
          </h3>
          {view.waiting.length === 0 ? (
            <p className="empty-state">{t('request.emptyWaiting')}</p>
          ) : (
            <ul className="request-list" aria-label={t('request.waitingTitle')}>
              {view.waiting.map((request) => (
                <WaitingRow key={request.id} request={request} />
              ))}
            </ul>
          )}
          {view.waiting.length > 4 ? (
            <p className="list-hint">
              {t('request.scrollWaiting', { count: view.waiting.length })}
            </p>
          ) : null}
        </div>

        <div>
          <h3 className="subheading">
            {t('request.runningTitle')}{' '}
            <span className="subheading-count">{view.running.length}</span>
          </h3>
          {view.running.length === 0 ? (
            <p className="empty-state">{t('request.emptyRunning')}</p>
          ) : (
            <ul className="request-list" aria-label={t('request.runningTitle')}>
              {view.running.map((request) => (
                <RunningRow key={request.id} request={request} />
              ))}
            </ul>
          )}
          {view.running.length > 4 ? (
            <p className="list-hint">
              {t('request.scrollRunning', { count: view.running.length })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="finished-section">
        <h3 className="subheading">
          {t('request.finishedTitle')}{' '}
          <span className="subheading-count">{view.finished.length}</span>
        </h3>
        {view.finished.length === 0 ? (
          <p className="empty-state">{t('request.emptyFinished')}</p>
        ) : (
          <div className="table-scroll finished-table-wrap">
            <table className="finished-table">
              <caption className="sr-only">{t('request.tableCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('request.request')}</th>
                  <th scope="col">TTFT</th>
                  <th scope="col">TPOT</th>
                  <th scope="col">E2E</th>
                  <th scope="col">{t('request.prefix')}</th>
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
                {t('request.finishedHint', { count: view.finished.length })}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <p className="caption">{t('request.caption')}</p>
    </section>
  )
}

function WaitingRow({ request }: { readonly request: RequestTimelineState }) {
  const { t } = useI18n()
  return (
    <li className="request-row">
      <div className="request-main">
        <span className="request-id">{request.id}</span>
        <span className="state-badge state-waiting">{t('request.waitingState')}</span>
      </div>
      <div className="request-meta">
        <span>{t('request.promptTokens', { count: formatTokens(request.promptTokens) })}</span>
        <span>
          {t('request.outputBudget', {
            count: Math.max(0, request.maxNewTokens - request.outputTokens),
          })}
        </span>
      </div>
    </li>
  )
}

function RunningRow({ request }: { readonly request: RequestTimelineState }) {
  const { t } = useI18n()
  const stateLabel =
    request.state === 'prefill' ? t('request.prefillState') : t('request.decodeState')

  return (
    <li className="request-row">
      <div className="request-main">
        <span className="request-id">{request.id}</span>
        <span
          className={
            request.state === 'prefill' ? 'state-badge state-prefill' : 'state-badge state-decode'
          }
        >
          {stateLabel}
        </span>
        {request.prefixHitTokens > 0 ? (
          <span className="state-badge state-prefix">
            {t('request.prefixBadge', { count: request.prefixHitTokens })}
          </span>
        ) : null}
      </div>

      <div className="progress-block">
        <div className="progress-label">
          <span>{t('request.prompt')}</span>
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
          <span>{t('request.output')}</span>
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
        <span>{t('request.logicalBlocks', { count: request.logicalBlocks })}</span>
        {request.prefixBlocks > 0 ? (
          <span>{t('request.prefixBlocks', { count: request.prefixBlocks })}</span>
        ) : null}
      </div>
    </li>
  )
}
