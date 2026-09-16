// Job #26 — phone captures of the Insights display lab with real Pune numbers.
//   TMPDIR=/tmp/cs26 BASE_URL=https://staging.saysomethingin.app OUT=/abs/dir \
//   SB_URL=… SVC=… ANON=… node e2e/_26-lab-shots.mjs      (from packages/player-vue)
// Mints an ssi_admin session by magic link (service key), injects it into the
// browser, opens /admin/insights-lab at 390x844 and shoots: the whole page,
// each tile, then the Sunrise-vs-region and new-phrases states.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT || './lab-shots'
mkdirSync(OUT, { recursive: true })
const URL = process.env.SB_URL, SVC = process.env.SVC, ANON = process.env.ANON
const svc = createClient(URL, SVC)
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
const projectRef = new URL(URL).hostname.split('.')[0]

const browser = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) }, [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
const page = await ctx.newPage()
const log = []
page.on('console', (m) => { if (m.type() === 'error') log.push(m.text()) })

async function settle() {
  await page.waitForSelector('.tile[data-rendering="ribbon"]', { timeout: 60000 })
  await page.waitForTimeout(800)
}
await page.goto(`${BASE}/admin/insights-lab`, { waitUntil: 'domcontentloaded' })
await settle()
const status = await page.locator('.status').innerText()
const nums = await page.locator('.tile[data-rendering="lines"] .nums').innerText()
console.log('status:', status.replace(/\n/g, ' | '))
console.log('three numbers (lines tile):', nums.replace(/\n/g, ' '))
await page.screenshot({ path: `${OUT}/01-grade7a-vs-school-minutes-full.png`, fullPage: true })
const kinds = await page.locator('.tile').evaluateAll((els) => els.map((e) => e.getAttribute('data-rendering')))
let n = 2
for (const k of kinds) {
  await page.locator(`.tile[data-rendering="${k}"]`).screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-tile-${k}.png` })
  n++
}
// new phrases
await page.getByRole('button', { name: 'new phrases' }).click()
await page.waitForTimeout(500)
console.log('phrases numbers:', (await page.locator('.tile[data-rendering="lines"] .nums').innerText()).replace(/\n/g, ' '))
await page.screenshot({ path: `${OUT}/${String(n++).padStart(2, '0')}-grade7a-vs-school-phrases-full.png`, fullPage: true })
// Sunrise vs region
await page.getByRole('button', { name: 'minutes', exact: true }).click()
await page.getByRole('button', { name: 'Sunrise' }).click()
await page.waitForTimeout(2500)
await settle()
const opts = await page.locator('select.pick option').allInnerTexts()
console.log('compare options (Sunrise):', opts.join(' / '))
const region = opts.find((o) => /Region/i.test(o))
if (region) { await page.locator('select.pick').selectOption({ label: region }); await page.waitForTimeout(2500); await settle() }
console.log('status:', (await page.locator('.status').innerText()).replace(/\n/g, ' | '))
console.log('three numbers (Sunrise):', (await page.locator('.tile[data-rendering="lines"] .nums').innerText()).replace(/\n/g, ' '))
await page.screenshot({ path: `${OUT}/${String(n++).padStart(2, '0')}-sunrise-vs-region-minutes-full.png`, fullPage: true })
await page.locator('.tile[data-rendering="anomaly"]').screenshot({ path: `${OUT}/${String(n++).padStart(2, '0')}-sunrise-vs-region-anomaly.png` })
await page.locator('.tile[data-rendering="sentence"]').screenshot({ path: `${OUT}/${String(n++).padStart(2, '0')}-sunrise-vs-region-sentence.png` })
// one verdict round-trip, then read it back from the server
if (process.env.TAP === '1') {
  await page.locator('.tile[data-rendering="anomaly"] .tap.like').click()
  await page.waitForTimeout(2000)
  console.log('status after tap:', (await page.locator('.status').innerText()).replace(/\n/g, ' | '))
  const resp = await fetch(`${BASE}/api/lab/verdicts`, { headers: { Authorization: `Bearer ${v.session.access_token}` } })
  const j = await resp.json()
  console.log('server verdicts:', resp.status, (j.verdicts || []).length, JSON.stringify((j.verdicts || [])[0] || null))
}
writeFileSync(`${OUT}/console-errors.txt`, log.join('\n'))
console.log('console errors:', log.length)
await browser.close()
