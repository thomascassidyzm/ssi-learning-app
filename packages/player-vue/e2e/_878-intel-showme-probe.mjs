// Job #878: proof that the Handbook Show-me door renders on the /intel pages
// of a deployed build. Signs in by session injection (see _354), opens an
// intel question page, reads the [data-walk-offer] chips, screenshots.
import { chromium } from '@playwright/test'
import fs from 'fs'
const HOST = process.env.PROBE_URL || 'https://staging.saysomethingin.app'
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const OUT_DIR = process.env.OUT_DIR || '.'
const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript(({ ref, sess }) => { localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess)) }, { ref: REF, sess: session })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
const out = {}
for (const slug of ['pulse', 'person']) {
  await page.goto(`${HOST}/intel/${slug}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  if (slug === 'pulse') out.version = await page.evaluate(() => fetch('/version.json?cb=' + Date.now()).then((r) => r.json())).catch((e) => String(e))
  await page.locator('[data-walk-offer], [data-intel="answer"]').first().waitFor({ state: 'visible', timeout: 30000 }).catch((e) => (out[`${slug}Wait`] = String(e).slice(0, 120)))
  await page.waitForTimeout(2500)
  out[slug] = { url: page.url(), offers: await page.locator('[data-walk-offer]').allInnerTexts().catch(() => []) }
  await page.screenshot({ path: `${OUT_DIR}/878-intel-${slug}.png`, fullPage: false }).catch(() => {})
}
// Tap the first chip on the pulse page and confirm a walk overlay appears.
await page.goto(`${HOST}/intel/pulse`, { waitUntil: 'domcontentloaded' })
const chip = page.locator('[data-walk-offer]').first()
await chip.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
if (await chip.count()) {
  await chip.click()
  await page.waitForTimeout(1500)
  out.afterTap = await page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '))
  await page.screenshot({ path: `${OUT_DIR}/878-intel-walk.png` }).catch(() => {})
}
out.errors = errors
console.log(JSON.stringify(out, null, 1))
await browser.close()
