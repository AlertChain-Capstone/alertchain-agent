import { useEffect, useRef, useState } from 'react'
import data from '../mock/fa1.json'
import MonitoredEventsEditor from './MonitoredEventsEditor'
import AlertsList from './AlertsList'
import AlertDetail from './AlertDetail'
import SecuritySources from './SecuritySources'
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
  const [selectedAlertId, setSelectedAlertId] = useState(null)
  const restoreAlertFocus = useRef(false)
  const recoveryTimers = useRef(new Map())
  const [sourceDemo, setSourceDemo] = useState({
    scenario: 'healthy', states: {}, pending: [], announcement: '',
  })

  useEffect(() => {
    const timers = recoveryTimers.current
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [])

  function changeSourceScenario(scenario, label) {
    recoveryTimers.current.forEach((timer) => clearTimeout(timer))
    recoveryTimers.current.clear()
    setMessage('')
    setSourceDemo({
      scenario,
      states: Object.fromEntries(data.sources.map((source) => [source.id, scenario])),
      pending: [],
      announcement: `Demo scenario: ${label}. Applied to both sources.`,
    })
  }

  function recoverSource(source, state) {
    if (recoveryTimers.current.has(source.id)) return
    setMessage('')
    setSourceDemo((current) => ({
      ...current,
      pending: [...current.pending, source.id],
      announcement: `${source.name}: ${state === 'unconfigured' ? 'configuring' : 'retrying'} in this demo…`,
    }))
    const timer = setTimeout(() => {
      recoveryTimers.current.delete(source.id)
      setSourceDemo((current) => {
        const states = { ...current.states, [source.id]: 'healthy' }
        return {
          ...current,
          states,
          scenario: Object.values(states).every((value) => value === 'healthy') ? 'healthy' : current.scenario,
          pending: current.pending.filter((id) => id !== source.id),
          announcement: `${source.name}: simulated ${state === 'unconfigured' ? 'configuration' : 'retry'} succeeded. Source is Healthy. No AWS request was made.`,
        }
      })
    }, 800)
    recoveryTimers.current.set(source.id, timer)
  }

  useEffect(() => {
    if (view === 'alerts' && restoreAlertFocus.current) {
      const target = document.getElementById(`open-${selectedAlertId}`) ?? document.getElementById('alerts-heading')
      target?.focus()
      restoreAlertFocus.current = false
    }
  }, [view, selectedAlertId])

  function openAlert(id) {
    setSelectedAlertId(id)
    setView('detail')
  }

  function backToAlerts() {
    restoreAlertFocus.current = true
    setView('alerts')
  }

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
      {view === 'detail' ? (
        <AlertDetail
          key={selectedAlertId}
          alert={data.alerts.find((alert) => alert.id === selectedAlertId)}
          onBack={backToAlerts}
        />
      ) : (
        <>
          <p className="fa1-breadcrumb">Alerts & Sources / {view === 'sources' ? 'Sources' : 'Alerts'}</p>

          <h1 id={view === 'alerts' ? 'alerts-heading' : undefined} tabIndex={-1}>{view === 'sources' ? 'Security signal sources' : 'Alerts'}</h1>

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
              onOpenAlert={openAlert}
            />
          ) : (
            <>
              <SecuritySources
                sources={data.sources}
                alerts={data.alerts}
                demo={sourceDemo}
                onScenarioChange={changeSourceScenario}
                onRecover={recoverSource}
                onTestConnection={testConnection}
                onViewRecent={openAlerts}
              />

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
