import { useState } from 'react'
import { config, formatDateTime, formatTime, needsReview } from './fa2Data'
import { CloseAsDialog, EscalateDialog } from './CloseOutDialogs'

const CLOSEOUT_SCENARIOS = {
  normal: 'Saves normally',
  otherAnalyst: 'Another analyst resolves it first',
  saveFails: 'Save fails once (Retry works)',
}

export default function InvestigationOverview({ inv, closeoutScenario, onCloseoutScenarioChange, onTick, onResolve, onOpenTrace, onMessage }) {
  const [dialog, setDialog] = useState(null)
  const done = inv.status === 'done'

  return (
    <div className="fa2-columns">
      <div className="fa2-stack">
        <section className="fa1-card" aria-labelledby="fa2-progress-title">
          <h2 id="fa2-progress-title">Progress</h2>
          <dl className="fa1-stats fa2-stats">
            <div><dt>Steps</dt><dd>{inv.trace.length} / {config.maxSteps}</dd></div>
            <div><dt>Evidence</dt><dd>{inv.evidence.length} {inv.evidence.length === 1 ? 'item' : 'items'}</dd></div>
            <div><dt>Started</dt><dd>{formatTime(inv.startedAt)}</dd></div>
            <div><dt>Finished</dt><dd>{done ? formatTime(inv.finishedAt) : '—'}</dd></div>
          </dl>
        </section>
        <section className="fa1-card" aria-labelledby="fa2-evidence-title">
          <h2 id="fa2-evidence-title">Evidence gathered</h2>
          {inv.evidence.length === 0 ? (
            <p className="fa1-muted">No evidence yet.</p>
          ) : (
            <ul className="fa2-evidence">
              {inv.evidence.map((ev) => (
                <li key={ev.id}>
                  <span className="fa1-badge fa1-badge-neutral">{ev.id}</span>
                  <span>{ev.text}</span>
                  <span className="fa1-muted">{ev.source}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="fa1-card fa2-verdict" aria-labelledby="fa2-verdict-title">
        {!done ? (
          <>
            <h2 id="fa2-verdict-title">Verdict &amp; next steps</h2>
            <p className="fa2-dialog-text">No verdict yet. The verdict and recommended next steps appear here when the investigation finishes.</p>
          </>
        ) : (
          <>
            <h2 id="fa2-verdict-title" className="fa2-eyebrow">Verdict</h2>
            <div className="fa2-verdict-row">
              <span className={`fa1-badge fa1-badge-${needsReview(inv) ? 'warning' : inv.verdict === 'Likely malicious' ? 'danger' : inv.verdict === 'Likely benign' ? 'success' : 'warning'}`}>
                {needsReview(inv) ? 'Needs human review' : inv.verdict}
              </span>
              <strong>Confidence {inv.confidence}%</strong>
            </div>
            <div className="fa2-confidence" role="img" aria-label={`Confidence ${inv.confidence} percent`}>
              <span style={{ width: `${inv.confidence}%` }} />
            </div>
            <p className="fa2-summary">{inv.summary}</p>
            <NextSteps inv={inv} onTick={onTick} onOpenTrace={onOpenTrace} onMessage={onMessage} />
            <CloseOut inv={inv} onChoose={setDialog} scenario={closeoutScenario} onScenarioChange={onCloseoutScenarioChange} />
            <p className="fa2-incident">
              {inv.incidentId ? (
                <>
                  <span>Incident {inv.incidentId}</span>{' '}
                  <button type="button" className="fa2-link" disabled aria-describedby="fa2-report-note">View report →</button>
                  <span id="fa2-report-note" className="fa1-muted"> Incident report unavailable — awaiting FA3 team integration.</span>
                </>
              ) : (
                <span className="fa1-muted">No incident created for this alert.</span>
              )}
            </p>
          </>
        )}
      </section>

      {dialog === 'escalate' && (
        <EscalateDialog
          openSteps={inv.nextSteps.map((step, i) => ({ ...step, number: i + 1 })).filter((step) => !inv.ticks[step.id])}
          onCancel={() => setDialog(null)}
          onSubmit={(note) => { setDialog(null); onResolve({ type: 'True positive', note }) }}
        />
      )}
      {(dialog === 'Benign' || dialog === 'False positive') && (
        <CloseAsDialog
          initialType={dialog}
          onCancel={() => setDialog(null)}
          onSubmit={(type, note) => { setDialog(null); onResolve({ type, note }) }}
        />
      )}
    </div>
  )
}

function NextSteps({ inv, onTick, onOpenTrace, onMessage }) {
  const [skipping, setSkipping] = useState(null)
  const [reason, setReason] = useState('')
  const closed = Boolean(inv.resolution)
  const doneCount = inv.nextSteps.filter((s) => inv.ticks[s.id] === 'done').length
  const skippedCount = inv.nextSteps.filter((s) => inv.ticks[s.id] === 'skipped').length

  async function runAction(step) {
    if (step.action.kind === 'trace') return onOpenTrace(step.action.filter)
    try {
      await navigator.clipboard.writeText(step.action.value)
      onMessage(`${step.action.label.replace('Copy ', '')} copied to clipboard. AlertChain is read-only – run it yourself, then tick the step.`)
    } catch {
      onMessage(`Could not copy. Copy it manually: ${step.action.value}`)
    }
  }

  return (
    <>
      <h3 className="fa2-subheading">Recommended next steps</h3>
      <ol className="fa2-checklist">
        {inv.nextSteps.map((step, i) => {
          const state = inv.ticks[step.id]
          const inputId = `fa2-ns-${step.id}`
          return (
            <li key={step.id} className={state === 'skipped' ? 'fa2-skipped' : undefined}>
              <input
                id={inputId}
                type="checkbox"
                checked={state === 'done'}
                disabled={closed || state === 'skipped'}
                onChange={(e) => onTick(step.id, e.target.checked ? 'done' : null)}
              />
              <div>
                <label htmlFor={inputId}>{i + 1}. {step.text}</label>
                {state === 'skipped' ? (
                  <p className="fa2-skip-reason">
                    Skipped – {inv.skipReasons[step.id]}{' '}
                    {!closed && <button type="button" className="fa2-link" onClick={() => onTick(step.id, null)}>Undo</button>}
                  </p>
                ) : (
                  <div className="fa2-step-actions">
                    <button type="button" className="fa2-link" onClick={() => runAction(step)}>{step.action.label} ↗</button>
                    {!closed && state !== 'done' && skipping !== step.id && (
                      <button type="button" className="fa2-link fa2-link-muted" onClick={() => { setSkipping(step.id); setReason('') }}>Can't do this step</button>
                    )}
                  </div>
                )}
                {skipping === step.id && (
                  <form className="fa2-skip-form" onSubmit={(e) => { e.preventDefault(); onTick(step.id, 'skipped', reason.trim()); setSkipping(null) }}>
                    <label htmlFor={`${inputId}-reason`}>Why can't it be done? (required)</label>
                    <input id={`${inputId}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No permission for iam:UpdateAccessKey; asked Cloud Admin" />
                    <div className="fa1-actions">
                      <button type="submit" disabled={!reason.trim()}>Mark skipped</button>
                      <button type="button" onClick={() => setSkipping(null)}>Cancel</button>
                    </div>
                  </form>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="fa1-muted fa2-checklist-note">
        {doneCount || skippedCount
          ? `${doneCount} of ${inv.nextSteps.length} done${skippedCount ? ` · ${skippedCount} skipped with a reason` : ''}. Skipped steps and reasons are saved with the resolution.`
          : 'Agent is read-only: you carry out these steps; tick each one when done.'}
      </p>
    </>
  )
}

function CloseOut({ inv, onChoose, scenario, onScenarioChange }) {
  const r = inv.resolution
  if (r) {
    const mine = r.by === config.analystName
    return (
      <>
        <h3 className="fa2-subheading">Close out this alert</h3>
        <div className={`fa2-resolution ${mine ? '' : 'fa2-resolution-other'}`} role="status">
          <strong>
            {mine ? `Closed as ${r.type}` : `Already closed as ${r.type}`}
            {r.type === 'True positive' ? ' – escalated' : ''} by {r.by} at {formatTime(r.at)}
          </strong>
          {!mine && inv.rejectedChoice && <span>Your choice ({inv.rejectedChoice}) was not saved – another analyst resolved it first.</span>}
          {r.note ? <span>Note: “{r.note}”</span> : <span>No note was added.</span>}
          <span className="fa1-muted">Saved {formatDateTime(r.at)} with {r.done.length} completed next {r.done.length === 1 ? 'step' : 'steps'}{Object.keys(r.skipped ?? {}).length ? ` and ${Object.keys(r.skipped).length} skipped` : ''}.</span>
        </div>
      </>
    )
  }
  return (
    <>
      <h3 className="fa2-subheading">Close out this alert</h3>
      <p className="fa1-muted fa2-checklist-note">Pick one when you are done. Your name, the time and your note are saved on the alert.</p>
      <div className="fa1-actions">
        <button type="button" className="fa1-primary" disabled={inv.saving} onClick={() => onChoose('escalate')}>{inv.saving ? 'Saving…' : 'True positive – escalate'}</button>
      </div>
      <div className="fa1-actions fa2-actions-row">
        <button type="button" disabled={inv.saving} onClick={() => onChoose('Benign')}>Benign</button>
        <button type="button" disabled={inv.saving} onClick={() => onChoose('False positive')}>False positive</button>
      </div>
      <div className="fa1-filter fa2-inline-demo">
        <label htmlFor="fa2-closeout-scenario">Close-out demo scenario</label>
        <select id="fa2-closeout-scenario" value={scenario} onChange={(e) => onScenarioChange(e.target.value)}>
          {Object.entries(CLOSEOUT_SCENARIOS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </>
  )
}
