import { test, expect } from '@playwright/test'

const row = (id = 'LIVE-1') => ({ id, eventName: 'StopLogging', source: 'AWS CloudTrail',
  severity: 'CRITICAL', status: 'New', occurredAt: '2026-11-14T14:30:00.000000Z',
  createdAt: '2026-11-14T14:31:00.000000Z', principal: null, resource: null, region: 'us-east-2',
  accessKeyId: null, sourceIp: null, summary: 'A monitored trail stopped logging.' })
const payload = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const failure = () => payload({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable.' } }, 503)
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

function defaultReply(path, url) {
  const id = decodeURIComponent(path.split('/')[2] ?? 'LIVE-1')
  if (path === '/alerts') {
    const page = Number(url.searchParams.get('page'))
    return payload({ alerts: page === 1 ? [row()] : [], totalAlerts: 1, page, pageSize: 6 })
  }
  if (path.endsWith('/raw-event')) return payload({ alertId: id, rawEvent: { eventName: 'StopLogging', value: 8.5 } })
  if (path.endsWith('/associated-incident')) return payload({ alertId: id, status: 'none', incidentId: null })
  return payload(row(id))
}

async function installApi(page, handler = defaultReply) {
  const calls = []
  page.on('pageerror', (error) => { throw error })
  await page.route('**/__fa1_api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/__fa1_api', '')
    calls.push({ path, url, method: route.request().method(), body: route.request().postData() })
    await route.fulfill(await handler(path, url))
  })
  return calls
}

