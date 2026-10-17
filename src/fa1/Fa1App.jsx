import { useState } from 'react'
import data from '../mock/fa1.json'
import MonitoredEventsEditor from './MonitoredEventsEditor'
import AlertsList from './AlertsList'
import './fa1.css'

const eventDetails = {
  CreateAccessKey: ['IAM', 'New long-lived credentials'],
  StopLogging: ['CloudTrail', 'Turns off audit logging'],
  DeleteTrail: ['CloudTrail', 'Removes audit trail'],
  AttachUserPolicy: ['IAM', 'Privilege escalation'],
  PutBucketPolicy: ['S3', 'Can make data public'],
  ConsoleLogin: ['Sign-in', 'Failed sign-ins may indicate password guessing'],
}

export default function Fa1App() {
  const [message, setMessage] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [monitoredEvents, setMonitoredEvents] = useState(data.monitoredEvents)
  const [view, setView] = useState('sources')
  const [alertFilters, setAlertFilters] = useState({
    search: '', severity: '', source: '', status: '', timeRange: '24',
  })
  const [alertPage, setAlertPage] = useState(1)

  function openAlerts(source) {
    if (source) {
      setAlertFilters({ search: '', severity: '', source, status: '', timeRange: '24' })
      setAlertPage(1)
    }
    setView('alerts')
  }

  function testConnection(source) {
    setMessage(
      `${source.name}: simulated connection test passed. No AWS request was made.`
    )
  }

  function saveMonitoredEvents(events) {
    setMonitoredEvents(events)
    setEditorOpen(false)
    setMessage(
      'Monitored events updated for this demo session. Refreshing resets the sample configuration.'
    )
  }

  return (
    <main className="fa1-page" id="fa1-content" tabIndex={-1}>
      <nav className="fa1-nav" aria-label="Alerts and sources">
        <button aria-current={view === 'sources' ? 'page' : undefined} onClick={() => setView('sources')}>
          Sources
        </button>
        <button aria-current={view === 'alerts' ? 'page' : undefined} onClick={() => openAlerts()}>
          Alerts
        </button>
      </nav>
      <p className="fa1-breadcrumb">Alerts & Sources / {view === 'sources' ? 'Sources' : 'Alerts'}</p>

      <h1>{view === 'sources' ? 'Security signal sources' : 'Alerts'}</h1>

      <p className="fa1-description">
        {view === 'sources'
          ? `AWS sandbox account ${data.accountId} · region ${data.region}`
          : 'Normalized from GuardDuty findings and monitored CloudTrail events'}
      </p>

      <p className="fa1-demo">
        Inception prototype — fictional data and simulated connections
      </p>

      {message && (
        <div className="fa1-notice" role="status">
          {message}
        </div>
      )}

      {view === 'alerts' ? (
        <AlertsList
          alerts={data.alerts}
          filters={alertFilters}
          setFilters={setAlertFilters}
          page={alertPage}
          setPage={setAlertPage}
        />
      ) : (
        <>
          <div className="fa1-source-grid">
            {data.sources.map((source) => (
              <section className="fa1-card" key={source.id}>
                <div className="fa1-card-heading">
                  <h2>{source.name}</h2>
                  <span className="fa1-status">{source.status}</span>
                </div>

                <dl className="fa1-stats">
                  <div>
                    <dt>Last event received</dt>
                    <dd>
                      {new Date(source.lastEventAt).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC',
                      })} UTC
                    </dd>
                  </div>

                  <div>
                    <dt>Sample normalized alerts</dt>
                    <dd>
                      {data.alerts.filter(
                        (alert) => alert.source === source.name
                      ).length}
                    </dd>
                  </div>
                </dl>

                <div className="fa1-actions">
                  <button onClick={() => testConnection(source)}>
                    Test connection
                  </button>

                  <button onClick={() => openAlerts(source.name)}>
                    View recent events
                  </button>
                </div>
              </section>
            ))}
          </div>

          <section className="fa1-card">
            <div className="fa1-card-heading">
              <h2>Monitored CloudTrail events</h2>
              <span className="fa1-muted">
                {monitoredEvents.length} events · only these create alerts
              </span>
            </div>

            <div className="fa1-table-wrapper">
              <table className="fa1-table">
                <thead>
                  <tr>
                    <th>Event name</th>
                    <th>Service</th>
                    <th>Why we watch it</th>
                  </tr>
                </thead>

                <tbody>
                  {monitoredEvents.map((eventName) => (
                    <tr key={eventName}>
                      <td>
                        {eventName === 'ConsoleLogin'
                          ? 'ConsoleLogin (failed)'
                          : eventName}
                      </td>
                      <td>{eventDetails[eventName]?.[0] ?? 'Other'}</td>
                      <td>{eventDetails[eventName]?.[1] ?? 'Monitored activity'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              className="fa1-primary"
              onClick={() => setEditorOpen(true)}
            >
              Edit monitored events
            </button>
          </section>
        </>
      )}

      {editorOpen && (
        <MonitoredEventsEditor
          selected={monitoredEvents}
          options={Object.keys(eventDetails)}
          onClose={() => setEditorOpen(false)}
          onSave={saveMonitoredEvents}
        />
      )}
    </main>
  )
}
