/**
 * SchoolsTopBar mobile layout — real-browser bounding-box verification.
 *
 * 2026-07-16 teacher-loop audit: at phone widths the hamburger was squashed
 * to a ~2px tap target, the Learn button overlapped the wordmark, and the
 * avatar chip overlapped both. Checked at 320/375/430px (the audited range).
 *
 * Uses the dev-only `window.__setSchoolsE2EUser` hook (useSchoolContext.ts)
 * to render SchoolsTopBar as a signed-in teacher WITHOUT a real Supabase
 * session — happy-dom (the unit-test environment) never computes real CSS
 * layout, so genuine bounding-box assertions need an actual browser; this
 * hook gets there without live auth/DB dependencies.
 */
import { test, expect, type Page } from '@playwright/test'

const VIEWPORTS = [320, 375, 430]

async function signInAsTeacher(page: Page) {
  await page.goto('/schools')
  // Both singletons SchoolsContainer's showDashboard gate reads: the role
  // cache (canAccessSchools = isTeacher || isSsiAdmin) and the school
  // context (currentUser). Real auth resolution (isAuthLoading) still runs
  // its normal course against the real anon Supabase client — no session is
  // found, so it resolves quickly on its own.
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
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

test.describe('SchoolsTopBar — mobile layout (320/375/430px)', () => {
  for (const width of VIEWPORTS) {
    test(`no overlaps and >=44px tap targets at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 })
      await signInAsTeacher(page)

      const navToggle = await page.locator('.nav-toggle').boundingBox()
      const brand = await page.locator('.brand').boundingBox()
      const learnBtn = await page.locator('.learn-btn').boundingBox()
      const userTrigger = await page.locator('.user-trigger').boundingBox()

      expect(navToggle, 'hamburger must be present').toBeTruthy()
      expect(brand, 'brand/logo must be present').toBeTruthy()
      expect(learnBtn, 'Learn button must be present').toBeTruthy()
      expect(userTrigger, 'user menu trigger must be present').toBeTruthy()

      // Tap-target floor (WCAG 2.5.5 / the audit's explicit ask).
      expect(navToggle!.width, 'hamburger width').toBeGreaterThanOrEqual(44)
      expect(navToggle!.height, 'hamburger height').toBeGreaterThanOrEqual(44)
      expect(learnBtn!.width, 'Learn button width').toBeGreaterThanOrEqual(44)
      expect(learnBtn!.height, 'Learn button height').toBeGreaterThanOrEqual(44)
      expect(userTrigger!.height, 'user menu trigger height').toBeGreaterThanOrEqual(44)

      // No two of the four top-bar elements may overlap.
      const boxes = { navToggle: navToggle!, brand: brand!, learnBtn: learnBtn!, userTrigger: userTrigger! }
      const names = Object.keys(boxes) as (keyof typeof boxes)[]
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const overlap = rectsOverlap(boxes[names[i]], boxes[names[j]])
          expect(overlap, `${names[i]} must not overlap ${names[j]} at ${width}px`).toBe(false)
        }
      }

      // Nothing should spill past the viewport's right edge.
      for (const name of names) {
        expect(boxes[name].x + boxes[name].width, `${name} must stay within the ${width}px viewport`).toBeLessThanOrEqual(width)
      }
    })
  }
})
