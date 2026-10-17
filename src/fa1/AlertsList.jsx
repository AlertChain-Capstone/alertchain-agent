import AlertBadge from './AlertBadge'

const DEMO_REFERENCE_TIME = '2026-10-17T16:00:00Z'
const PAGE_SIZE = 6
const timeRanges = [
  ['24', 'Last 24 hours'],
  ['1', 'Last hour'],
  ['168', 'Last 7 days'],
  ['all', 'All time'],
]
export default function AlertsList({ alerts, filters, setFilters, page, setPage, onOpenAlert, demoScenario, onDemoChange, onViewSources }) {
  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
    setPage(1)
  }

  function clearFilters() {
    setFilters({ search: '', severity: '', source: '', status: '', timeRange: '24' })
    setPage(1)
  }

  const referenceTime = Date.parse(DEMO_REFERENCE_TIME)
  const query = filters.search.trim().toLowerCase()
  const availableAlerts = demoScenario === 'empty' ? [] : alerts
  const filtered = availableAlerts.filter((alert) => {
    const occurredAt = Date.parse(alert.occurredAt)
    return (
      [alert.id, alert.eventName, alert.principal].some((value) => value.toLowerCase().includes(query)) &&
      (!filters.severity || alert.severity === filters.severity) &&
      (!filters.source || alert.source === filters.source) &&
      (!filters.status || alert.status === filters.status) &&
      occurredAt <= referenceTime &&
      (filters.timeRange === 'all' || occurredAt >= referenceTime - Number(filters.timeRange) * 3600000)
    )
  }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const offset = (currentPage - 1) * PAGE_SIZE
  const visibleAlerts = filtered.slice(offset, offset + PAGE_SIZE)
  const selectFilters = [
    ['severity', 'Severity', ['High', 'Medium', 'Low']],
    ['source', 'Source', [...new Set(alerts.map((alert) => alert.source))]],
    ['status', 'Status', [...new Set(alerts.map((alert) => alert.status))]],
  ]

  return (
    <section aria-label="Normalized alerts">
      <div className="fa1-scenario-controls fa1-alert-demo-controls">
        <div className="fa1-filter">
          <label htmlFor="alerts-demo-scenario">Alerts demo scenario</label>
          <select id="alerts-demo-scenario" value={demoScenario} aria-describedby="alerts-demo-status" onChange={(event) => onDemoChange(event.target.value)}>
            <option value="sample">Sample alerts</option>
            <option value="empty">No alerts available</option>
          </select>
        </div>
        <p id="alerts-demo-status" className="fa1-muted" role="status" aria-atomic="true">
          {demoScenario === 'empty' ? 'Demo: no alerts have been ingested yet.' : 'Showing fictional sample alerts.'}
        </p>
      </div>
      <div className="fa1-filters">
        <div className="fa1-filter fa1-search">
          <label htmlFor="alert-search">Search alerts</label>
          <input
            id="alert-search"
            type="search"
            placeholder="Search ID, event or principal…"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
          />
        </div>
        {selectFilters.map(([name, label, options]) => (
          <div className="fa1-filter" key={name}>
            <label htmlFor={`alert-${name}`}>{label}</label>
            <select id={`alert-${name}`} value={filters[name]} onChange={(event) => updateFilter(name, event.target.value)}>
              <option value="">All</option>
              {options.map((option) => <option key={option}>{option}</option>)}
            </select>
          </div>
        ))}
        <div className="fa1-filter">
          <label htmlFor="alert-time-range">Time range</label>
          <select id="alert-time-range" aria-describedby="alert-demo-time" value={filters.timeRange} onChange={(event) => updateFilter('timeRange', event.target.value)}>
            {timeRanges.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="button" onClick={clearFilters}>Clear filters</button>
      </div>
      <p id="alert-demo-time" className="fa1-muted">
        Demo reference time: <time dateTime={DEMO_REFERENCE_TIME}>2026-10-17 16:00:00 UTC</time>
      </p>

      {availableAlerts.length === 0 ? (
        <div className="fa1-card fa1-empty">
          <h2>No alerts available</h2>
          <p>No alerts have been ingested yet. View security sources to review their configuration and connection status.</p>
          <button type="button" onClick={onViewSources}>View security sources</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="fa1-card fa1-empty">
          <p role="status">No alerts match your filters</p>
          <button type="button" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <div className="fa1-table-wrapper fa1-alerts-table-wrapper" role="region" aria-label="Alerts table" tabIndex={0}>
          <table className="fa1-table fa1-alerts-table" aria-label="Normalized alerts">
            <thead>
              <tr>
                {['ID', 'Time (UTC)', 'Source', 'Event', 'Principal', 'Resource', 'Severity', 'Status'].map((heading) => (
                  <th key={heading} scope="col">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleAlerts.map((alert) => (
                <tr key={alert.id}>
                  <td><button type="button" className="fa1-alert-id" id={`open-${alert.id}`} onClick={() => onOpenAlert(alert.id)}>{alert.id}</button></td>
                  <td><time dateTime={alert.occurredAt}>{new Date(alert.occurredAt).toISOString().slice(0, 16).replace('T', ' ')}</time></td>
                  <td>{alert.source}</td>
                  <td>{alert.eventName === 'ConsoleLogin' ? 'ConsoleLogin (failed)' : alert.eventName}</td>
                  <td>{alert.principal}</td>
                  <td>{alert.resource}</td>
                  <td><AlertBadge kind="severity" value={alert.severity} /></td>
                  <td><AlertBadge kind="status" value={alert.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="fa1-pagination">
        <p className="fa1-muted" role="status">
          Showing {filtered.length ? offset + 1 : 0}–{Math.min(offset + PAGE_SIZE, filtered.length)} of {filtered.length} alerts
        </p>
        <nav className="fa1-actions" aria-label="Alerts pagination">
          <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span className="fa1-muted">Page {currentPage} of {pageCount}</span>
          <button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
        </nav>
      </div>
    </section>
  )
}
