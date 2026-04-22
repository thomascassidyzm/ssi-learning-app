import { test, expect, type Page } from '@playwright/test'

// Shared per-test observers: accumulate uncaught JS exceptions and console errors.
// pageerror fires for uncaught exceptions AND unhandled promise rejections (Playwright normalizes both).
function attachObservers(page: Page) {
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []

  page.on('pageerror', (err) => {
    pageErrors.push(err)
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  // Log failed subresource requests for visibility — does NOT fail the test.
  page.on('requestfailed', (req) => {
    // eslint-disable-next-line no-console
    console.log(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`)
  })

  return { pageErrors, consoleErrors }
}

// No allowlist for pageerrors — any uncaught JS exception should fail the test.
// If real noise emerges during runs, add filters here with a comment explaining why.
function assertNoPageErrors(pageErrors: Error[]) {
  expect(
    pageErrors.map((e) => `${e.name}: ${e.message}`),
    'uncaught JS exceptions during page load'
  ).toEqual([])
}

// Console-error allowlist: filter known noise (Clerk auth, favicon, missing backend in dev).
function filterConsoleErrors(errors: string[]) {
  return errors.filter(
    (e) =>
      !e.includes('clerk') &&
      !e.includes('Clerk') &&
      !e.includes('favicon') &&
      !e.includes('Failed to load resource') // expected when no backend
  )
}

test.describe('App loads', () => {
  test('homepage renders without crash', async ({ page }) => {
    const { pageErrors } = attachObservers(page)
    await page.goto('/')
    await expect(page.locator('#app')).toBeAttached()
    assertNoPageErrors(pageErrors)
  })

  test('no console errors on load', async ({ page }) => {
    const { pageErrors, consoleErrors } = attachObservers(page)
    await page.goto('/')
    await page.waitForTimeout(2000)
    expect(filterConsoleErrors(consoleErrors)).toEqual([])
    assertNoPageErrors(pageErrors)
  })
})

test.describe('Schools dashboard', () => {
  test('dashboard route loads', async ({ page }) => {
    const { pageErrors } = attachObservers(page)
    await page.goto('/schools')
    await expect(page.locator('#app')).toBeAttached()
    assertNoPageErrors(pageErrors)
  })
})

test.describe('PWA', () => {
  // These need the production build (manifest + SW are only generated at build time).
  // Run with: pnpm e2e:pwa
  test.skip(
    () => !process.env.PWA_TEST && !process.env.PROD_URL,
    'Run pnpm e2e:pwa or pnpm e2e:prod to test PWA features'
  )

  test('manifest is valid', async ({ page }) => {
    const response = await page.goto('/manifest.webmanifest')
    expect(response?.status()).toBe(200)
    const json = await response?.json()
    expect(json.name).toBeTruthy()
    expect(json.display).toBe('standalone')
  })

  test('service worker registers', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      const registrations = await navigator.serviceWorker.getRegistrations()
      return registrations.length > 0
    })
    expect(swRegistered).toBe(true)
  })
})
