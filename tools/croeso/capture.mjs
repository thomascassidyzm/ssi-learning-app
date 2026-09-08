/**
 * Re-shoot the Canolfan welcome pack's pictures against the real app.
 *
 * Nothing in the pack is a mock-up. Every picture is the running app at a
 * phone viewport, driven through the actual journey a Canolfan learner takes.
 * When a screen changes, re-run this rather than editing a picture.
 *
 *   TMPDIR=/tmp \
 *   LD_LIBRARY_PATH=~/.ssi-sentinel-libs \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
 *   OUT_DIR=/some/scratch/shots \
 *   SESSION_JSON=/some/scratch/session.json \
 *   node tools/croeso/capture.mjs
 *
 * TMPDIR=/tmp is not optional: "Socket path too long" is the scratch
 * directory, not a missing library. LD_LIBRARY_PATH is: there is no system
 * Chrome here and the bundled one cannot find libnspr4 without it.
 *
 * SESSION_JSON holds { storageKey, session } for a signed-in test learner —
 * a Supabase session written straight into localStorage. It exists so this
 * script never has to make the app send a sign-in email: the one screen that
 * would need one (the six-digit code step) is reached with the OTP request
 * answered locally, so no mail leaves the building for a screenshot.
 *
 * Afterwards, delete the test learner's rows. A screenshot run that leaves an
 * enrolment behind inflates the funder's own count of its cohort.
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const CODE = process.env.ENROL_CODE || 'ZMN-561'
const OUT = (process.env.OUT_DIR || './croeso-shots') + '/'
fs.mkdirSync(OUT, { recursive: true })
const S = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))

// Anything a real learner never sees is gone before the shutter: the env
// badge, the dev reset, the guest nudge, the build/version card.
const HIDE = `.env-label,.env-reset,.guest-progress-nudge,#eruda,.eruda-container,
  [class^="build-"],[class*=" build-"],.whats-new,[class^="whats-new"]{display:none!important}`

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})

async function context({ signedIn = false, ua = null, welshUi = false } = {}) {
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'en-GB',
    ...(ua ? { userAgent: ua, isMobile: true, hasTouch: true } : {}),
  })
  if (signedIn) {
    await c.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
      [S.storageKey, JSON.stringify(S.session)])
  }
  if (welshUi) {
    await c.addInitScript(() => {
      try { localStorage.setItem('ssi-locale', 'cym'); localStorage.setItem('ssi-locale-source', 'chosen') } catch { /* ditto */ }
    })
  }
  return c
}

async function shot(page, name) {
  await page.addStyleTag({ content: HIDE }).catch(() => {})
  await page.waitForTimeout(400)
  await page.screenshot({ path: OUT + name + '.png' })
  console.log('shot', name)
}

// ── the enrolment flow, signed out ─────────────────────────────────────────
{
  const c = await context()
  const p = await c.newPage()
  await p.route('**/auth/v1/otp*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await p.goto(`${BASE}/enrol/${CODE}`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(5000)
  await shot(p, '01-intro')
  await p.click('.enrol-primary'); await p.waitForTimeout(800)
  await p.fill('.enrol-input', 'enw@example.com'); await p.waitForTimeout(300)
  await shot(p, '03-email-typed')
  await p.click('.enrol-primary'); await p.waitForTimeout(1500)
  await shot(p, '04-code')
  await c.close()
}

// ── the ticks, the confirmation ────────────────────────────────────────────
{
  const c = await context({ signedIn: true })
  const p = await c.newPage()
  await p.goto(`${BASE}/enrol/${CODE}`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(6000)
  await p.locator('.enrol-primary').first().click(); await p.waitForTimeout(1200)
  await p.locator('input[type=checkbox]').nth(1).check({ force: true }); await p.waitForTimeout(400)
  await shot(p, '06-ticks-ticked')
  await p.locator('.enrol-primary').first().click(); await p.waitForTimeout(6000)
  await shot(p, '07-done')
  await c.close()
}

// ── choosing Welsh, and the dialect ────────────────────────────────────────
{
  const c = await context({ signedIn: true })
  const p = await c.newPage()
  await p.goto(`${BASE}/?openCourses=1`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(8000)
  // The search box, not a scroll: Welsh sits below the fold behind a
  // "2 variants" expander, and telling a nervous learner to scroll a modal
  // is exactly where they stall.
  await p.locator('input[placeholder*="Search"]').first().fill('Welsh')
  await p.waitForTimeout(1200)
  await shot(p, '10-picker-search-welsh')
  await p.getByText('2 variants').first().click()
  await p.waitForTimeout(1200)
  await shot(p, '11-picker-variants')
  await c.close()
}

// ── the player: at rest, mid-gap, and showing the answer ───────────────────
{
  const c = await context({ signedIn: true })
  const p = await c.newPage()
  await p.goto(`${BASE}/?course=cym_n_for_eng`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(10000)
  await shot(p, '12-player-ready')
  await p.locator('.center-btn').first().click({ timeout: 15000 })
  // A cycle is ~11s; walk a couple of them and keep the frames that land on
  // the speaking gap and on the revealed answer.
  for (let i = 0; i < 10; i++) { await p.waitForTimeout(2500); await shot(p, '13-play-' + i) }
  await c.close()
}

// ── the app's own install walkthrough, per platform ────────────────────────
const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
}
for (const [tag, ua] of Object.entries(UA)) {
  const c = await context({ signedIn: true, ua })
  const p = await c.newPage()
  await p.goto(`${BASE}/install`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(5000)
  for (let i = 0; i < 4; i++) {
    await shot(p, `20-install-${tag}-${i}`)
    const next = p.getByRole('button', { name: /next/i }).first()
    if (!(await next.count())) break
    await next.click().catch(() => {})
    await p.waitForTimeout(1200)
  }
  await c.close()
}

// ── settings, signing back in, and the Welsh interface ─────────────────────
{
  const c = await context()
  const p = await c.newPage()
  await p.goto(`${BASE}/?course=cym_n_for_eng`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(9000)
  const buttons = await p.locator('button').all()
  await buttons[buttons.length - 1].click()   // the cog, last in the bottom nav
  await p.waitForTimeout(2500)
  await shot(p, '41-settings-signedout')
  await p.getByText('Interface Language').first().click()
  await p.waitForTimeout(2000)
  await shot(p, '43-interface-language')
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000)
  const b2 = await p.locator('button').all()
  await b2[b2.length - 1].click(); await p.waitForTimeout(2500)
  await p.getByRole('button', { name: /^sign in$/i }).first().click()
  await p.waitForTimeout(2500)
  await shot(p, '42-signin')
  await c.close()
}
{
  const c = await context({ welshUi: true })
  const p = await c.newPage()
  await p.goto(`${BASE}/?course=cym_n_for_eng`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(10000)
  await shot(p, '46-welsh-ui-player')
  await c.close()
}

await browser.close()
console.log('\nPictures are 390x844 at 2x. tools/croeso/shots/ holds them cropped')
console.log('and downscaled to 390px wide JPEGs — see the pack build for why.')
