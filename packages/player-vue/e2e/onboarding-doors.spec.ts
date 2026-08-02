import { test, expect, type Page } from '@playwright/test'

/**
 * The signup doors, driven in a real browser against the live catalogue.
 * READ-ONLY: stops at the "Send my code" boundary — never sends an OTP email.
 *
 * What these assert (the door contract):
 *   /schools1  — the HERITAGE door, and since 2026-08-02 the ONLY school door.
 *                Welsh N/S + Irish pinned first, then the rest of the 365-day
 *                offer, then the REST OF THE CATALOGUE (inherited from the
 *                retired /schools2). "Free for a year" badges discriminate
 *                within the merged list; search works; a free-tier pick
 *                promises 365 days.
 *   /schools2  — RETIRED: a pure redirect to /schools1, query + hash preserved.
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

test.describe('/schools1 — the heritage door, now the only school door', () => {
  test('lists the whole catalogue, pinned and searchable, and promises 365 days', async ({ page }) => {
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

    // Badges now DISCRIMINATE: the door lists the whole catalogue (merged in
    // when /schools2 retired), so the year-free set is marked and the
    // commercial courses are not. Spanish for English speakers is the canonical
    // unbadged case — and its presence is the proof no course became
    // unreachable when the English-first door closed.
    const badges = page.locator('.ob-known-menu .ob-tier')
    expect(await badges.count(), 'year-free badges should render').toBeGreaterThan(10)
    await page.locator('.ob-known-search').fill('spanish')
    const spanishOpt = page.locator('.ob-known-opt').first()
    await expect(spanishOpt).toContainText(/Spanish/i)
    await expect(spanishOpt.locator('.ob-tier')).toHaveCount(0)
    await page.locator('.ob-known-search').fill('')

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

test.describe('/schools2 — retired, kept alive as a redirect', () => {
  test('redirects to /schools1 preserving query and hash', async ({ page }) => {
    const { pageErrors } = attachObservers(page)
    await openDoor(page, '/schools2?utm_source=leaflet#top')

    await expect(page).toHaveURL(/\/schools1\?utm_source=leaflet#top$/)
    // The real door rendered — not a blank redirect shell.
    await expect(page.locator('.ob-known')).toContainText('Choose a language')

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
