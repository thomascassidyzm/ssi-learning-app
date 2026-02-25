import { test, expect } from '@playwright/test'

test.describe('App loads', () => {
  test('homepage renders without crash', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#app')).toBeAttached()
  })

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await page.goto('/')
    await page.waitForTimeout(2000)
    // Filter out known noise (Clerk auth, favicon, etc.)
    const real = errors.filter(
      (e) =>
        !e.includes('clerk') &&
        !e.includes('Clerk') &&
        !e.includes('favicon') &&
        !e.includes('Failed to load resource') // expected when no backend
    )
    expect(real).toEqual([])
  })
})

test.describe('Schools dashboard', () => {
  test('dashboard route loads', async ({ page }) => {
    await page.goto('/schools')
    await expect(page.locator('#app')).toBeAttached()
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
