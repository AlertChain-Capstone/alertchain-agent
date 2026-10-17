const scenarios = {
  healthy: { label: 'Healthy', status: 'Connected', color: 'success' },
  unconfigured: {
    label: 'Not configured', status: 'Not configured', color: 'neutral',
    explanation: 'This source has no ingestion configuration. Configure it in this demo to simulate a healthy connection.',
  },
  denied: {
    label: 'Permission denied / stale data', status: 'Permission denied / stale data', color: 'warning',
    explanation: 'Ingestion permission was denied. The last successful ingestion is stale; new security signals are not being received. Retry simulates restoring permission.',
  },
  unreachable: {
    label: 'AWS unreachable', status: 'AWS unreachable', color: 'danger',
    explanation: 'Connection error: the AWS endpoint could not be reached. New security signals are not being received. Retry simulates restoring connectivity.',
  },
}
const STALE_INGESTION_TIME = '2026-10-16T12:00:00Z'

export default function SecuritySources({ sources, alerts, demo, onScenarioChange, onRecover, onTestConnection, onViewRecent }) {
  return (
    <>
      <div className="fa1-scenario-controls">
        <div className="fa1-filter">
          <label htmlFor="source-demo-scenario">Demo scenario</label>
          <select
            id="source-demo-scenario"
            value={demo.scenario}
            aria-describedby="source-demo-help"
            onChange={(event) => onScenarioChange(event.target.value, scenarios[event.target.value].label)}
          >
            {Object.entries(scenarios).map(([value, scenario]) => <option key={value} value={value}>{scenario.label}</option>)}
          </select>
        </div>
        <p id="source-demo-help" className="fa1-muted">
          Applies to both sources. Recover each source independently. All actions are simulated; sample alerts remain available.
        </p>
      </div>
      <p className="fa1-source-announcement" role="status" aria-atomic="true">{demo.announcement}</p>

      <div className="fa1-source-grid">
        {sources.map((source) => {
          const state = demo.states[source.id] ?? 'healthy'
          const scenario = scenarios[state]
          const recovering = demo.pending.includes(source.id)
          const stale = state === 'denied' || state === 'unreachable'
          const lastIngestion = stale ? STALE_INGESTION_TIME : source.lastEventAt
          const explanationId = `source-explanation-${source.id}`
          return (
            <section className="fa1-card" key={source.id} aria-labelledby={`source-title-${source.id}`}>
              <div className="fa1-card-heading">
                <h2 id={`source-title-${source.id}`}>{source.name}</h2>
                <span className={`fa1-badge fa1-badge-${recovering ? 'info' : scenario.color}`}>
                  {recovering ? 'Recovering…' : scenario.status}
                </span>
              </div>
              {scenario.explanation && <p id={explanationId} className={`fa1-source-explanation fa1-source-explanation-${scenario.color}`}>{scenario.explanation}</p>}

              <dl className="fa1-stats">
                <div>
                  <dt>{state === 'healthy' ? 'Last event received' : 'Last successful ingestion'}</dt>
                  <dd>
                    {state === 'unconfigured' ? 'Not available — not configured' : (
                      <>
                        <time dateTime={lastIngestion}>
                          {stale
                            ? `${lastIngestion.slice(0, 19).replace('T', ' ')} UTC`
                            : `${new Date(lastIngestion).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`}
                        </time>
                        {stale && <span className="fa1-stale-label">Stale sample data</span>}
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Sample normalized alerts</dt>
                  <dd>{alerts.filter((alert) => alert.source === source.name).length}</dd>
                </div>
              </dl>

              <div className="fa1-actions">
                <button
                  type="button"
                  disabled={recovering}
                  aria-describedby={scenario.explanation ? explanationId : undefined}
                  onClick={() => state === 'healthy' ? onTestConnection(source) : onRecover(source, state)}
                >
                  {recovering
                    ? (state === 'unconfigured' ? 'Configuring…' : 'Retrying…')
                    : (state === 'healthy' ? 'Test connection' : state === 'unconfigured' ? 'Configure (simulated)' : 'Retry')}
                </button>
                <button type="button" onClick={() => onViewRecent(source.name)}>View recent events</button>
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}
