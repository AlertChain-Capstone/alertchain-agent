import { useEffect, useRef, useState } from 'react'
import { alertById } from './fa2Data'

const LONG_TRACE = 20
const PREVIEW_LINES = 12

function longDemoTrace(trace) {
  const extra = Array.from({ length: 24 - trace.length }, (_, i) => ({
    n: trace.length + i + 1,
    decision: `Check related activity in window ${i + 1}`,
    why: 'The agent widens the search one hour at a time.',
    tool: 'AWS CloudTrail',
    query: `LookupEvents, window ${i + 1} hour(s) before the alert`,
    result: 'No new related events.',
    evidence: [],
  }))
  return [...trace, ...extra]
}

function bigResult(step) {
  return Array.from({ length: PREVIEW_LINES }, (_, i) =>
    `{"eventTime":"2026-10-17T14:${String(31 + i * 3).padStart(2, '0')}:0${i % 10}Z","eventName":"${['ListBuckets', 'GetCallerIdentity', 'DescribeTrails', 'StopLogging'][i % 4]}","sourceIPAddress":"203.0.113.45","userIdentity":{"accessKeyId":"DEMO-ACCESS-KEY-002"}}`
  ).join('\n') + `\n… ${step.tooLarge.lines - PREVIEW_LINES} more lines not shown`
}

export default function ReasoningTrace({ inv, filter, focusStep, onClearFilter }) {
  const [demo, setDemo] = useState('recorded')
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set(focusStep ? [focusStep] : []))
  const [linked, setLinked] = useState(null)
  const focusRef = useRef(null)

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' })
    focusRef.current?.focus()
  }, [])

  const all = demo === 'long' ? longDemoTrace(inv.trace) : inv.trace
  const matches = (step) => !filter || [step.query, step.result, step.decision].join(' ').includes(filter)
  const visible = all.filter(matches)
  const collapsed = !filter && !showAll && visible.length > LONG_TRACE
  const rows = collapsed ? [...visible.slice(0, 5), { gap: visible.length - 10 }, ...visible.slice(-5)] : visible

  function toggle(n) {
    setExpanded((set) => {
      const next = new Set(set)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  return (
    <div className="fa2-trace-layout">
      <section className="fa1-card" aria-labelledby="fa2-trace-title">
        <div className="fa1-card-heading fa2-spread">
          <h2 id="fa2-trace-title">Reasoning trace</h2>
          <div className="fa1-filter fa2-inline-demo">
            <label htmlFor="fa2-trace-demo">Trace demo scenario</label>
            <select id="fa2-trace-demo" value={demo} onChange={(e) => { setDemo(e.target.value); setShowAll(false) }}>
              <option value="recorded">As recorded</option>
              <option value="long">Very long trace (24 steps)</option>
            </select>
          </div>
        </div>
        <p className="fa1-muted">Steps in time order: what the agent decided to check and why, the tool it used, and what it found.</p>

        {inv.status !== 'done' && (
          <div className="fa2-banner fa2-banner-info" role="status">
            <p>{inv.status === 'paused' ? 'Investigation paused – new steps appear after Retry.' : 'Investigation still running – new steps appear here as the agent works.'}</p>
          </div>
        )}
        {filter && (
          <div className="fa2-banner fa2-banner-info" role="status">
            <p>Showing {visible.length} of {all.length} steps that mention <strong>{filter}</strong>.</p>
            <button type="button" onClick={onClearFilter}>Show all steps</button>
          </div>
        )}

        <ol className="fa2-trace">
          {rows.map((step) => step.gap ? (
            <li key="gap" className="fa2-trace-gap">
              <span>{step.gap} more steps hidden to keep the trace readable.</span>
              <button type="button" onClick={() => setShowAll(true)}>Show all {visible.length} steps</button>
            </li>
          ) : (
            <li
              key={step.n}
              className={`fa2-trace-step${step.failed ? ' fa2-trace-failed' : ''}`}
              ref={step.n === focusStep ? focusRef : undefined}
              tabIndex={step.n === focusStep ? -1 : undefined}
            >
              <span className="fa2-step-number" aria-hidden="true">{step.n}</span>
              <div className="fa2-step-body">
                <div className="fa2-step-head">
                  <strong>Step {step.n}: {step.decision}</strong>
                  {step.failed && <span className="fa1-badge fa1-badge-danger">Failed</span>}
                </div>
                <p className="fa1-muted">Why: {step.why} · Tool: {step.tool}</p>
                <p>{step.result}</p>
                <button type="button" className="fa2-link" aria-expanded={expanded.has(step.n)} onClick={() => toggle(step.n)}>
                  {expanded.has(step.n) ? 'Hide details' : 'Show query, raw result and evidence'}
                </button>
                {expanded.has(step.n) && <StepDetails step={step} onOpenLink={setLinked} />}
              </div>
            </li>
          ))}
          {inv.status === 'running' && (
            <li className="fa2-trace-step fa2-trace-pending" aria-live="polite">
              <span className="fa2-step-number" aria-hidden="true">{all.length + 1}</span>
              <div className="fa2-step-body"><strong>Working on the next step…</strong></div>
            </li>
          )}
        </ol>
      </section>

      {linked && <LinkedEvent link={linked} onClose={() => setLinked(null)} />}
    </div>
  )
}

function StepDetails({ step, onOpenLink }) {
  return (
    <div className="fa2-step-details">
      <h3 className="fa2-eyebrow">Query</h3>
      <pre className="fa1-raw-json">{step.query}</pre>
      <h3 className="fa2-eyebrow">Raw result</h3>
      {step.tooLarge ? (
        <>
          <p className="fa2-warning-text">The raw result is too large to show ({step.tooLarge.size}, {step.tooLarge.lines.toLocaleString('en-US')} lines). Showing the first {PREVIEW_LINES} lines; the full result is kept with the investigation.</p>
          <pre className="fa1-raw-json" tabIndex={0}>{bigResult(step)}</pre>
        </>
      ) : (
        <pre className="fa1-raw-json">{step.result}</pre>
      )}
      <p className="fa1-muted">
        Evidence produced: {step.evidence.length ? step.evidence.join(', ') : 'none'}
      </p>
      {step.links?.length > 0 && (
        <div className="fa2-step-actions">
          {step.links.map((link) => (
            <button key={link.label} type="button" className="fa2-link" onClick={() => onOpenLink(link)}>Open {link.label} ↗</button>
          ))}
        </div>
      )}
    </div>
  )
}

function LinkedEvent({ link, onClose }) {
  const alert = link.alertId ? alertById(link.alertId) : null
  const available = link.available && alert?.rawEvent != null
  return (
    <aside className="fa1-card fa2-drawer" aria-labelledby="fa2-linked-title">
      <p className="fa2-eyebrow">Linked event</p>
      <h2 id="fa2-linked-title">{available ? link.label : 'Event not available'}</h2>
      {available ? (
        <>
          <p className="fa1-muted">{alert.source} · {alert.id}</p>
          <pre className="fa1-raw-json" tabIndex={0}>{JSON.stringify(alert.rawEvent, null, 2)}</pre>
        </>
      ) : (
        <p className="fa2-warning-text">
          {link.label} is no longer available in CloudTrail (events are kept for 90 days). The evidence the agent recorded at this step is kept, but the original event cannot be opened.
        </p>
      )}
      <button type="button" onClick={onClose}>Close</button>
    </aside>
  )
}
