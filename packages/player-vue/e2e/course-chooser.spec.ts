import { test, expect } from '@playwright/test'

// Regression: prod incident 2026-07-18 — fd382b27 gave the full-viewport
// .learning-player-root an unconditional z-index:100, which put a transparent
// tap-shield over PlayerRestingState (z-50). The resting UI looked perfectly
// normal but received zero pointer events, so the course name — the chooser's
// only trigger — was dead for every user and nobody could change course.
//
// Everything here uses REAL hit-tested clicks (never programmatic .click()
// via evaluate): the whole failure mode is "the element is fine but a layer
// above it eats the tap", which only hit-testing can catch.
//
// Needs a live course catalogue (deployed build, or a dev server with
// Supabase env). Without one the resting state never shows a course name and
// the suite skips rather than false-fails.

const courseName = '.course-name--tappable'

test.describe('Course chooser', () => {
  test('resting-state course name is tappable and switches course', async ({ page }) => {
    await page.goto('/')

    const trigger = page.locator(courseName).first()
    const hasCatalogue = await trigger
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!hasCatalogue, 'no course catalogue (dev server without Supabase env)')

    const initial = (await trigger.innerText()).trim()

    // The incident's exact repro: a real tap on the course name. With a
    // tap-shield present this times out with "<layer> intercepts pointer events".
    await trigger.click({ timeout: 10_000 })
    await expect(page.locator('.selector-overlay')).toBeVisible()

    // Pick a different course. Group rows with variants expand instead of
    // selecting, so choose a row that doesn't mention variants and isn't the
    // current course.
    const rows = page.locator('.course-row')
    const count = await rows.count()
    expect(count).toBeGreaterThan(1)
    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim()
      if (text.toLowerCase().includes('variant')) continue
      if (text.toLowerCase().includes(initial.toLowerCase())) continue
      await rows.nth(i).click()
      break
    }

    await expect(page.locator('.selector-overlay')).toBeHidden({ timeout: 10_000 })
    await expect(trigger).not.toHaveText(initial, { timeout: 15_000 })

    // And back again — the chooser must keep working after a switch.
    const switched = (await trigger.innerText()).trim()
    await trigger.click({ timeout: 10_000 })
    await expect(page.locator('.selector-overlay')).toBeVisible()
    await page.locator('.course-row').filter({ hasText: initial }).first().click()
    await expect(trigger).not.toHaveText(switched, { timeout: 15_000 })
  })

  test('blocking-overlay elevation still outranks the resting state', async ({ page }) => {
    await page.goto('/')
    await page.locator('.learning-player-root').waitFor({ state: 'attached', timeout: 15_000 })

    // The counterpart guarantee (the original fd382b27 purpose): while a
    // blocking overlay is up, the player root must outrank .resting-state's
    // z-index:50 so the paywall card is reachable — but ONLY then.
    const z = await page.evaluate(() => {
      const root = document.querySelector('.learning-player-root') as HTMLElement
      const normally = getComputedStyle(root).zIndex
      root.classList.add('has-blocking-overlay')
      const elevated = getComputedStyle(root).zIndex
      root.classList.remove('has-blocking-overlay')
      return { normally, elevated }
    })
    expect(z.normally).toBe('auto')
    expect(Number(z.elevated)).toBeGreaterThan(50)
  })
})
