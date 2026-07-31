// OFFLINE ALWAYS-PLAY PROBE — Tom's invariant: offline, the app plays EVERYTHING
// it has cached; an offline banner may inform quietly but must NEVER gate
// playback or replace content.
//
// Three passes against a real deployment (needs the service worker, so run
// against the dev alias, not `vite dev`):
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/offline-always-play-probe.mjs
//
//   A. online warm-up — guest starts a lesson, plays ~45s so the rolling
//      filler warms IndexedDB and the SW finishes precaching the shell.
//   B. mid-session drop — context goes offline while playing; audio must keep
//      flowing and no blocking offline copy may appear.
//   C. offline cold start — reload while offline; the shell must come up from
//      the SW, the lesson must start, and audio must play from cache.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/offline-always-play/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

// Copy that treats offline as a wall instead of playing. Informational mentions
// ("downloaded for offline") are fine; these phrases GATE, so they fail.
const BLOCKING_COPY = /you'?re offline|no internet|no connection|check your (internet|connection)|connect to the internet|offline access paused|free offline trial ended|internet connection/i

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  // This machine's default headless shell (1208) is missing libnspr4; the
  // 1234 build carries its own deps. Override only when present.
  executablePath: process.env.CHROME_BIN || undefined,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  window.__audioPlays = []
  const orig = Audio.prototype.play
  Audio.prototype.play = function (...a) { window.__audioPlays.push({ src: this.src || '(nosrc)', t: performance.now() }); return orig.apply(this, a) }
})

const playCount = () => page.evaluate(() => window.__audioPlays.length).catch(() => 0)
const bodyText = async () => (await page.textContent('body').catch(() => '')) || ''

const startLesson = async () => {
  for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
    const btn = page.locator(sel).first()
    if (await btn.count()) {
      try { await btn.click({ timeout: 8000 }); return true } catch { /* try next */ }
    }
  }
  return false
}

// ── A. online warm-up ───────────────────────────────────────────────────────
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)
check('A: home loads online', (await bodyText()).length > 200, page.url())
check('A: lesson started', await startLesson())
await page.waitForTimeout(45_000) // let the filler warm cache + SW settle
const playsWarm = await playCount()
check('A: audio playing online', playsWarm > 0, `${playsWarm} Audio.play() calls`)
await page.screenshot({ path: `${OUT}A-online-playing.png` })

// Service-worker state before we cut the network — the offline cold start
// depends entirely on this.
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker?.getRegistration()
  const keys = await caches.keys()
  const counts = {}
  for (const k of keys) counts[k] = (await (await caches.open(k)).keys()).length
  return {
    controller: !!navigator.serviceWorker?.controller,
    state: reg?.active?.state || reg?.installing?.state || reg?.waiting?.state || 'none',
    caches: counts,
  }
}).catch((e) => ({ error: String(e) }))
console.log('SW state pre-offline:', JSON.stringify(swState))

// ── B. mid-session drop ─────────────────────────────────────────────────────
await ctx.setOffline(true)
const playsAtDrop = await playCount()
await page.waitForTimeout(35_000)
const playsAfterDrop = await playCount()
check('B: audio keeps playing after drop', playsAfterDrop > playsAtDrop, `${playsAtDrop} → ${playsAfterDrop}`)
const bodyB = await bodyText()
const blockB = bodyB.match(BLOCKING_COPY)
check('B: no blocking offline copy', !blockB, blockB ? `"${blockB[0]}"` : '')
await page.screenshot({ path: `${OUT}B-offline-drop.png` })

// ── C. offline cold start ───────────────────────────────────────────────────
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(6000)
const bodyC1 = await bodyText()
// The browser error page ("No internet" / dino) is the hard fail — the SW
// must serve the precached shell. Detect it explicitly.
const isErrorPage = /ERR_INTERNET_DISCONNECTED|No internet/i.test(bodyC1)
check('C: shell loads offline (SW)', bodyC1.length > 200 && !isErrorPage, isErrorPage ? 'browser error page' : `${bodyC1.length} chars`)
await page.screenshot({ path: `${OUT}C1-offline-coldstart.png` })
const started = await startLesson()
check('C: lesson start control works offline', started)
const playsBefore = await playCount()
await page.waitForTimeout(25_000)
const playsCold = await playCount()
check('C: audio plays offline from cache', playsCold > playsBefore, `${playsBefore} → ${playsCold}`)
const bodyC2 = await bodyText()
const blockC = bodyC2.match(BLOCKING_COPY)
check('C: no blocking offline copy', !blockC, blockC ? `"${blockC[0]}"` : '')
await page.screenshot({ path: `${OUT}C2-offline-playing.png` })

const errReal = errors.filter((e) => !/favicon|manifest|Failed to fetch|NetworkError|Load failed/i.test(e))
check('zero unexpected page errors', errReal.length === 0, errReal.slice(0, 3).join(' | '))

await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
