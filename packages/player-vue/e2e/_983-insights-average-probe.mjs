// job #983 — staging, class insights, as an ssi_admin (harness admin account), 390px.
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const CLASS = process.env.CLASS_ID
const OUT = process.env.OUT_DIR
mkdirSync(OUT, { recursive: true })
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+e2e-admin@gmail.com'
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const svc = createClient(SB_URL, serviceKey)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: TESTER })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
console.log('minted session for', TESTER)

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
const page = await ctx.newPage()
const projectRef = new URL(SB_URL).hostname.split('.')[0]
await page.addInitScript(([key, sess]) => { try { localStorage.setItem(key, JSON.stringify(sess)) } catch {} }, [`sb-${projectRef}-auth-token`, v.session])

const payloads = []
page.on('response', async (r) => {
  if (!r.url().includes('rate-compare')) return
  let j = null; try { j = await r.json() } catch {}
  payloads.push({ url: decodeURIComponent(r.url()).slice(0, 220), status: r.status(),
    average: j?.average, cohortSize: j?.cohortSize, cohortSizeLine: j?.cohortSizeLine,
    entity: j?.entity?.value, percentile: j?.percentile, insufficient: j?.insufficientData, reason: j?.reason })
})

async function readCard(tag) {
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage: true })
  return page.evaluate(() => ({
    headline: (document.querySelector('.rc-stat-row')?.textContent || '').replace(/\s+/g, ' ').trim(),
    caption: (document.querySelector('.rc-stat-caption')?.textContent || '').replace(/\s+/g, ' ').trim(),
    cohortSize: (document.querySelector('.rc-stat-cohort-size')?.textContent || '').replace(/\s+/g, ' ').trim(),
    rankChip: (document.querySelector('.rc-pct-chip')?.textContent || '').trim(),
    measure: (document.querySelector('[data-walk=insights-measure] .fs-value')?.textContent || document.querySelector('[data-walk=insights-measure] .nre-fixed')?.textContent || '').replace(/\s+/g, ' ').trim(),
    metricDesc: (document.querySelector('.nre-metric-desc')?.textContent || '').replace(/\s+/g, ' ').trim(),
    empty: (document.querySelector('.nre-widget-card')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    windowChips: [...document.querySelectorAll('[data-walk=insights-window] button')].map((b) => `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' || b.className.includes('is-active') || b.className.includes('active') ? '*' : ''}`),
  }))
}

await page.goto(`${BASE}/admin/classes/${CLASS}/insights`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)
const first = await readCard('1-default')
console.log('DEFAULT', JSON.stringify(first, null, 1))

// Practice minutes — a SUM measure, the one a widening window must never lower.
const trigger = page.locator('[data-walk=insights-measure] .fs-trigger')
if (await trigger.count()) {
  await trigger.click()
  await page.waitForTimeout(600)
  const opts = await page.evaluate(() => [...document.querySelectorAll('.fs-panel [role=option], .fs-panel .fs-opt, .fs-panel button')].map((o) => o.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean))
  console.log('MEASURES', JSON.stringify(opts))
  const minutes = page.locator('.fs-panel [role=option], .fs-panel .fs-opt, .fs-panel button').filter({ hasText: /minute/i }).first()
  if (await minutes.count()) { await minutes.click(); await page.waitForTimeout(2500) }
  else { console.log('NO MINUTES OPTION'); await page.keyboard.press('Escape') }
} else { console.log('measure picker is fixed:', await page.locator('[data-walk=insights-measure] .nre-fixed').textContent().catch(() => '?')) }
const results = {}
for (const label of ['30 days', 'All time']) {
  const chip = page.locator('[data-walk=insights-window] button', { hasText: new RegExp(label.replace(' ', '\\s*'), 'i') }).first()
  if (await chip.count()) { await chip.click().catch(() => {}) } else { console.log('no chip for', label) }
  results[label] = await readCard(`2-minutes-${label.replace(/\s+/g, '')}`)
  console.log(label, JSON.stringify(results[label], null, 1))
}
console.log('PAYLOADS', JSON.stringify(payloads, null, 1))
await browser.close()
