import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AlertApiClient, AlertApiError, apiUrl, buildAlertFilter, DEMO_REFERENCE_TIME, isMockMode, toUiAlert } from '../src/shared/api.js'

const liveEnv = { VITE_API_URL: 'https://api.example/stage/' }
const alert = { id: 'A:1', eventName: 'StopLogging', source: 'AWS CloudTrail', severity: 'CRITICAL',
  status: 'New', occurredAt: '2026-11-14T12:00:00.000000Z', principal: null, resource: null, region: 'us-east-2' }

function clientWith(script, env = liveEnv) {
  const calls = []
  const client = new AlertApiClient({ env, fetchImpl: async (url, init) => {
    calls.push({ url, ...init })
    const next = script.shift()
    if (next instanceof Error) throw next
    return { ok: next.status < 400, status: next.status, json: async () => next.body }
  } })
  return { client, calls }
}

test('FA1 config uses VITE_API_URL, supports the legacy alias, and preserves explicit/default mock mode', () => {
  assert.equal(apiUrl({ ...liveEnv, VITE_API_BASE_URL: 'https://old.example' }), 'https://api.example/stage')
  assert.equal(apiUrl({ VITE_API_BASE_URL: ' https://old.example/ ' }), 'https://old.example')
  assert.equal(isMockMode({}), true)
  assert.equal(isMockMode({ VITE_USE_MOCK: 'false' }), true)
  assert.equal(isMockMode({ VITE_API_URL: '  ' }), true)
  assert.equal(isMockMode(liveEnv), false)
  assert.equal(isMockMode({ ...liveEnv, VITE_USE_MOCK: 'true' }), true)
  assert.equal(new AlertApiClient({ now: () => 'live clock', env: liveEnv }).referenceTime(), 'live clock')
  assert.equal(new AlertApiClient({ env: {} }).referenceTime(), DEMO_REFERENCE_TIME)
})

test('filter conversion supplies combined filters and a frozen UTC window', () => {
  const filters = { search: ' alice ', severity: 'Critical', source: 'AWS CloudTrail', status: 'New', timeRange: '24' }
  const result = buildAlertFilter(filters, '2026-11-14T12:00:00Z')
  assert.deepEqual(result, { search: 'alice', severity: 'CRITICAL', source: 'AWS CloudTrail', status: 'New',
    from: '2026-11-13T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z' })
  assert.equal(Object.hasOwn(buildAlertFilter({ ...filters, timeRange: 'all' }, result.to), 'from'), false)
})

test('live list preserves totals/pages and maps Critical/nulls without filtering again', async () => {
  const { client, calls } = clientWith([{ status: 200, body: { alerts: [alert], totalAlerts: 7, page: 2, pageSize: 6 } }])
  const signal = new AbortController().signal
  const result = await client.listAlerts({ search: 'A:1 & user', severity: 'CRITICAL', source: 'AWS CloudTrail',
    status: 'New', from: '2026-11-14T00:00:00Z', to: '2026-11-15T00:00:00Z' }, 2, 6, { signal })
  const url = new URL(calls[0].url)
  assert.equal(url.pathname, '/stage/alerts')
  assert.deepEqual(Object.fromEntries(url.searchParams), { page: '2', pageSize: '6', search: 'A:1 & user',
    severity: 'CRITICAL', source: 'AWS CloudTrail', status: 'New', from: '2026-11-14T00:00:00Z', to: '2026-11-15T00:00:00Z' })
  assert.equal(calls[0].signal, signal)
  assert.equal(calls[0].method, 'GET')
  assert.equal(result.totalAlerts, 7)
  assert.equal(result.alerts[0].severity, 'Critical')
  assert.equal(result.alerts[0].principal, null)
  assert.equal(result.alerts[0].resource, null)
})

test('details and optional requests use distinct encoded routes and operation envelopes', async () => {
  const rawEvent = { number: 8.5, nested: [true, null] }
  const { client, calls } = clientWith([
    { status: 200, body: { ...alert, rawEvent: { unintended: true }, incidentId: 'ignore' } },
    { status: 200, body: { alertId: alert.id, rawEvent } },
    { status: 200, body: { alertId: alert.id, status: 'ambiguous', incidentId: null } },
  ])
  const details = await client.getAlertDetails(alert.id)
  assert.equal(Object.hasOwn(details, 'rawEvent'), false)
  assert.equal(Object.hasOwn(details, 'incidentId'), false)
  assert.deepEqual(await client.getRawEvent(alert.id), { alertId: alert.id, rawEvent })
  assert.deepEqual(await client.getAssociatedIncidentId(alert.id), { alertId: alert.id, status: 'ambiguous', incidentId: null })
  assert.deepEqual(calls.map((c) => c.url), [
    'https://api.example/stage/alerts/A%3A1', 'https://api.example/stage/alerts/A%3A1/raw-event',
    'https://api.example/stage/alerts/A%3A1/associated-incident',
  ])
})

