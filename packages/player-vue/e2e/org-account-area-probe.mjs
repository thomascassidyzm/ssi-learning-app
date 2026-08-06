// Deployed-dev probe — the permanent "Your account" area and its two pack
// walks (founder ruling 2026-08-06).
//
//   node e2e/org-account-area-probe.mjs
//
// Opens a real leader's PERSONAL link on deployed dev (the link IS the login,
// same door e2e/explainer/deployed-walk.mjs uses), lands on their node home,
// and checks:
//   · the Your account card renders, with both rows and all three walk anchors
//   · the password action opens its form in place and rejects a mismatch
//   · the install action is context-aware and routes to the full guide when
//     the browser offers no native prompt
//   · How-this-works offers BOTH new walks, and each starts through the real
//     engine (data-walk-active on <html>) and anchors to this card
//
// DELIBERATELY NOT DONE: no valid password is ever submitted. This runs
// against a REAL leader account on deployed dev, and changing a real person's
// credentials is not a probe's business. The write path is covered by the
// unit tests (YourAccount.test.ts); everything up to the API call is exercised
// here for real.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const LEADER_LINK = process.env.LEADER_LINK || `${BASE}/group/QJM-868`
const OUT = new URL('../../../docs/org-account/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const p = await ctx.newPage()

// 1. Straight in on the personal link, onto the leader's own node home.
await p.goto(LEADER_LINK, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForSelector('.node-home .identity-name', { timeout: 30000 })
check('leader link lands on the member node home', /\/(org|schools\/org)\//.test(p.url()), p.url())

// 2. The card itself.
const card = p.locator('.your-account')
await card.scrollIntoViewIfNeeded().catch(() => {})
check('Your account card renders', (await card.count()) === 1)
for (const id of ['account-card', 'account-password', 'account-install']) {
  check(`anchor ${id} present`, (await p.locator(`[data-walk="${id}"]`).count()) === 1)
}
const cardText = (await card.innerText().catch(() => '')).replace(/\n/g, ' · ')
console.log('   card:', cardText)
await p.screenshot({ path: `${OUT}1-your-account-card.png`, fullPage: false })

// 3. Password — opens in place, validates, writes nothing.
await p.locator('[data-walk="account-password"] button').click()
await p.waitForSelector('#account-password-new', { timeout: 5000 })
check('password form opens in place', await p.locator('#account-password-new').isVisible())
await p.fill('#account-password-new', 'probe-not-a-real-password')
await p.fill('#account-password-confirm', 'deliberately-different')
await p.locator('.account-save').click()
await p.waitForTimeout(400)
const err = await p.locator('.account-error').innerText().catch(() => '')
check('mismatch is refused before any write', err.includes('do not match'), err)
await p.screenshot({ path: `${OUT}2-password-validation.png`, fullPage: false })
// Close without saving — nothing on this account is touched.
await p.locator('[data-walk="account-password"] button').click()

// 4. Install — context-aware wording, and the guide fallback.
const installText = await p.locator('[data-walk="account-install"]').innerText()
check('install row is desktop-framed on a desktop viewport', /app/i.test(installText), installText.replace(/\n/g, ' · '))
const installBtn = p.locator('[data-walk="account-install"] button')
if (await installBtn.count()) {
  await installBtn.click()
  await p.waitForTimeout(1200)
  check('no native prompt → routes to the full install guide', /\/install/.test(p.url()), p.url())
  await p.screenshot({ path: `${OUT}3-install-guide.png`, fullPage: false })
  await p.goBack({ waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.node-home .identity-name', { timeout: 30000 })
} else {
  check('install row already standalone (no button)', true, 'skipped install click')
}

// 5. How-this-works offers BOTH walks, and each runs through the real engine.
await p.locator('.htw-toggle').click()
await p.waitForSelector('.htw-card', { timeout: 5000 })
const offers = await p.locator('[data-walk-offer]').evaluateAll((els) =>
  els.map((e) => e.getAttribute('data-walk-offer')))
console.log('   offered walks:', offers.join(', '))
check('set-your-password offered in How this works', offers.includes('set-your-password'))
check('install-the-app offered in How this works', offers.includes('install-the-app'))
await p.screenshot({ path: `${OUT}4-how-this-works-offers.png`, fullPage: false })

for (const id of ['set-your-password', 'install-the-app']) {
  await p.locator(`[data-walk-offer="${id}"]`).click()
  await p.waitForTimeout(1200)
  const active = await p.locator('html').getAttribute('data-walk-active')
  check(`${id} starts through the real engine`, (active || '').startsWith(`${id}:`), active || 'none')
  const anchored = await p.locator('.walk-card').count()
  check(`${id} renders its card`, anchored >= 1)
  await p.screenshot({ path: `${OUT}5-walk-${id}.png`, fullPage: false })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  check(`${id} ends on Escape`, (await p.locator('html').getAttribute('data-walk-active')) === null)
  if (!(await p.locator('.htw-card').count())) await p.locator('.htw-toggle').click()
  await p.waitForTimeout(300)
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
process.exit(failed.length ? 1 : 0)
