// DEPLOY SENTINEL — live play probe. Loads production in a real headless
// browser, ACTUALLY STARTS the player, and verifies the whole learner loop:
// playback begins (the session timer advances), the page renders without JS
// errors, and the client's telemetry batch POSTs to /api/player-events with a
// 2xx. This is the deterministic "can a learner actually play?" check the
// sentinel uses to confirm/refute a telemetry-volume crater (volume alone
// false-alarms at small-N traffic hours — see tools/deploy-sentinel/README.md).
//
//   CHROME_BIN=<chromium binary> node e2e/deploy-sentinel-play-probe.mjs
//   (the sentinel sets LD_LIBRARY_PATH for the nspr/nss libs on watson-1)
//
// Prints one JSON line and exits 1 unless `ok`:
//   { ok, verdict, reason, started, timer, jsErrors, telemetryPosts, audioFetches, screen }
//
// `verdict` is the important field — it separates two things the old probe
// conflated, which produced a 3am false "learners can't play" alarm on
// 2026-08-20 (triage: docs/a159-prod-triage/):
//   'healthy'      — playback started and the learner loop is intact.
//   'broken'       — the app is genuinely failing for learners. ALERT ON THIS.
//   'inconclusive' — the probe could not start playback (start control not
//                    found, click refused, headless environment). This says
//                    nothing about learners and must NOT be alarmed on.
// The old probe could never start playback at all — every selector it tried
// missed the real control and it clicked a <p class="hero-known"> paragraph,
// swallowing the failure with .catch(() => {}). Its passes came from a
// page-load telemetry flush, so pass/fail was a 35-second race, not a test.
import { chromium } from '@playwright/test'

const PROD = process.env.PROBE_URL || 'https://saysomethingin.app/'
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  // Headless Chromium blocks audio without a user gesture; the player's first
  // cycle would never fire and the probe would report a false failure.
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await (await browser.newContext()).newPage()
const jsErrors = []
const telemetryPosts = []
let audioFetches = 0
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 150)))
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('player-events')) telemetryPosts.push(r.status())
  else if (u.includes('/api/audio/')) audioFetches++
})

const readTimer = () =>
  page.evaluate(() => (document.body.innerText.match(/\d+:\d\d/) || [null])[0]).catch(() => null)

// Emit a verdict line and leave. NOTHING in this probe may throw its way out
// of the process: an uncaught exception prints a stack trace with no JSON, and
// the sentinel then has no way to tell "the probe fell over" from "learners
// can't play" — which is exactly the 2026-09-03 00:15 false alarm (a nav
// failure whose message was truncated to the useless `page.goto: `).
async function bail(verdict, reason) {
  console.log(JSON.stringify({ ok: false, verdict, reason, started: false, probeFault: true }))
  await browser.close().catch(() => {})
  process.exit(verdict === 'healthy' ? 0 : 1)
}
process.on('unhandledRejection', (e) => bail('probe-error', `unhandled rejection: ${String(e).replace(/\s+/g, ' ').slice(0, 300)}`))
process.on('uncaughtException', (e) => bail('probe-error', `uncaught exception: ${String(e).replace(/\s+/g, ' ').slice(0, 300)}`))

// Navigation. A cold CDN right after a deploy, a slow DNS answer or a page that
// never reaches `networkidle` are all PROBE-SIDE facts, not learner outages —
// one retry, then 'inconclusive'. `domcontentloaded` is the real bar: the SPA
// keeps sockets and audio in flight, so 'networkidle' is a coin toss under load.
let navError = null
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    await page.goto(PROD, { waitUntil: 'domcontentloaded', timeout: 45000 })
    navError = null
    break
  } catch (e) {
    navError = `attempt ${attempt}: ${String(e).replace(/\s+/g, ' ').slice(0, 300)}`
    if (attempt === 1) await page.waitForTimeout(5000)
  }
}
if (navError) await bail('inconclusive', `could not load ${PROD} in the probe browser — ${navError}`)

// The SPA needs a moment past DOMContentLoaded to mount its player.
await page.waitForTimeout(8000)
const timerBefore = await readTimer()
if (timerBefore === null) await bail('inconclusive', `page loaded but no session clock rendered within 8s of DOMContentLoaded at ${PROD}`)

// Start playback. These are the REAL guest-landing controls — the player's
// centre transport button and its accessible label. Text selectors are
// deliberately absent: 'text=Ready when you are' matches the hero PROMPT
// paragraph, not a control, and clicking it does nothing.
let clickedSelector = null
let startError = null
// `.center-btn` first: the "Tap player to start" label exists but is a
// zero-size overlay element, so clicking it times out.
for (const sel of ['.center-btn', '[aria-label="Tap player to start"]', '.play-button', 'button[aria-label*="lay"]', '.player-start']) {
  const el = page.locator(sel).first()
  if (!(await el.count())) continue
  clickedSelector = sel
  // No silent .catch() — a refused click is a fact the sentinel needs.
  await el.click({ timeout: 5000 }).catch((e) => { startError = String(e).slice(0, 150) })
  break
}
if (!clickedSelector) startError = 'no start control matched any known selector'

// Let cycles run and the client's event buffer flush (it batches every few seconds).
await page.waitForTimeout(35000)

const timerAfter = await readTimer()
const screen = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => 'EVAL_FAIL')
// Playback started iff the session clock actually moved off its initial value.
const started = !!(timerAfter && timerAfter !== timerBefore && timerAfter !== '0:00')
const gotTelemetry = telemetryPosts.some((s) => s >= 200 && s < 300)

let verdict, reason
if (screen === 'EVAL_FAIL') { verdict = 'broken'; reason = 'page body unreadable' }
else if (jsErrors.length) { verdict = 'broken'; reason = `JS errors: ${jsErrors[0]}` }
else if (!started) {
  // Could not drive the UI. Says nothing about real learners — the app may be
  // perfectly healthy (audio prefetch and telemetry below evidence that).
  verdict = 'inconclusive'
  reason = `could not start playback (${startError || 'timer did not advance'}); ` +
    `selector=${clickedSelector || 'none'}, audioFetches=${audioFetches}, telemetry=${telemetryPosts.join(',') || 'none'}`
} else if (!gotTelemetry) { verdict = 'broken'; reason = 'playback ran but no 2xx to /api/player-events' }
else { verdict = 'healthy'; reason = 'playback started and telemetry posted' }

const ok = verdict === 'healthy'
console.log(JSON.stringify({
  ok, verdict, reason, started,
  timer: { before: timerBefore, after: timerAfter },
  clickedSelector, startError,
  jsErrors, telemetryPosts, audioFetches, screen,
}))
await browser.close()
process.exit(ok ? 0 : 1)
