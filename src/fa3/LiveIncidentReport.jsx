import { Link } from 'react-router'
import { incidentTime } from './fa3Data.js'
import { Badge, PageHeading } from './Ui.jsx'
import StoredEvidence from './StoredEvidence.jsx'

export default function LiveIncidentReport({ incident }) {
  const id = incident.id
  const evidenceById = new Map(incident.evidence.map((item) => [item.id, item]))
  return <>
    <PageHeading title={incident.title} eyebrow={`INCIDENT REPORT · ${id}`}>
      <div className="fa3-meta"><Badge value={incident.severity} /><Badge value={incident.status} /><span>{incidentTime(incident)}</span></div>
    </PageHeading>
    <div className="fa3-actions">
      <Link to="/incidents">← Back to incidents</Link>
      <Link className="fa3-button fa3-primary" to={`/incidents/${encodeURIComponent(id)}/ask`}>Ask the Agent</Link>
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
          <StoredEvidence item={item} />
        </article>
      })}
    </section>
  </>
}
