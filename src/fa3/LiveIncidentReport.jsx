import { Link } from 'react-router'
import { incidentTime } from './fa3Data.js'
import { Badge, Notice, PageHeading } from './Ui.jsx'

export default function LiveIncidentReport({ incident, ask }) {
  const id = incident.id
  if (ask) return <>
    <PageHeading title="Ask the Agent" eyebrow={`INCIDENT QUESTION · ${id}`}><p>{incident.title}</p></PageHeading>
    <Notice title="Live incident questions are unavailable">
      <Link to={`/incidents/${encodeURIComponent(id)}`}>Return to report</Link>
    </Notice>
  </>
  const evidenceById = new Map(incident.evidence.map((item) => [item.id, item]))
  return <>
    <PageHeading title={incident.title} eyebrow={`INCIDENT REPORT · ${id}`}>
      <div className="fa3-meta"><Badge value={incident.severity} /><Badge value={incident.status} /><span>{incidentTime(incident)}</span></div>
    </PageHeading>
    <div className="fa3-actions">
      <Link to="/incidents">← Back to incidents</Link>
      {incident.investigationId && <Link className="fa3-button" to={`/investigations/${encodeURIComponent(incident.investigationId)}`}>View investigation {incident.investigationId}</Link>}
      {incident.alertId && <Link className="fa3-button" to={`/alerts/${encodeURIComponent(incident.alertId)}`}>View alert {incident.alertId}</Link>}
    </div>
    <section className="fa3-card"><h2>What happened</h2><p className="fa3-report-summary">{incident.summary || 'No summary was recorded.'}</p></section>
    <section className="fa3-card fa3-recorded-evidence">
      <h2>Cited evidence</h2>
      {incident.evidenceIds.length === 0 && <p>No evidence was cited in this incident.</p>}
      {incident.evidenceIds.map((citation) => {
        const item = evidenceById.get(citation)
        if (!item) return <p key={citation}>{citation} · Evidence unavailable</p>
        return <article key={citation}>
          <h3>{item.id} · {item.source}</h3>
          <p>{item.summary}</p>
          {item.raw != null && <details>
            <summary>Inspect stored evidence {item.id}</summary>
            <pre tabIndex={0} aria-label={`Stored evidence ${item.id}`}>{JSON.stringify(item.raw, null, 2)}</pre>
          </details>}
        </article>
      })}
    </section>
  </>
}
