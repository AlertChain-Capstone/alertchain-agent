// Real local browser/API verification. Never substitutes fixtures for API responses.
// Default: read-only. --investigate permits one Floci-stub run; real Bedrock also
// requires --allow-real-bedrock after the user approves usage charges.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'

const service = 'http://127.0.0.1:4566'
const api = process.env.LOCAL_API_URL || 'http://f863b23b16.execute-api.localhost.floci.io:4566'
const website = process.env.LOCAL_DEMO_URL || 'http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/'
for (const value of [api, website]) {
  const url = new URL(value)
  assert.ok(url.protocol === 'http:' && (['127.0.0.1', 'localhost'].includes(url.hostname) || url.hostname.endsWith('.localhost.floci.io')))
}
const run = `integration-${randomUUID()}`
const output = `test-results/integration/${run}`
await mkdir(output, { recursive: true })
const save = (name, data) => writeFile(`${output}/${name}`, JSON.stringify(data, null, 2))
const tables = ['alertchain-alerts', 'alertchain-investigations', 'alertchain-evidence', 'alertchain-incidents']
const auth = (name) => ({ Authorization: `AWS4-HMAC-SHA256 Credential=test/20261116/us-east-2/${name}/aws4_request, SignedHeaders=host;x-amz-date, Signature=0000`, 'X-Amz-Date': '20261116T000000Z' })
async function ddb(operation, body) {
  const response = await fetch(service, { method: 'POST', headers: { ...auth('dynamodb'), 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': `DynamoDB_20120810.${operation}` }, body: JSON.stringify(body) })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result
}
async function snapshot() {
  const all = {}
  for (const TableName of tables) {
    all[TableName] = []
    let ExclusiveStartKey
    do {
      const page = await ddb('Scan', { TableName, ConsistentRead: true, ExclusiveStartKey })
      all[TableName].push(...page.Items)
      ExclusiveStartKey = page.LastEvaluatedKey
    } while (ExclusiveStartKey && Object.keys(ExclusiveStartKey).length)
    all[TableName].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  return all
}
function decode(value) {
  if ('S' in value) return value.S
  if ('N' in value) return Number(value.N)
  if ('BOOL' in value) return value.BOOL
  if ('NULL' in value) return null
  if ('M' in value) return Object.fromEntries(Object.entries(value.M).map(([k, v]) => [k, decode(v)]))
  if ('L' in value) return value.L.map(decode)
  throw new Error('Unsupported DynamoDB value')
}
const before = await snapshot()
await save('tables-before.json', before)
const rows = before[tables[0]].map(row => decode({ M: row }))
assert.ok(rows.length >= 14, 'Original alert population is missing')
const originals = rows.filter(row => row.createdTime < '2026-11-15T00:00:00Z')
assert.equal(originals.length, 14)
const response = await fetch(`${service}/2015-03-31/functions/alertchain-backend/configuration`, { headers: auth('lambda') })
assert.equal(response.status, 200)
const vars = (await response.json()).Environment.Variables
const bedrockIsLocal = vars.BEDROCK_ENDPOINT_URL?.startsWith('http://host.docker.internal:4566')
if (process.argv.includes('--investigate') && !bedrockIsLocal) assert.ok(process.argv.includes('--allow-real-bedrock'), 'Real Bedrock usage must be explicitly approved')
const config = { model: vars.BEDROCK_MODEL_ID, region: vars.BEDROCK_REGION, bedrockEndpoint: vars.BEDROCK_ENDPOINT_URL, bedrockIsLocal, dynamodbEndpoint: vars.DYNAMODB_ENDPOINT_URL, lambdaEndpoint: vars.LAMBDA_ENDPOINT_URL }
await save('effective-config.json', config)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, recordHar: { path: `${output}/browser.har`, content: 'embed' } })
const page = await context.newPage()
page.setDefaultTimeout(30000)
const network = [], errors = [], consoleErrors = [], failures = [], pending = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') failures.push({ url: request.url(), error: request.failure() }) })
page.on('response', res => {
  if (res.url().startsWith(api)) pending.push((async () => network.push({ url: res.url(), method: res.request().method(), status: res.status(), body: await res.json().catch(() => null) }))())
})
let investigation = null
const associationStates = []
try {
  await page.goto(`${website}#/alerts`)
  await page.getByLabel('Time range', { exact: true }).selectOption('all')
  await page.getByText(`of ${rows.length} alerts`, { exact: false }).waitFor()
  assert.equal(await page.getByLabel('Alerts demo scenario', { exact: true }).count(), 0)
  const rendered = []
  const pages = Math.ceil(rows.length / 6)
  for (let n = 1; n <= pages; n++) {
    await page.getByText(`Page ${n} of ${pages}`, { exact: true }).waitFor()
    rendered.push(...await page.locator('.fa1-alert-id').allTextContents())
    await page.screenshot({ path: `${output}/alerts-${n}.png`, fullPage: true })
    if (n < pages) await page.getByRole('button', { name: 'Next', exact: true }).click()
  }
  const sorted = [...rows].sort((a, b) => Date.parse(b.eventTime) - Date.parse(a.eventTime) || b.alertId.localeCompare(a.alertId))
  assert.deepEqual(rendered, sorted.map(row => row.alertId))
  await page.getByLabel('Search alerts', { exact: true }).fill('stopLOG')
  await page.getByLabel('Source', { exact: true }).selectOption('AWS CloudTrail')
  await page.getByLabel('Severity', { exact: true }).selectOption('High')
  const filtered = sorted.filter(row => row.eventName.toLowerCase().includes('stoplog') && row.source === 'AWS CloudTrail' && row.severity === 'HIGH')
  await page.getByText(`of ${filtered.length} alerts`, { exact: false }).waitFor()
  assert.deepEqual(await page.locator('.fa1-alert-id').allTextContents(), filtered.slice(0, 6).map(row => row.alertId))
  const selected = originals.find(row => row.eventName === 'StopLogging') || originals[0]
  await page.goto(`${website}#/alerts/${selected.alertId}`)
  await page.getByRole('heading', { name: `${selected.alertId} · ${selected.eventName}`, exact: true }).waitFor()
  await page.getByLabel('Raw event JSON', { exact: true }).waitFor()
  assert.deepEqual(JSON.parse(await page.getByLabel('Raw event JSON', { exact: true }).textContent()), selected.rawEvent)
  await page.getByText('No associated incident.', { exact: true }).waitFor()
  associationStates.push('none')
  await page.screenshot({ path: `${output}/original-detail.png`, fullPage: true })
  if (process.argv.includes('--associations')) {
    const ids = [0, 1].map(n => `INC-VERIFY-${run}-${n}`)
    const created = []
    await save('association-test-manifest.json', { run, alertId: selected.alertId, incidentIds: ids })
    try {
      for (const id of ids) {
        await ddb('PutItem', { TableName: 'alertchain-incidents', Item: {
          incident_id: { S: id }, alert_id: { S: selected.alertId },
          investigation_id: { S: `VERIFY-${run}` }, verification_run: { S: run },
        }, ConditionExpression: 'attribute_not_exists(incident_id)' })
        created.push(id)
        await page.reload()
        if (created.length === 1) {
          await page.getByText(`Associated incident: ${id}`, { exact: true }).waitFor()
          assert.equal(await page.getByRole('button', { name: `Open incident ${id}`, exact: true }).isDisabled(), true)
          associationStates.push('associated')
        } else {
          await page.getByText('Multiple incidents are associated with this alert. No incident has been selected.', { exact: true }).waitFor()
          associationStates.push('ambiguous')
        }
        await page.screenshot({ path: `${output}/association-${created.length}.png`, fullPage: true })
      }
    } finally {
      for (const id of created) await ddb('DeleteItem', { TableName: 'alertchain-incidents', Key: { incident_id: { S: id } }, ConditionExpression: 'verification_run = :run', ExpressionAttributeValues: { ':run': { S: run } } })
      await save('association-test-cleanup.json', { deletedOwnedIds: created })
    }
    await page.reload()
    await page.getByText('No associated incident.', { exact: true }).waitFor()
  }
  if (process.argv.includes('--investigate')) {
    const started = page.waitForResponse(res => res.url() === `${api}/investigations` && res.request().method() === 'POST')
    await page.getByRole('button', { name: 'Investigate', exact: true }).click()
    const post = await started
    assert.equal(post.status(), 202, await post.text())
    const id = (await post.json()).investigationId
    assert.ok(!before['alertchain-investigations'].some(row => row.investigation_id.S === id))
    await save('created-records.json', { run, investigationId: id })
    // Poll the actual UI responses, not a mocked transport or a separate direct call.
    for (let attempts = 0; attempts < 70; attempts++) {
      const polled = await page.waitForResponse(res => res.url() === `${api}/investigations/${id}` && res.request().method() === 'GET')
      assert.equal(polled.status(), 200)
      investigation = await polled.json()
      if (investigation.status !== 'RUNNING') break
    }
    assert.notEqual(investigation.status, 'RUNNING')
    await page.getByRole('heading', { name: `Investigation ${id}`, exact: true }).waitFor()
    await page.screenshot({ path: `${output}/investigation.png`, fullPage: true })
    await save('investigation.json', investigation)
    // Save generated records for review. They are explicitly owned by this run;
    // cleanup is a separate exact-key step after inspecting the saved manifest.
    const afterRun = await snapshot()
    await save('tables-after-run.json', afterRun)
    const owned = {}
    for (const table of tables.slice(1)) {
      owned[table] = afterRun[table].filter(row => row.investigation_id?.S === id)
      const existing = new Set(before[table].map(row => JSON.stringify(row)))
      assert.ok(owned[table].every(row => !existing.has(JSON.stringify(row))))
    }
    await save('owned-records.json', owned)
  }
  await Promise.all(pending)
  const listed = network.filter(entry => new URL(entry.url).pathname === '/alerts' && !new URL(entry.url).searchParams.has('search') && !new URL(entry.url).searchParams.has('from')).flatMap(entry => entry.body?.alerts || [])
  for (const row of rows) {
    const actual = listed.find(item => item.id === row.alertId)
    assert.ok(actual, `Missing browser response ${row.alertId}`)
    for (const key of ['eventName', 'source', 'severity', 'status', 'principal', 'resource', 'region']) assert.equal(actual[key], row[key] ?? null)
    assert.equal(Date.parse(actual.occurredAt), Date.parse(row.eventTime))
    assert.equal(Date.parse(actual.createdAt), Date.parse(row.createdTime))
  }
  const after = await snapshot()
  assert.deepEqual(after['alertchain-alerts'], before['alertchain-alerts'])
  assert.deepEqual(errors, [])
  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(failures, [])
  assert.ok(network.every(entry => entry.status < 400))
  const summary = { run, output, website, api, config, totalAlerts: rows.length, originalAlerts: originals.length, renderedIds: rendered, originalAlertsUnchanged: true, filteredCount: filtered.length, associationStates, investigationId: investigation?.investigationId, investigationStatus: investigation?.status, evidenceCount: investigation?.evidence.length, conclusion: investigation?.conclusion, browserErrors: errors, consoleErrors, failedRequests: failures, requests: network.map(({ url, method, status }) => ({ url, method, status })) }
  await save('summary.json', summary)
  console.log(JSON.stringify(summary, null, 2))
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
  console.log(await page.locator('body').innerText().catch(() => ''))
  throw error
} finally {
  await Promise.allSettled(pending)
  await save('network.json', network)
  await context.close()
  await browser.close()
  console.log('Browser evidence:', output)
}
