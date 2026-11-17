import fixtures from '../mock/fa3.json' with { type: 'json' }
import { apiUrl, isMockMode } from '../shared/api.js'
import { ApiError, requestJson } from '../shared/http.js'
import { selectIncidents } from './fa3Data.js'

function invalidResponse() {
  return new Error('The incident service returned an invalid response.')
}

function checkRow(row) {
  const validDate = (value) => value == null || Number.isFinite(Date.parse(value))
  if (!row || typeof row.id !== 'string' || !row.id || typeof row.title !== 'string'
    || typeof row.status !== 'string' || typeof row.severity !== 'string'
    || !validDate(row.occurredAt) || !validDate(row.createdAt)) throw invalidResponse()
}

export function createIncidentsApi({ env, fetchImpl } = {}) {
  const base = apiUrl(env)
  const mock = isMockMode(env)

  async function list(filters, page, pageSize, { signal, scenario } = {}) {
    if (mock) {
      if (scenario === 'error') throw new ApiError('The sample incident request failed.', 503)
      const rows = selectIncidents(scenario === 'empty' ? [] : fixtures.incidents, filters)
      return { incidents: rows.slice((page - 1) * pageSize, page * pageSize), totalIncidents: rows.length, page, pageSize }
    }
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    for (const key of ['search', 'severity', 'status']) {
      if (filters[key]?.trim()) params.set(key, filters[key].trim())
    }
    const body = await requestJson(`${base}/incidents?${params}`, { signal, fetchImpl })
    if (!Array.isArray(body?.incidents) || !Number.isSafeInteger(body.totalIncidents) || body.totalIncidents < 0
      || body.page !== page || body.pageSize !== pageSize
      || body.incidents.length !== Math.min(pageSize, Math.max(0, body.totalIncidents - (page - 1) * pageSize))) {
      throw invalidResponse()
    }
    body.incidents.forEach(checkRow)
    return body
  }

  async function get(id, { signal } = {}) {
    if (mock) {
      const incident = fixtures.incidents.find((item) => item.id === id)
      if (!incident) throw new ApiError('Incident not found.', 404)
      return incident
    }
    const body = await requestJson(`${base}/incidents/${encodeURIComponent(id)}`, { signal, fetchImpl })
    checkRow(body)
    if (body.id !== id || (body.summary != null && typeof body.summary !== 'string') || !Array.isArray(body.evidenceIds)
      || !body.evidenceIds.every((key) => typeof key === 'string')
      || !Array.isArray(body.evidence) || !body.evidence.every((item) => item?.incidentId === id
        && body.evidenceIds.includes(item.id) && typeof item.source === 'string' && typeof item.summary === 'string')) {
      throw invalidResponse()
    }
    return body
  }

  return { mock, list, get }
}

export const incidentsApi = createIncidentsApi()
