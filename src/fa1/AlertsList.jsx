import { useCallback, useEffect, useMemo } from 'react'
import AlertBadge from './AlertBadge'
import { alertApi, buildAlertFilter, DEMO_REFERENCE_TIME } from '../shared/api'
import useAlertRead from './useAlertRead'

const PAGE_SIZE = 6
const timeRanges = [
  ['24', 'Last 24 hours'],
  ['1', 'Last hour'],
  ['168', 'Last 7 days'],
  ['all', 'All time'],
]
export default function AlertsList({ filters, setFilters, page, setPage, onOpenAlert, onReady, demoScenario, onDemoChange, onViewSources, client = alertApi }) {
  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
    setPage(1)
  }

  function clearFilters() {
    setFilters({ search: '', severity: '', source: '', status: '', timeRange: '24' })
    setPage(1)
  }

  const filter = useMemo(() => buildAlertFilter(filters, filters.referenceTime), [filters])
  const load = useCallback((signal) => client.listAlerts(filter, page, PAGE_SIZE, { signal, demoScenario }),
    [client, filter, page, demoScenario])
  const read = useAlertRead(JSON.stringify([filter, page, demoScenario]), load)
  useEffect(() => {
    if (read.status === 'ready') onReady?.()
  }, [read.status, onReady])
  const visibleAlerts = read.data?.alerts ?? []
  const total = read.data?.totalAlerts ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const displayedPage = client.mock ? Math.min(page, pageCount) : page
  const pageUnavailable = !client.mock && page > pageCount
  const offset = (page - 1) * PAGE_SIZE
  const filtered = Boolean(filters.search.trim() || filters.severity || filters.source || filters.status || filters.timeRange !== 'all')
  const demoEmpty = client.mock && demoScenario === 'empty'
  const selectFilters = [
    ['severity', 'Severity', ['Critical', 'High', 'Medium', 'Low']],
    ['source', 'Source', ['Amazon GuardDuty', 'AWS CloudTrail']],
    ['status', 'Status', ['New', 'Under investigation', 'Closed · Benign', 'Closed · False positive', 'Resolved']],
  ]

  return (
    <section aria-label="Normalized alerts">
      {client.mock && <div className="fa1-scenario-controls fa1-alert-demo-controls">
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
      </div>}
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
          <select id="alert-time-range" aria-describedby={client.mock ? 'alert-demo-time' : undefined} value={filters.timeRange} onChange={(event) => updateFilter('timeRange', event.target.value)}>
            {timeRanges.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="button" onClick={clearFilters}>Clear filters</button>
      </div>
      {client.mock && <p id="alert-demo-time" className="fa1-muted">
        Demo reference time: <time dateTime={DEMO_REFERENCE_TIME}>2026-10-17 16:00:00 UTC</time>
      </p>}

      {read.status === 'loading' ? (
        <p role="status">Loading alerts…</p>
      ) : read.status === 'error' ? (
        <div className="fa1-card fa1-empty" role="alert">
          <h2>Alerts could not be loaded</h2>
          <p>Check your connection and try again. Your filters and page are preserved.</p>
          <button type="button" onClick={read.retry}>Retry alerts</button>
        </div>
      ) : pageUnavailable || (total > 0 && visibleAlerts.length === 0) ? (
        <div className="fa1-card fa1-empty">
          <p role="status">This page is no longer available.</p>
          <button type="button" onClick={() => setPage(1)}>Return to first page</button>
        </div>
      ) : total === 0 && (demoEmpty || !filtered) ? (
        <div className="fa1-card fa1-empty">
          <h2>No alerts available</h2>
          <p>No alerts have been ingested yet. View security sources to review their configuration and connection status.</p>
          <button type="button" onClick={onViewSources}>View security sources</button>
        </div>
      ) : total === 0 ? (
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
                  <td>{alert.principal ?? 'Not available'}</td>
                  <td>{alert.resource ?? 'Not available'}</td>
                  <td><AlertBadge kind="severity" value={alert.severity} /></td>
                  <td><AlertBadge kind="status" value={alert.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {read.status === 'ready' && <div className="fa1-pagination">
        <p className="fa1-muted" role="status">
          Showing {visibleAlerts.length ? offset + 1 : 0}–{visibleAlerts.length ? offset + visibleAlerts.length : 0} of {total} alerts
        </p>
        <nav className="fa1-actions" aria-label="Alerts pagination">
          <button disabled={displayedPage === 1} onClick={() => setPage(displayedPage - 1)}>Previous</button>
          <span className="fa1-muted">{pageUnavailable ? `Page ${page} unavailable` : `Page ${displayedPage} of ${pageCount}`}</span>
          <button disabled={displayedPage >= pageCount} onClick={() => setPage(displayedPage + 1)}>Next</button>
        </nav>
      </div>}
    </section>
  )
}
