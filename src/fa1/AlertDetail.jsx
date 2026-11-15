import { useCallback, useEffect, useRef, useState } from 'react'
import AlertBadge from './AlertBadge'
import { alertApi } from '../shared/api'
import useAlertRead from './useAlertRead'

export default function AlertDetail({ alertId, onBack, onInvestigate, onOpenIncident, client = alertApi }) {
  const headingRef = useRef(null)
  const [copyMessage, setCopyMessage] = useState('')
  const [copying, setCopying] = useState(false)
  const [simulateUnavailable, setSimulateUnavailable] = useState(false)
  const loadDetails = useCallback((signal) => client.getAlertDetails(alertId, { signal }), [client, alertId])
  const details = useAlertRead(alertId, loadDetails)
  const alert = details.data
  const loadRaw = useCallback((signal) => client.getRawEvent(alertId, { signal }), [client, alertId])
  const loadAssociation = useCallback((signal) => client.getAssociatedIncidentId(alertId, { signal }), [client, alertId])
  const raw = useAlertRead(alertId, loadRaw, Boolean(alert))
  const association = useAlertRead(alertId, loadAssociation, Boolean(alert))
  const incidentId = association.data?.incidentId
  const canInvestigate = client.mock && Boolean(onInvestigate)
  const canOpenIncident = client.mock && Boolean(onOpenIncident)

  useEffect(() => {
    headingRef.current?.focus()
  }, [alert?.id, details.status, simulateUnavailable])

  const demoControl = client.mock && alert && (
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

  if (details.status === 'loading' || (details.status === 'error' && details.error.status !== 404)) {
    return (
      <section>
        <h1 ref={headingRef} tabIndex={-1}>{details.status === 'loading' ? 'Loading alert details…' : 'Alert details could not be loaded'}</h1>
        {details.status === 'error' && <div role="alert">
          <p>Check your connection and try again.</p>
          <button type="button" onClick={details.retry}>Retry alert details</button>
        </div>}
        <button type="button" onClick={onBack}>Back to alerts</button>
      </section>
    )
  }

  if (!alert || simulateUnavailable) {
    return (
      <section>
        <p className="fa1-breadcrumb">Alerts &amp; Sources / Alerts</p>
        <h1 ref={headingRef} tabIndex={-1}>Alert no longer available</h1>
        {client.mock && <p className="fa1-demo">Inception prototype — fictional data and simulated connections</p>}
        {demoControl}
        <button type="button" onClick={onBack}>Back to alerts</button>
      </section>
    )
  }

  const hasRawEvent = raw.status === 'ready' && raw.data.rawEvent != null
  const json = hasRawEvent ? JSON.stringify(raw.data.rawEvent, null, 2) : ''
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
        {incidentId && <span className="fa1-badge fa1-badge-warning">In {incidentId}</span>}
      </div>
      <p className="fa1-description">{alert.source} · <time dateTime={alert.occurredAt}>{timestamp}</time></p>
      {client.mock && <p className="fa1-demo">Inception prototype — fictional data and simulated connections</p>}
      {demoControl}

      <div className="fa1-actions">
        <button type="button" className="fa1-primary" disabled={!canInvestigate} aria-describedby={canInvestigate ? undefined : 'alert-handoff-note'} onClick={() => { if (canInvestigate) onInvestigate(alert) }}>
          Investigate
        </button>
        {incidentId && (
          <button type="button" disabled={!canOpenIncident} aria-describedby={canOpenIncident ? undefined : 'alert-handoff-note'} onClick={() => { if (canOpenIncident) onOpenIncident(incidentId) }}>
            Open incident {incidentId}
          </button>
        )}
        <button type="button" onClick={onBack}>Back to alerts</button>
      </div>
      {(!canInvestigate || !canOpenIncident) && (
        <p id="alert-handoff-note" className="fa1-muted">{client.mock
          ? 'Investigation and incident actions are unavailable — awaiting FA2/FA3 team integration.'
          : 'Live investigations and incident reports are not connected yet. These actions are unavailable.'}</p>
      )}

      <section aria-label="Associated incident" className="fa1-card">
        <h2>Associated incident</h2>
        {(association.status === 'loading' || association.status === 'idle') && <p role="status">Loading incident association…</p>}
        {association.status === 'error' && <div role="alert">
          <p>Incident association could not be loaded.</p>
          <button type="button" onClick={association.retry}>Retry incident association</button>
        </div>}
        {association.data?.status === 'none' && <p>No associated incident.</p>}
        {association.data?.status === 'ambiguous' && <p role="status">Multiple incidents are associated with this alert. No incident has been selected.</p>}
        {association.data?.status === 'associated' && <p>Associated incident: {incidentId}</p>}
      </section>

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
          {(raw.status === 'loading' || raw.status === 'idle') ? (
            <p role="status">Loading raw event…</p>
          ) : raw.status === 'error' ? (
            <div role="alert">
              <p>Raw event could not be loaded.</p>
              <button type="button" onClick={() => { setCopyMessage(''); raw.retry() }}>Retry raw event</button>
            </div>
          ) : hasRawEvent ? (
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
