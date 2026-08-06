// LISTENING-STRAIGHT-IN PROBE — Tom's 2026-08-06 ruling, checked in a real
// browser: a listening exercise opens straight into the audio. No popup, no
// modal, no instruction text on screen — the dialogue teleprompter and the
// small textless ambient mark are the only surfaces during a lap.
//
// Drives the ?podview=1 instant pod preview (dev/staging only), so it needs a
// deployment carrying that cheat:
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/listening-straight-in-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/tmp/listening-straight-in/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.addInitScript(() => {
  try { localStorage.setItem('ssi-last-course', 'zho_for_eng') } catch { /* ignore */ }
})
await page.goto(`${BASE}/?podview=1`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(5000)

// Start the pod lap: with ?podview=1 the play tap goes straight into one.
await page.locator('.play-button, .bottom-nav .play-btn, button[aria-label*="lay"]').first()
  .click({ timeout: 5000 }).catch(() => {})

// Watch the whole opening of the lap. The old transient showed for its first
// ~4s, so sampling across 12s is what would have caught it.
let sawReminder = false
let sawTeleprompter = false
let sawAmbient = false
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(500)
  if (await page.locator('.pod-listening-reminder').count()) sawReminder = true
  if (await page.locator('.pod-turn-display').count()) sawTeleprompter = true
  if (await page.locator('.pod-listening-ambient').count()) sawAmbient = true
  if (i === 4) await page.screenshot({ path: `${OUT}1-lap-opening.png` })
}
await page.screenshot({ path: `${OUT}2-lap-running.png` })

check('a pod lap actually ran (probe is meaningful)', sawTeleprompter || sawAmbient)
check('no reminder popup at any point in the lap', !sawReminder)
check('the ambient mark carries the lap', sawAmbient)

// Nothing instructional on screen while the lap plays: the birdsong line must
// not be rendered anywhere over the dialogue.
const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
check('no "like listening to birdsong" instruction on screen', !/birdsong/i.test(bodyText))
check('hero text pane hidden during the lap', await page.locator('.hero-text-pane:visible').count() === 0)

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
process.exit(failures ? 1 : 0)
