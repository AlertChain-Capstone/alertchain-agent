import { test, expect } from '@playwright/test'

test('FA1 mock paging, focus, filters, and demo scenarios preserve fixture behavior without HTTP', async ({ page }) => {
  const requests = []
  page.on('request', (r) => { if (/\/alerts(?:\?|\/)/.test(new URL(r.url()).pathname + new URL(r.url()).search)) requests.push(r.url()) })
  page.on('pageerror', (error) => { throw error })
  await page.goto('/#/alerts')
  await expect(page.getByText('Showing 1–6 of 8 alerts')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Showing 7–8 of 8 alerts')).toBeVisible()
  const button = page.locator('.fa1-alert-id').first()
  const id = await button.innerText()
  await button.click()
  await expect(page.getByRole('heading', { name: 'Normalized alert', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to alerts' }).click()
  await expect(page.getByText('Page 2 of 2')).toBeVisible()
  await expect(page.getByRole('button', { name: id, exact: true })).toBeFocused()
  await page.getByLabel('Alerts demo scenario', { exact: true }).selectOption('empty')
  await expect(page.getByRole('heading', { name: 'No alerts available' })).toBeVisible()
  await expect(page.getByText('Page 1 of 1')).toBeVisible()
  await page.getByLabel('Alerts demo scenario', { exact: true }).selectOption('sample')
  await expect(page.getByText('Showing 7–8 of 8 alerts')).toBeVisible()
  await page.getByLabel('Search alerts', { exact: true }).fill('no-matches')
  await expect(page.getByText('No alerts match your filters', { exact: true })).toBeVisible()
  expect(requests).toEqual([])
})

test('mock detail retains unavailable/raw-missing states and clipboard failure feedback', async ({ page }) => {
  await page.goto('/#/alerts/ALT-007')
  await expect(page.getByText('Raw event unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy JSON', exact: true })).toBeDisabled()
  await page.getByLabel('Alert details demo scenario', { exact: true }).selectOption('unavailable')
  await expect(page.getByRole('heading', { name: 'Alert no longer available' })).toBeVisible()
  await page.getByLabel('Alert details demo scenario', { exact: true }).selectOption('available')
  await expect(page.getByRole('heading', { name: 'Normalized alert', exact: true })).toBeVisible()
  await page.goto('/#/alerts/ALT-002')
  await expect(page.getByRole('button', { name: 'Copy JSON', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Clipboard unavailable') },
    } })
  })
  await page.getByRole('button', { name: 'Copy JSON', exact: true }).click()
  await expect(page.getByText('Could not copy JSON. Select the displayed JSON and copy it manually.', { exact: true })).toBeVisible()
})
