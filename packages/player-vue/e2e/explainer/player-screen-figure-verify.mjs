// A-176 live verification — the "show me the screen" figure in the learner
// explainer. Opens the Library panel as a guest, opens "Using the app", asserts
// the thumbnail is there, taps it, asserts the labelled sheet opens with its
// four callouts, and asserts no dev-only chrome appears in either view.
//
//   BASE_URL=http://localhost:4319 node e2e/explainer/player-screen-figure-verify.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:4319'
const OUT = process.env.OUT_DIR || '/tmp/a176-verify/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

await page.goto(`${BASE}/?screen=library`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(7000)

const toggle = page.locator('.hl-toggle')
check('library how-this-works link present', (await toggle.count()) > 0)
await toggle.first().click()
await page.waitForTimeout(600)

const using = page.locator('.lx-toggle')
check('"Using the app" section present', (await using.count()) > 0)
await using.first().click()
await page.waitForTimeout(600)

const thumb = page.locator('.psf-thumb')
check('inline thumbnail present, exactly one', (await thumb.count()) === 1)
check('it says what it does', /show me the screen/i.test(await thumb.first().innerText()))
const thumbBox = await thumb.locator('img').boundingBox()
check('thumbnail is small and inline', !!thumbBox && thumbBox.width < 120, JSON.stringify(thumbBox))
check('nothing open before the tap', (await page.locator('.psf-sheet').count()) === 0)
await page.locator('.lx-card').screenshot({ path: `${OUT}1-card-inline.png` }).catch(() => {})

await thumb.first().click()
await page.waitForTimeout(500)
const sheet = page.locator('.psf-sheet')
check('tapping opens the labelled version', (await sheet.count()) === 1)
check('four pins on the picture', (await page.locator('.psf-pin').count()) === 4)
check('four labels beneath it', (await page.locator('.psf-legend-row').count()) === 4)
const sheetText = await sheet.innerText()
for (const line of ['only button that matters', 'Offline downloads live here', 'Every course you have', 'One go']) {
  check(`callout reaches the learner: "${line}"`, sheetText.includes(line))
}
const shotBox = await page.locator('.psf-shot-img').boundingBox()
check('the picture is big in the sheet', !!shotBox && shotBox.width > 280, JSON.stringify(shotBox))
await page.screenshot({ path: `${OUT}2-sheet-top.png` })
await page.locator('.psf-body').evaluate((el) => el.scrollTo(0, el.scrollHeight))
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}3-sheet-bottom.png` })

// Nothing dev-only inside the figure. Note the check is scoped to the sheet on
// purpose: the HOST app on a dev host legitimately carries its own DEV badge and
// guest Save Progress nudge, and neither is anything to do with this picture.
// The picture is a raster, so its own freedom from dev chrome is verified by eye
// against the screenshots this probe writes.
check('nothing dev-only in the figure', !/\bDEV\b|Save Progress/.test(await sheet.innerText()))
check('scroll is locked while the sheet is open', await page.evaluate(() => document.body.style.overflow === 'hidden'))

await page.locator('.psf-close').click()
await page.waitForTimeout(400)
check('close puts it away', (await page.locator('.psf-sheet').count()) === 0)
check('scroll lock handed back', await page.evaluate(() => document.body.style.overflow === ''))

await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
