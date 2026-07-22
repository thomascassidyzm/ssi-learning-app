import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const QS = process.env.QS || '?pod=1'

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.addInitScript(() => {
  window.__audioPlays = []
  const orig = Audio.prototype.play
  Audio.prototype.play = function (...a) { window.__audioPlays.push(this.src || '(nosrc)'); return orig.apply(this, a) }
})

console.log('Navigating to', BASE + '/' + QS)
await page.goto(BASE + '/' + QS, { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
console.log('URL after load:', page.url())

let clicked = false
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) {
    try { await btn.click({ timeout: 8000 }); clicked = true; console.log('clicked', sel); break } catch { /* try next */ }
  }
}
console.log('start clicked:', clicked)

// Let it play through several rounds worth of time
await page.waitForTimeout(150_000)
await page.screenshot({ path: '/tmp/repro-pod-final.png' })
console.log('done')
await browser.close()
