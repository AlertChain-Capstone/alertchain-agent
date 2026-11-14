import fixtures from '../mock/fa1.json' with { type: 'json' }

const viteEnv = import.meta.env ?? {}
export const DEMO_REFERENCE_TIME = '2026-10-17T16:00:00Z'
const severityLabels = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' }

export function apiUrl(env = viteEnv) {
  return (env.VITE_API_URL?.trim() || env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')
}

export function isMockMode(env = viteEnv) {
  return env.VITE_USE_MOCK === 'true' || !apiUrl(env)
}

export class AlertApiError extends Error {
  constructor(message, status = 0, code = 'REQUEST_FAILED') {
    super(message)
    this.name = 'AlertApiError'
    this.status = status
    this.code = code
  }
}

function invalidResponse() {
  return new AlertApiError('The alert service returned an invalid response.', 0, 'INVALID_RESPONSE')
}

export function toUiAlert(alert) {
  const severity = severityLabels[alert?.severity?.toUpperCase()]
  if (!alert || typeof alert.id !== 'string' || !alert.id || typeof alert.eventName !== 'string'
    || !Number.isFinite(Date.parse(alert.occurredAt)) || !severity
    || typeof alert.source !== 'string' || typeof alert.status !== 'string') throw invalidResponse()
  return {
    ...alert, severity,
    principal: alert.principal ?? null, resource: alert.resource ?? null,
    region: alert.region ?? null, accessKeyId: alert.accessKeyId ?? null,
    sourceIp: alert.sourceIp ?? null, summary: alert.summary ?? null,
  }
}

// Freeze this reference when filters change, so paging/retry uses the same time window.
export function buildAlertFilter(filters, referenceTime) {
  const to = new Date(referenceTime).toISOString()
  return {
    search: filters.search.trim(), severity: filters.severity.toUpperCase(),
    source: filters.source, status: filters.status, to,
    ...(filters.timeRange === 'all' ? {} : {
      from: new Date(Date.parse(to) - Number(filters.timeRange) * 3600000).toISOString(),
    }),
  }
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError')
}

export class AlertApiClient {
  constructor({ env = viteEnv, fetchImpl = (...args) => globalThis.fetch(...args),
    mockAlerts = fixtures.alerts, now = () => new Date().toISOString() } = {}) {
    this.mock = isMockMode(env)
    this.baseUrl = apiUrl(env)
    this.fetchImpl = fetchImpl
    this.mockAlerts = mockAlerts
    this.now = now
  }

  referenceTime() {
    return this.mock ? DEMO_REFERENCE_TIME : this.now()
  }

  async request(path, signal) {
    checkAbort(signal)
    let response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'GET', signal })
    } catch (error) {
      if (error.name === 'AbortError') throw error
      throw new AlertApiError('Could not reach the alert service.')
    }
    checkAbort(signal)
    const body = await response.json().catch(() => null)
    checkAbort(signal)
    if (!response.ok) {
      throw new AlertApiError(body?.error?.message || `Alert request failed (HTTP ${response.status}).`,
        response.status, body?.error?.code || 'HTTP_ERROR')
    }
    if (body === null) throw invalidResponse()
    return body
  }

  mockAlert(id, signal) {
    checkAbort(signal)
    const alert = this.mockAlerts.find((item) => item.id === id)
    if (!alert) throw new AlertApiError('Alert not found.', 404, 'ALERT_NOT_FOUND')
    return structuredClone(alert)
  }

  async listAlerts(filter = {}, page = 1, pageSize = 6, { signal, demoScenario } = {}) {
    checkAbort(signal)
    if (this.mock) {
      const search = (filter.search ?? '').toLowerCase()
      const rows = (demoScenario === 'empty' ? [] : this.mockAlerts).filter((alert) => (
        [alert.id, alert.eventName, alert.principal].some((value) => (value ?? '').toLowerCase().includes(search))
        && (!filter.severity || alert.severity.toUpperCase() === filter.severity.toUpperCase())
        && (!filter.source || alert.source === filter.source)
        && (!filter.status || alert.status === filter.status)
        && (!filter.from || Date.parse(alert.occurredAt) >= Date.parse(filter.from))
        && (!filter.to || Date.parse(alert.occurredAt) <= Date.parse(filter.to))
      )).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
        || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      return { alerts: rows.slice((page - 1) * pageSize, page * pageSize).map((a) => toUiAlert(structuredClone(a))),
        totalAlerts: rows.length, page, pageSize }
    }
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    for (const key of ['search', 'severity', 'source', 'status', 'from', 'to']) {
      if (filter[key]) params.set(key, filter[key])
    }
    const body = await this.request(`/alerts?${params}`, signal)
    if (!Array.isArray(body.alerts) || !Number.isSafeInteger(body.totalAlerts) || body.totalAlerts < 0
      || body.page !== page || body.pageSize !== pageSize || body.alerts.length > pageSize
      || body.alerts.length !== Math.min(pageSize, Math.max(0, body.totalAlerts - (page - 1) * pageSize))) throw invalidResponse()
    return { ...body, alerts: body.alerts.map(toUiAlert) }
  }

  async getAlertDetails(id, { signal } = {}) {
    const body = this.mock ? this.mockAlert(id, signal)
      : await this.request(`/alerts/${encodeURIComponent(id)}`, signal)
    if (body.id !== id) throw invalidResponse()
    // Optional data always comes from its own operation, including in mock mode.
    const details = { ...body }
    delete details.rawEvent
    delete details.incidentId
    return toUiAlert(details)
  }

  async getRawEvent(id, { signal } = {}) {
    const body = this.mock ? { alertId: id, rawEvent: this.mockAlert(id, signal).rawEvent ?? null }
      : await this.request(`/alerts/${encodeURIComponent(id)}/raw-event`, signal)
    if (body.alertId !== id || !Object.hasOwn(body, 'rawEvent')
      || (body.rawEvent !== null && (typeof body.rawEvent !== 'object' || Array.isArray(body.rawEvent)))) throw invalidResponse()
    return body
  }

  async getAssociatedIncidentId(id, { signal } = {}) {
    let body
    if (this.mock) {
      const incidentId = this.mockAlert(id, signal).incidentId ?? null
      body = { alertId: id, status: incidentId ? 'associated' : 'none', incidentId }
    } else {
      body = await this.request(`/alerts/${encodeURIComponent(id)}/associated-incident`, signal)
    }
    if (body.alertId !== id || !['none', 'associated', 'ambiguous'].includes(body.status)
      || (body.status === 'associated' ? typeof body.incidentId !== 'string' || !body.incidentId
        : body.incidentId !== null)) throw invalidResponse()
    return body
  }
}

export const alertApi = new AlertApiClient()
