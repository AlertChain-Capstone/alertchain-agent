import { useEffect, useRef, useState } from 'react'
import { advance, alertById, config, formatTime, initialInvestigations, isBelowThreshold, newInvestigation } from './fa2Data'
import StartInvestigation from './StartInvestigation'
import InvestigationHeader from './InvestigationHeader'
import InvestigationOverview from './InvestigationOverview'
import ReasoningTrace from './ReasoningTrace'
import AttackChain from './AttackChain'
import './fa2.css'

const STEP_DELAY = 1500
const SAVE_DELAY = 800

export default function Fa2App() {
  const [investigations, setInvestigations] = useState(initialInvestigations)
  const [view, setView] = useState({ name: 'home' })
  const [startScenario, setStartScenario] = useState('normal')
  const [closeoutScenario, setCloseoutScenario] = useState('normal')
  const [message, setMessage] = useState('')
  const headingRef = useRef(null)
  const saveTimer = useRef(null)
  const openIdRef = useRef(null)

  const current = view.name === 'investigation' ? investigations.find((inv) => inv.id === view.id) : null
  const anyRunning = investigations.some((inv) => inv.status === 'running')

  // Simulated agent: running investigations gain one reasoning step at a time.
  useEffect(() => {
    if (!anyRunning) return undefined
    const timer = setInterval(() => {
      // INV-003 waits until it is opened, so the "already running" demo stays reproducible.
      setInvestigations((list) => list.map((inv) => (inv.holdUntilOpened && inv.id !== openIdRef.current ? inv : advance(inv))))
    }, STEP_DELAY)
    return () => clearInterval(timer)
  }, [anyRunning])

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  useEffect(() => {
    openIdRef.current = view.name === 'investigation' ? view.id : null
    headingRef.current?.focus()
  }, [view.name, view.id, view.tab])

  function update(id, changes) {
    setInvestigations((list) => list.map((inv) => (inv.id === id ? { ...inv, ...(typeof changes === 'function' ? changes(inv) : changes) } : inv)))
  }

  function open(id, extra = {}) {
    setMessage('')
    update(id, (inv) => (inv.holdUntilOpened ? { holdUntilOpened: false } : {}))
    setView({ name: 'investigation', id, tab: 'overview', ...extra })
  }

  function startNew(alert) {
    const id = `INV-${String(investigations.length + 1).padStart(3, '0')}`
    setInvestigations((list) => [...list, newInvestigation(alert, id, startScenario)])
    open(id, { notice: { kind: 'started' } })
  }

  // Start an Alert Investigation – main flow and extensions 3a, 3b, 4a.
  function requestInvestigation(alert, { confirmedLowSeverity = false, reinvestigate = false } = {}) {
    const existing = [...investigations].reverse().find((inv) => inv.alertId === alert.id)
    if (!reinvestigate && existing) {
      if (existing.status === 'running' || existing.status === 'paused') return open(existing.id, { notice: { kind: 'alreadyRunning' } })
      if (existing.resolution) return open(existing.id, { notice: { kind: 'alreadyClosed' } })
      return open(existing.id, { notice: { kind: 'existing' } })
    }
    if (!confirmedLowSeverity && isBelowThreshold(alert)) return 'belowThreshold'
    startNew(alert)
    return 'started'
  }

  function retryBedrock(id) {
    update(id, { status: 'running', scenario: 'normal' })
  }

  function setTick(id, stepId, value, reason) {
    update(id, (inv) => {
      const ticks = { ...inv.ticks }
      const skipReasons = { ...inv.skipReasons }
      if (value) ticks[stepId] = value
      else delete ticks[stepId]
      if (value === 'skipped') skipReasons[stepId] = reason
      else delete skipReasons[stepId]
      return { ticks, skipReasons }
    })
  }

  // Resolve Alert with Next Steps – save with extensions 7a and 7b.
  function resolve(id, { type, note }) {
    update(id, { saving: true, saveError: false })
    clearTimeout(saveTimer.current)
    const scenario = closeoutScenario
    saveTimer.current = setTimeout(() => {
      update(id, (inv) => {
        const done = Object.keys(inv.ticks).filter((key) => inv.ticks[key] === 'done')
        if (scenario === 'saveFails' && !inv.retrying) {
          return { saving: false, saveError: true, pending: { type, note }, retrying: true }
        }
        if (scenario === 'otherAnalyst') {
          return {
            saving: false, saveError: false, retrying: false, pending: null, rejectedChoice: type,
            resolution: { type: 'True positive', by: config.otherAnalystName, at: '2026-10-17T15:52:00Z', note: 'Key disabled, trail re-enabled, DevOps notified.', done, skipped: {} },
          }
        }
        return {
          saving: false, saveError: false, retrying: false, pending: null, rejectedChoice: null,
          resolution: { type, by: config.analystName, at: config.referenceTime, note, done, skipped: inv.skipReasons },
        }
      })
    }, SAVE_DELAY)
  }

  function retrySave(id) {
    const inv = investigations.find((item) => item.id === id)
    if (inv?.pending) resolve(id, inv.pending)
  }

  const alert = current && alertById(current.alertId)

  return (
    <main className="fa1-page fa2-page" id="fa2-content" tabIndex={-1}>
      {view.name === 'home' || !current ? (
        <StartInvestigation
          headingRef={headingRef}
          investigations={investigations}
          scenario={startScenario}
          onScenarioChange={setStartScenario}
          onRequest={requestInvestigation}
          onOpen={(id) => open(id)}
        />
      ) : (
        <>
          <InvestigationHeader
            headingRef={headingRef}
            inv={current}
            alert={alert}
            tab={view.tab}
            notice={view.notice}
            onTab={(tab) => { setMessage(''); setView((v) => ({ ...v, tab, notice: undefined, filter: undefined, focusStep: undefined })) }}
            onHome={() => setView({ name: 'home' })}
            onRetryBedrock={() => retryBedrock(current.id)}
            onReinvestigate={() => requestInvestigation(alert, { reinvestigate: true, confirmedLowSeverity: true })}
            onViewFailedStep={(n) => setView((v) => ({ ...v, tab: 'trace', focusStep: n, notice: undefined }))}
            onRetrySave={() => retrySave(current.id)}
            startedLabel={formatTime(current.startedAt)}
          />
          {message && <div className="fa1-notice" role="status">{message}</div>}
          {view.tab === 'overview' && (
            <InvestigationOverview
              inv={current}
              closeoutScenario={closeoutScenario}
              onCloseoutScenarioChange={setCloseoutScenario}
              onTick={(stepId, value, reason) => setTick(current.id, stepId, value, reason)}
              onResolve={(payload) => resolve(current.id, payload)}
              onOpenTrace={(filter) => setView((v) => ({ ...v, tab: 'trace', filter, notice: undefined }))}
              onMessage={setMessage}
            />
          )}
          {view.tab === 'trace' && (
            <ReasoningTrace
              key={`${current.id}-${view.filter ?? ''}-${view.focusStep ?? ''}`}
              inv={current}
              filter={view.filter}
              focusStep={view.focusStep}
              onClearFilter={() => setView((v) => ({ ...v, filter: undefined }))}
            />
          )}
          {view.tab === 'chain' && (
            <AttackChain
              key={current.id}
              inv={current}
              onViewInTrace={(n) => setView((v) => ({ ...v, tab: 'trace', focusStep: n }))}
            />
          )}
        </>
      )}
    </main>
  )
}
