// Verify the freshly-minted leader link /group/RPP-125 end-to-end on production.
import { chromium } from '@playwright/test'
const SHOTS = '/tmp/prod-smoke/shots'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
await page.goto('https://saysomethingin.app/group/RPP-125', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3500)
await page.screenshot({ path: `${SHOTS}/30-leader-landing.png`, fullPage: true })
console.log('landing url:', page.url())

// identity capture: fill name + email if fields present
const name = page.locator('input[placeholder*="name" i], input[name*="name" i]').first()
const email = page.locator('input[type="email"], input[placeholder*="email" i]').first()
try {
  await name.fill('Smoke Leader', { timeout: 4000 })
  await email.fill('thomas.cassidy+smokeleader1@gmail.com', { timeout: 4000 })
  await page.screenshot({ path: `${SHOTS}/31-leader-capture-filled.png` })
  await page.locator('button[type=submit], button:has-text("Continue"), button:has-text("Join"), button:has-text("Go")').first().click({ timeout: 4000 })
  await page.waitForTimeout(6000)
} catch (e) { console.log('capture step:', e.message.slice(0, 100)) }
await page.screenshot({ path: `${SHOTS}/32-leader-after-submit.png`, fullPage: true })
const authed = await page.evaluate(() => !!window.localStorage.getItem('sb-swfvymspfxmnfhevgdkg-auth-token')).catch(() => false)
console.log('after submit url:', page.url(), 'authed:', authed)
const body = (await page.textContent('body').catch(() => '')) || ''
console.log('body sniff:', body.replace(/\s+/g, ' ').slice(0, 300))
await browser.close()
