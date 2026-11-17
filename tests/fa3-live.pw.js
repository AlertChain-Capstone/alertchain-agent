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

async function mockIncidents(page, read, ask) {
  page.on('pageerror', (error) => { throw error })
  await page.route('**/__fa1_api/incidents**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/questions')) {
      expect(request.method()).toBe('POST')
      if (!ask) throw new Error('Unexpected incident question')
      await route.fulfill(await ask(url, request.postDataJSON()))
    } else {
      expect(request.method()).toBe('GET')
      await route.fulfill(await read(url))
    }
  })
}

test('dashboard, filtered portfolio, and report use stored rows, links and scoped tool evidence', async ({ page }) => {
  const queries = []
  await mockIncidents(page, (url) => {
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
  await mockIncidents(page, async () => {
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

test('detail failure retries and distinguishes a missing report', async ({ page }) => {
  let status = 503
  await mockIncidents(page, () => response({ error: { message: 'Report unavailable' } }, status))
  await page.goto('/#/incidents/INC-001')
  await expect(page.getByRole('heading', { name: 'The report could not be loaded' })).toBeVisible()
  status = 404
  await page.getByRole('button', { name: 'Retry report' }).click()
  await expect(page.getByRole('heading', { name: 'Incident unavailable' })).toBeVisible()
  await expect(page.getByText('Leaked access key used to disable logging')).toHaveCount(0)
})

const answer = { kind: 'answer', text: 'The tool returned one recorded event.', citations: ['E-found'] }
const question = 'How many related events were recorded?'
const askPath = `/#/incidents/${report.id}/ask`

test('blank questions send nothing; a transient failure preserves the draft and retry opens the cited record', async ({ page }) => {
  const posts = []
  await mockIncidents(page, () => response(report), (url, body) => {
    expect(url.pathname).toBe(`/__fa1_api/incidents/${report.id}/questions`)
    posts.push(body)
    return posts.length === 1 ? response({ error: { message: 'Unavailable' } }, 503) : response(answer)
  })
  await page.goto(`/#/incidents/${report.id}`)
  await page.getByRole('link', { name: 'Ask the Agent', exact: true }).click()
  const draft = page.getByLabel('Your question')
  const submit = page.getByRole('button', { name: 'Ask question' })
  await submit.click()
  await expect(page.getByRole('alert')).toContainText('Enter a question')
  expect(posts).toHaveLength(0)
  await draft.fill(`  ${question}  `)
  await submit.click()
  await expect(page.getByRole('alert')).toContainText('Try again')
  await expect(draft).toHaveValue(`  ${question}  `)
  await submit.click()
  await expect(page.getByText(answer.text, { exact: true })).toBeVisible()
  expect(posts).toEqual([{ question }, { question }])
  await page.getByText('View citation E-found').click()
  await expect(page.getByText(report.evidence[0].summary)).toBeVisible()
  await page.getByText('Inspect stored evidence E-found').click()
  await expect(page.getByLabel('Stored evidence E-found')).toContainText('"eventCount": 1')
  await expect(page.getByText('View citation E-unavailable')).toHaveCount(0)
})

test('unknown citations withhold the entire answer; an unanswerable question displays the limitation', async ({ page }) => {
  const invalid = { ...answer, text: 'This candidate must never appear.', citations: ['E-found', 'E-other'] }
  const limitation = { kind: 'limitation', text: 'These records do not establish who approved the operation.', citations: [] }
  await mockIncidents(page, () => response(report), (_url, body) => response(body.question === question ? invalid : limitation))
  await page.goto(askPath)
  await page.getByLabel('Your question').fill(question)
  await page.getByRole('button', { name: 'Ask question' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText(invalid.text)).toHaveCount(0)
  await expect(page.getByText(/View citation/)).toHaveCount(0)
  await page.getByLabel('Your question').fill('Who approved it?')
  await page.getByRole('button', { name: 'Ask question' }).click()
  await expect(page.getByRole('heading', { name: 'Insufficient evidence' })).toBeVisible()
  await expect(page.getByText(limitation.text)).toBeVisible()
  await expect(page.getByText(/View citation/)).toHaveCount(0)
})

test('navigating during a slow question keeps drafts isolated and rejects a late answer', async ({ page }) => {
  const other = { ...report, ...rows[1], evidence: [], evidenceIds: [] }
  let release
  const hold = new Promise((resolve) => { release = resolve })
  // Exercise the completion guard even when a transport ignores AbortSignal.
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = (url, options) => original(url, { ...options, signal: undefined })
  })
  await mockIncidents(page, (url) => response(url.pathname.endsWith(other.id) ? other : report), async () => {
    await hold
    return response(answer)
  })
  await page.goto(askPath)
  await page.getByLabel('Your question').fill(question)
  await page.getByRole('button', { name: 'Ask question' }).click()
  await expect(page.getByText('Reading the incident evidence…')).toBeVisible()
  await page.evaluate((id) => { window.location.hash = `/incidents/${id}/ask` }, other.id)
  await expect(page.getByText(other.title, { exact: true })).toBeVisible()
  await expect(page.getByLabel('Your question')).toHaveValue('')
  await page.getByLabel('Your question').fill('A separate draft')
  const delivered = page.waitForResponse((res) => res.url().endsWith('/questions'))
  release()
  await delivered
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await expect(page.getByLabel('Your question')).toHaveValue('A separate draft')
  await expect(page.getByText(answer.text)).toHaveCount(0)
  await page.goBack()
  await expect(page.getByLabel('Your question')).toHaveValue(question)
  await expect(page.getByText(answer.text)).toHaveCount(0)
})

test('a previously grounded answer is withheld when the refreshed report loses its cited evidence', async ({ page }) => {
  let current = report
  await mockIncidents(page, (url) => url.pathname.endsWith('/incidents')
    ? response({ incidents: [current], totalIncidents: 1, page: 1, pageSize: 4 })
    : response(current), () => response(answer))
  await page.goto(askPath)
  await page.getByLabel('Your question').fill(question)
  await page.getByRole('button', { name: 'Ask question' }).click()
  await expect(page.getByText(answer.text)).toBeVisible()
  await page.getByRole('link', { name: 'Return to report' }).click()
  await page.getByRole('link', { name: 'Back to incidents' }).click()
  current = { ...report, evidence: [] }
  await page.evaluate((id) => { window.location.hash = `/incidents/${id}/ask` }, report.id)
  await expect(page.getByLabel('Your question')).toHaveValue(question)
  await expect(page.getByRole('heading', { name: 'Evidence unavailable' })).toBeVisible()
  await expect(page.getByText(answer.text)).toHaveCount(0)
})
