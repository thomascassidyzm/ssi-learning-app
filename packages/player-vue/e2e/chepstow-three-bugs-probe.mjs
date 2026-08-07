// Deployed probe — the three bugs Tom's Chepstow-mirror testing surfaced
// (2026-08-07). Runs against MAIN/production, because admin and school
// surfaces live and are tested on main (Tom's A-81 ruling).
//
//   node e2e/chepstow-three-bugs-probe.mjs
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/...
//
// Signs in as the real ZZ Chepstow Mirror School leader with the shared test
// password and checks, on the leader's own surfaces:
//   1. the school's state badge names the trial LANGUAGE, not a bare "Trial"
//      and not a raw course code
//   2. the Subscribe page's seat stepper opens on the school's ACTUAL teacher
//      count (3), not the hardcoded 1
//   3. Insights names the course "Welsh (South)", never "Cym_s_for_eng"
//
// DELIBERATELY NOT DONE: no Paddle checkout is ever opened and nothing is
// ever submitted. This runs against a real account on the real production
// deployment; a probe does not transact. Everything up to the pay button is
// exercised for real.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://saysomethingin.app'
const EMAIL = process.env.LEADER_EMAIL || 'thomas.cassidy+zz.chepstow.leader@gmail.com'
const PASSWORD = process.env.LEADER_PASSWORD || 'SsiTest2026!'
const OUT = new URL('../../../docs/chepstow-three-bugs/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

// The raw-code shapes that must never reach a leader's screen.
const RAW_CODE = /cym_s_for_eng/i

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const p = await ctx.newPage()

async function shot(name) {
  await p.screenshot({ path: `${OUT}${name}.png`, fullPage: false }).catch(() => {})
}

// ─── Sign in (Save Progress → email → "Use password instead" → password) ───
await p.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})

const saveProgress = p.getByText(/save progress/i).first()
if (await saveProgress.isVisible().catch(() => false)) await saveProgress.click().catch(() => {})

const emailField = p.locator('input[type="email"]').first()
await emailField.waitFor({ timeout: 30000 })
await emailField.fill(EMAIL)
await p.getByRole('button', { name: /continue|next|sign in/i }).first().click().catch(() => {})

const usePassword = p.getByText(/use password instead/i).first()
await usePassword.waitFor({ timeout: 20000 }).catch(() => {})
if (await usePassword.isVisible().catch(() => false)) await usePassword.click().catch(() => {})

const pwField = p.locator('input[type="password"]').first()
await pwField.waitFor({ timeout: 20000 })
await pwField.fill(PASSWORD)
await p.getByRole('button', { name: /sign in|continue|log in/i }).first().click().catch(() => {})

// The sign-in button spins while Supabase answers — wait for the PASSWORD
// FIELD to go, not for networkidle. The first cut of this probe screenshotted
// a still-spinning button and read every later surface signed-out.
await p.locator('input[type="password"]').first().waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {})
await p.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {})
await p.waitForTimeout(2000)
const signedIn = !(await p.locator('input[type="password"]').first().isVisible().catch(() => false))
check('signed in as the Chepstow school leader', signedIn, p.url())
if (!signedIn) {
  await shot('0-signin-failed')
  console.log('\nABORTING — every later check would read a signed-out page and lie.')
  await browser.close()
  process.exit(1)
}
await shot('0-signed-in')

// ─── BUG 1 — the school card's state badge names the trial language ───
await p.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForTimeout(3000)
let badgeText = ''
for (const sel of ['.state-badge', '.status-pill', '[class*="state-badge"]', '[class*="status-pill"]']) {
  const el = p.locator(sel).first()
  if (await el.isVisible().catch(() => false)) { badgeText = (await el.textContent().catch(() => '')) || ''; break }
}
const pageText = (await p.locator('body').textContent().catch(() => '')) || ''
const trialLine = badgeText || (pageText.match(/Trial[^\n]{0,40}/) || [''])[0]
check('B1 — trial badge names a language, not a bare "Trial"', /Trial\s*[—-]\s*\S/.test(trialLine), trialLine.trim())
check('B1 — trial badge shows no raw course code', !RAW_CODE.test(trialLine), trialLine.trim())
await shot('1-trial-badge')

// ─── BUG 2 — the Subscribe page opens on the real teacher count ───
await p.goto(`${BASE}/schools/upgrade`, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForTimeout(4000)
let seatValue = ''
const seatInput = p.locator('input[type="number"], .seat-count, [class*="seat"] input').first()
if (await seatInput.isVisible().catch(() => false)) {
  seatValue = (await seatInput.inputValue().catch(() => '')) || (await seatInput.textContent().catch(() => '')) || ''
}
if (!seatValue) {
  const upgradeText = (await p.locator('body').textContent().catch(() => '')) || ''
  seatValue = (upgradeText.match(/(\d+)\s*teacher seats?/i) || [])[1] || ''
}
check('B2 — seat stepper opens on the school\'s 3 teachers, not 1', seatValue.trim() === '3', `seats=${seatValue.trim() || '(not found)'}`)
await shot('2-subscribe-seats')

// ─── BUG 3 — Insights names the course ───
await p.goto(`${BASE}/schools/analytics`, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForTimeout(6000)
const insightText = (await p.locator('body').textContent().catch(() => '')) || ''
check('B3 — Insights prints no raw course code', !RAW_CODE.test(insightText), (insightText.match(/Cym_s\S*/i) || [''])[0])
check('B3 — Insights names the course "Welsh (South)"', /Welsh\s*\(South\)/i.test(insightText))
await shot('3-insights-course')

await browser.close()

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
  process.exit(1)
}
