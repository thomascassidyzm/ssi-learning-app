/**
 * Refresh protocol — real-browser visual proof that the ONE universal refresh
 * affordance renders in the navbar (founder ruling, 2026-07-19).
 *
 * Uses the dev-only window.__setSchoolsE2EUser hook (useSchoolContext.ts) to
 * render the schools shell as a signed-in teacher WITHOUT a live Supabase
 * session — the same technique the mobile-topbar spec uses. Captures the
 * circular-arrow RefreshButton in the top bar (top-right, near identity).
 *
 * Screenshots land in ../../../docs/the-view/refresh/ for the record. (The
 * authenticated node-home at 3 org levels lives behind real admin auth + seeded
 * org data / the service-role key; captured separately when those are present.)
 */
import { test, type Page } from '@playwright/test'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = resolve(here, '../../../../docs/the-view/refresh')

async function signInAsTeacher(page: Page) {
  await page.goto('/schools')
  await page.waitForFunction(
    () => typeof (window as any).__setSchoolsE2ERole === 'function' &&
          typeof (window as any).__setSchoolsE2EUser === 'function',
    undefined,
    { timeout: 15_000 },
  )
  await page.evaluate(() => {
    ;(window as any).__setSchoolsE2ERole(null, 'teacher')
    ;(window as any).__setSchoolsE2EUser({
      user_id: 'e2e-teacher-1',
      learner_id: 'e2e-learner-1',
      display_name: 'Sian Morgan',
      educational_role: 'teacher',
      platform_role: null,
      school_name: 'Ysgol Bro Morgannwg',
    })
  })
  await page.locator('.schools-topbar').waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('.refresh-button').waitFor({ state: 'visible', timeout: 15_000 })
}

test('refresh button renders in the schools top bar (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInAsTeacher(page)
  await page.screenshot({ path: resolve(SHOTS, 'refresh-schools-dashboard-desktop.png') })
  await page.locator('.schools-topbar').screenshot({ path: resolve(SHOTS, 'refresh-topbar-desktop.png') })
})

test('refresh button renders in the schools top bar (mobile)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAsTeacher(page)
  await page.locator('.schools-topbar').screenshot({ path: resolve(SHOTS, 'refresh-topbar-mobile.png') })
})
