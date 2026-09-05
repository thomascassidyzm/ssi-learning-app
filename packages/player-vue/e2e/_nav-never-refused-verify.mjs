// #513 verification: a real belt tap, driven in a real browser against a LOCAL
// build of this branch. Asserts the two things the ruling is about:
//   1. the tap LANDS (the round on screen moves to the tapped belt), and
//   2. no refusal sentence appears — at most the waiting line.
// Telemetry is checked separately against live player_events.
import { chromium } from '@playwright/test'

const BASE = process.env.PROBE_URL || 'http://127.0.0.1:5199/'
const COURSE = process.env.PROBE_COURSE || 'zho_for_eng'
const TAPS = (process.env.PROBE_BELTS || 'orange,blue').split(',')

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
const page = await ctx.newPage()
const errs = []; const logs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)))
page.on('console', (m) => { const t = m.text(); if (/Belt|belt|ALARM|Skipping to|Jumping to|unresolved|Round forward/.test(t)) logs.push(t.slice(0, 200)) })

await page.addInitScript((c) => { try { localStorage.setItem('ssi-last-course', c) } catch {} }, COURSE)
const u = new URL(BASE); u.searchParams.set('course', COURSE)
await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForSelector('.center-btn', { timeout: 90000 }).catch(() => {})
await page.waitForTimeout(4000)
const resting = page.locator('.player-resting-state button, .resting-cta').first()
if (await resting.count()) await resting.click({ timeout: 5000 }).catch(() => {})
await page.waitForTimeout(1500)
await page.locator('.bottom-nav .center-btn').first().click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(8000)

const readState = () => page.evaluate(() => ({
  body: (document.body.innerText || '').slice(0, 400),
  tip: (document.querySelector('.mode-tip')?.textContent || '').trim(),
  pill: (document.querySelector('button[aria-label*="Tap to jump to a belt"]')?.getAttribute('aria-label') || ''),
}))

// PROBE_OFFLINE: go offline BEFORE the tap, so the target belt genuinely
// cannot be fetched. This is the India case and the only way to see the
// waiting state on a real screen.
if (process.env.PROBE_OFFLINE) { await ctx.setOffline(true); await page.waitForTimeout(1500) }

const results = []
for (const belt of TAPS) {
  const before = await readState()
  // Open the belt pill modal, then tap the belt chip by its aria-label.
  await page.locator('button[aria-label*="Tap to jump to a belt"]').first().click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const chip = page.locator(`.map-chip[aria-label*="${belt.charAt(0).toUpperCase() + belt.slice(1)}"]`).first()
  const found = await chip.count()
  const disabled = found ? await chip.getAttribute('disabled') : 'n/a'
  if (found) await chip.click({ timeout: 8000 }).catch(() => {})
  // Catch the waiting line while it is up: it appears immediately and the
  // bounded retry loop runs for ~31s behind it.
  await page.waitForTimeout(3000)
  const tipEarly = (await readState()).tip
  await page.waitForTimeout(Number(process.env.PROBE_WAIT_MS || 12000))
  const after = await readState()
  after.tipEarly = tipEarly
  results.push({ belt, chipFound: !!found, chipDisabled: disabled, tip: after.tip, tipEarly: after.tipEarly, before: before.body.slice(0, 160), after: after.body.slice(0, 160) })
}

const sessionId = await page.evaluate(() => { try { return sessionStorage.getItem('ssi-session-id') || localStorage.getItem('ssi-session-id') } catch { return null } })
await browser.close()
console.log(JSON.stringify({ course: COURSE, sessionId, results, logs: logs.slice(-40), jsErrors: errs.slice(0, 5) }, null, 2))
