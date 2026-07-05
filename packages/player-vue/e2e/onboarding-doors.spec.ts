import { test, expect, type Page } from '@playwright/test'

/**
 * The three signup doors, driven in a real browser against the live catalogue.
 * READ-ONLY: stops at the "Send my code" boundary — never sends an OTP email.
 *
 * What these assert (the door contract):
 *   /schools1  — the HERITAGE door lists the whole 365-day offer (30+ courses,
 *                derived from pricing_tier + Welsh), Welsh N/S + Irish pinned
 *                first, search works, no badges (the offer IS the door), a
 *                free-tier pick promises 365 days.
 *   /schools2  — English-first door; "Free for a year" badges mark qualifying
 *                targets in the dropdown; Welsh promises 365 days.
 *   /tutors    — NO year badges anywhere and a free-tier pick promises 30 days
 *                (the tutor trial is 30 days regardless of course).
 */

function attachObservers(page: Page) {
  const pageErrors: Error[] = []
  page.on('pageerror', (err) => pageErrors.push(err))
  return { pageErrors }
}

async function openDoor(page: Page, path: string) {
  // Attach the listener BEFORE goto — the catalogue fetch fires onMounted and
  // could otherwise land before waitForResponse starts listening.
  const catalogue = page.waitForResponse(
    (r) => r.url().includes('/api/courses/available') && r.ok(),
    { timeout: 15_000 }
  )
  await page.goto(path)
  await catalogue
}

test.describe('/schools1 — the year-free heritage door', () => {
  test('lists the whole 365-day offer, pinned and searchable, and promises 365 days', async ({ page }) => {
    const { pageErrors } = attachObservers(page)
    await openDoor(page, '/schools1')

    // Course-level trigger, no premature selection.
    const trigger = page.locator('.ob-known')
    await expect(trigger).toContainText('Choose a language')
    await trigger.click()

    // The derived pool: far more than the old hardcoded 3, pinned order intact.
    const options = page.locator('.ob-known-opt')
    const count = await options.count()
    expect(count, 'heritage door should list the whole year-free set').toBeGreaterThan(25)
    await expect(options.nth(0)).toContainText('North Welsh')
    await expect(options.nth(1)).toContainText('South Welsh')
    await expect(options.nth(2)).toContainText('Irish')

    // No badges here — everything on this door qualifies by construction.
    await expect(page.locator('.ob-known-menu .ob-tier')).toHaveCount(0)

    // Search surfaces a language the old door hid; picking it commits the course.
    await page.locator('.ob-known-search').fill('armen')
    await expect(options).toHaveCount(1)
    await options.first().click()
    await expect(page.locator('.ob-claim-endonym')).toContainText('Armenian')
    await expect(page.locator('.ob-claim-echo')).toContainText('Free for 365 days')

    // Send stays disabled until an email is present; enabling never fires a send.
    const send = page.getByRole('button', { name: 'Send my code' })
    await expect(send).toBeDisabled()
    await page.locator('#ob-email').fill('door-e2e@example.com')
    await expect(send).toBeEnabled()

    expect(pageErrors, 'uncaught JS exceptions').toEqual([])
  })
})

test.describe('/schools2 — the English-first school door', () => {
  test('badges year-free targets in the dropdown; Welsh promises 365 days', async ({ page }) => {
    const { pageErrors } = attachObservers(page)
    await openDoor(page, '/schools2')

    const trigger = page.locator('.ob-known')
    await expect(trigger).toContainText('English')
    await trigger.click()

    // Badges present on qualifying targets, absent on English (premium).
    const badges = page.locator('.ob-known-menu .ob-tier')
    expect(await badges.count(), 'year-free badges should render').toBeGreaterThan(10)
    const englishOpt = page.locator('.ob-known-opt', { hasText: 'English' }).first()
    await expect(englishOpt.locator('.ob-tier')).toHaveCount(0)

    // Welsh is badged (the premium anomaly) and promises the year.
    await page.locator('.ob-known-search').fill('welsh')
    const welshOpt = page.locator('.ob-known-opt').first()
    await expect(welshOpt.locator('.ob-tier')).toContainText('Free for a year')
    await welshOpt.click()
    // Two learner-language rows (N/S variants), disambiguated.
    await page.locator('.ob-lang-row, .ob-lang-tile').first().click()
    await expect(page.locator('.ob-claim-echo')).toContainText('Free for 365 days')

    expect(pageErrors, 'uncaught JS exceptions').toEqual([])
  })
})

test.describe('/tutors — the tutor door', () => {
  test('never shows year badges; a free-tier pick promises 30 days', async ({ page }) => {
    const { pageErrors } = attachObservers(page)
    await openDoor(page, '/tutors')

    await page.locator('.ob-known').click()
    // The tutor trial is 30 days always — a "Free for a year" badge here would lie.
    await expect(page.locator('.ob-known-menu .ob-tier')).toHaveCount(0)

    // Irish is free-tier: on the SCHOOL doors it promises 365; here it must say 30.
    await page.locator('.ob-known-search').fill('irish')
    await page.locator('.ob-known-opt').first().click()
    // gle has one learner language → auto-selects to the claimed card.
    await expect(page.locator('.ob-claim-endonym')).toContainText('Irish')
    await expect(page.locator('.ob-claim-echo')).toContainText('Free for 30 days')

    expect(pageErrors, 'uncaught JS exceptions').toEqual([])
  })
})
