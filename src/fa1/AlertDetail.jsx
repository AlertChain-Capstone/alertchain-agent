import { useEffect, useRef, useState } from 'react'
import AlertBadge from './AlertBadge'

export default function AlertDetail({ alert, onBack, onInvestigate, onOpenIncident }) {
  const headingRef = useRef(null)
  const [copyMessage, setCopyMessage] = useState('')
  const [copying, setCopying] = useState(false)
  const [simulateUnavailable, setSimulateUnavailable] = useState(false)

  useEffect(() => {
    headingRef.current?.focus()
  }, [alert?.id, simulateUnavailable])

  const demoControl = alert && (
    <div className="fa1-scenario-controls fa1-alert-demo-controls">
      <div className="fa1-filter">
        <label htmlFor="alert-detail-demo-scenario">Alert details demo scenario</label>
        <select
          id="alert-detail-demo-scenario"
          value={simulateUnavailable ? 'unavailable' : 'available'}
          aria-describedby="alert-detail-demo-status"
          onChange={(event) => {
            setSimulateUnavailable(event.target.value === 'unavailable')
            setCopyMessage('')
          }}
        >
          <option value="available">Selected alert available</option>
          <option value="unavailable">Alert no longer available</option>
        </select>
      </div>
      <p id="alert-detail-demo-status" className="fa1-muted" role="status" aria-atomic="true">
        {simulateUnavailable
          ? 'Demo: the selected alert is unavailable. Restore it with this selector; fixture data is unchanged.'
          : 'Showing the selected sample alert. This demo does not change fixture data.'}
      </p>
    </div>
  )

  if (!alert || simulateUnavailable) {
    return (
      <section>
        <p className="fa1-breadcrumb">Alerts &amp; Sources / Alerts</p>
        <h1 ref={headingRef} tabIndex={-1}>Alert no longer available</h1>
        <p className="fa1-demo">Inception prototype — fictional data and simulated connections</p>
        {demoControl}
        <button type="button" onClick={onBack}>Back to alerts</button>
      </section>
    )
  }

  const hasRawEvent = alert.rawEvent != null
  const json = hasRawEvent ? JSON.stringify(alert.rawEvent, null, 2) : ''
  const timestamp = new Date(alert.occurredAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
  const fields = [
    ['Source', alert.source],
    ['Event', alert.eventName],
    ['Time', <time dateTime={alert.occurredAt}>{timestamp}</time>],
    ['Principal', alert.principal],
    ['Access key', alert.accessKeyId],
    ['Source IP', alert.sourceIp],
    ['Resource', alert.resource],
    ['Region', alert.region],
    ['Severity', <AlertBadge kind="severity" value={alert.severity} />],
    ['Summary', alert.summary],
  ]

  async function copyJson() {
    setCopying(true)
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(json)
      setCopyMessage('JSON copied to clipboard.')
    } catch {
      setCopyMessage('Could not copy JSON. Select the displayed JSON and copy it manually.')
    } finally {
      setCopying(false)
    }
  }

  return (
    <section aria-labelledby="alert-detail-heading">
      <p className="fa1-breadcrumb">Alerts &amp; Sources / Alerts / {alert.id}</p>
      <div className="fa1-detail-title">
        <h1 id="alert-detail-heading" ref={headingRef} tabIndex={-1}>{alert.id} · {alert.eventName}</h1>
        <AlertBadge kind="severity" value={alert.severity} />
        <AlertBadge kind="status" value={alert.status} />
        {alert.incidentId && <span className="fa1-badge fa1-badge-warning">In {alert.incidentId}</span>}
      </div>
      <p className="fa1-description">{alert.source} · <time dateTime={alert.occurredAt}>{timestamp}</time></p>
      <p className="fa1-demo">Inception prototype — fictional data and simulated connections</p>
      {demoControl}

      <div className="fa1-actions">
        {/* FA2 supplies these callbacks from App.jsx; without them the buttons stay disabled. */}
        <button type="button" className="fa1-primary" disabled={!onInvestigate} aria-describedby={onInvestigate ? undefined : 'alert-handoff-note'} onClick={() => onInvestigate?.(alert)}>
          Investigate
        </button>
        {alert.incidentId && (
          <button type="button" disabled={!onOpenIncident} aria-describedby={onOpenIncident ? undefined : 'alert-handoff-note'} onClick={() => onOpenIncident?.(alert.incidentId)}>
            Open incident {alert.incidentId}
          </button>
        )}
        <button type="button" onClick={onBack}>Back to alerts</button>
      </div>
      {(!onInvestigate || !onOpenIncident) && (
        <p id="alert-handoff-note" className="fa1-muted">Investigation and incident actions are unavailable — awaiting FA2/FA3 team integration.</p>
      )}

      <div className="fa1-detail-grid">
        <section className="fa1-card" aria-labelledby="normalized-alert-title">
          <h2 id="normalized-alert-title">Normalized alert</h2>
          <dl className="fa1-detail-fields">
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value ?? 'Not available'}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="fa1-card" aria-labelledby="raw-event-title">
          <h2 id="raw-event-title">Raw event (JSON)</h2>
          {hasRawEvent ? (
            <pre className="fa1-raw-json" tabIndex={0} aria-label="Raw event JSON"><code>{json}</code></pre>
          ) : (
            <p className="fa1-muted">Raw event unavailable</p>
          )}
          <button type="button" disabled={!hasRawEvent || copying} onClick={copyJson}>{copying ? 'Copying…' : 'Copy JSON'}</button>
          <p className="fa1-copy-status" role="status">{copyMessage}</p>
        </section>
      </div>
    </section>
  )
}
