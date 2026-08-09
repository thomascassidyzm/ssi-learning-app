// LISTENING QUICK-TOGGLE PROBE — Tom's 2026-08-06 ruling, checked in a real
// browser: listening mode "needs to be… the sort of thing that you can move
// backwards and forwards from quite easily". So the assertion is a ROUND TRIP,
// not just an entry point — tray → listening overlay → back out, and the tray
// row reflects the state both times.
//
// Replaces listening-under-settings-probe.mjs, which asserted the opposite
// (that the popup carried no listening row) and also still asserted Turbo,
// retired the same day.
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/listening-quick-toggle-probe.mjs
//
// Prints PASS/FAIL per assertion, screenshots to OUT_DIR, exits 1 on any fail.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/tmp/listening-toggle/'
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

// Returning-learner shape: a saved course skips the first-visit picker, so the
// player shell (and its mode tray) is up without signing in. Note this learner
// has NEVER touched developer settings — ssi-mode-listening is unset, which is
// the whole point: the row must be visible anyway.
await page.addInitScript(() => {
  try {
    localStorage.setItem('ssi-last-course', 'zho_for_eng')
    localStorage.removeItem('ssi-mode-listening')
  } catch { /* ignore */ }
})
await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4000)

const trigger = page.locator('.mode-trigger')
const tray = page.locator('.mode-tray')
const openTray = async () => {
  await trigger.first().click().catch(() => {})
  await page.waitForTimeout(700)
}
const listeningRow = () => page.locator('.tray-item', { hasText: /listening mode/i }).first()

// 1. The tray carries a listening row for a learner with no dev flag set.
check('mode tray trigger present', await trigger.count() > 0, page.url())
await openTray()
check('mode tray opens', await tray.count() > 0)
const trayText = await tray.innerText().catch(() => '')
check('tray offers listening', /listening/i.test(trayText), trayText.replace(/\n/g, ' | '))
check('tray keeps offline', /offline/i.test(trayText))
check('no "Mode — pick one" radio group', !/pick one|HISE/i.test(trayText))
check('listening row is a toggle, not a radio', await listeningRow().locator('.tray-toggle').count() > 0)
check('toggle starts off', await listeningRow().locator('.tray-toggle.on').count() === 0)
await page.screenshot({ path: `${OUT}1-tray-listening-off.png` })

// 2. One tap in: the overlay opens and the tray closes behind it.
await listeningRow().click().catch(() => {})
await page.waitForTimeout(4000)
const overlay = page.locator('.listening-overlay, .scene-list-wrap, .teleprompter, .scene-empty')
check('one tap opens the listening overlay', await overlay.count() > 0)
check('tray closed behind it', await tray.count() === 0)
await page.screenshot({ path: `${OUT}2-listening-overlay.png` })

// 3. The tray reflects the live state — reopening shows the toggle ON.
await openTray()
check('reopened tray shows listening ON', await listeningRow().locator('.tray-toggle.on').count() > 0)
await page.screenshot({ path: `${OUT}3-tray-listening-on.png` })

// 4. And out again, through the same row. The transport's back/play button is
//    the other exit and is unchanged; this proves the row is a true round trip.
await listeningRow().click().catch(() => {})
await page.waitForTimeout(2500)
check('same row exits listening mode', await overlay.count() === 0)
await page.screenshot({ path: `${OUT}4-back-out.png` })

// 5. Settings must NOT carry a listening row. Tom's ruling (2026-08-06,
//    22:38Z): listening mode goes back where learners already knew to find it
//    — the mode tray — and "NOT IN SETTINGS". This assertion is deliberately
//    the inverse of what it said this afternoon: the earlier version asserted
//    the Settings row was present, which is the placement Tom rejected.
await page.locator('.bottom-nav button[title="Settings"]').click().catch(() => {})
await page.waitForTimeout(1200)
check(
  'Settings carries NO "Listening mode" row',
  await page.locator('.setting-row.clickable', { hasText: /listening mode/i }).count() === 0
)
await page.screenshot({ path: `${OUT}5-settings-no-row.png` })

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
process.exit(failures ? 1 : 0)
