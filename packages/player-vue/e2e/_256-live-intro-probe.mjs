// Job #256 — drive the REAL player on staging to the S0006L01 intro and watch
// what the audio element actually does. `?preview=8` is the round-index cheat
// (round-map index 8 = S0006L01); `?course=` deep-links the course.
//
//   CHROME_BIN=... node e2e/_256-live-intro-probe.mjs [roundIndex]
import { chromium } from '@playwright/test'

const ORIGIN = process.env.PROBE_ORIGIN || 'https://staging.saysomethingin.app'
const ROUND = process.argv[2] || '8'
const RUN_MS = Number(process.env.RUN_MS || 90000)

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext()
const page = await ctx.newPage()

const failures = []
const console_ = []
const requests = []

await page.addInitScript(() => {
  // Log every media error and every src assignment on every <audio>, with the
  // element's readyState/networkState — the fields that separate "never
  // loaded" from "loaded then died".
  const proto = HTMLMediaElement.prototype
  const desc = Object.getOwnPropertyDescriptor(proto, 'src')
  window.__audioLog = []
  Object.defineProperty(proto, 'src', {
    get() { return desc.get.call(this) },
    set(v) {
      window.__audioLog.push({ t: Math.round(performance.now()), kind: 'src', url: String(v).slice(-60) })
      if (!this.__wired) {
        this.__wired = true
        for (const ev of ['error', 'stalled', 'abort', 'emptied', 'ended', 'playing', 'waiting', 'suspend']) {
          this.addEventListener(ev, () => {
            window.__audioLog.push({
              t: Math.round(performance.now()), kind: ev,
              url: String(this.currentSrc || '').slice(-60),
              code: this.error?.code, msg: this.error?.message,
              readyState: this.readyState, networkState: this.networkState,
              currentTime: Number(this.currentTime.toFixed(2)),
            })
          })
        }
      }
      desc.set.call(this, v)
    },
  })
})

page.on('console', (m) => {
  const t = m.text()
  if (/SimplePlayer|audio|Audio|intro|failed|error/i.test(t)) console_.push(t.slice(0, 220))
})
page.on('request', (r) => {
  if (r.url().includes('/api/audio/')) requests.push({ at: Date.now(), url: r.url().slice(-44), headers: r.headers().range || '' })
})
page.on('response', async (r) => {
  if (r.url().includes('/api/audio/')) {
    const q = requests.find((x) => r.url().endsWith(x.url))
    if (q) { q.status = r.status(); q.len = r.headers()['content-length']; q.cr = r.headers()['content-range'] }
  }
  if (r.url().includes('player-events') && r.request().method() === 'POST') {
    try {
      const body = JSON.parse(r.request().postData() || '{}')
      for (const e of body.events || []) if (String(e.event_type).includes('fail')) failures.push(e)
    } catch {}
  }
})

await page.goto(`${ORIGIN}/?course=cym_s_for_eng&preview=${ROUND}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(9000)
for (const sel of ['.center-btn', '[aria-label="Tap player to start"]', '.play-button']) {
  const el = page.locator(sel).first()
  if (await el.count()) { await el.click({ timeout: 5000 }).catch(() => {}); break }
}
await page.waitForTimeout(RUN_MS)

const log = await page.evaluate(() => window.__audioLog || [])
const screen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300))
console.log(JSON.stringify({ screen, audioLog: log, failures, requests, console: console_.slice(-80) }, null, 1))
await browser.close()
