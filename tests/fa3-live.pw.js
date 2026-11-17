import { expect, test } from '@playwright/test'

const rows = Array.from({ length: 5 }, (_, i) => ({
  id: `INC-LIVE-${i + 1}`, title: `Recorded case ${i + 1}`, severity: 'High', status: 'Open',
  occurredAt: null, createdAt: i === 4 ? '2026-11-17T13:00:00Z' : null,
  investigationId: 'INV-live', alertId: 'ALT-live',
}))
const report = { ...rows[4], summary: 'The investigation recorded a related event.',
  evidenceIds: ['E-found', 'E-unavailable'], evidence: [{ id: 'E-found', incidentId: rows[4].id,
    source: 'get_related_events', summary: 'Observed event on this alert.', raw: { eventCount: 1 } }] }

function response(json, status = 200) {
  return { status, json }
}

async function mockReads(page, handler) {
  page.on('pageerror', (error) => { throw error })
  await page.route('**/__fa1_api/incidents**', async (route) => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill(await handler(new URL(route.request().url())))
  })
}

test('dashboard, filtered portfolio, and report use stored rows, links and scoped tool evidence', async ({ page }) => {
  const queries = []
  await mockReads(page, (url) => {
    if (url.pathname.endsWith('/INC-LIVE-5')) return response(report)
    const pageSize = Number(url.searchParams.get('pageSize'))
    const index = Number(url.searchParams.get('page'))
    queries.push(Object.fromEntries(url.searchParams))
    return response({ incidents: rows.slice((index - 1) * pageSize, index * pageSize),
      totalIncidents: rows.length, page: index, pageSize })
  })
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'Recorded case 1' })).toBeVisible()
  await expect(page.getByText('5 recorded')).toBeVisible()
  await expect(page.getByText(/Sample snapshot/)).toHaveCount(0)
  await page.getByRole('link', { name: 'Open incidents', exact: true }).click()
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('Open')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Showing 5–5 of 5 incidents')).toBeVisible()
  expect(queries.at(-1)).toMatchObject({ status: 'Open', page: '2' })
  await page.getByRole('link', { name: /INC-LIVE-5/ }).click()
  await expect(page.getByRole('heading', { name: 'Recorded case 5' })).toBeVisible()
  await expect(page.getByText('Opened 2026-11-17 13:00:00 UTC')).toBeVisible()
  await expect(page.getByText(report.summary)).toBeVisible()
  await expect(page.getByRole('link', { name: 'View investigation INV-live' })).toHaveAttribute('href', '#/investigations/INV-live')
  await expect(page.getByRole('link', { name: 'View alert ALT-live' })).toHaveAttribute('href', '#/alerts/ALT-live')
  await page.getByText('Inspect stored evidence E-found').click()
  await expect(page.getByLabel('Stored evidence E-found')).toContainText('"eventCount": 1')
  await expect(page.getByText('E-unavailable · Evidence unavailable')).toBeVisible()
  await page.getByRole('link', { name: 'Back to incidents' }).click()
  await expect(page.getByText('Showing 5–5 of 5 incidents')).toBeVisible()
})

test('loading, list failures, filter misses and an empty portfolio are distinct', async ({ page }) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let failed = true
  await mockReads(page, async () => {
    await gate
    return failed ? response({ error: { message: 'Storage unavailable' } }, 503)
      : response({ incidents: [], totalIncidents: 0, page: 1, pageSize: 4 })
  })
  await page.goto('/#/incidents')
  await expect(page.getByRole('heading', { name: 'Loading incidents…' })).toBeVisible()
  release()
  await expect(page.getByText('Storage unavailable')).toBeVisible()
  failed = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'No incidents available' })).toBeVisible()
  await page.getByLabel('Search incidents').fill('missing')
  await expect(page.getByRole('heading', { name: 'No matching incidents' })).toBeVisible()
})

test('detail failure retries and distinguishes a missing report; live ask never uses canned answers', async ({ page }) => {
  let status = 503
  await mockReads(page, () => status === 200 ? response(report)
    : response({ error: { message: 'Report unavailable' } }, status))
  await page.goto('/#/incidents/INC-001')
  await expect(page.getByRole('heading', { name: 'The report could not be loaded' })).toBeVisible()
  status = 404
  await page.getByRole('button', { name: 'Retry report' }).click()
  await expect(page.getByRole('heading', { name: 'Incident unavailable' })).toBeVisible()
  await expect(page.getByText('Leaked access key used to disable logging')).toHaveCount(0)
  status = 200
  await page.goto('/#/incidents/INC-LIVE-5/ask')
  await expect(page.getByRole('heading', { name: 'Live incident questions are unavailable' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask question' })).toHaveCount(0)
})
