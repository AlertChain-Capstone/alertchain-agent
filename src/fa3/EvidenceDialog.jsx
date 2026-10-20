import { useEffect, useRef, useState } from 'react'
import { formatDate, resolveEvidence } from './fa3Data.js'
import { Notice } from './Ui.jsx'

export default function EvidenceDialog({ incident, citation, scenario = 'normal', onClose }) {
  const dialog = useRef(null)
  const [state, setState] = useState('loading')
  const [segment, setSegment] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const evidence = resolveEvidence(incident, citation)
  const unavailable = !evidence || scenario === 'missing' || scenario === 'invalid'
  const raw = evidence?.raw == null ? null : JSON.stringify(evidence.raw, null, 2)
  const limit = scenario === 'large' ? 200 : 1200
  const segments = raw ? Math.ceil(raw.length / limit) : 0

  useEffect(() => {
    const element = dialog.current
    const trigger = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setState(scenario === 'error' && attempt === 0 ? 'error' : 'ready'), 450)
    return () => clearTimeout(timer)
  }, [scenario, attempt])

  return (
    <dialog className="fa3-evidence-dialog" ref={dialog} aria-labelledby="evidence-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="fa3-section-heading"><div><p className="fa3-eyebrow">STORED EVIDENCE · {incident.id}</p><h2 id="evidence-title">Citation {citation}</h2></div><button onClick={onClose}>Close evidence</button></div>
      {state === 'loading' ? <Notice title="Loading stored evidence…" />
        : state === 'error' ? <Notice title="Evidence could not be loaded" error><p>This is a temporary load error. The question and answer are preserved.</p><button onClick={() => { setState('loading'); setAttempt(attempt + 1) }}>Retry evidence</button></Notice>
        : unavailable ? <Notice title={scenario === 'invalid' ? 'Invalid citation' : 'Cited evidence is unavailable'} error><p>{scenario === 'invalid' ? 'This reference does not resolve to evidence belonging to this incident. No other incident’s evidence is displayed.' : 'The cited source cannot currently be verified. No other evidence has been substituted.'}</p></Notice>
        : <>
          <dl className="fa3-fields">
            <div><dt>Source</dt><dd>{evidence.source}</dd></div>
            <div><dt>Event</dt><dd>{evidence.eventName}</dd></div>
            <div><dt>Timestamp</dt><dd>{formatDate(evidence.occurredAt)}</dd></div>
            <div><dt>Principal</dt><dd>{evidence.principal ?? 'Not recorded'}</dd></div>
            <div><dt>Resource</dt><dd>{evidence.resource ?? 'Not recorded'}</dd></div>
            <div><dt>Analyst attribution</dt><dd>Not recorded in the source event</dd></div>
          </dl>
          <p>{evidence.summary}</p>
          {evidence.alertId && <a href={`#/alerts/${evidence.alertId}`} onClick={onClose}>Open normalized alert {evidence.alertId} →</a>}
          <h3>Stored event</h3>
          {!raw ? <p>Raw evidence was not recorded.</p> : <>
            {segments > 1 && <p className="fa3-muted">Truncated preview · Segment {segment + 1} of {segments}. Use the controls to inspect all stored content for {citation}.</p>}
            <pre tabIndex={0} aria-label="Stored event JSON"><code>{raw.slice(segment * limit, (segment + 1) * limit)}</code></pre>
            {segments > 1 && <div className="fa3-actions"><button disabled={segment === 0} onClick={() => setSegment(segment - 1)}>Previous segment</button><button disabled={segment === segments - 1} onClick={() => setSegment(segment + 1)}>Next segment</button></div>}
          </>}
        </>}
    </dialog>
  )
}
