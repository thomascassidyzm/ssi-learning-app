// Does the post-change bundle actually take the WebView branch from the UA
// marker alone, with nothing injected? Read it out of the telemetry body the
// app sends — app_shell comes straight from platform().shell.
import { chromium } from '@playwright/test'
const BASE = 'http://127.0.0.1:4401'
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 SSiShell/android'
const results = {}
for (const [label, ua] of [['shell', UA], ['plain browser', UA.replace(' SSiShell/android', '')]]) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua })
  const seen = new Set()
  ctx.on('request', (r) => {
    if (!/\/api\//.test(r.url())) return
    const body = r.postData() || ''
    const m = body.match(/"app_shell":"(\w+)"/)
    if (m) seen.add(m[1])
  })
  const page = await ctx.newPage()
  await page.addInitScript((c) => { try { localStorage.setItem('ssi-last-course', c) } catch {} }, 'pol_for_eng')
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45000 }).catch(() => {})
  await page.locator('.center-btn').first().click({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(45000)
  results[label] = [...seen]
  await browser.close()
}
console.log(JSON.stringify(results, null, 2))
