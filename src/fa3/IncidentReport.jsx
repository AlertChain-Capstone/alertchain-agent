import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Badge, DemoControl, Notice, PageHeading, Unavailable } from './Ui.jsx'
import { formatDate } from './fa3Data.js'
import EvidenceDialog from './EvidenceDialog.jsx'

export default function IncidentReport({ incident }) {
  const [scenario, setScenario] = useState('normal')
  const [loading, setLoading] = useState(false)
  const [citation, setCitation] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const generating = scenario === 'generating' || incident.reportState === 'generating'
  const review = scenario === 'review' || incident.needsReview
  const chain = scenario === 'limited' ? null : incident.chain
  function refresh() {
    setLoading(true)
    timer.current = setTimeout(() => {
      setLoading(false)
      // A real generating fixture stays generating; a simulated load error recovers.
      setScenario((value) => value === 'error' ? 'normal' : value)
    }, 650)
  }
  return (
    <>
      <DemoControl id="report-scenario" label="Incident report demo scenario" value={scenario} onChange={(value) => {
        clearTimeout(timer.current); setLoading(false); setScenario(value)
      }} options={[['normal', 'Recorded report state'], ['generating', 'Report generating'], ['error', 'Report load failed'], ['review', 'Needs human review'], ['limited', 'No supported attack chain'], ['unavailable', 'Incident unavailable']]} />
      {scenario === 'unavailable' ? <Unavailable id={incident.id} /> : <>
        <PageHeading title={incident.title} eyebrow={`INCIDENT REPORT · ${incident.id}`}>
          <div className="fa3-meta"><Badge value={incident.severity} /><Badge value={incident.status} /><span>{formatDate(incident.occurredAt)}</span></div>
        </PageHeading>
        <div className="fa3-actions"><Link to="/incidents">← Back to incidents</Link><Link className="fa3-button fa3-primary" to={`/incidents/${incident.id}/ask`}>Ask the Agent</Link>{incident.investigationId && <Link className="fa3-button" to={`/investigations/${incident.investigationId}`}>View investigation</Link>}</div>
        {incident.demoOnly && <p className="fa3-muted">Additional FA3 demonstration record. It is not a shared FA2 investigation.</p>}
        {loading ? <Notice title="Loading incident report…" />
          : scenario === 'error' ? <Notice title="The report could not be loaded" error><p>Incident metadata is available. Retry to load the stored report.</p><button onClick={refresh}>Retry report</button></Notice>
          : generating ? <Notice title="Report generating"><p>The investigation has not produced a completed report. Available incident metadata is shown above.</p><button onClick={refresh}>Refresh report</button><p className="fa3-muted">This fixture stays generating until a completed report is available.</p></Notice>
          : <>
            {review && <Notice title="Needs human review"><p>{incident.reviewReason ?? 'Some evidence is incomplete. Treat conclusions as tentative.'}</p></Notice>}
            <section className="fa3-card"><p className="fa3-eyebrow">RECORDED FINDINGS</p><h2>What happened</h2><p className="fa3-report-summary">{incident.summary}</p><div className="fa3-citations">{incident.evidence.map((item) => <button key={item.id} onClick={() => setCitation(item.id)}>{item.id} · {item.eventName.split('/')[0]}</button>)}</div></section>
            <div className="fa3-report-grid">
              <section className="fa3-card"><h2>Recorded timeline</h2>{incident.evidence.length ? <ol className="fa3-timeline">{incident.evidence.map((item) => <li key={item.id}><time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time><strong>{item.eventName}</strong><span>{item.principal ?? 'Principal not recorded'}</span><button className="fa3-text-action" onClick={() => setCitation(item.id)}>Inspect {item.id} · {item.alertId}</button></li>)}</ol> : <p>No stored event evidence is available.</p>}</section>
              <div className="fa3-stack"><section className="fa3-card"><h2>Attack-chain explanation</h2><p>{chain ?? 'No supported attack chain is currently available. Review the available event evidence without assuming a chain.'}</p>{chain && incident.investigationId && <Link to={`/incidents/${incident.id}/chain`}>Open attack-chain graph →</Link>}</section><section className="fa3-card fa3-guidance"><h2>Evidence limitations</h2><p>{incident.limitations}</p></section></div>
            </div>
          </>}
      </>}
      {citation && <EvidenceDialog incident={incident} citation={citation} onClose={() => setCitation(null)} />}
    </>
  )
}
