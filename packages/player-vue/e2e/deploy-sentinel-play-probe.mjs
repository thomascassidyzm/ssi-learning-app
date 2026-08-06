// DEPLOY SENTINEL — live play probe. Loads production in a real headless
// browser, starts the player, and verifies the whole learner loop: page renders
// without JS errors AND the client's telemetry batch POSTs to
// /api/player-events with a 2xx. This is the deterministic "can a learner
// actually play?" check the sentinel uses to confirm/refute a telemetry-volume
// crater (volume alone false-alarms at small-N traffic hours — see
// tools/deploy-sentinel/README.md).
//
//   CHROME_BIN=<chromium binary> node e2e/deploy-sentinel-play-probe.mjs
//   (the sentinel sets LD_LIBRARY_PATH for the nspr/nss libs on watson-1)
//
// Prints one JSON line: { ok, jsErrors, telemetryPosts, screen } — exit 1 on fail.
import { chromium } from '@playwright/test'

const PROD = process.env.PROBE_URL || 'https://saysomethingin.app/'
const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const page = await (await browser.newContext()).newPage()
const jsErrors = []
const telemetryPosts = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 150)))
page.on('response', (r) => {
  if (r.url().includes('player-events')) telemetryPosts.push(r.status())
})

await page.goto(PROD, { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(3000)
// Start playback — first matching affordance wins (guest landing player).
for (const sel of ['button:has-text("Ready when you are")', '.play-button', 'button[aria-label*="lay"]', '.player-start', 'text=Ready when you are']) {
  const el = page.locator(sel).first()
  if (await el.count()) { await el.click({ timeout: 3000 }).catch(() => {}); break }
}
// Let cycles run and the client's event buffer flush (it batches every few seconds).
await page.waitForTimeout(35000)

const screen = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => 'EVAL_FAIL')
const ok = jsErrors.length === 0 && telemetryPosts.some((s) => s >= 200 && s < 300) && screen !== 'EVAL_FAIL'
console.log(JSON.stringify({ ok, jsErrors, telemetryPosts, screen }))
await browser.close()
process.exit(ok ? 0 : 1)