for (const status of [400, 404, 503]) {
  test(`live HTTP ${status} is surfaced, never replaced with fixtures`, async () => {
    const { client, calls } = clientWith([{ status, body: { error: { code: 'TEST_ERROR', message: 'Specific failure' } } }])
    await assert.rejects(client.getAlertDetails('ALT-002'), { name: 'AlertApiError', status, code: 'TEST_ERROR', message: 'Specific failure' })
    assert.equal(calls.length, 1)
  })
}

test('network errors and non-JSON error bodies remain failures', async () => {
  const { client } = clientWith([new TypeError('network'), { status: 502, body: null }])
  await assert.rejects(client.listAlerts(), { code: 'REQUEST_FAILED', status: 0 })
  await assert.rejects(client.getRawEvent('ALT-002'), { code: 'HTTP_ERROR', status: 502 })
})

test('aborted requests stop before fetch and retain AbortError during fetch', async () => {
  const controller = new AbortController()
  controller.abort()
  const { client, calls } = clientWith([new DOMException('cancel', 'AbortError')])
  await assert.rejects(client.listAlerts({}, 1, 6, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls.length, 0)
  await assert.rejects(client.getAlertDetails('ALT-002'), { name: 'AbortError' })
})

test('unexpected identities, malformed pages/JSON and contradictory association states fail validation', async () => {
  const { client } = clientWith([
    { status: 200, body: { ...alert, id: 'OTHER' } },
    { status: 200, body: { alerts: [], totalAlerts: 7, page: 1, pageSize: 6 } },
    { status: 200, body: null },
    { status: 200, body: { alertId: alert.id, status: 'ambiguous', incidentId: 'INC-1' } },
    { status: 200, body: { alertId: 'OTHER', rawEvent: {} } },
  ])
  for (const operation of [() => client.getAlertDetails(alert.id), () => client.listAlerts(),
    () => client.getAlertDetails(alert.id), () => client.getAssociatedIncidentId(alert.id), () => client.getRawEvent(alert.id)]) {
    await assert.rejects(operation(), { code: 'INVALID_RESPONSE' })
  }
  assert.throws(() => toUiAlert({ ...alert, occurredAt: 'invalid' }), AlertApiError)
})

test('mock fixtures retain their fixed clock, totals, detail, null raw event, and explicit incident links', async () => {
  const { client, calls } = clientWith([], { VITE_USE_MOCK: 'true', ...liveEnv })
  const filter = buildAlertFilter({ search: '', severity: '', source: '', status: '', timeRange: '24' }, client.referenceTime())
  const first = await client.listAlerts(filter, 1, 6)
  assert.equal(first.totalAlerts, 8)
  assert.equal(first.alerts.length, 6)
  assert.equal((await client.listAlerts(filter, 2, 6)).alerts.length, 2)
  assert.equal((await client.listAlerts({ ...filter, search: 'ALT-002' })).alerts[0].id, 'ALT-002')
  assert.equal((await client.getAlertDetails('ALT-002')).eventName, 'StopLogging')
  assert.deepEqual(await client.getAssociatedIncidentId('ALT-002'), { alertId: 'ALT-002', status: 'associated', incidentId: 'INC-001' })
  assert.deepEqual(await client.getAssociatedIncidentId('ALT-001'), { alertId: 'ALT-001', status: 'none', incidentId: null })
  assert.equal((await client.getRawEvent('ALT-007')).rawEvent, null)
  const raw = await client.getRawEvent('ALT-002')
  raw.rawEvent.eventName = 'changed'
  assert.equal((await client.getRawEvent('ALT-002')).rawEvent.eventName, 'StopLogging')
  assert.equal((await client.listAlerts(filter, 1, 6, { demoScenario: 'empty' })).totalAlerts, 0)
  await assert.rejects(client.getRawEvent('MISSING'), { status: 404 })
  assert.equal(calls.length, 0)
})

test('mock paging sorts timestamp ties by descending ID and searches nullable principals safely', async () => {
  const client = new AlertApiClient({ env: {}, mockAlerts: [{ ...alert, id: 'A-1' }, { ...alert, id: 'A-2' }] })
  const page = await client.listAlerts({ search: 'stoplogging', severity: 'CRITICAL' }, 1, 1)
  assert.equal(page.totalAlerts, 2)
  assert.equal(page.alerts[0].id, 'A-2')
})
