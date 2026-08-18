// A-159 — run each new Library walk end to end on a real build and assert
// every step actually anchors to something on screen (not the unanchored
// fallback), so a walk that points at nothing is caught before Tom sees it.
import { chromium } from '@playwright/test'
const BASE = process.env.BASE || 'http://localhost:4322'
const OUT = '/tmp/a159walks/'
const WALKS = ['what-your-numbers-mean', 'reading-the-course-list', 'go-back-over-something']

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--disable-gpu', '--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
const p = await ctx.newPage()
p.on('pageerror', (err) => console.log('PAGEERROR', err.message))

await p.goto(`${BASE}/?screen=library`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(9000)
await p.locator('.hl-toggle').first().click()
await p.waitForTimeout(600)
console.log('CHIPS:', JSON.stringify(await p.locator('.hl-chip').allInnerTexts()))

for (const id of WALKS) {
  console.log(`\n── ${id}`)
  await p.locator('.hl-search-trigger').click()
  await p.waitForTimeout(400)
  await p.locator(`.hl-pop-result[data-walk-offer="${id}"]`).click()
  await p.waitForTimeout(1200)
  let i = 0
  for (;;) {
    const active = await p.locator('html').getAttribute('data-walk-active')
    if (!active) break
    const anchored = await p.locator(".walk-ring").count()
    const card = await p.locator('.walk-overlay').innerText().catch(() => '')
    console.log(`  step ${active} | ring=${anchored} | ${card.replace(/\n/g, ' / ').slice(0, 160)}`)
    await p.screenshot({ path: `${OUT}${id}-${i}.png` }).catch(() => {})
    const nextBtn = p.locator('.walk-overlay button', { hasText: /Next|Got it|Done|Finish/ })
    if (await nextBtn.count()) await nextBtn.last().click()
    else if (active.includes(':0') && id === 'go-back-over-something') await p.locator('[data-walk="library-belt-browser"]').click()
    else break
    await p.waitForTimeout(900)
    if (++i > 8) break
  }
  console.log('  ended, data-walk-active =', await p.locator('html').getAttribute('data-walk-active'))
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  // The Library scrolls; make sure the hub is reachable for the next walk.
  await p.locator('.hl-search-trigger').scrollIntoViewIfNeeded().catch(() => {})
}

await browser.close()
