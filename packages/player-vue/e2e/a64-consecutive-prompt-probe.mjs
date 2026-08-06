// A-64 LIVE PROBE — "no mode should ever repeat the same prompt more than
// twice consecutively" (Tom, 2026-08-06).
//
// Measures what the learner ACTUALLY HEARS rather than what the generator
// intended: it wraps HTMLMediaElement.prototype.play in the page and records
// the src of every clip at the moment it starts, in order. Then it reports the
// longest run of identical consecutive srcs. Any run > 2 is a breach.
//
//   PROBE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app/ \
//   CHROME_BIN=<chromium> node e2e/a64-consecutive-prompt-probe.mjs
//
// Options:
//   PROBE_COURSE=fra_for_eng   course to select (default fra_for_eng)
//   PROBE_MODE=easy            learning mode to force (easy | fast)
//   PROBE_SECONDS=600          how long to listen (default 600 = 10 minutes)
//   PROBE_LISTENING=1          open Listening mode instead of the main player
//
// Prints one JSON line and exits 1 on a breach.
import { chromium } from '@playwright/test'

const URL_BASE = process.env.PROBE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app/'
const COURSE = process.env.PROBE_COURSE || 'fra_for_eng'
const MODE = process.env.PROBE_MODE || 'easy'
const SECONDS = Number(process.env.PROBE_SECONDS || 600)
const LISTENING = process.env.PROBE_LISTENING === '1'

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const context = await browser.newContext()
const page = await context.newPage()

const jsErrors = []
const capLogs = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('A-64')) capLogs.push(t.slice(0, 200))
})

// Record every clip start, before any app code runs.
await page.addInitScript(() => {
  window.__a64 = []
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    try {
      const src = this.currentSrc || this.src || ''
      // Silent-gap WAVs are transport padding, not prompts — never a repeat
      // the learner hears as content.
      if (src && !src.startsWith('data:audio/wav')) {
        window.__a64.push({ t: Date.now(), src })
      }
    } catch { /* never break playback to measure it */ }
    return origPlay.apply(this, args)
  }
})

// Fresh state, forced course + mode.
const url = new global.URL(URL_BASE)
url.searchParams.set('reset', '1')
url.searchParams.set('course', COURSE)
url.searchParams.set('mode', MODE)
await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(6000)

// ?reset=1 reloads the app clean — re-apply course/mode without the reset.
const url2 = new global.URL(URL_BASE)
url2.searchParams.set('course', COURSE)
url2.searchParams.set('mode', MODE)
await page.goto(url2.toString(), { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(5000)

const clicked = []
const tryClick = async (sel) => {
  const el = page.locator(sel).first()
  if (await el.count()) {
    await el.click({ timeout: 4000 }).catch(() => {})
    clicked.push(sel)
    return true
  }
  return false
}

for (const sel of [
  'button:has-text("Ready when you are")',
  'button:has-text("Start")',
  '.play-button',
  'button[aria-label*="lay"]',
  '.player-start',
]) {
  if (await tryClick(sel)) break
}
await page.waitForTimeout(4000)

if (LISTENING) {
  // Mode tray → Listening mode row.
  for (const sel of ['button[aria-label*="ode"]', '.mode-tray-trigger', 'button:has-text("Modes")']) {
    if (await tryClick(sel)) break
  }
  await page.waitForTimeout(1500)
  await tryClick('text=Listening mode')
  await page.waitForTimeout(3000)
  // Open the first dialogue scene.
  await tryClick('.scene-row, .pod-scene, li:has-text("Scene")')
}

const started = Date.now()
let lastCount = 0
while ((Date.now() - started) / 1000 < SECONDS) {
  await page.waitForTimeout(15000)
  const count = await page.evaluate(() => window.__a64.length).catch(() => lastCount)
  // Nudge the transport if nothing has played for two checks (autoplay gate).
  if (count === lastCount) {
    await tryClick('.play-button, button[aria-label*="lay"]')
  }
  lastCount = count
}

const plays = await page.evaluate(() => window.__a64)
await browser.close()

// Longest run of identical consecutive srcs.
const norm = (s) => {
  try { const u = new global.URL(s); return u.pathname } catch { return s }
}
let longest = 0
let longestSrc = ''
let run = 0
let last = null
const breaches = []
for (let i = 0; i < plays.length; i++) {
  const id = norm(plays[i].src)
  run = id === last ? run + 1 : 1
  last = id
  if (run > longest) { longest = run; longestSrc = id }
  if (run === 3) breaches.push({ index: i, clip: id })
}

const result = {
  ok: longest <= 2 && jsErrors.length === 0,
  url: url2.toString(),
  listening: LISTENING,
  secondsListened: SECONDS,
  clipsPlayed: plays.length,
  distinctClips: new Set(plays.map((p) => norm(p.src))).size,
  longestConsecutiveRun: longest,
  longestRunClip: longestSrc,
  breaches: breaches.slice(0, 10),
  capLogs: capLogs.slice(0, 10),
  jsErrors: jsErrors.slice(0, 5),
  clicked,
}
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
