import { test, expect, type Page } from '@playwright/test'

/**
 * Offline round 3 — the Listening overlay must never spin forever or show a
 * raw fetch error in airplane mode (Tom's on-device test, 2026-07-09).
 *
 * This drives the REAL app in a headless browser: load a course online as a
 * guest, flip the browser context offline, open the Listening overlay, and
 * assert both Dialogues and Core settle to a definite state — content (when
 * the metadata cache has it) or the explicit not-downloaded message — with
 * no spinner left and no raw TypeError ever rendered.
 *
 * Run against a deployment carrying the new code:
 *   PROD_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app pnpm e2e:chromium -- offline-listening
 * or locally: pnpm e2e:chromium -- offline-listening (dev server).
 */

function attachObservers(page: Page) {
  const pageErrors: Error[] = []
  page.on('pageerror', (err) => pageErrors.push(err))
  return { pageErrors }
}

// The overlay is "settled" when its loading spinners are gone and one of the
// definite states is visible. Returns the visible state for further asserts.
async function settledListeningState(page: Page): Promise<'content' | 'empty' | 'error'> {
  const overlay = page.locator('.listening-overlay, .scene-list-wrap, .teleprompter, .error, .scene-empty')
  await expect(overlay.first()).toBeVisible({ timeout: 20_000 })
  // No spinner may survive 20s — the spinner-forever regression gate.
  await expect(page.locator('.loading-spinner')).toHaveCount(0, { timeout: 20_000 })
  if (await page.locator('.scene-list, .teleprompter').first().isVisible().catch(() => false)) return 'content'
  if (await page.locator('.scene-empty').first().isVisible().catch(() => false)) return 'empty'
  return 'error'
}

test('Listening overlay offline: definite state, no spinner-forever, no raw TypeError', async ({ page, context }) => {
  const { pageErrors } = attachObservers(page)

  // Returning-learner shape: a saved course skips the first-visit picker.
  await page.addInitScript(() => {
    try { localStorage.setItem('ssi-last-course', 'zho_for_eng') } catch { /* ignore */ }
  })

  await page.goto('/')
  // The player shell is up when the mode-tray trigger renders.
  const trigger = page.locator('.mode-trigger')
  await expect(trigger).toBeVisible({ timeout: 30_000 })
  // Let the course bootstrap settle before cutting the network.
  await page.waitForTimeout(3_000)

  // Airplane mode.
  await context.setOffline(true)

  // Enter listening mode from Settings → Tools (its only entry point since
  // 2026-08-06 — the mode tray no longer offers it).
  await page.locator('.bottom-nav button[title="Settings"]').click()
  const listeningRow = page.locator('.setting-row.clickable', { hasText: /listening mode/i }).first()
  await expect(listeningRow).toBeVisible({ timeout: 10_000 })
  await listeningRow.click()

  // Dialogues (default view) must settle: scenes, empty, or the explicit
  // not-downloaded message — never a stuck spinner, never a raw TypeError.
  const dialoguesState = await settledListeningState(page)
  await expect(page.locator('body')).not.toContainText('TypeError')
  await expect(page.locator('body')).not.toContainText('Load failed')
  if (dialoguesState === 'error') {
    // An error state is only acceptable as the deliberate human copy.
    await expect(page.locator('.error, .scene-empty').first()).toContainText(/downloaded|connect/i)
  }
  console.log(`[offline-e2e] Dialogues settled: ${dialoguesState}`)

  // Core tab: same contract.
  const coreTab = page.locator('.view-tab', { hasText: 'Core' })
  if (await coreTab.isVisible().catch(() => false)) {
    await coreTab.click()
    const coreState = await settledListeningState(page)
    await expect(page.locator('body')).not.toContainText('TypeError')
    await expect(page.locator('body')).not.toContainText('Load failed')
    if (coreState === 'error') {
      await expect(page.locator('.error').first()).toContainText(/downloaded|connect/i)
    }
    console.log(`[offline-e2e] Core settled: ${coreState}`)
  }

  // No uncaught exceptions anywhere in the offline path.
  expect(pageErrors.map((e) => `${e.name}: ${e.message}`)).toEqual([])
})
