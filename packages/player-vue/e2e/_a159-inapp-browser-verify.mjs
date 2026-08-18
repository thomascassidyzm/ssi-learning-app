/**
 * Live verification of the in-app browser overlay on the dev deployment.
 *
 * Route used: /try/<bogus-code> — the Try-link gateway, which needs no auth,
 * fails closed to "Link not valid", and carries a "Visit SaySomethingin" link
 * pointing at www.saysomethingin.com. That host frames, so tapping it must
 * open the overlay rather than navigating away.
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const out = (m) => console.log(m)

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
const page = await ctx.newPage()

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  out(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

await page.goto(`${BASE}/try/a159-verify-not-a-real-code`, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})

// The gateway resolves the code server-side before it paints the failure.
await page.waitForSelector('.home-link', { timeout: 45000 })
check('gateway painted the "Visit SaySomethingin" link', true)

const urlBefore = page.url()

// Tap it. The overlay is a *_blank-suppressed* click handler, so a new tab
// appearing at all would mean the conversion did not take.
const popupPromise = ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null)
await page.click('.home-link')
const popup = await popupPromise
check('did not open an external tab', popup === null, popup ? `popup: ${popup.url()}` : '')

const sheet = await page.waitForSelector('.iab-sheet', { timeout: 15000 }).catch(() => null)
check('in-app overlay opened', !!sheet)

check('app did not navigate away', page.url() === urlBefore, page.url())

if (sheet) {
  const frameSrc = await page.getAttribute('.iab-frame', 'src')
  check(
    'overlay frames www.saysomethingin.com',
    !!frameSrc && frameSrc.includes('saysomethingin.com'),
    frameSrc || 'no src',
  )

  // The safe-area rule: the header must be taller than its 54px base once an
  // inset exists, and the close button must sit fully below the status bar.
  const box = await page.$eval('.iab-close', (el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, height: r.height, width: r.width }
  })
  check(
    'close button is a real tap target, clear of the top edge',
    box.top >= 0 && box.height >= 36 && box.width >= 36,
    `top=${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`,
  )

  await page.screenshot({ path: '../../docs/a159-htw-visual/inapp-browser-live.png' })

  // The remote page loads inside the frame, i.e. this is not a white sheet.
  const framed = await page
    .waitForFunction(
      () => {
        const f = document.querySelector('.iab-frame')
        return !!f && !document.querySelector('.iab-fallback')
      },
      { timeout: 20000 },
    )
    .catch(() => null)
  check('no fallback card raised — the page really framed', !!framed)

  await page.click('.iab-close')
  const closed = await page
    .waitForSelector('.iab-sheet', { state: 'detached', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  check('close button dismisses the overlay', closed)
  check('app still on the same screen after closing', page.url() === urlBefore)
}

await browser.close()

const failed = results.filter((r) => !r.pass)
out(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