test('live server filters and numbered pages preserve state and focus after detail navigation', async ({ page }) => {
  const calls = await installApi(page, (path, url) => {
    if (path !== '/alerts') return defaultReply(path, url)
    const number = Number(url.searchParams.get('page'))
    return payload({ alerts: number === 1 ? Array.from({ length: 6 }, (_, i) => row(`LIVE-${i + 1}`)) : [row('LIVE-7')],
      totalAlerts: 7, page: number, pageSize: 6 })
  })
  await page.goto('/#/alerts')
  await expect(page.getByText('Showing 1–6 of 7 alerts')).toBeVisible()
  await expect(page.getByLabel('Alerts demo scenario', { exact: true })).toHaveCount(0)
  await page.getByLabel('Search alerts', { exact: true }).fill('StopLogging')
  await page.getByLabel('Severity', { exact: true }).selectOption('Critical')
  await page.getByLabel('Source', { exact: true }).selectOption('AWS CloudTrail')
  await page.getByLabel('Status', { exact: true }).selectOption('New')
  await page.getByLabel('Time range', { exact: true }).selectOption('168')
  await expect(page.getByText('Showing 1–6 of 7 alerts')).toBeVisible()
  const query = calls.at(-1).url.searchParams
  expect(Object.fromEntries(query)).toMatchObject({ search: 'StopLogging', severity: 'CRITICAL', source: 'AWS CloudTrail', status: 'New', page: '1', pageSize: '6' })
  expect(Date.parse(query.get('to')) - Date.parse(query.get('from'))).toBe(168 * 3600000)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Showing 7–7 of 7 alerts')).toBeVisible()
  expect(calls.at(-1).url.searchParams.get('to')).toBe(query.get('to'))
  await expect(page.getByRole('cell', { name: 'Not available', exact: true })).toHaveCount(2)
  await expect(page.getByRole('cell', { name: 'Critical', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'LIVE-7', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'LIVE-7 · StopLogging' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to alerts' }).click()
  await expect(page.getByText('Showing 7–7 of 7 alerts')).toBeVisible()
  await expect(page.getByRole('button', { name: 'LIVE-7', exact: true })).toBeFocused()
  await expect(page.getByLabel('Search alerts', { exact: true })).toHaveValue('StopLogging')
  await expect(page.getByLabel('Severity', { exact: true })).toHaveValue('Critical')
  await page.getByLabel('Search alerts', { exact: true }).fill('changed')
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
})

test('list loading, failure, retry, filtered empty and no alerts states remain distinct', async ({ page }) => {
  const gate = deferred()
  let result = 'error'
  const calls = await installApi(page, async (path, url) => {
    if (path !== '/alerts') return defaultReply(path, url)
    await gate.promise
    if (result === 'error') return failure()
    return payload({ alerts: [], totalAlerts: 0, page: Number(url.searchParams.get('page')), pageSize: 6 })
  })
  await page.goto('/#/alerts')
  await expect(page.getByText('Loading alerts…', { exact: true })).toBeVisible()
  gate.resolve()
  await expect(page.getByRole('heading', { name: 'Alerts could not be loaded' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^ALT-/ })).toHaveCount(0)
  const failedQuery = calls.at(-1).url.search
  result = 'empty'
  await page.getByRole('button', { name: 'Retry alerts' }).click()
  await expect(page.getByText('No alerts match your filters', { exact: true })).toBeVisible()
  expect(calls.at(-1).url.search).toBe(failedQuery)
  await page.getByLabel('Time range', { exact: true }).selectOption('all')
  await expect(page.getByRole('heading', { name: 'No alerts available' })).toBeVisible()
  expect(calls.at(-1).url.searchParams.has('from')).toBe(false)
})

test('normalized details render first; optional reads fail and retry independently; raw JSON copies', async ({ page }) => {
  const detailsGate = deferred()
  let failRaw = true
  let failIncident = true
  const calls = await installApi(page, async (path, url) => {
    if (path === '/alerts/LIVE-1') { await detailsGate.promise; return payload(row()) }
    if (path.endsWith('/raw-event') && failRaw) return failure()
    if (path.endsWith('/associated-incident') && failIncident) return failure()
    return defaultReply(path, url)
  })
  await page.goto('/#/alerts/LIVE-1')
  await expect(page.getByRole('heading', { name: 'Loading alert details…' })).toBeVisible()
  expect(calls.map((c) => c.path)).toEqual(['/alerts/LIVE-1'])
  detailsGate.resolve()
  await expect(page.getByRole('heading', { name: 'LIVE-1 · StopLogging' })).toBeVisible()
  await expect(page.getByText('Raw event could not be loaded.', { exact: true })).toBeVisible()
  await expect(page.getByText('Incident association could not be loaded.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy JSON', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Investigate', exact: true })).toBeEnabled()
  failRaw = false
  await page.getByRole('button', { name: 'Retry raw event' }).click()
  await expect(page.getByLabel('Raw event JSON')).toContainText('8.5')
  expect(calls.filter((c) => c.path === '/alerts/LIVE-1')).toHaveLength(1)
  expect(calls.filter((c) => c.path.endsWith('/associated-incident'))).toHaveLength(1)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value) => { window.copiedRaw = value },
    } })
  })
  await page.getByRole('button', { name: 'Copy JSON', exact: true }).click()
  await expect(page.getByText('JSON copied to clipboard.', { exact: true })).toBeVisible()
  expect(JSON.parse(await page.evaluate(() => window.copiedRaw))).toEqual({ eventName: 'StopLogging', value: 8.5 })
  failIncident = false
  await page.getByRole('button', { name: 'Retry incident association' }).click()
  await expect(page.getByText('No associated incident.', { exact: true })).toBeVisible()
  expect(calls.filter((c) => c.path.endsWith('/raw-event'))).toHaveLength(2)
  await page.screenshot({ path: 'test-results/fa1-live-detail.png', fullPage: true })
})

