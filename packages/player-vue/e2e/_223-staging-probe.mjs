// #223 live probe — the not-ready tap is ANSWERED, and opening Settings is no
// longer a pause tap. Staging strips console.log (vite `pure`), so everything
// here is proved from the DOM and from the /api/player-events wire.
//
//   TMPDIR=/home/tomcassidy/.tmpbig/p223 \
//   CHROME_PATH=/home/tomcassidy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
//   node packages/player-vue/e2e/_223-staging-probe.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT || '/home/tomcassidy/.tmpbig/p223'
fs.mkdirSync(OUT, { recursive: true })

const live = await fetch(`${BASE}/version.json`, { cache: 'no-store' }).then(r => r.json())
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

const IPHONE = {
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
}

/** Every player event this page posted, read off the wire. */
function watchEvents(page, sink) {
  page.on('request', req => {
    if (!req.url().includes('/api/player-events')) return
    try {
      for (const e of JSON.parse(req.postData() || '{}').events || []) sink.push(e)
    } catch { /* a beacon we cannot parse tells us nothing either way */ }
  })
}

const results = {}

// ── A. A transport tap while the player is NOT READY ────────────────────────
// The awakening window is forced by holding the data reads: that is the same
// shape as the p90 10.5s / p99 46s cold starts in production, just reliable.
{
  const ctx = await browser.newContext({ ...IPHONE, serviceWorkers: 'allow' })
  const page = await ctx.newPage()
  const events = []
  watchEvents(page, events)
  await page.route(/supabase\.co/, async route => {
    await new Promise(r => setTimeout(r, 30000))
    await route.continue().catch(() => {})
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForSelector('.loading-text', { timeout: 30000 })
  const before = (await page.locator('.loading-text').first().innerText()).trim()
  await page.screenshot({ path: `${OUT}/a1-awakening-before-tap.png` })

  await page.locator('.center-btn').click()
  await page.waitForTimeout(400)
  const acknowledged = await page.locator('.loading-text.tap-acknowledged').count()
  const after = (await page.locator('.loading-text').first().innerText()).trim()
  await page.screenshot({ path: `${OUT}/a2-awakening-after-tap.png` })

  // The refusal is recorded. Flush is every 5s; give it two windows.
  await page.waitForTimeout(12000)
  const ignored = events.filter(e => e.event_type === 'tap_ignored')
  results.A = {
    lineBeforeTap: before,
    lineAfterTap: after,
    acknowledgedNodes: acknowledged,
    tapIgnoredRows: ignored.length,
    tapIgnoredPayload: ignored[0]?.payload ?? null,
    tapPauseRows: events.filter(e => e.event_type === 'tap_pause').length,
    tapPlayRows: events.filter(e => e.event_type === 'tap_play').length,
  }
  await ctx.close()
}

// ── B. Opening Settings on a ready player is NOT a pause tap ────────────────
{
  const ctx = await browser.newContext({ ...IPHONE, serviceWorkers: 'allow' })
  const page = await ctx.newPage()
  const events = []
  watchEvents(page, events)
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForTimeout(12000)                       // let it reach ready
  await page.locator('.nav-content .pill-btn').last().click()   // the gear
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/b1-settings-open.png` })
  await page.waitForTimeout(12000)                       // two flush windows
  results.B = {
    settingsVisible: await page.locator('.settings-overlay').count(),
    tapPauseRows: events.filter(e => e.event_type === 'tap_pause').length,
    allEventTypes: [...new Set(events.map(e => e.event_type))].sort(),
  }
  await ctx.close()
}

await browser.close()

const ok =
  results.A.acknowledgedNodes === 1 &&
  /Got you/.test(results.A.lineAfterTap) &&
  results.A.tapIgnoredRows >= 1 &&
  results.A.tapPauseRows === 0 &&
  results.B.settingsVisible >= 1 &&
  results.B.tapPauseRows === 0

console.log('live build', live.buildNumber, live.buildBranch)
console.log(JSON.stringify(results, null, 2))
console.log(ok ? 'PASS' : 'FAIL')
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ live, results, ok }, null, 2))
process.exit(ok ? 0 : 1)
