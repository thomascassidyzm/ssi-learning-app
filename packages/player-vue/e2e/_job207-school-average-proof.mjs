// job #207 — live proof: Chepstow 10P's week card, and the school average beside it.
//
// Tom on production 2026-09-18: "The school average is the misleading one. It can't be zero if
// the class I'm looking at has 8m." This drives a real browser as an ssi_admin (the harness
// account) through the admin read-view of 10P's insights and prints the card's four rows plus the
// server payload behind them, so "what the leader sees" is a capture rather than a claim.
//
// Run it:
//   TMPDIR=~/.t207 CHROME_BIN=<playwright chrome> OUT_DIR=<dir> \
//     node packages/player-vue/e2e/_job207-school-average-proof.mjs
//
// TMPDIR matters: chromium's singleton socket path has a ~104-char limit and a scratch dir under
// ~/.cs-scratch/cs-<uuid> blows it, which aborts the browser before it opens a page.
//
// BEFORE (staging, pre-fix):  "Play as class | 7m | 0m"   server cohort 0.4 min
// AFTER  (staging, post-fix): "Play as class | 8m | <1m"  same server payload, honest rendering
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const CLASS = '9cbef56d-baf7-4e22-bdc1-9e38f98b1e17' // Chepstow 10P
const OUT = process.env.OUT_DIR
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 } })
const page = await ctx.newPage()
const ref = new URL(SB_URL).hostname.split('.')[0]
await page.addInitScript(([k, s]) => { try { localStorage.setItem(k, JSON.stringify(s)) } catch {} }, [`sb-${ref}-auth-token`, v.session])

let payload = null
page.on('response', async (r) => {
  if (!r.url().includes('rate-compare')) return
  try { const j = await r.json(); if (j?.week) payload = { url: decodeURIComponent(r.url()).slice(0,200), week: { window: j.week.window, entity: j.week.entity, cohort: j.week.cohort } } } catch {}
})

const SCHOOL_NODE = '568fe0ca-4846-4d4b-ac3d-5af94eb30073' // Chepstow's node group
const readCard = () => page.evaluate(() => {
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const row = (k) => [...document.querySelectorAll(`.wk-row-${k} .wk-cell`)].map((c) => txt(c)).join(' | ')
  return {
    window: txt(document.querySelector('.wk-window')),
    range: txt(document.querySelector('.wk-range')),
    header: [...document.querySelectorAll('.wk-row-head .wk-cell')].map(txt).join(' | '),
    playAsClass: row('class'),
    studentsOwn: row('pupils'),
    total: row('total'),
    phrases: row('phrases'),
    denominator: txt(document.querySelector('.wk-denominator')),
  }
})

async function visit(tag, url) {
  payload = null
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(12000)
  const card = await readCard()
  console.log(`\n── ${tag} ──`)
  console.log('CARD:', JSON.stringify(card, null, 1))
  if (payload) console.log('SERVER cohort:', JSON.stringify(payload.week.cohort))
  await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage: true })
}

await visit('10p-this-week', `${BASE}/admin/classes/${CLASS}/insights?window=this_week`)
await visit('10p-last-week', `${BASE}/admin/classes/${CLASS}/insights?window=last_week`)
await visit('10p-all-time', `${BASE}/admin/classes/${CLASS}/insights?window=all_time`)
await visit('school-this-week', `${BASE}/admin/groups/${SCHOOL_NODE}/insights?window=this_week`)
await browser.close()
