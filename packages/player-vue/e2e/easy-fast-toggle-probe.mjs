// EASY/FAST TOGGLE PROBE — Aran's 2026-08-06 ruling, checked in a real browser
// at phone size: Turbo is gone from the mode tray, and the easy/fast switch is
// on the player's resting screen (the mode you pick before you start).
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/easy-fast-toggle-probe.mjs
//
// Prints PASS/FAIL per assertion, screenshots to OUT_DIR, exits 1 on any fail.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/tmp/easy-fast/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
// iPhone-ish viewport — this control has to work under a thumb.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// Returning-learner shape: a saved course skips the first-visit picker, so the
// player's resting screen is up without signing in.
await page.addInitScript(() => {
  try { localStorage.setItem('ssi-last-course', 'spa_for_eng') } catch { /* ignore */ }
})
await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
// The belt badge and the mode switch are both gated on isPlayerReady, which
// waits for progress data — give the player time to finish awakening.
await page.waitForTimeout(9000)

// 1. The switch is on the resting screen, with both modes offered.
const sw = page.locator('.mode-switch')
check('mode switch present on resting screen', await sw.count() > 0, page.url())
const swText = await sw.first().innerText().catch(() => '')
check('offers Easy', /easy/i.test(swText), swText.replace(/\n/g, ' | '))
check('offers Fast', /fast/i.test(swText), swText.replace(/\n/g, ' | '))

// 2. Fast is the default — nobody is silently moved off today's behaviour.
const fastBtn = page.locator('.mode-switch-btn', { hasText: /^Fast$/i }).first()
const easyBtn = page.locator('.mode-switch-btn', { hasText: /^Easy$/i }).first()
check(
  'Fast is selected by default',
  (await fastBtn.getAttribute('aria-pressed').catch(() => null)) === 'true',
)
await page.screenshot({ path: `${OUT}1-resting-fast-default.png` })

// 3. The control is thumb-sized (>=44px tall) and inside the safe area.
const box = await easyBtn.boundingBox().catch(() => null)
check('mode buttons are at least 44px tall', !!box && box.height >= 44, box ? `${Math.round(box.height)}px` : 'no box')

// 4. Tapping Easy selects it and persists the choice.
await easyBtn.click().catch(() => {})
await page.waitForTimeout(600)
check(
  'tapping Easy selects Easy',
  (await easyBtn.getAttribute('aria-pressed').catch(() => null)) === 'true',
)
await page.screenshot({ path: `${OUT}2-resting-easy-selected.png` })
const stored = await page.evaluate(() => {
  try { return localStorage.getItem('ssi-learning-mode') } catch { return null }
})
check('choice persisted to localStorage', stored === 'easy', String(stored))

// 5. It survives a reload (the whole point of persisting it).
await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(9000)
check(
  'Easy still selected after reload',
  (await page.locator('.mode-switch-btn', { hasText: /^Easy$/i }).first()
    .getAttribute('aria-pressed').catch(() => null)) === 'true',
)

// 6. Turbo is gone from the mode tray.
const trigger = page.locator('.mode-trigger')
if (await trigger.count() > 0) {
  await trigger.first().click().catch(() => {})
  await page.waitForTimeout(800)
  const trayText = await page.locator('.mode-tray').innerText().catch(() => '')
  check('mode tray has no Turbo row', !/turbo/i.test(trayText), trayText.replace(/\n/g, ' | '))
  await page.screenshot({ path: `${OUT}3-mode-tray-no-turbo.png` })
} else {
  check('mode tray trigger present', false, 'not found — could not check for Turbo')
}

check('no uncaught page errors', errors.length === 0, errors.join(' | '))

console.log(`\nScreenshots in ${OUT}`)
await browser.close()
process.exit(failures > 0 ? 1 : 0)
