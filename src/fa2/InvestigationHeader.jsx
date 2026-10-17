import { config, formatDateTime, needsReview } from './fa2Data'
import StatusChip from './StatusChip'

const TABS = [
  ['overview', 'Overview'],
  ['trace', 'Reasoning Trace'],
  ['chain', 'Attack Chain'],
]

function Banner({ tone, children, action }) {
  return (
    <div className={`fa2-banner fa2-banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <p>{children}</p>
      {action}
    </div>
  )
}

// Breadcrumb, banners, title, alert line and tabs shared by the three FA2 tabs.
export default function InvestigationHeader({
  headingRef, inv, alert, tab, notice, startedLabel,
  onTab, onHome, onRetryBedrock, onReinvestigate, onViewFailedStep, onRetrySave,
}) {
  const failedStep = inv.status === 'running' ? inv.trace.find((step) => step.failed) : null
  const title = tab === 'chain' ? `Attack chain · ${inv.incidentId ?? inv.id}` : `Investigation ${inv.id}`

  return (
    <>
      <p className="fa1-breadcrumb">
        <button type="button" className="fa2-crumb" onClick={onHome}>Investigations &amp; Incidents</button>
        {' / '}{inv.id}{tab === 'chain' ? ' / Attack chain' : ''}
      </p>

      <div className="fa2-banners">
        {notice?.kind === 'alreadyRunning' && (
          <Banner tone="info">An investigation for {alert.id} is already running ({inv.id}, started {startedLabel}). You were taken to it – a second one was not started.</Banner>
        )}
        {notice?.kind === 'alreadyClosed' && (
          <Banner tone="info" action={<button type="button" className="fa1-primary" onClick={onReinvestigate}>Re-investigate</button>}>
            {alert.id} was already investigated ({inv.id}) and closed as {inv.resolution.type}. Showing the existing result.
          </Banner>
        )}
        {notice?.kind === 'incident' && (
          <Banner tone="info">Incident report screens are part of FA3 and not built yet – showing the FA2 investigation behind {notice.incidentId}.</Banner>
        )}
        {notice?.kind === 'existing' && (
          <Banner tone="info">{alert.id} already has an investigation ({inv.id}). Showing it instead of starting a new one.</Banner>
        )}
        {inv.status === 'paused' && (
          <Banner tone="warning" action={<button type="button" className="fa1-primary" onClick={onRetryBedrock}>Retry</button>}>
            Paused – reasoning service (Amazon Bedrock) is unavailable. Steps done so far are saved.
          </Banner>
        )}
        {failedStep && (
          <Banner tone="danger" action={<button type="button" className="fa1-primary" onClick={() => onViewFailedStep(failedStep.n)}>View failed step</button>}>
            Step {failedStep.n} failed – {failedStep.tool} query was denied ({failedStep.result.split(' – ')[0]}). The failure is in the reasoning trace; the agent continues with other sources.
          </Banner>
        )}
        {tab !== 'chain' && needsReview(inv) && !inv.resolution && (
          <Banner tone="warning">
            Low confidence ({inv.confidence}%) – this alert cannot be closed automatically. Check the evidence, then choose a close-out option yourself.
          </Banner>
        )}
        {tab === 'chain' && inv.status !== 'done' && (
          <Banner tone="info">
            Investigation still running – showing the {inv.chain.nodes.length} {inv.chain.nodes.length === 1 ? 'event' : 'events'} linked so far. The graph updates as new events are linked.
          </Banner>
        )}
        {inv.saveError && (
          <Banner tone="danger" action={<button type="button" className="fa1-primary" onClick={onRetrySave} disabled={inv.saving}>{inv.saving ? 'Saving…' : 'Retry'}</button>}>
            Your resolution could not be saved (connection lost). Your choice, note and ticked steps are kept – try again.
          </Banner>
        )}
      </div>

      <div className="fa1-detail-title fa2-title">
        <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
        <StatusChip inv={inv} />
      </div>
      <p className="fa1-description">
        Alert {alert.id} · {alert.eventName} · principal {alert.principal} · {alert.resource} · Severity {alert.severity} · {formatDateTime(alert.occurredAt)}
      </p>
      <p className="fa1-demo">Inception prototype — fictional data and a simulated agent · max {config.maxSteps} reasoning steps</p>

      <nav className="fa2-tabs" aria-label="Investigation views">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" aria-current={tab === value ? 'page' : undefined} onClick={() => onTab(value)}>{label}</button>
        ))}
      </nav>
    </>
  )
}
