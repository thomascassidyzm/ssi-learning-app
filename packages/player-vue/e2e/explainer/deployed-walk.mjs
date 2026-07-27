// Deployed-dev walk — the self-explaining dashboard rendered for real
// (docs/self-explaining-dashboard.md; evidence run 2026-07-27).
//
//   node e2e/explainer/deployed-walk.mjs
//
// Opens the IME Programme Leader PERSONAL link (the link IS the login) in a
// fresh browser on deployed dev, lands on the leader's node home, checks the
// "How this works" entry opens the leader explanation, then walks to the
// Grade 6A class page and checks a noticing invitation is rendered and
// dismissible. Screenshots → docs/explainer/.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const LEADER_LINK = `${BASE}/group/QJM-868`
const CLASS_ID = '02503883-3f5e-48c3-82c2-243158925288' // Grade 6A (Sunrise, Pune)
const OUT = new URL('../../../../docs/explainer/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const p = await ctx.newPage()

// 1. The personal link: straight in, zero screens, leader node home.
await p.goto(LEADER_LINK, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForSelector('.node-home .identity-name', { timeout: 30000 })
check('leader link lands on node home', /schools\/org\//.test(p.url()), p.url())

// 2. How this works — opens, carries the leader ruling's language.
const toggle = p.locator('.htw-toggle')
check('How this works entry present', (await toggle.count()) === 1)
await toggle.click()
await p.waitForSelector('.htw-card', { timeout: 5000 })
const htwText = await p.locator('.htw-body').innerText()
check('leader explanation renders', htwText.includes('your organisation'), htwText.slice(0, 60))
await p.screenshot({ path: `${OUT}deployed-1-how-this-works.png`, fullPage: false })

// 3. Grade 6A — a noticing invitation on real data, dismissible.
await p.goto(`${BASE}/schools/org/${CLASS_ID}`, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForSelector('.node-home .identity-name', { timeout: 30000 })
await p.waitForTimeout(1500)
const notices = p.locator('.notice-card')
const nNotices = await notices.count()
check('noticing invitation rendered on Grade 6A', nNotices >= 1, `${nNotices} card(s)`)
if (nNotices) {
  console.log('   invitation:', (await notices.first().innerText()).replace(/\n/g, ' · '))
  await p.screenshot({ path: `${OUT}deployed-2-invitation.png`, fullPage: false })
  await notices.first().locator('.notice-dismiss').click()
  await p.waitForTimeout(500)
  check('invitation dismisses', (await p.locator('.notice-card').count()) === nNotices - 1)
  await p.reload({ waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.node-home .identity-name', { timeout: 30000 })
  await p.waitForTimeout(1500)
  check('dismissal survives reload', (await p.locator('.notice-card').count()) === nNotices - 1)
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
process.exit(failed.length ? 1 : 0)
