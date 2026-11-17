import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createIncidentsApi } from '../src/fa3/api.js'

const env = { VITE_API_URL: 'https://example.test/stage/' }
const filters = { search: '', severity: '', status: '' }
const row = { id: 'INC:9', title: 'Archived incident', severity: 'High', status: 'Open', occurredAt: null }
const report = { ...row, summary: null, evidenceIds: ['found', 'missing'],
  evidence: [{ id: 'found', incidentId: row.id, source: 'get_related_events', summary: 'Two events', raw: {} }] }
const ok = (body) => new Response(JSON.stringify(body))

test('incident list delegates filtering and pagination and accepts legacy timestamps', async () => {
  const signal = new AbortController().signal
  const api = createIncidentsApi({ env, fetchImpl: async (url, options) => {
    const parsed = new URL(url)
    assert.equal(parsed.pathname, '/stage/incidents')
    assert.deepEqual(Object.fromEntries(parsed.searchParams), { page: '2', pageSize: '4', search: 'a & b', severity: 'High', status: 'Open' })
    assert.equal(options.signal, signal)
    return ok({ incidents: [row], totalIncidents: 5, page: 2, pageSize: 4 })
  } })
  assert.deepEqual((await api.list({ search: ' a & b ', severity: 'High', status: 'Open' }, 2, 4, { signal })).incidents, [row])
})

test('detail encodes the incident ID and retains unresolved citations and a missing summary', async () => {
  const api = createIncidentsApi({ env, fetchImpl: async (url) => {
    assert.equal(url, 'https://example.test/stage/incidents/INC%3A9')
    return ok(report)
  } })
  assert.deepEqual(await api.get(row.id), report)
})

test('malformed pages, mismatched records, foreign evidence and network failures never fall back to fixtures', async () => {
  const replies = [
    ok({ incidents: [], totalIncidents: 5, page: 1, pageSize: 4 }),
    ok({ ...report, id: 'wrong' }),
    ok({ ...report, evidence: [{ ...report.evidence[0], incidentId: 'wrong' }] }),
    new Response(JSON.stringify({ error: { message: 'Incident not found.' } }), { status: 404 }),
  ]
  const api = createIncidentsApi({ env, fetchImpl: async () => {
    if (!replies.length) throw new TypeError('Offline')
    return replies.shift()
  } })
  await assert.rejects(api.list(filters, 1, 4), /invalid response/)
  await assert.rejects(api.get(row.id), /invalid response/)
  await assert.rejects(api.get(row.id), /invalid response/)
  await assert.rejects(api.get(row.id), { status: 404 })
  await assert.rejects(api.get('INC-001'), /Offline/)
})

test('explicit mock mode reads the portfolio and incident without an API call', async () => {
  const api = createIncidentsApi({ env: { ...env, VITE_USE_MOCK: 'true' }, fetchImpl: assert.fail })
  const page = await api.list({ ...filters, search: 'INC-001' }, 1, 4)
  assert.deepEqual(page.incidents.map((item) => item.id), ['INC-001'])
  assert.equal((await api.get('INC-001')).evidence[0].id, 'E1')
  await assert.rejects(api.get('missing'), { status: 404 })
})
