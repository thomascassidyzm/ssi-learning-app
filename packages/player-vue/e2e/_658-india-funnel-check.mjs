// #658 — THROWAWAY verification script for the India funnel flow page.
// Renders the local file at 390 and 1280 CSS px, asserts no sideways scroll,
// no console errors and no failed requests, and writes screenshots so a human
// can look at the pane split and the mock-up labelling.
//
//   LD_LIBRARY_PATH=/home/tomcassidy/.pwlibs/root/usr/lib/x86_64-linux-gnu \
//     node e2e/_658-india-funnel-check.mjs
//
// Never set CHROME_BIN — the pinned chromium builds die on launch.
import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const FILE = pathToFileURL(resolve('public/_flows/india-funnel-741fa755ae481522d276.html')).href
const OUT = process.env.OUT_DIR || '/tmp/'
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] })
let bad = 0

for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  const failed = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  page.on('requestfailed', r => failed.push(r.url() + ' :: ' + (r.failure()?.errorText || '')))
  page.on('response', r => { if (r.status() >= 400) failed.push(r.url() + ' :: HTTP ' + r.status()) })
  await page.goto(FILE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  // Walk the page so loading="lazy" images below the fold actually load.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1500)
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    imgs: [...document.images].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })),
    mermaid: !!document.querySelector('.diagram svg'),
  }))
  const brokenImgs = m.imgs.filter(i => !i.ok)
  await page.screenshot({ path: `${OUT}658-funnel-${width}.png`, fullPage: true })
  const okScroll = m.scrollWidth <= m.inner
  console.log(`\n=== ${width}px ===`)
  console.log(`scrollWidth ${m.scrollWidth} vs innerWidth ${m.inner} -> ${okScroll ? 'OK' : 'SIDEWAYS SCROLL'}`)
  console.log(`images ${m.imgs.length}, broken ${brokenImgs.length}`, brokenImgs)
  console.log(`mermaid rendered: ${m.mermaid}`)
  console.log(`console errors: ${errors.length}`, errors)
  console.log(`failed requests: ${failed.length}`, failed)
  if (!okScroll || brokenImgs.length || errors.length || failed.length) bad++
  await ctx.close()
}
await browser.close()
console.log(bad ? `\nFAIL (${bad} width(s))` : '\nALL GREEN')
process.exit(bad ? 1 : 0)
