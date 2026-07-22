import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const dataDir = '/tmp/ssi-repro-profile'
mkdirSync(dataDir, { recursive: true })

const ctx = await chromium.launchPersistentContext(dataDir, {
  viewport: { width: 390, height: 844 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = ctx.pages()[0] || await ctx.newPage()
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

console.log('=== PHASE 1: build up progress, no cheat flags ===')
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) {
    try { await btn.click({ timeout: 8000 }); console.log('clicked', sel); break } catch { /* try next */ }
  }
}
// Let 3 rounds worth of plain cycles play through, building saved position
await page.waitForTimeout(45_000)
console.log('=== reloading with ?pod=1 (simulating resume) ===')
await page.goto(BASE + '/?pod=1', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) {
    try { await btn.click({ timeout: 8000 }); console.log('clicked resume', sel); break } catch { /* try next */ }
  }
}
await page.waitForTimeout(60_000)
await page.screenshot({ path: '/tmp/repro-pod-resume-final.png' })
console.log('done')
await ctx.close()
