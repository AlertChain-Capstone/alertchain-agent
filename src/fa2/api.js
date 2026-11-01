// FA2 client for the investigations API (backend/api/investigations.py).
// Mock mode (the inception prototype's simulated agent) is used when VITE_USE_MOCK=true,
// or when no VITE_API_BASE_URL is configured, so local dev and e2e tests keep working.
const viteEnv = import.meta.env ?? {}

export const POLL_INTERVAL_MS = 2000
// Matches StepLimiter's DEFAULT_MAX_STEPS in backend/agent/step_limiter.py.
export const LIVE_MAX_STEPS = 6
const MAX_POLL_FAILURES = 3

export function isMockMode(env = viteEnv) {
  return env.VITE_USE_MOCK === 'true' || !env.VITE_API_BASE_URL
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function abortError() {
  return new DOMException('Polling stopped', 'AbortError')
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()) }, { once: true })
  })
}

export function createInvestigationsApi({
  baseUrl = viteEnv.VITE_API_BASE_URL ?? '',
  fetchImpl = (...args) => globalThis.fetch(...args),
  wait = sleep,
} = {}) {
  const root = baseUrl.replace(/\/+$/, '')

  async function request(path, { method = 'GET', body, signal } = {}) {
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
    if (!res.ok) {
      const detail = await res.json().then((data) => data?.detail, () => null)
      throw new ApiError(typeof detail === 'string' ? detail : `HTTP ${res.status}`, res.status)
    }
    return res.json()
  }

  async function start(alertId) {
    const { investigationId } = await request('/investigations', { method: 'POST', body: { alertId } })
    return investigationId
  }

  function get(id, { signal } = {}) {
    return request(`/investigations/${encodeURIComponent(id)}`, { signal })
  }

  // GET every intervalMs until the status is no longer RUNNING. Calls onUpdate with each
  // response and resolves with the last one. A 4xx stops at once; network or 5xx errors
  // are retried until MAX_POLL_FAILURES in a row.
  async function poll(id, { onUpdate = () => {}, signal, intervalMs = POLL_INTERVAL_MS } = {}) {
    let failures = 0
    for (;;) {
      try {
        const inv = await get(id, { signal })
        failures = 0
        onUpdate(inv)
        if (inv.status !== 'RUNNING') return inv
      } catch (err) {
        if (err.name === 'AbortError' || (err.status >= 400 && err.status < 500)) throw err
        failures += 1
        if (failures >= MAX_POLL_FAILURES) throw err
      }
      await wait(intervalMs, signal)
    }
  }

  return { start, get, poll }
}

const STATUS = { RUNNING: 'running', COMPLETED: 'done', NEEDS_HUMAN_REVIEW: 'review', FAILED: 'failed' }

const TOOL_DECISIONS = {
  get_related_events: (input) => `Find events related to alert ${input?.alert_id ?? ''}`.trim(),
  check_actor_baseline: (input) => `Check whether ${input?.actor ?? 'the actor'} normally does this`,
  create_incident: (input) => `Open an incident: ${input?.title ?? ''}`.trim(),
}

const MAX_THOUGHT = 300

function stepToTrace(step, apiInv) {
  const out = step.toolOutput
  const isFinal = !step.toolName
  // Without <thinking>, the final step's thought is the raw answer JSON; it is not a reason.
  const rawAnswer = isFinal && /^\s*(\{|```)/.test(step.thought ?? '')
  const thought = rawAnswer ? 'Summarise the evidence into a verdict.'
    : step.thought?.length > MAX_THOUGHT ? `${step.thought.slice(0, MAX_THOUGHT)}…` : step.thought
  let result
  if (out?.error) result = `Error: ${out.error}`
  else if (out?.summary) result = out.summary
  else if (isFinal) result = apiInv.conclusion?.summary ?? apiInv.statusReason ?? 'Final answer recorded.'
  else result = 'No result.'
  return {
    n: step.stepNo,
    decision: isFinal ? 'Write the verdict' : (TOOL_DECISIONS[step.toolName]?.(step.toolInput) ?? `Call ${step.toolName}`),
    why: thought || '—',
    tool: isFinal ? 'Amazon Bedrock' : step.toolName,
    query: isFinal ? 'final answer' : JSON.stringify(step.toolInput ?? {}),
    result,
    raw: out ? JSON.stringify(out.data ?? out, null, 2) : result,
    evidence: out?.evidence_id ? [out.evidence_id] : [],
    failed: Boolean(out?.error),
    at: step.timestamp,
  }
}

// Maps a GET /investigations/{id} response onto the investigation shape the FA2 screens
// render. `previous` keeps UI-only state (ticks, notices) across polls.
export function fromApiInvestigation(apiInv, previous = {}) {
  const trace = apiInv.steps.map((step) => stepToTrace(step, apiInv))
  const finished = apiInv.status !== 'RUNNING'
  return {
    ticks: {}, skipReasons: {}, nextSteps: [], incidentId: null,
    ...previous,
    source: 'api',
    maxSteps: LIVE_MAX_STEPS,
    id: apiInv.investigationId,
    alertId: apiInv.alertId,
    status: STATUS[apiInv.status] ?? 'failed',
    apiStatus: apiInv.status,
    statusReason: apiInv.statusReason,
    startedAt: previous.startedAt ?? trace[0]?.at ?? null,
    finishedAt: finished ? (trace.at(-1)?.at ?? null) : null,
    trace,
    evidence: apiInv.evidence.map((ev) => ({ id: ev.id, alertId: null, text: ev.summary, source: ev.source })),
    conclusion: apiInv.conclusion,
    chain: { window: '', nodes: [], edges: [] },
  }
}

// Placeholder shown between POST and the first GET.
export function pendingApiInvestigation(id, alertId, startedAt = new Date().toISOString()) {
  return fromApiInvestigation(
    { investigationId: id, alertId, status: 'RUNNING', statusReason: null, steps: [], evidence: [], conclusion: null },
    { startedAt },
  )
}
