// Explore a production page and dump every interactive control, so the driver
// script can be written against real selectors rather than guesses.
// Usage: node explore.mjs <path> [outname]
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'https://saysomethingin.app'
const P = process.argv[2] || '/schools1'
const NAME = process.argv[3] || 'explore'
const OUT = '/home/tomcassidy/chepstow-run/out'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--disable-gpu', '--disable-dev-shm-usage'],
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
p.on('requestfailed', (r) => console.log('REQFAILED', r.url(), r.failure()?.errorText))

await p.goto(BASE + P, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(7000)
console.log('URL:', p.url())
console.log('TITLE:', await p.title())
await p.screenshot({ path: `${OUT}/${NAME}.png`, fullPage: true })

console.log('\n--- BODY TEXT ---')
console.log((await p.locator('body').innerText().catch(() => '')).slice(0, 4000))

console.log('\n--- CONTROLS ---')
const controls = await p.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button,a,input,select,textarea,[role="button"],[data-walk],[data-testid]')) {
    const r = el.getBoundingClientRect()
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      text: (el.innerText || el.value || '').trim().slice(0, 70),
      ph: el.getAttribute('placeholder'),
      aria: el.getAttribute('aria-label'),
      id: el.id || null,
      cls: (el.className && String(el.className).slice(0, 60)) || null,
      walk: el.getAttribute('data-walk'),
      tid: el.getAttribute('data-testid'),
      href: el.getAttribute('href'),
      vis: r.width > 0 && r.height > 0,
    })
  }
  return out
})
for (const c of controls) console.log(JSON.stringify(c))

await browser.close()
