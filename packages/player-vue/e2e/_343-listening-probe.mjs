// Job #343: headless play-through on staging — main flow, then Listening Mode
// through several clips. Captures pageerrors, console errors, every
// /api/player-events POST body, and the belt-jump strip's rendered pip count.
import { chromium } from '@playwright/test'
const URL = process.env.PROBE_URL || 'https://staging.saysomethingin.app/'
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await (await browser.newContext()).newPage()
const jsErrors = [], consoleErrors = [], posts = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
page.on('request', (r) => {
  if (r.url().includes('/api/player-events') && r.method() === 'POST') {
    try { posts.push(JSON.parse(r.postData() || '{}')) } catch { posts.push({ parseError: true }) }
  }
})
const out = { url: URL }
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(8000)
const start = page.locator('.center-btn').first()
out.startFound = await start.count()
if (out.startFound) await start.click({ timeout: 5000 }).catch((e) => (out.startError = String(e).slice(0, 150)))
await page.waitForTimeout(30000)
out.timerAfterMain = await page.evaluate(() => (document.body.innerText.match(/\d+:\d\d/) || [null])[0]).catch(() => null)
// Into Listening Mode
const trig = page.locator('.mode-trigger').first()
out.modeTriggerFound = await trig.count()
if (out.modeTriggerFound) {
  await trig.click({ timeout: 5000 }).catch((e) => (out.trigError = String(e).slice(0, 150)))
  await page.waitForTimeout(1500)
  const items = page.locator('.tray-item')
  out.trayItems = await items.allInnerTexts().catch(() => [])
  const listen = items.filter({ hasText: /listen/i }).first()
  out.listenItemFound = await listen.count()
  if (out.listenItemFound) await listen.click({ timeout: 5000 }).catch((e) => (out.listenError = String(e).slice(0, 150)))
  await page.waitForTimeout(10000)
  out.beltJumpPips = await page.locator('.belt-jump-pip').count()
  out.phraseRows = await page.locator('.phrase-row').count()
  const row = page.locator('.phrase-row').first()
  if (await row.count()) await row.click({ timeout: 5000 }).catch((e) => (out.rowError = String(e).slice(0, 150)))
  await page.waitForTimeout(50000)
  out.screenTail = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => 'EVAL_FAIL')
}
// Summarise telemetry posts
const sessions = new Set(), counts = {}
for (const p of posts) for (const ev of p.events || []) {
  if (ev.session_id) sessions.add(ev.session_id)
  const k = `${ev.event_type}${ev.payload?.mode ? ':' + ev.payload.mode : ''}`
  counts[k] = (counts[k] || 0) + 1
}
out.sessions = [...sessions]; out.eventCounts = counts; out.posts = posts.length
out.jsErrors = jsErrors; out.consoleErrors = consoleErrors.slice(0, 10)
console.log(JSON.stringify(out, null, 1))
await browser.close()
