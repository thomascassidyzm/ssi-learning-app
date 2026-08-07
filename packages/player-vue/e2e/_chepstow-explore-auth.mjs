// Explore a production page as an already-signed-in user.
// Usage: node e2e/_chepstow-explore-auth.mjs <stateFile> <path> [outname]
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'https://saysomethingin.app'
const STATE = process.argv[2]
const P = process.argv[3] || '/schools'
const NAME = process.argv[4] || 'explore-auth'
const OUT = '/home/tomcassidy/chepstow-run/out'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-gpu', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, storageState: STATE })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message))

await p.goto(BASE + P, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(8000)
console.log('URL:', p.url())
await p.screenshot({ path: `${OUT}/${NAME}.png`, fullPage: true })

console.log('\n--- BODY TEXT ---')
console.log((await p.locator('body').innerText().catch(() => '')).slice(0, 5000))

console.log('\n--- CONTROLS ---')
const controls = await p.evaluate(() =>
  [...document.querySelectorAll('button,a,input,select,textarea,[role="button"],[data-testid]')]
    .map((el) => {
      const r = el.getBoundingClientRect()
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || '').trim().slice(0, 60),
        ph: el.getAttribute('placeholder'),
        aria: el.getAttribute('aria-label'),
        id: el.id || null,
        cls: (el.className && String(el.className).slice(0, 50)) || null,
        href: el.getAttribute('href'),
        vis: r.width > 0 && r.height > 0,
      }
    })
    .filter((c) => c.vis),
)
for (const c of controls) console.log(JSON.stringify(c))
await browser.close()
