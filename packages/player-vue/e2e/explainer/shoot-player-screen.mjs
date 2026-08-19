// A-176 — capture the player screen for the explainer's "show me the screen"
// figure. Guest, phone viewport, 2x, mid-turn so the pill's gap segment is
// part-filled. Nothing dev-only is ever allowed into the shot: the DEV badge,
// the dev reset button, the guest Save Progress nudge and any debug fab are
// hidden before the shutter, because real learners never see them.
//
//   BASE_URL=https://saysomethingin.app node e2e/explainer/shoot-player-screen.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://saysomethingin.app'
const OUT = process.env.OUT_DIR || '/tmp/a176-shoot/'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(6000)
console.log('URL:', page.url())

const btn = page.locator('.center-btn').first()
console.log('center-btn count:', await btn.count())
await btn.click({ timeout: 15000 }).catch((e) => console.log('click failed', e.message))
await page.waitForTimeout(12000)

// Everything a learner never sees, gone before the shutter.
await page.addStyleTag({
  content: `
    .env-label, .env-reset, .guest-progress-nudge,
    #eruda, .eruda-container, [class*="devtools"], [id*="devtools"] { display: none !important; }
  `,
})
await page.waitForTimeout(500)

const state = await page.evaluate(() => ({
  fill: document.querySelector('.phase-segment-fill')?.getAttribute('style') || '(none)',
  active: document.querySelector('.phase-segment.is-active')?.className || '(none)',
  prompt: document.querySelector('.prompt-text, .known-text')?.textContent?.trim() || '(none)',
  badge: !!document.querySelector('.env-label'),
}))
console.log('state:', JSON.stringify(state))

// A handful of frames across one cycle; pick the one where the gap is part-full.
for (let i = 0; i < 8; i++) {
  const s = await page.evaluate(() => document.querySelector('.phase-segment-fill')?.getAttribute('style') || '')
  await page.screenshot({ path: `${OUT}frame-${i}.png` })
  console.log(`frame-${i}`, s)
  await page.waitForTimeout(1400)
}

await browser.close()
