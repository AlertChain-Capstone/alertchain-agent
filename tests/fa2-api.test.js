import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInvestigationsApi, fromApiInvestigation, isMockMode, pendingApiInvestigation, POLL_INTERVAL_MS } from '../src/fa2/api.js'

const RUNNING = {
  investigationId: 'INV-abc', alertId: 'A-1', status: 'RUNNING', statusReason: null,
  steps: [], evidence: [], conclusion: null,
}
const COMPLETED = {
  investigationId: 'INV-abc', alertId: 'A-1', status: 'COMPLETED', statusReason: null,
  steps: [
    { stepNo: 1, thought: 'Start with the alert.', toolName: 'get_related_events', toolInput: { alert_id: 'A-1' },
      toolOutput: { evidence_id: 'INV-abc-ev-1', summary: 'Alert A-1 and 2 related events', data: { related_events: [] } },
      timestamp: '2026-11-01T10:10:00Z' },
    { stepNo: 2, thought: '', toolName: 'delete_user', toolInput: { user: 'alice.dev' },
      toolOutput: { error: "unknown tool 'delete_user'" }, timestamp: '2026-11-01T10:10:01Z' },
    { stepNo: 3, thought: 'Evidence is consistent.', toolName: null, toolInput: null, toolOutput: null,
      timestamp: '2026-11-01T10:10:02Z' },
  ],
  evidence: [{ id: 'INV-abc-ev-1', source: 'get_related_events', summary: 'Alert A-1 and 2 related events', raw: {} }],
  conclusion: {
    summary: 'Likely credential compromise.', severity: 'HIGH', confidence: 'HIGH',
    attackChain: [{ description: 'Initial access', evidenceIds: ['INV-abc-ev-1'] }], evidenceIds: ['INV-abc-ev-1'],
  },
}

// Fake fetch: answers each call from a script and records requests.
function fakeFetch(script) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init })
    const next = script.shift()
    if (next instanceof Error) throw next
    return { ok: next.status < 400, status: next.status, json: async () => next.body }
  }
  return { fetchImpl, calls }
}

const noWait = async () => {}

test('mock mode when VITE_USE_MOCK=true or no API URL is configured', () => {
  assert.equal(isMockMode({ VITE_USE_MOCK: 'true', VITE_API_BASE_URL: 'https://api.example' }), true)
  assert.equal(isMockMode({}), true)
  assert.equal(isMockMode({ VITE_API_BASE_URL: 'https://api.example' }), false)
  assert.equal(isMockMode({ VITE_USE_MOCK: 'false', VITE_API_BASE_URL: 'https://api.example' }), false)
})

test('start POSTs the alert and returns the investigation id', async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 202, body: { investigationId: 'INV-abc' } }])
  const api = createInvestigationsApi({ baseUrl: 'https://api.example/', fetchImpl, wait: noWait })

  assert.equal(await api.start('A-1'), 'INV-abc')
  assert.equal(calls[0].url, 'https://api.example/investigations')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].body), { alertId: 'A-1' })
})

test('start surfaces the API error detail', async () => {
  const { fetchImpl } = fakeFetch([{ status: 404, body: { detail: 'alert A-9 not found' } }])
  const api = createInvestigationsApi({ baseUrl: '', fetchImpl, wait: noWait })

  await assert.rejects(api.start('A-9'), { name: 'ApiError', status: 404, message: 'alert A-9 not found' })
})

test('poll GETs every 2 s until the status is no longer RUNNING', async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 200, body: RUNNING }, { status: 200, body: RUNNING }, { status: 200, body: COMPLETED },
  ])
  const waits = []
  const api = createInvestigationsApi({ baseUrl: '', fetchImpl, wait: async (ms) => { waits.push(ms) } })
  const seen = []

  const final = await api.poll('INV-abc', { onUpdate: (inv) => seen.push(inv.status) })

  assert.equal(final.status, 'COMPLETED')
  assert.deepEqual(seen, ['RUNNING', 'RUNNING', 'COMPLETED'])
  assert.deepEqual(waits, [POLL_INTERVAL_MS, POLL_INTERVAL_MS])
  assert.equal(POLL_INTERVAL_MS, 2000)
  assert.equal(calls[0].url, '/investigations/INV-abc')
})

