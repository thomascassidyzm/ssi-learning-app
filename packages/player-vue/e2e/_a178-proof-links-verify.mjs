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
 *  · EVERY row opens the in-app overlay instead of navigating away;
 *  · each overlay frames the saysomethingin.com page that row promises;
 *  · each framed page actually paints — not a silent white sheet, which is the
 *    one failure mode the overlay exists to prevent.
 *
 * Not covered, deliberately: the RTÉ Raidió na Gaeltachta clip that receipts
 * the Irish row. rte.ie sends X-Frame-Options SAMEORIGIN, so it is named in the
 * copy and recorded as a source comment rather than linked.
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

// Every row is a claim that a page exists and shows something. Prove each one
// in turn: tap it, assert the overlay opened over the app rather than
// navigating away, and assert the remote page actually painted.
const EXPECTED = [
  'intensive-croatia',
  'intensive-ireland',
  'intensive-japanuary',
  'intensive-welsh-tom',
  'celebrity-coaching',
]

for (let i = 0; i < EXPECTED.length; i++) {
  const slug = EXPECTED[i]
  await page.click(`.wx-link >> nth=${i}`)
  await page.waitForSelector('iframe', { timeout: 15000 })

  check(`${slug}: overlay opened without navigating the app away`, page.url() === urlBefore)

  const frameUrl = await page.$eval('iframe', (el) => el.getAttribute('src'))
  check(`${slug}: overlay frames the right page`, (frameUrl || '').endsWith(`/${slug}`), frameUrl)

  // The site is client-rendered, so `load` firing is not the same thing as the
  // page having content — a check that trusted `load` would pass on a blank
  // frame, which is the one failure mode the overlay exists to prevent.
  let frameText = ''
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().includes(slug))
    if (frame) {
      frameText = (await frame.evaluate(() => document.body.innerText || '').catch(() => '')).trim()
      if (frameText.length > 200) break
    }
    await page.waitForTimeout(1000)
  }
  check(`${slug}: page actually painted`, frameText.length > 200, `${frameText.length} chars`)
  if (frameText) out(`      ${frameText.slice(0, 120).replace(/\n+/g, ' / ')}`)

  if (i === 0) await page.screenshot({ path: 'e2e/_a178-proof-links.png' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}

await page.screenshot({ path: 'e2e/_a178-proof-links.png' })
out('screenshot: packages/player-vue/e2e/_a178-proof-links.png')

await browser.close()

const failed = results.filter((r) => !r.pass)
out(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
