// EMPTY-POD-HIDDEN PROBE — a real learner's seat, not the data layer.
// Loads the app on a course, opens Listening Mode through the mode tray the
// way a learner does, and prints the tabs that are actually on screen.
// Welsh (empty pod-0) must show NO "Dialogues" tab; Spanish must still show it.
//
//   BASE_URL=http://localhost:5199 COURSE=cym_s_for_eng node e2e/empty-pod-hidden-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const COURSE = process.env.COURSE || 'cym_s_for_eng'
const OUT = process.env.OUT_DIR || '/tmp/empty-pod-hidden/'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
const logs = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 160)}`))

await page.addInitScript((course) => {
  try { localStorage.setItem('ssi-last-course', course) } catch { /* ignore */ }
}, COURSE)

await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(15000)
await page.screenshot({ path: `${OUT}${COURSE}-1-landing.png` })

// Start the course the way a learner does — the central transport button.
await page.locator('.center-btn').first().click({ timeout: 15000 })
  .catch((e) => console.log('play click failed:', String(e).slice(0, 120)))
await page.waitForTimeout(20000)
await page.screenshot({ path: `${OUT}${COURSE}-2-player.png` })

// Open the mode tray with a real click, then pick Listening Mode — the exact
// two taps a learner makes.
const trigger = page.locator('.mode-trigger').first()
console.log('mode trigger visible:', await trigger.isVisible().catch(() => false))
await trigger.click({ timeout: 10000 }).catch((e) => console.log('trigger click failed:', String(e).slice(0, 120)))
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}${COURSE}-3-tray.png` })

const listening = page.locator('.tray-item', { hasText: /listening/i }).first()
console.log('listening tray item visible:', await listening.isVisible().catch(() => false))
await listening.click({ timeout: 10000 }).catch((e) => console.log('listening click failed:', String(e).slice(0, 120)))
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}${COURSE}-3b-just-after-click.png` })
console.log('post-click DOM:', JSON.stringify(await page.evaluate(() => ({
  trigger: document.querySelector('.mode-trigger')?.className,
  overlayish: Array.from(document.querySelectorAll('[class*="overlay"]')).map((e) => e.className).slice(0, 10),
  viewTabs: document.querySelectorAll('.view-tab').length,
}))))
await page.waitForTimeout(7000)
await page.screenshot({ path: `${OUT}${COURSE}-4-listening.png`, fullPage: false })

const seat = await page.evaluate(() => {
  const overlay = document.querySelector('.listening-overlay, [class*="listening"]')
  const tabs = Array.from(document.querySelectorAll('.view-tab')).map((t) => ({
    label: (t.textContent || '').trim(),
    active: t.className.includes('active'),
  }))
  return {
    overlayPresent: !!overlay,
    tabs,
    // textContent, not innerText — headless Chrome returns '' for innerText here.
    overlayText: (document.querySelector('.listening-overlay')?.textContent || '')
      .replace(/\s+/g, ' ').slice(0, 400),
  }
})

console.log('\n=== LEARNER SEAT:', COURSE, '===')
console.log('overlay present :', seat.overlayPresent)
console.log('tabs on screen  :', JSON.stringify(seat.tabs))
console.log('DIALOGUES TAB   :', seat.tabs.some((t) => /dialogue/i.test(t.label)) ? 'PRESENT' : 'ABSENT')
console.log('overlay text    :', seat.overlayText)
console.log('js errors       :', JSON.stringify(errors.slice(0, 5)))
console.log('console tail    :\n  ' + logs.filter((l) => /listen|pod|overlay|error/i.test(l)).slice(-25).join('\n  '))
console.log('screenshots     :', OUT)

await browser.close()
