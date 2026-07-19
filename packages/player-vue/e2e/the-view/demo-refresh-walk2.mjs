// Demo-refresh walk — supplemental probes (2026-07-19 finish pass):
//   A. CLASS-level home/insights after refresh — screenshot, alive data.
//   B. Regression: node home COLD load timing (first-time-fast).
//   C. Regression: idle network quiet — count requests over 30s after settle.
//
//   EXPECT_BUILD=<sha7> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/demo-refresh-walk2.mjs
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

const IME_GROUP_ID = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a'
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

// pick an IME class
const { data: schools, error: serr } = await svc.from('schools').select('id, school_name').eq('group_id', IME_GROUP_ID)
if (serr) throw serr
const { data: classes } = await svc.from('classes').select('id, class_name, school_id').in('school_id', schools.map((s) => s.id)).limit(1)
const cls = classes[0]
console.log(`class under walk: ${cls.class_name} (${cls.id})`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])

// A. class home — alive after refresh
{
  const p = await ctx.newPage()
  await p.goto(`${BASE}/admin/classes/${cls.id}`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(2500)
  const body = await p.locator('body').innerText().catch(() => '')
  check('class home renders the class', body.includes(cls.class_name), cls.class_name)
  check('class home not empty of data', !/Not enough data|No activity/i.test(body))
  await p.screenshot({ path: `${OUT}after-class-home.png`, fullPage: true })
  await p.close()
}

// B. cold-load timing on the programme node home (fresh context, no cache)
{
  const cold = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await cold.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
  const p = await cold.newPage()
  const t0 = Date.now()
  await p.goto(`${BASE}/admin/groups/${IME_GROUP_ID}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForSelector('.stats-row .stat-value', { timeout: 25000 }).catch(() => {})
  const ms = Date.now() - t0
  check('node home cold load renders stats fast', ms < 8000, `${ms}ms to stats`)
  // C. idle network quiet: count requests over 30s AFTER settle
  await p.waitForTimeout(3000)
  let reqs = 0
  const listener = (r) => { const u = r.url(); if (!u.startsWith('data:')) { reqs++; console.log(`  idle request: ${u.slice(0, 120)}`) } }
  p.on('request', listener)
  await p.waitForTimeout(30000)
  p.off('request', listener)
  check('network quiet at idle (0 requests in 30s)', reqs === 0, `${reqs} requests`)
  await cold.close()
}

await browser.close()
console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
