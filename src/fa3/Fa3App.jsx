import { useState } from 'react'
import data from '../mock/fa3.json'
import Dashboard from './Dashboard.jsx'
import IncidentList from './IncidentList.jsx'
import IncidentReport from './IncidentReport.jsx'
import AskAgent from './AskAgent.jsx'
import { Unavailable } from './Ui.jsx'
import './fa3.css'

const emptySession = { question: '', response: null, submittedQuestion: '' }

export default function Fa3App({ route, active }) {
  const [list, setList] = useState({ filters: { search: '', severity: '', status: '' }, page: 1, scenario: 'sample' })
  const [sessions, setSessions] = useState({})
  const incident = data.incidents.find((item) => item.id === route?.params.id)
  // Leave area state mounted but cancel pending screen requests when navigating away.
  if (!active) return null
  return (
    <main className="fa3-page" id="fa3-content" tabIndex={-1}>
      {route.view === 'dashboard' ? <Dashboard data={data} onFilter={(status) => setList({ filters: { search: '', severity: '', status }, page: 1, scenario: 'sample' })} />
        : route.view === 'list' ? <IncidentList incidents={data.incidents} state={list} setState={setList} />
        : !incident ? <Unavailable id={route.params.id} />
        : route.view === 'report' ? <IncidentReport key={incident.id} incident={incident} />
        : <AskAgent key={incident.id} incident={incident} session={sessions[incident.id] ?? emptySession} setSession={(next) => setSessions((current) => ({ ...current, [incident.id]: next }))} />}
      <footer className="fa3-footer">AlertChain Agent · Read-only AWS investigation · Inception prototype</footer>
    </main>
  )
}
