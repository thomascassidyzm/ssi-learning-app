// A-159 hub live verification — chips + the search that pops up over everything.
// Opens ?screen=library as a guest, opens How this works, asserts the topic
// chips, opens the search popup, types, and starts a walk from a result.
import { chromium } from '@playwright/test'
const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = '/tmp/a159hub/'

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--disable-gpu', '--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
const p = await ctx.newPage()
p.on('pageerror', (err) => console.log('PAGEERROR', err.message))

await p.goto(`${BASE}/?screen=library`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(9000)
console.log('URL:', p.url())

const toggle = p.locator('.hl-toggle')
console.log('how-this-works link count:', await toggle.count())
if (!(await toggle.count())) { await browser.close(); process.exit(1) }

console.log('armed dot present:', await p.locator('.hl-dot').count())
await toggle.first().click()
await p.waitForTimeout(800)
console.log('CHIPS:', JSON.stringify(await p.locator('.hl-chip').allInnerTexts()))
console.log('search trigger:', await p.locator('.hl-search-trigger').count())
await p.screenshot({ path: `${OUT}1-chips.png`, fullPage: true }).catch(() => {})

await p.locator('.hl-search-trigger').click()
await p.waitForTimeout(500)
console.log('popup open:', await p.locator('.hl-pop-panel').count())
console.log('all results (empty query):', JSON.stringify(await p.locator('.hl-pop-result').allInnerTexts()))
await p.screenshot({ path: `${OUT}2-search-open.png` }).catch(() => {})

await p.locator('.hl-pop-input').fill('belt')
await p.waitForTimeout(400)
console.log('results for "belt":', JSON.stringify(await p.locator('.hl-pop-result').allInnerTexts()))
await p.screenshot({ path: `${OUT}3-search-belt.png` }).catch(() => {})

await p.locator('.hl-pop-input').fill('photosynthesis')
await p.waitForTimeout(400)
console.log('empty-state text:', await p.locator('.hl-pop-empty').innerText().catch(() => 'MISSING'))

await p.locator('.hl-pop-input').fill('belt')
await p.waitForTimeout(400)
await p.locator('.hl-pop-result').first().click()
await p.waitForTimeout(1500)
console.log('popup closed after pick:', (await p.locator('.hl-pop-panel').count()) === 0)
console.log('data-walk-active:', await p.locator('html').getAttribute('data-walk-active'))
await p.screenshot({ path: `${OUT}4-walk-running.png` }).catch(() => {})

await browser.close()
