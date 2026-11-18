import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import data from '../mock/fa3.json'
import Dashboard from './Dashboard.jsx'
import IncidentList from './IncidentList.jsx'
import IncidentReport from './IncidentReport.jsx'
import LiveIncidentReport from './LiveIncidentReport.jsx'
import LiveAsk from './LiveAsk.jsx'
import { incidentsApi } from './api.js'
import AskAgent from './AskAgent.jsx'
import { Notice, Unavailable } from './Ui.jsx'
import useApiRead from '../shared/useApiRead.js'
import './fa3.css'

const emptySession = { question: '', response: null, submittedQuestion: '' }

function IncidentScreen({ id, ask, session, setSession }) {
  const load = useCallback((signal) => incidentsApi.get(id, { signal }), [id])
  const read = useApiRead(id, load)
  if (read.status === 'loading') return <Notice title="Loading incident report…" />
  if (read.status === 'error') {
    if (read.error.status === 404) return <Unavailable id={id} />
    return <Notice title="The report could not be loaded" error>
      <p>{read.error.message}</p><button onClick={read.retry}>Retry report</button>{' '}
      <Link to="/incidents">Back to incidents</Link>
    </Notice>
  }
  if (!incidentsApi.mock) return ask
    ? <LiveAsk incident={read.data} session={session} setSession={setSession} />
    : <LiveIncidentReport incident={read.data} />
  if (ask) return <AskAgent incident={read.data} session={session} setSession={setSession} />
  return <IncidentReport incident={read.data} />
}

export default function Fa3App({ route, active }) {
  const [list, setList] = useState({ filters: { search: '', severity: '', status: '' }, page: 1, scenario: 'sample' })
  const [sessions, setSessions] = useState({})
  // Leave area state mounted but cancel pending screen requests when navigating away.
  if (!active) return null
  const id = route.params.id
  return (
    <main className="fa3-page" id="fa3-content" tabIndex={-1}>
      {route.view === 'dashboard' ? <Dashboard data={data} onFilter={(status) => setList({ filters: { search: '', severity: '', status }, page: 1, scenario: 'sample' })} />
        : route.view === 'list' ? <IncidentList state={list} setState={setList} />
        : <IncidentScreen key={id} id={id} ask={route.view === 'ask'} session={sessions[id] ?? emptySession}
            setSession={(next) => setSessions((current) => ({ ...current, [id]: next }))} />}
      <footer className="fa3-footer">AlertChain Agent · Read-only AWS investigation{incidentsApi.mock && ' · Inception prototype'}</footer>
    </main>
  )
}
