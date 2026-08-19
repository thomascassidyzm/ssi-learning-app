/**
 * A-178 — live verification of the "Where all this comes from" proof rows.
 *
 * The rows live on the learner profile, which is behind auth, so this drives a
 * local vite dev server against a temporary harness route that mounts the REAL
 * WhyThisWorks component and the REAL InAppBrowser overlay. Everything under
 * test is production code: the copy, the links, openInApp, the allowlist and
 * the overlay. Only the mount point is a harness.
 *
 * What it proves, in a real browser:
 *  · the panel opens and the five named rows render;
 *  · tapping a row opens the in-app overlay instead of navigating away;
 *  · the overlay's iframe carries the right saysomethingin.com URL;
 *  · the framed page actually paints — not a silent white sheet, which is the
 *    one failure mode the overlay exists to prevent.
 *
 * Run: start `pnpm --filter player-vue dev`, then `node e2e/_a178-proof-links-verify.mjs`.
 *
 * Env (see memory: playwright-chromium-missing-libs):
 *   LD_LIBRARY_PATH=/home/tomcassidy/.pwlibs/root/usr/lib/x86_64-linux-gnu:/home/tomcassidy/.ssi-sentinel-libs
 *   CHROME_BIN=/home/tomcassidy/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
 */
import { chromium } from '@playwright/test'
import { writeFileSync, rmSync } from 'node:fs'

// The harness page is written next to index.html so vite serves it as a second
// MPA entry, then removed on the way out — it is scaffolding, not app code.
const HARNESS_HTML = new URL('../__a178.html', import.meta.url)
const HARNESS_JS = new URL('../__a178.js', import.meta.url)
writeFileSync(HARNESS_HTML, `<!doctype html>
<html lang="en" data-theme="mist">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>A-178 harness</title></head>
  <body><div id="app"></div><script type="module" src="/__a178.js"></script></body>
</html>
`)
writeFileSync(HARNESS_JS, `import { createApp, h } from 'vue'
import './src/styles/design-tokens.css'
import './src/styles/global.css'
import WhyThisWorks from './src/components/me/WhyThisWorks.vue'
import InAppBrowser from './src/components/InAppBrowser.vue'

createApp({
  render: () => h('div', { style: 'padding:24px' }, [h(WhyThisWorks), h(InAppBrowser)]),
}).mount('#app')
`)
const cleanup = () => {
  rmSync(HARNESS_HTML, { force: true })
  rmSync(HARNESS_JS, { force: true })
}
process.on('exit', cleanup)

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const out = (m) => console.log(m)

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  out(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()

await page.goto(`${BASE}/__a178.html`, { waitUntil: 'domcontentloaded', timeout: 60000 })

// Open the panel.
await page.waitForSelector('.wx-toggle', { timeout: 30000 })
await page.click('.wx-toggle')
await page.waitForSelector('.wx-card', { timeout: 10000 })
check('Why-this-works panel opens', true)

const labels = await page.$$eval('.wx-link', (els) => els.map((e) => e.textContent.trim()))
check('five proof rows render', labels.length === 5, `${labels.length}: ${labels.join(' | ')}`)

// The Croatian row must lead.
check('Croatian row leads', /croatian/i.test(labels[0] || ''), labels[0])

const urlBefore = page.url()
await page.click('.wx-link >> nth=0')

// The overlay is the thing under test: it must appear, and the app must not
// have navigated away underneath it.
await page.waitForSelector('iframe', { timeout: 15000 })
check('tapping a row did not navigate the app away', page.url() === urlBefore, page.url())

const frameUrl = await page.$eval('iframe', (el) => el.getAttribute('src'))
check(
  'overlay frames the Croatian page',
  /saysomethingin\.com\/intensive-croatia$/.test(frameUrl || ''),
  frameUrl,
)

// A blocked/blank frame is the failure this design exists to prevent, so assert
// the remote page really painted rather than trusting that `load` fired.
let painted = false
let frameText = ''
try {
  // The site is a client-rendered SPA, so `load` firing is not the same thing
  // as the page having content. Poll the frame's own text until it fills.
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => /intensive-croatia/.test(f.url()))
    if (frame) {
      frameText = (await frame.evaluate(() => document.body.innerText || '').catch(() => '')).trim()
      if (frameText.length > 200) break
    }
    await page.waitForTimeout(1000)
  }
  painted = frameText.length > 200
} catch (e) {
  frameText = `error: ${e.message.split('\n')[0]}`
}
check('framed page actually painted content', painted, `${frameText.length} chars`)
out(`      frame text: ${frameText.slice(0, 160).replace(/\n/g, ' / ')}`)

await page.screenshot({ path: 'e2e/_a178-proof-links.png' })
out('screenshot: packages/player-vue/e2e/_a178-proof-links.png')

await browser.close()

const failed = results.filter((r) => !r.pass)
out(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
