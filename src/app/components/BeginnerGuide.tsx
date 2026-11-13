import { useState } from 'react'
import { GUIDES } from '../lib/guide'
import { useI18n } from '../lib/i18n'

export function BeginnerGuide() {
  const { language, t } = useI18n()
  const [open, setOpen] = useState(true)
  const guide = GUIDES[language]

  return (
    <section className="panel guide-panel" aria-labelledby="guide-title">
      <div className="panel-heading guide-heading">
        <div>
          <p className="panel-kicker">{guide.kicker}</p>
          <h2 id="guide-title">{guide.title}</h2>
          <p className="guide-summary">{guide.summary}</p>
        </div>
        <button
          type="button"
          className="guide-toggle"
          aria-expanded={open}
          aria-controls="guide-body"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t('guide.hide') : t('guide.show')}
        </button>
      </div>

      {open ? (
        <div className="guide-body" id="guide-body">
          <div className="guide-steps">
            {guide.steps.map((step) => (
              <article key={step.title} className="guide-step">
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>

          <div className="guide-metrics">
            <h3>{guide.metricsTitle}</h3>
            <dl>
              {guide.metrics.map((metric) => (
                <div key={metric.term}>
                  <dt>{metric.term}</dt>
                  <dd>{metric.body}</dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="guide-cta">
            <a href={`?scenario=bursty&tab=continuous-batching&step=0.35&lang=${language}`}>
              {guide.cta}
            </a>
          </p>
        </div>
      ) : null}
    </section>
  )
}