test('poll stops on NEEDS_HUMAN_REVIEW and FAILED too', async () => {
  for (const status of ['NEEDS_HUMAN_REVIEW', 'FAILED']) {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { ...RUNNING, status, statusReason: 'x' } }])
    const api = createInvestigationsApi({ baseUrl: '', fetchImpl, wait: noWait })
    assert.equal((await api.poll('INV-abc')).status, status)
    assert.equal(calls.length, 1)
  }
})

test('poll retries transient errors but gives up after 3 in a row', async () => {
  const flaky = fakeFetch([new TypeError('network'), { status: 503, body: {} }, { status: 200, body: COMPLETED }])
  const api = createInvestigationsApi({ baseUrl: '', fetchImpl: flaky.fetchImpl, wait: noWait })
  assert.equal((await api.poll('INV-abc')).status, 'COMPLETED')

  const down = fakeFetch([new TypeError('network'), new TypeError('network'), new TypeError('network')])
  const api2 = createInvestigationsApi({ baseUrl: '', fetchImpl: down.fetchImpl, wait: noWait })
  await assert.rejects(api2.poll('INV-abc'), TypeError)
  assert.equal(down.calls.length, 3)
})

test('poll stops at once on 404 and when aborted', async () => {
  const missing = fakeFetch([{ status: 404, body: { detail: 'not found' } }])
  const api = createInvestigationsApi({ baseUrl: '', fetchImpl: missing.fetchImpl, wait: noWait })
  await assert.rejects(api.poll('INV-x'), { status: 404 })
  assert.equal(missing.calls.length, 1)

  const controller = new AbortController()
  const running = fakeFetch([{ status: 200, body: RUNNING }])
  const api2 = createInvestigationsApi({ baseUrl: '', fetchImpl: running.fetchImpl })
  const polling = api2.poll('INV-abc', { signal: controller.signal })
  controller.abort()
  await assert.rejects(polling, { name: 'AbortError' })
})

test('API investigations map onto the FA2 screen model', () => {
  const inv = fromApiInvestigation(COMPLETED, { ticks: { NS1: 'done' }, startedAt: '2026-11-01T10:09:59Z' })

  assert.equal(inv.source, 'api')
  assert.equal(inv.status, 'done')
  assert.deepEqual(inv.ticks, { NS1: 'done' })
  assert.equal(inv.startedAt, '2026-11-01T10:09:59Z')
  assert.equal(inv.finishedAt, '2026-11-01T10:10:02Z')
  assert.deepEqual(inv.trace.map((s) => s.n), [1, 2, 3])
  assert.equal(inv.trace[0].decision, 'Find events related to alert A-1')
  assert.equal(inv.trace[0].why, 'Start with the alert.')
  assert.deepEqual(inv.trace[0].evidence, ['INV-abc-ev-1'])
  assert.equal(inv.trace[1].failed, true)
  assert.match(inv.trace[1].result, /unknown tool 'delete_user'/)
  assert.deepEqual(inv.trace[1].evidence, [])
  assert.equal(inv.maxSteps, 6)
  assert.equal(inv.trace[2].decision, 'Write the verdict')
  assert.equal(inv.trace[2].why, 'Evidence is consistent.')
  const noThinking = { ...COMPLETED, steps: [{ ...COMPLETED.steps[2], thought: '{"summary": "x"}' }] }
  assert.equal(fromApiInvestigation(noThinking).trace[0].why, 'Summarise the evidence into a verdict.')
  assert.equal(inv.trace[2].result, 'Likely credential compromise.')
  assert.deepEqual(inv.evidence, [{ id: 'INV-abc-ev-1', alertId: null, text: 'Alert A-1 and 2 related events', source: 'get_related_events' }])
  assert.deepEqual(inv.chain.nodes, [])
})

test('all four API statuses map to screen states', () => {
  const statusOf = (status) => fromApiInvestigation({ ...RUNNING, status, statusReason: 'r' }).status
  assert.deepEqual(['RUNNING', 'COMPLETED', 'NEEDS_HUMAN_REVIEW', 'FAILED'].map(statusOf), ['running', 'done', 'review', 'failed'])

  const review = fromApiInvestigation({ ...RUNNING, status: 'NEEDS_HUMAN_REVIEW', statusReason: 'step limit of 6 reached', finishedAt: null })
  assert.equal(review.statusReason, 'step limit of 6 reached')
  assert.equal(pendingApiInvestigation('INV-new', 'A-1', '2026-11-01T10:00:00Z').status, 'running')
})
