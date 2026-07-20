// 3-tier demo tree — Compare-to chain verification (scope add, 2026-07-19).
// After re-parenting IME's demo schools under "Pilot Districts Region", a demo
// CLASS's Compare-to must offer the full ancestor chain:
//   school → region → programme → global → global (all courses)  = 5 options.
//
//   EXPECT_BUILD=<sha7> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/demo-refresh-walk3.mjs
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/demo-refresh/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const EXPECT = process.env.EXPECT_BUILD
if (EXPECT) {
  const { buildNumber } = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
  if (buildNumber !== EXPECT) { console.log(`FAIL — deploy gate: deployed=${buildNumber} expected=${EXPECT}`); process.exit(2) }
}

const CLASS_ID = 'e2bbe2de-cada-4aed-908a-4b36d26ca95c' // Grade 6A, Sunrise Pune (demo)

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// ── API: compare-to options on the demo class ──
const resp = await fetch(`${BASE}/api/groups/${CLASS_ID}/rate-compare`, {
  headers: { Authorization: `Bearer ${v.session.access_token}` },
})
const body = await resp.json().catch(() => ({}))
const opts = body?.options?.compares || []
console.log('compare_to options:', JSON.stringify(opts.map((o) => `${o.label} (${o.word})`)))
check('rate-compare responds', resp.ok, `${resp.status}`)
check('5 compare-to options offered', opts.length === 5, `${opts.length}`)
check('school in the chain', opts.some((o) => /Sunrise Public School/i.test(o.label)))
check('region (district tier) in the chain', opts.some((o) => /Pilot Districts Region/i.test(o.label)))
check('programme in the chain', opts.some((o) => /IME Demo Programme/i.test(o.label)))
check('globals in the chain', opts.filter((o) => /global/i.test(String(o.value))).length === 2)

// ── UI: open the Compare-to FrostSelect on the class insights view, screenshot ──
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
const p = await ctx.newPage()
await p.goto(`${BASE}/admin/classes/${CLASS_ID}/insights`, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForSelector('[aria-label="Compare to"]', { timeout: 25000 }).catch(() => {})
await p.waitForTimeout(1500)
await p.locator('[aria-label="Compare to"] .fs-trigger, button[aria-label="Compare to"], [aria-label="Compare to"]').first().click().catch(() => {})
await p.waitForTimeout(600)
const uiOptions = await p.locator('.fs-list .fs-opt-label').allInnerTexts().catch(() => [])
console.log('UI compare options:', JSON.stringify(uiOptions))
check('UI offers the full 5-option chain', uiOptions.length === 5, `${uiOptions.length}`)
check('UI chain order school→region→programme→globals',
  /Sunrise/.test(uiOptions[0] || '') && /Pilot Districts/.test(uiOptions[1] || '') &&
  /IME Demo Programme/.test(uiOptions[2] || '') && /Global/.test(uiOptions[3] || '') && /Global/.test(uiOptions[4] || ''))
await p.screenshot({ path: `${OUT}compare-chain-class-3tier.png`, fullPage: false })
await browser.close()

console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
