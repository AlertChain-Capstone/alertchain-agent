import { useCallback } from 'react'
import { Link } from 'react-router'
import { Badge, DemoControl, Notice, PageHeading } from './Ui.jsx'
import { incidentTime } from './fa3Data.js'
import { incidentsApi } from './api.js'
import useApiRead from '../shared/useApiRead.js'

const PAGE_SIZE = 4
const EMPTY_FILTERS = { search: '', severity: '', status: '' }

export default function IncidentList({ state, setState }) {
  const { filters, page, scenario } = state
  const load = useCallback((signal) => incidentsApi.list(filters, page, PAGE_SIZE, { signal, scenario }), [filters, page, scenario])
  const read = useApiRead(JSON.stringify([filters, page, scenario]), load)
  const total = read.data?.totalIncidents ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE
  const filtered = Boolean(filters.search.trim() || filters.severity || filters.status)
  function filter(name, value) { setState({ ...state, filters: { ...filters, [name]: value }, page: 1 }) }
  function refresh() {
    if (incidentsApi.mock && scenario === 'error') setState({ ...state, scenario: 'sample' })
    else read.retry()
  }
  return (
    <>
      <PageHeading title="Incidents" eyebrow="INCIDENT PORTFOLIO"><p>Highest severity first, then newest recorded time within each severity.</p></PageHeading>
      {incidentsApi.mock && <DemoControl id="incident-list-scenario" label="Incident list demo scenario" value={scenario} onChange={(value) => setState({ ...state, scenario: value, page: 1 })}
        options={[['sample', 'Sample incidents'], ['empty', 'No incidents available'], ['error', 'Incident load failed']]} />}
      <div className="fa3-filters">
        <div className="fa3-filter"><label htmlFor="incident-search">Search incidents</label><input id="incident-search" type="search" placeholder="Incident ID or title" value={filters.search} onChange={(e) => filter('search', e.target.value)} /></div>
        <div className="fa3-filter"><label htmlFor="incident-severity">Severity</label><select id="incident-severity" value={filters.severity} onChange={(e) => filter('severity', e.target.value)}><option value="">All severities</option>{['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="fa3-filter"><label htmlFor="incident-status">Status</label><select id="incident-status" value={filters.status} onChange={(e) => filter('status', e.target.value)}><option value="">All statuses</option>{['Open', 'Needs human review', 'Closed'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <button onClick={() => setState({ ...state, filters: EMPTY_FILTERS, page: 1 })}>Clear filters</button>
      </div>
      {read.status === 'loading' ? <Notice title="Loading incidents…" />
        : read.status === 'error' ? <Notice title="Incidents could not be loaded" error><p>{read.error.message}</p><button onClick={refresh}>Retry</button></Notice>
        : page > pages ? <Notice title="This page is no longer available"><button onClick={() => setState({ ...state, page: 1 })}>Return to first page</button></Notice>
        : !total && (!filtered || scenario === 'empty') ? <Notice title="No incidents available"><p>There are no recorded incidents to review yet.</p><button onClick={refresh}>Refresh</button> <Link to="/">Back to dashboard</Link></Notice>
        : !total ? <Notice title="No matching incidents"><p>Change or clear the filters to broaden your search.</p><button onClick={() => setState({ ...state, filters: EMPTY_FILTERS, page: 1 })}>Clear filters</button></Notice>
        : <section className="fa3-card fa3-table-card" aria-label="Incident results">
          <div className="fa3-table-scroll" tabIndex={0} role="region" aria-label="Incident table">
            <table><thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Recorded time (UTC)</th></tr></thead>
              <tbody>{read.data.incidents.map((incident) => <tr key={incident.id}><td><Link to={`/incidents/${encodeURIComponent(incident.id)}`}><span className="fa3-mono">{incident.id}</span><strong>{incident.title}</strong></Link>{incident.demoOnly && <small>Additional FA3 demo fixture</small>}</td><td><Badge value={incident.severity} /></td><td><Badge value={incident.status} /></td><td>{incidentTime(incident)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="fa3-pagination"><p role="status">Showing {start + 1}–{start + read.data.incidents.length} of {total} incidents</p><div><button disabled={page === 1} onClick={() => setState({ ...state, page: page - 1 })}>Previous</button><span>Page {page} of {pages}</span><button disabled={page === pages} onClick={() => setState({ ...state, page: page + 1 })}>Next</button></div></div>
        </section>}
    </>
  )
}
