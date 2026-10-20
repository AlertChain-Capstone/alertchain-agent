import { Link } from 'react-router'
import { Badge, PageHeading } from './Ui.jsx'
import { formatDate, selectIncidents } from './fa3Data.js'

export default function Dashboard({ data, onFilter }) {
  const active = data.incidents.filter((incident) => incident.status !== 'Closed')
  const open = data.incidents.filter((incident) => incident.status === 'Open')
  const review = data.incidents.filter((incident) => incident.needsReview)
  const recent = selectIncidents(active, { search: '', severity: '', status: '' })
  return (
    <>
      <PageHeading title="Dashboard" eyebrow="SECURITY OVERVIEW">
        <p>Review security activity in your AWS sandbox account.</p>
      </PageHeading>
      <p className="fa3-snapshot">Sample snapshot · {formatDate(data.referenceTime)} · {data.region}</p>
      <div className="fa3-stat-grid">
        <Link className="fa3-stat" to="/incidents" onClick={() => onFilter('Open')}><span>Open incidents</span><strong>{open.length}</strong><small>Review open incidents →</small></Link>
        <Link className="fa3-stat" to="/incidents" onClick={() => onFilter('Needs human review')}><span>Needs human review</span><strong>{review.length}</strong><small>Check uncertain conclusions →</small></Link>
        <Link className="fa3-stat" to="/sources"><span>Healthy sources</span><strong>{data.sources.filter((source) => source.status === 'Connected').length}<em> / {data.sources.length}</em></strong><small>View source configuration →</small></Link>
      </div>
      <div className="fa3-dashboard-grid">
        <section className="fa3-card">
          <div className="fa3-section-heading"><h2>Incidents needing attention</h2><Link to="/incidents" onClick={() => onFilter('')}>View all incidents →</Link></div>
          {recent.map((incident) => (
            <article className="fa3-attention" key={incident.id}>
              <div><span className="fa3-mono">{incident.id}</span><Badge value={incident.severity} /></div>
              <h3><Link to={`/incidents/${incident.id}`}>{incident.title}</Link></h3>
              <p>{incident.status} · {formatDate(incident.occurredAt)}</p>
              <Link className="fa3-text-action" to={`/incidents/${incident.id}`}>Review incident →</Link>
            </article>
          ))}
        </section>
        <div className="fa3-stack">
          <section className="fa3-card"><h2>Source health</h2>
            {data.sources.map((source) => <div className="fa3-source" key={source.id}><strong>{source.name}</strong><span>● {source.status}</span><small>Last event {formatDate(source.lastEventAt)}</small></div>)}
            <p className="fa3-muted">Snapshot values; source recovery demos are independent.</p>
            <Link to="/sources">Manage sources →</Link>
          </section>
          <section className="fa3-card fa3-guidance"><p className="fa3-eyebrow">YOUR REVIEW WORKFLOW</p><h2>From alert to evidence</h2><p>Open an incident, read its report, then ask a follow-up question. Select a citation to inspect the recorded evidence.</p><p className="fa3-muted">Review and questions leave AWS resources unchanged.</p></section>
        </div>
      </div>
    </>
  )
}
