// LISTENING-UNDER-SETTINGS PROBE — Aran's 2026-08-06 change, checked in a real
// browser: the mode popup must NOT offer listening any more, and Settings →
// Tools → "Listening mode" must open the listening overlay.
//
//   BASE_URL=https://staging.saysomethingin.app node e2e/listening-under-settings-probe.mjs
//
// Prints PASS/FAIL per assertion, screenshots to OUT_DIR, exits 1 on any fail.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/tmp/listening-settings/'
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
// player shell (and its mode tray) is up without signing in.
await page.addInitScript(() => {
  try { localStorage.setItem('ssi-last-course', 'zho_for_eng') } catch { /* ignore */ }
})
await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4000)

// 1. The mode popup opens and carries Turbo/Offline but no listening row.
const trigger = page.locator('.mode-trigger')
check('mode popup trigger present', await trigger.count() > 0, page.url())
await trigger.first().click().catch(() => {})
await page.waitForTimeout(800)
const tray = page.locator('.mode-tray')
check('mode popup opens', await tray.count() > 0)
const trayText = await tray.innerText().catch(() => '')
check('popup has no listening row', !/listening/i.test(trayText), trayText.replace(/\n/g, ' | '))
check('popup has no "Mode — pick one" group', !/pick one|HISE/i.test(trayText))
check('popup keeps its other controls', /turbo/i.test(trayText) && /offline/i.test(trayText))
await page.screenshot({ path: `${OUT}1-mode-popup.png` })
await page.keyboard.press('Escape').catch(() => {})
await page.locator('.tray-backdrop').click().catch(() => {})
await page.waitForTimeout(500)

// 2. Settings → Tools carries the listening-mode row.
await page.locator('.bottom-nav button[title="Settings"]').click().catch(() => {})
await page.waitForTimeout(1200)
const row = page.locator('.setting-row.clickable', { hasText: /listening mode/i }).first()
check('Settings has a "Listening mode" row', await row.count() > 0)
await row.scrollIntoViewIfNeeded().catch(() => {})
await page.screenshot({ path: `${OUT}2-settings-row.png` })

// 3. Tapping it closes settings and opens the listening overlay.
await row.click().catch(() => {})
await page.waitForTimeout(4000)
const overlay = page.locator('.listening-overlay, .scene-list-wrap, .teleprompter, .scene-empty')
check('listening overlay opens', await overlay.count() > 0)
check('settings panel closed behind it', await page.locator('.settings-panel').count() === 0)
await page.screenshot({ path: `${OUT}3-listening-overlay.png` })

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
process.exit(failures ? 1 : 0)
