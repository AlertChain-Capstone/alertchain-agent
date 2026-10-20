import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Badge, DemoControl, Notice, PageHeading } from './Ui.jsx'
import { formatDate, selectIncidents } from './fa3Data.js'

const PAGE_SIZE = 4
const EMPTY_FILTERS = { search: '', severity: '', status: '' }

export default function IncidentList({ incidents, state, setState }) {
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const { filters, page, scenario } = state
  const results = selectIncidents(scenario === 'empty' ? [] : incidents, filters)
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const start = (currentPage - 1) * PAGE_SIZE
  function filter(name, value) { setState({ ...state, filters: { ...filters, [name]: value }, page: 1 }) }
  function refresh() {
    setLoading(true)
    timer.current = setTimeout(() => {
      setLoading(false)
      setState((current) => ({ ...current, scenario: current.scenario === 'error' ? 'sample' : current.scenario }))
    }, 650)
  }
  return (
    <>
      <PageHeading title="Incidents" eyebrow="INCIDENT PORTFOLIO"><p>Highest severity first, then newest incident time within each severity.</p></PageHeading>
      <DemoControl id="incident-list-scenario" label="Incident list demo scenario" value={scenario} onChange={(value) => {
        clearTimeout(timer.current); setLoading(false); setState({ ...state, scenario: value, page: 1 })
      }} options={[['sample', 'Sample incidents'], ['empty', 'No incidents available'], ['error', 'Incident load failed']]} />
      <div className="fa3-filters">
        <div className="fa3-filter"><label htmlFor="incident-search">Search incidents</label><input id="incident-search" type="search" placeholder="Incident ID or title" value={filters.search} onChange={(e) => filter('search', e.target.value)} /></div>
        <div className="fa3-filter"><label htmlFor="incident-severity">Severity</label><select id="incident-severity" value={filters.severity} onChange={(e) => filter('severity', e.target.value)}><option value="">All severities</option>{['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="fa3-filter"><label htmlFor="incident-status">Status</label><select id="incident-status" value={filters.status} onChange={(e) => filter('status', e.target.value)}><option value="">All statuses</option>{['Open', 'Needs human review', 'Closed'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <button onClick={() => setState({ ...state, filters: EMPTY_FILTERS, page: 1 })}>Clear filters</button>
      </div>
      {loading ? <Notice title="Loading incidents…"><p>Your filters are preserved.</p></Notice>
        : scenario === 'error' ? <Notice title="Incidents could not be loaded" error><p>This is a load failure, not an empty result. Your filters are preserved.</p><button onClick={refresh}>Retry</button></Notice>
        : scenario === 'empty' ? <Notice title="No incidents available"><p>There are no recorded incidents to review yet.</p><button onClick={refresh}>Refresh</button> <Link to="/">Back to dashboard</Link></Notice>
        : !results.length ? <Notice title="No matching incidents"><p>Change or clear the filters to broaden your search.</p><button onClick={() => setState({ ...state, filters: EMPTY_FILTERS, page: 1 })}>Clear filters</button></Notice>
        : <section className="fa3-card fa3-table-card" aria-label="Incident results">
          <div className="fa3-table-scroll" tabIndex={0} role="region" aria-label="Incident table">
            <table><thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Incident time (UTC)</th></tr></thead>
              <tbody>{results.slice(start, start + PAGE_SIZE).map((incident) => <tr key={incident.id}><td><Link to={`/incidents/${incident.id}`}><span className="fa3-mono">{incident.id}</span><strong>{incident.title}</strong></Link>{incident.demoOnly && <small>Additional FA3 demo fixture</small>}</td><td><Badge value={incident.severity} /></td><td><Badge value={incident.status} /></td><td><time dateTime={incident.occurredAt}>{formatDate(incident.occurredAt)}</time></td></tr>)}</tbody>
            </table>
          </div>
          <div className="fa3-pagination"><p role="status">Showing {start + 1}–{Math.min(start + PAGE_SIZE, results.length)} of {results.length} incidents</p><div><button disabled={currentPage === 1} onClick={() => setState({ ...state, page: currentPage - 1 })}>Previous</button><span>Page {currentPage} of {pages}</span><button disabled={currentPage === pages} onClick={() => setState({ ...state, page: currentPage + 1 })}>Next</button></div></div>
        </section>}
    </>
  )
}
