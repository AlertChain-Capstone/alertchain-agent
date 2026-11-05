import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { advance, alertById, alertOrPlaceholder, config, formatTime, initialInvestigations, isBelowThreshold, newInvestigation } from './fa2Data'
import { createInvestigationsApi, fromApiInvestigation, isMockMode, pendingApiInvestigation } from './api'
import StartInvestigation, { BelowThresholdDialog } from './StartInvestigation'
import InvestigationHeader from './InvestigationHeader'
import InvestigationOverview from './InvestigationOverview'
import ReasoningTrace from './ReasoningTrace'
import AttackChain from './AttackChain'
import './fa2.css'

const STEP_DELAY = 1500
const SAVE_DELAY = 800
// Live mode talks to the investigations API; mock mode keeps the simulated agent.
const LIVE = !isMockMode()
const api = LIVE ? createInvestigationsApi() : null

// `ref` lets the FA1 Alert Detail buttons hand an alert or incident to FA2.
export default function Fa2App({ ref, route, active }) {
  const navigate = useNavigate()
  const [investigations, setInvestigations] = useState(LIVE ? [] : initialInvestigations)
  const chainInvestigation = route?.view === 'chain' ? investigations.find((inv) => inv.incidentId === route.params.id) : null
  const view = route && route.view !== 'home'
    ? { ...route.state, name: 'investigation', id: chainInvestigation?.id ?? route.params.id, tab: route.view === 'chain' ? 'chain' : (route.state?.tab ?? 'overview') }
    : { name: 'home' }

  function setView(next) {
    const value = typeof next === 'function' ? next(view) : next
    const inv = investigations.find((item) => item.id === value.id)
    const path = value.name === 'home' ? '/investigations'
      : value.tab === 'chain' && inv?.incidentId ? `/incidents/${inv.incidentId}/chain`
      : `/investigations/${value.id}`
    navigate(path, { state: value })
  }
  const [startScenario, setStartScenario] = useState('normal')
  const [closeoutScenario, setCloseoutScenario] = useState('normal')
  const [message, setMessage] = useState('')
  const [lowSeverityAlert, setLowSeverityAlert] = useState(null)
  const headingRef = useRef(null)
  const saveTimer = useRef(null)
  const openIdRef = useRef(null)
  const pollers = useRef(new Map())
  const followed = useRef(new Set())
  const [startingAlertId, setStartingAlertId] = useState(null)
  const [startError, setStartError] = useState('')
  const [loadingId, setLoadingId] = useState(null)

  const current = view.name === 'investigation' ? investigations.find((inv) => inv.id === view.id) : null
  const anyRunning = investigations.some((inv) => inv.status === 'running' && inv.source !== 'api')

  // Simulated agent: running investigations gain one reasoning step at a time.
  useEffect(() => {
    if (!anyRunning) return undefined
    const timer = setInterval(() => {
      // INV-003 waits until it is opened, so the "already running" demo stays reproducible.
      setInvestigations((list) => list.map((inv) => (inv.source === 'api' || (inv.holdUntilOpened && inv.id !== openIdRef.current) ? inv : advance(inv))))
    }, STEP_DELAY)
    return () => clearInterval(timer)
  }, [anyRunning])

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // Stop polling when FA2 unmounts. Forgetting the IDs lets a remount (React StrictMode
  // mounts twice in dev) start polling them again.
  useEffect(() => {
    const active = pollers.current
    const seen = followed.current
    return () => {
      active.forEach((controller) => controller.abort())
      active.clear()
      seen.clear()
    }
  }, [])

  // Live mode: an investigation opened by URL (e.g. after a refresh) is loaded from the API.
  const missingLiveId = LIVE && view.name === 'investigation' && route?.view === 'investigation' && !current ? view.id : null
  useEffect(() => {
    if (missingLiveId && !followed.current.has(missingLiveId)) {
      setLoadingId(missingLiveId)
      followLive(missingLiveId)
    }
    // followLive only reads refs and stable setters, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingLiveId])

  useEffect(() => {
    openIdRef.current = view.name === 'investigation' ? view.id : null
    if (active) headingRef.current?.focus()
  }, [view.name, view.id, view.tab, active])

  function update(id, changes) {
    setInvestigations((list) => list.map((inv) => (inv.id === id ? { ...inv, ...(typeof changes === 'function' ? changes(inv) : changes) } : inv)))
  }

  function open(id, extra = {}) {
    setMessage('')
    update(id, (inv) => (inv.holdUntilOpened ? { holdUntilOpened: false } : {}))
    setView({ name: 'investigation', id, tab: 'overview', ...extra })
  }

  // GET /investigations/{id} every 2 s until the run is no longer RUNNING.
  function followLive(id) {
    if (followed.current.has(id)) return
    followed.current.add(id)
    const controller = new AbortController()
    pollers.current.set(id, controller)
    api.poll(id, {
      signal: controller.signal,
      onUpdate: (apiInv) => setInvestigations((list) => (list.some((inv) => inv.id === id)
        ? list.map((inv) => (inv.id === id ? fromApiInvestigation(apiInv, inv) : inv))
        : [...list, fromApiInvestigation(apiInv)])),
    }).catch((err) => {
      if (err.name === 'AbortError' || err.status === 404) return
      update(id, { status: 'failed', statusReason: `lost contact with the investigations API (${err.message}); refresh to check again` })
    }).finally(() => {
      if (controller.signal.aborted) return
      if (pollers.current.get(id) === controller) pollers.current.delete(id)
      setLoadingId((value) => (value === id ? null : value))
    })
  }

  async function startLive(alert) {
    setStartError('')
    setStartingAlertId(alert.id)
    try {
      const id = await api.start(alert.id)
      setInvestigations((list) => [...list, pendingApiInvestigation(id, alert.id)])
      open(id, { tab: 'trace', notice: { kind: 'started' } })
      followLive(id)
    } catch (err) {
      setStartError(`Could not start an investigation for ${alert.id}: ${err.message}`)
    } finally {
      setStartingAlertId(null)
    }
  }

  function startNew(alert) {
    if (LIVE) return startLive(alert)
    const id = `INV-${String(investigations.length + 1).padStart(3, '0')}`
    setInvestigations((list) => [...list, newInvestigation(alert, id, startScenario)])
    open(id, { notice: { kind: 'started' } })
  }

  // Start an Alert Investigation – main flow and extensions 3a, 3b, 4a.
  function requestInvestigation(alert, { confirmedLowSeverity = false, reinvestigate = false } = {}) {
    const existing = [...investigations].reverse().find((inv) => inv.alertId === alert.id)
    // A live run that failed can simply be started again.
    if (!reinvestigate && existing && !(existing.source === 'api' && existing.status === 'failed')) {
      if (existing.status === 'running' || existing.status === 'paused') return open(existing.id, { notice: { kind: 'alreadyRunning' } })
      if (existing.resolution) return open(existing.id, { notice: { kind: 'alreadyClosed' } })
      return open(existing.id, { notice: { kind: 'existing' } })
    }
    if (!confirmedLowSeverity && isBelowThreshold(alert)) return 'belowThreshold'
    startNew(alert)
    return 'started'
  }

  function investigate(alert) {
    if (requestInvestigation(alert) === 'belowThreshold') {
      setView({ name: 'home' })
      setLowSeverityAlert(alert)
    }
  }

  // Handoffs from FA1: "Investigate" and "Open incident" on the Alert Detail page.
  useImperativeHandle(ref, () => ({
    investigateAlert(alertId) {
      const alert = alertById(alertId)
      if (alert) investigate(alert)
    },
    openIncident(incidentId) {
      const inv = investigations.find((item) => item.incidentId === incidentId)
      if (inv) open(inv.id, { notice: { kind: 'incident', incidentId } })
      else setView({ name: 'home' })
    },
  }))

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

  const alert = current && alertOrPlaceholder(current.alertId)

  return (
    <main className="fa1-page fa2-page" id="fa2-content" tabIndex={-1}>
      {view.name !== 'home' && !current && loadingId === view.id ? (
        <section role="status">
          <h1>Loading investigation {view.id}…</h1>
        </section>
      ) : view.name !== 'home' && (!current || (route?.view === 'chain' && !chainInvestigation)) ? (
        <section>
          <h1>Investigation unavailable</h1>
          <p>No investigation is recorded for this address.</p>
          <Link to="/investigations">Back to investigations</Link>
        </section>
      ) : view.name === 'home' ? (
        <StartInvestigation
          headingRef={headingRef}
          investigations={investigations}
          scenario={startScenario}
          onScenarioChange={setStartScenario}
          onInvestigate={investigate}
          onOpen={(id) => open(id)}
          live={LIVE}
          startingAlertId={startingAlertId}
          startError={startError}
        />
      ) : (
        <>
          {current.incidentId && <Link to={`/incidents/${current.incidentId}`} className="fa2-report-link">Open incident report {current.incidentId}</Link>}
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
      {active && lowSeverityAlert && (
        <BelowThresholdDialog
          alert={lowSeverityAlert}
          onCancel={() => setLowSeverityAlert(null)}
          onConfirm={() => {
            const alert = lowSeverityAlert
            setLowSeverityAlert(null)
            requestInvestigation(alert, { confirmedLowSeverity: true })
          }}
        />
      )}
    </main>
  )
}
