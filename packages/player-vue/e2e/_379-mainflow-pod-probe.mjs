// Job #379: does MAIN FLOW compose a Chinese pod lap for this account on a
// deployed build? Signs in with an injected Supabase session, forces the
// course via ?course=, arms ?pod=1 (force a lap at the first boundary that
// can produce one), taps play, and records: the scheduler's cheat/fallback
// warnings, every pod_lap_* player event, and the DOM's pod state.
// PROBE_URL, SESSION_JSON, COURSE, OUT_DIR, TAG, WAIT_MS.
import { chromium } from '@playwright/test'
import fs from 'fs'
const URL = process.env.PROBE_URL
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const WAIT = Number(process.env.WAIT_MS || 150000)
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
await ctx.addInitScript(({ ref, sess, course }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess))
  localStorage.setItem('ssi-last-course', course)
  localStorage.setItem('ssi-last-course-origin', 'chosen')
}, { ref: REF, sess: session, course: process.env.COURSE })
const page = await ctx.newPage()
const warns = [], jsErrors = [], podEvents = [], podResponses = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => { const t = m.text(); if (/pod|Pod|cheat|lap|Lap/.test(t)) warns.push(`${m.type()}: ${t.slice(0, 220)}`) })
page.on('request', (r) => {
  if (r.url().includes('/api/player-events') && r.method() === 'POST') {
    try {
      const body = JSON.parse(r.postData() || '{}')
      const rows = Array.isArray(body) ? body : (body.events || [body])
      for (const ev of rows) { const t = ev.event_type || ev.type || ev.event; if (/pod|listening/i.test(String(t))) podEvents.push({ t, payload: JSON.stringify(ev.payload || ev.data || {}).slice(0, 200) }) }
    } catch {}
  }
})
page.on('response', (r) => { const u = r.url(); if (/learner_pod_state|listening_pod_sentences|serving|listening_pods/.test(u)) podResponses.push({ url: u.replace(/^https:\/\/[^/]+/, '').slice(0, 120), status: r.status() }) })
const out = { url: URL }
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
out.bodyHead = await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\n+/g, ' | '))
const start = page.locator('.center-btn').first()
out.startFound = await start.count()
if (out.startFound) await start.click({ timeout: 5000 }).catch((e) => (out.startError = String(e).slice(0, 150)))
await page.waitForTimeout(WAIT)
out.bodyAfter = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n+/g, ' | '))
out.warns = warns.slice(0, 30); out.podEvents = podEvents.slice(0, 20); out.jsErrors = jsErrors; out.podResponses = podResponses.slice(0, 10)
console.log(JSON.stringify(out, null, 1))
await browser.close()
