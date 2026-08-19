// A-159 Parts 2 and 3 — shoot the learner explainer's figures as they really
// render, at phone width, on deployed dev.
//
//   node e2e/explainer/shoot-parts-2-3.mjs
//
// Goes to /?screen=library rather than /me: /me paints empty without the
// profile API, while the Library route mounts the same two explainer
// components offline. Opens both sections, screenshots each illustrated block
// on its own, and prints what it actually found so a missing figure is loud.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/a159-htw-visual/live/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--disable-gpu', '--no-sandbox'],
})
// 390 wide is the phone the learner actually reads this on.
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
p.on('pageerror', (err) => console.log('PAGEERROR', err.message))

await p.goto(`${BASE}/?screen=library`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(9000)
console.log('URL:', p.url())

// The Library's own "How this works" panel is the host: both learner
// explainers are nested inside it, so it has to be opened first.
const host = p.locator('.hl-toggle')
console.log('library panel toggle count:', await host.count())
if (await host.count()) {
  await host.first().click()
  await p.waitForSelector('.hl-card', { timeout: 10000 })
  await p.waitForTimeout(600)
}

for (const [name, toggleSel, cardSel, blockSel, headingSel] of [
  ['how', '.lx-toggle', '.lx-card', '.lx-block', '.lx-heading'],
  ['why', '.wx-toggle', '.wx-card', '.wx-block', '.wx-heading'],
]) {
  const toggle = p.locator(toggleSel)
  console.log(`${name}: toggle count ${await toggle.count()}`)
  if (!(await toggle.count())) continue
  await toggle.first().click()
  await p.waitForSelector(cardSel, { timeout: 10000 })
  await p.waitForTimeout(600)

  await p.locator(cardSel).first().screenshot({ path: `${OUT}${name}-card.png` })

  const blocks = p.locator(`${cardSel} ${blockSel}`)
  const n = await blocks.count()
  for (let i = 0; i < n; i++) {
    const block = blocks.nth(i)
    if (!(await block.locator('figure').count())) continue
    const heading = (await block.locator(headingSel).innerText()).trim()
    const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    await block.scrollIntoViewIfNeeded()
    await block.screenshot({ path: `${OUT}${name}-${slug}.png` })
    console.log(`  drew ${heading}`)
  }
}

await browser.close()
console.log('shots →', OUT)
