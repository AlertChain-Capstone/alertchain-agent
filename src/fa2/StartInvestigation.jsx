import { useEffect, useRef, useState } from 'react'
import AlertBadge from '../fa1/AlertBadge'
import { alerts, alertById, config, formatDateTime } from './fa2Data'
import StatusChip from './StatusChip'

const SCENARIOS = {
  normal: { label: 'Normal run', help: 'New investigations run step by step and finish with a verdict and next steps.' },
  bedrock: { label: 'Amazon Bedrock unavailable', help: 'New investigations pause before the first reasoning step. Retry resumes them.' },
  cloudtrail: { label: 'CloudTrail query denied', help: 'The first CloudTrail query fails; the failure is recorded and the agent continues with other sources.' },
}

export default function StartInvestigation({ headingRef, investigations, scenario, onScenarioChange, onRequest, onOpen }) {
  const [lowSeverityAlert, setLowSeverityAlert] = useState(null)

  function investigate(alert) {
    if (onRequest(alert) === 'belowThreshold') setLowSeverityAlert(alert)
  }

  const latestFor = (alertId) => [...investigations].reverse().find((inv) => inv.alertId === alertId)

  return (
    <section aria-labelledby="fa2-home-heading">
      <p className="fa1-breadcrumb">Investigations &amp; Incidents</p>
      <h1 id="fa2-home-heading" ref={headingRef} tabIndex={-1}>Investigations</h1>
      <p className="fa1-description">Start an investigation from an alert, or open an existing one.</p>
      <p className="fa1-demo">Inception prototype — fictional data and a simulated agent (no AWS or Bedrock calls)</p>

      <div className="fa1-scenario-controls">
        <div className="fa1-filter">
          <label htmlFor="fa2-start-scenario">Investigation demo scenario</label>
          <select id="fa2-start-scenario" value={scenario} aria-describedby="fa2-start-scenario-help" onChange={(e) => onScenarioChange(e.target.value)}>
            {Object.entries(SCENARIOS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
          </select>
        </div>
        <p id="fa2-start-scenario-help" className="fa1-muted">{SCENARIOS[scenario].help} Applies to investigations you start next.</p>
      </div>

      <section className="fa1-card fa2-section" aria-labelledby="fa2-alerts-title">
        <div className="fa1-card-heading">
          <h2 id="fa2-alerts-title">Alerts</h2>
          <span className="fa1-muted">From FA1 · alerts below {config.severityThreshold} severity ask for confirmation</span>
        </div>
        <div className="fa1-table-wrapper">
          <table className="fa1-table fa2-table">
            <thead>
              <tr><th>Alert</th><th>Event</th><th>Principal</th><th>Severity</th><th>Investigation</th><th><span className="fa2-visually-hidden">Action</span></th></tr>
            </thead>
            <tbody>
              {alerts.map((alert) => {
                const inv = latestFor(alert.id)
                return (
                  <tr key={alert.id}>
                    <td><strong>{alert.id}</strong><div className="fa1-muted">{alert.title}</div></td>
                    <td className="fa2-break">{alert.eventName}</td>
                    <td>{alert.principal}</td>
                    <td><AlertBadge kind="severity" value={alert.severity} /></td>
                    <td>{inv ? <button type="button" className="fa2-link" onClick={() => onOpen(inv.id)}>{inv.id}</button> : <span className="fa1-muted">None</span>} {inv && <StatusChip inv={inv} />}</td>
                    <td><button type="button" className="fa1-primary" onClick={() => investigate(alert)}>Investigate</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fa1-card fa2-section" aria-labelledby="fa2-recent-title">
        <h2 id="fa2-recent-title">Recent investigations</h2>
        <div className="fa1-table-wrapper">
          <table className="fa1-table fa2-table">
            <thead><tr><th>Investigation</th><th>Alert</th><th>Status</th><th>Verdict</th><th>Started</th></tr></thead>
            <tbody>
              {[...investigations].reverse().map((inv) => {
                const alert = alertById(inv.alertId)
                return (
                  <tr key={inv.id}>
                    <td><button type="button" className="fa2-link" onClick={() => onOpen(inv.id)}>{inv.id}</button></td>
                    <td>{alert.id} · {alert.eventName}</td>
                    <td><StatusChip inv={inv} /></td>
                    <td>{inv.verdict ? `${inv.verdict} · ${inv.confidence}%` : <span className="fa1-muted">No verdict yet</span>}</td>
                    <td><time dateTime={inv.startedAt}>{formatDateTime(inv.startedAt)}</time></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {lowSeverityAlert && (
        <BelowThresholdDialog
          alert={lowSeverityAlert}
          onCancel={() => setLowSeverityAlert(null)}
          onConfirm={() => {
            const alert = lowSeverityAlert
            setLowSeverityAlert(null)
            onRequest(alert, { confirmedLowSeverity: true })
          }}
        />
      )}
    </section>
  )
}

function BelowThresholdDialog({ alert, onCancel, onConfirm }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog ref={ref} className="fa1-dialog" aria-labelledby="fa2-threshold-title" onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <h2 id="fa2-threshold-title">This alert is below the investigation threshold</h2>
      <p className="fa2-dialog-text">
        {alert.id} has <strong>{alert.severity}</strong> severity. Investigations normally start at <strong>{config.severityThreshold}</strong> or higher,
        so the agent does not use Amazon Bedrock on it automatically. You can still investigate it.
      </p>
      <div className="fa1-actions">
        <button type="button" className="fa1-primary" onClick={onConfirm}>Investigate anyway</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </dialog>
  )
}
