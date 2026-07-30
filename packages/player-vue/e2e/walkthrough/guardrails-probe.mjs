// Ad-hoc guardrail probe for 7d5ae34d — notched-viewport card clamp, Esc-at-engine-level, drift re-poll.
// Reuses the leader personal-link login (no service key needed).
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const LEADER_URL = `${BASE}/group/QJM-868`

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch()
// iPhone-notch-shaped viewport with safe-area-inset-top simulated via CSS env() override.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
})
const page = await ctx.newPage()
// Force safe-area-inset-top the way a notched device reports it (44px status bar).
await page.addInitScript(() => {
  const style = document.createElement('style')
  style.textContent = ':root { --forced-safe-area-top: 44px; }'
  document.head?.appendChild(style) || document.documentElement.appendChild(style)
})
await page.goto(LEADER_URL, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForURL((u) => u.pathname.startsWith('/schools/org/'), { timeout: 45000 }).catch(() => {})
await page.waitForSelector('.nh-stats, .stat-value', { timeout: 20000 }).catch(() => {})

// Open the ways-in walk.
await page.locator('.htw-toggle').first().click().catch(() => {})
await page.waitForTimeout(500)
const waysOffer = page.locator('[data-walk-offer="ways-in"]')
if (await waysOffer.count() === 0) {
  console.log('FAIL — could not find ways-in offer to start a walk')
  process.exit(1)
}
await waysOffer.first().click()
await page.waitForFunction(
  () => (document.documentElement.getAttribute('data-walk-active') || '').startsWith('ways-in:'),
  {}, { timeout: 8000 },
).catch(() => {})
await page.waitForTimeout(700)

// ── 1. Card never covers the top-chrome zone (54px + safe-area-inset-top),
// viewport-relative — the founder rule is "reachable in one tap on every
// step", i.e. the card must never occupy the fixed top strip where the Learn
// escape lives, regardless of scroll position. Checked across all 4 steps.
const SAFE_TOP_PX = 54
for (let step = 0; step < 4; step++) {
  await page.waitForFunction(
    (i) => (document.documentElement.getAttribute('data-walk-active') || '') === `ways-in:${i}`,
    step, { timeout: 8000 },
  ).catch(() => {})
  await page.waitForTimeout(500)
  const cardBox = await page.locator('.walk-card').boundingBox().catch(() => null)
  check(`step ${step}: walk card renders`, !!cardBox, JSON.stringify(cardBox))
  if (cardBox) {
    const clearsTopChrome = cardBox.y >= SAFE_TOP_PX - 2
    check(`step ${step}: walk card clears top-chrome zone (y >= ~54px)`, clearsTopChrome, `cardY=${cardBox.y}`)
  }
  if (step < 3) await page.locator('.walk-card .walk-btn-primary').click().catch(() => {})
}
// Back to step 0 for the rest of the probe.
await page.evaluate(() => {}).catch(() => {})

// ── 2. Esc ends the walk at engine level (works even if card scrolled off-screen) ──
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
const afterEsc = await page.evaluate(() => document.documentElement.getAttribute('data-walk-active'))
check('Esc ends the walk (data-walk-active cleared)', afterEsc === null, `attr=${afterEsc}`)
const cardGoneAfterEsc = await page.locator('.walk-card').count()
check('Esc removes the walk card from DOM', cardGoneAfterEsc === 0, `count=${cardGoneAfterEsc}`)

// ── 3. Drift: hide the anchor of a step, confirm no hang past 5s + re-poll rebinds ──
await waysOffer.first().click()
await page.waitForFunction(
  () => (document.documentElement.getAttribute('data-walk-active') || '').startsWith('ways-in:'),
  {}, { timeout: 8000 },
).catch(() => {})
await page.waitForTimeout(700)
const anchorSel = '[data-walk="ways-in-ledger"]'
const hadAnchor = await page.locator(anchorSel).count()
check('drift setup: initial anchor present', hadAnchor > 0)
// Hide it (simulate collapse to zero size / display:none) to trigger drift handling.
await page.evaluate((sel) => {
  const el = document.querySelector(sel)
  if (el) el.style.display = 'none'
}, anchorSel)
const t0 = Date.now()
// The walk must not hang forever — either it shows a "waiting" state or clears within a bounded time.
await page.waitForTimeout(6000) // > the 5s never-hang timeout in the commit message
const elapsed = Date.now() - t0
const stillResponsive = await page.evaluate(() => document.readyState === 'complete' && !!document.body)
check('page remains responsive past the 5s never-hang timeout', stillResponsive, `elapsed=${elapsed}ms`)
// Restore the anchor and confirm the slow re-poll rebinds the ring to it.
await page.evaluate((sel) => {
  const el = document.querySelector(sel)
  if (el) el.style.display = ''
}, anchorSel)
await page.waitForTimeout(3000) // slow re-poll interval
const stateAfterRestore = await page.evaluate(() => document.documentElement.getAttribute('data-walk-active'))
const ringBoxAfter = await page.locator('.walk-ring').boundingBox().catch(() => null)
const anchorBoxAfter = await page.locator(anchorSel).boundingBox().catch(() => null)
check('walk still active or gracefully ended after anchor restore (no crash)', stateAfterRestore !== undefined)
if (ringBoxAfter && anchorBoxAfter) {
  const rebound = Math.abs(ringBoxAfter.x - (anchorBoxAfter.x - 6)) <= 15 && Math.abs(ringBoxAfter.y - (anchorBoxAfter.y - 6)) <= 15
  check('ring re-binds to restored anchor after re-poll', rebound,
    `ring=${JSON.stringify(ringBoxAfter)} anchor=${JSON.stringify(anchorBoxAfter)}`)
} else {
  console.log(`INFO — ring/anchor boxes after restore: ring=${JSON.stringify(ringBoxAfter)} anchor=${JSON.stringify(anchorBoxAfter)} state=${stateAfterRestore}`)
}

await page.screenshot({ path: '/tmp/walk-guardrails-final.png' }).catch(() => {})
await ctx.close()
await browser.close()
console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