for (const status of ['none', 'associated', 'ambiguous']) {
  test(`incident outcome ${status} is clear without handing live IDs to fixture screens`, async ({ page }) => {
    await installApi(page, (path, url) => path.endsWith('/associated-incident')
      ? payload({ alertId: 'LIVE-1', status, incidentId: status === 'associated' ? 'INC-LIVE' : null })
      : path.endsWith('/raw-event') ? payload({ alertId: 'LIVE-1', rawEvent: null }) : defaultReply(path, url))
    await page.goto('/#/alerts/LIVE-1')
    await expect(page.getByRole('heading', { name: 'Normalized alert', exact: true })).toBeVisible()
    await expect(page.getByText('Raw event unavailable', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Investigate', exact: true })).toBeEnabled()
    if (status === 'associated') {
      await expect(page.getByText('Live incident reports are not connected yet, so opening an incident is unavailable.')).toBeVisible()
      await expect(page.getByText('Associated incident: INC-LIVE', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Open incident INC-LIVE' })).toBeDisabled()
    } else {
      await expect(page.getByText(status === 'none' ? 'No associated incident.'
        : 'Multiple incidents are associated with this alert. No incident has been selected.', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Open incident/ })).toHaveCount(0)
    }
  })
}

test('detail 404 and transient failure have distinct states and no optional requests', async ({ page }) => {
  let status = 503
  const calls = await installApi(page, (path, url) => path === '/alerts/LIVE-1'
    ? status === 200 ? payload(row()) : status === 404
      ? payload({ error: { code: 'ALERT_NOT_FOUND', message: 'Alert not found.' } }, 404) : failure()
    : defaultReply(path, url))
  await page.goto('/#/alerts/LIVE-1')
  await expect(page.getByRole('heading', { name: 'Alert details could not be loaded' })).toBeVisible()
  expect(calls.every((c) => c.path === '/alerts/LIVE-1')).toBe(true)
  status = 200
  await page.getByRole('button', { name: 'Retry alert details' }).click()
  await expect(page.getByRole('heading', { name: 'LIVE-1 · StopLogging' })).toBeVisible()
  status = 404
  calls.length = 0
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Alert no longer available' })).toBeVisible()
  expect(calls.every((c) => c.path === '/alerts/LIVE-1')).toBe(true)
})

test('late list responses cannot replace newer filter results even when transport ignores abort', async ({ page }) => {
  const gate = deferred()
  let started = false
  await page.addInitScript(() => {
    const fetch = window.fetch
    window.fetch = (input, init) => fetch(input, { ...init, signal: undefined })
  })
  await installApi(page, async (path, url) => {
    if (path !== '/alerts') return defaultReply(path, url)
    const search = url.searchParams.get('search')
    if (search === 'slow') { started = true; await gate.promise }
    return payload({ alerts: [row(search === 'slow' ? 'OLD' : 'NEW')], totalAlerts: 1, page: 1, pageSize: 6 })
  })
  await page.goto('/#/alerts')
  await page.getByLabel('Search alerts', { exact: true }).fill('slow')
  await expect.poll(() => started).toBe(true)
  await page.getByLabel('Search alerts', { exact: true }).fill('new')
  await expect(page.getByRole('button', { name: 'NEW', exact: true })).toBeVisible()
  const oldResponse = page.waitForResponse((r) => new URL(r.url()).searchParams.get('search') === 'slow')
  gate.resolve()
  await oldResponse
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await expect(page.getByRole('button', { name: 'NEW', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'OLD', exact: true })).toHaveCount(0)
})

test('late details and optional reads cannot replace another alert after navigation', async ({ page }) => {
  const detailsGate = deferred()
  const rawGate = deferred()
  let rawStarted = false
  await page.addInitScript(() => {
    const fetch = window.fetch
    window.fetch = (input, init) => fetch(input, { ...init, signal: undefined })
  })
  await installApi(page, async (path, url) => {
    if (path === '/alerts/LATE') await detailsGate.promise
    if (path === '/alerts/FIRST/raw-event') {
      rawStarted = true
      await rawGate.promise
      return payload({ alertId: 'FIRST', rawEvent: { oldAlert: 'FIRST' } })
    }
    return defaultReply(path, url)
  })
  await page.goto('/#/alerts/LATE')
  await expect(page.getByRole('heading', { name: 'Loading alert details…' })).toBeVisible()
  await page.evaluate(() => { window.location.hash = '/alerts/FIRST' })
  await expect(page.getByRole('heading', { name: 'FIRST · StopLogging' })).toBeVisible()
  await expect.poll(() => rawStarted).toBe(true)
  await page.evaluate(() => { window.location.hash = '/alerts/SECOND' })
  await expect(page.getByRole('heading', { name: 'SECOND · StopLogging' })).toBeVisible()
  await expect(page.getByLabel('Raw event JSON')).toBeVisible()
  const late = page.waitForResponse((r) => r.url().endsWith('/alerts/LATE'))
  const raw = page.waitForResponse((r) => r.url().endsWith('/alerts/FIRST/raw-event'))
  detailsGate.resolve()
  rawGate.resolve()
  await Promise.all([late, raw])
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await expect(page.getByRole('heading', { name: 'SECOND · StopLogging' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^(LATE|FIRST) ·/ })).toHaveCount(0)
  await expect(page.getByLabel('Raw event JSON')).not.toContainText('oldAlert')
})

test('live list and detail retain the narrow-screen layout and contain wide content', async ({ page }) => {
  await installApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/alerts')
  await expect(page.getByRole('button', { name: 'LIVE-1', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'LIVE-1', exact: true }).click()
  await expect(page.getByLabel('Raw event JSON')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

for (const remaining of [0, 1]) {
  test(`out-of-range list page recovers after records shrink to ${remaining}`, async ({ page }) => {
    let shrunk = false
    const calls = await installApi(page, (path, url) => {
      if (path !== '/alerts') return defaultReply(path, url)
      const number = Number(url.searchParams.get('page'))
      const total = shrunk ? remaining : 7
      const offset = (number - 1) * 6
      return payload({ alerts: Array.from({ length: Math.min(6, Math.max(0, total - offset)) },
        (_, index) => row(`LIVE-${offset + index + 1}`)), totalAlerts: total, page: number, pageSize: 6 })
    })
    await page.goto('/#/alerts')
    await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: 'LIVE-7', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'LIVE-7 · StopLogging' })).toBeVisible()
    shrunk = true
    await page.getByRole('button', { name: 'Back to alerts' }).click()
    await expect(page.getByText('This page is no longer available.', { exact: true })).toBeVisible()
    await expect(page.getByText('Page 2 unavailable', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Return to first page' }).click()
    await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible()
    expect(calls.filter((call) => call.path === '/alerts').at(-1).url.searchParams.get('page')).toBe('1')
  })
}

test('Investigate on a live alert starts a real investigation and opens its trace', async ({ page }) => {
  const done = { investigationId: 'INV-live1', alertId: 'LIVE-1', status: 'COMPLETED', statusReason: null,
    steps: [], evidence: [], conclusion: null }
  const calls = await installApi(page, (path, url) => path === '/investigations' ? payload({ investigationId: 'INV-live1' }, 202)
    : path === '/investigations/INV-live1' ? payload(done) : defaultReply(path, url))
  await page.goto('/#/alerts/LIVE-1')
  await expect(page.getByRole('heading', { name: 'Normalized alert', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Investigate', exact: true }).click()
  await expect(page).toHaveURL(/#\/investigations\/INV-live1/)
  const start = calls.find((c) => c.path === '/investigations')
  expect(start.method).toBe('POST')
  expect(JSON.parse(start.body)).toEqual({ alertId: 'LIVE-1' })
  await expect.poll(() => calls.some((c) => c.path === '/investigations/INV-live1')).toBe(true)
})

test('a failed start shows the backend message and stays on the investigations screen', async ({ page }) => {
  await installApi(page, (path, url) => path === '/investigations'
    ? payload({ error: { code: 'NOT_FOUND', message: 'alert LIVE-1 not found' } }, 404) : defaultReply(path, url))
  await page.goto('/#/alerts/LIVE-1')
  await page.getByRole('button', { name: 'Investigate', exact: true }).click()
  await expect(page.getByText('alert LIVE-1 not found')).toBeVisible()
})
