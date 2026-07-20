// FOUNDER WALK 5b re-walk: the "Updated HH:MM" stamp must be present on the
// node home right after a cold navigation load — no manual refresh first.
//
//   EXPECT_BUILD=<sha> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/founder-walk-stampcheck.mjs <groupId>
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = new URL('../../../../docs/the-view/founder-walk/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const groupId = process.argv[2]
if (!groupId) throw new Error('usage: stampcheck.mjs <groupId>')

const EXPECT = process.env.EXPECT_BUILD
if (EXPECT) {
  const { buildNumber } = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
  if (buildNumber !== EXPECT) { console.log(`FAIL — deploy gate: deployed=${buildNumber} expected=${EXPECT}`); process.exit(2) }
}

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
const p = await ctx.newPage()
await p.goto(`${BASE}/admin/groups/${groupId}`, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForSelector('.map-rail', { timeout: 20000 })
await p.waitForTimeout(1500)
const stamp = await p.locator('.updated-stamp').first().innerText().catch(() => '')
const ok = /Updated \d{2}:\d{2}/.test(stamp)
console.log(`${ok ? 'PASS' : 'FAIL'} — 5b Updated stamp present on cold node-home load (no manual refresh): "${stamp}"`)
await p.screenshot({ path: `${OUT}fw-11-updated-stamp.png` })
await browser.close()
process.exit(ok ? 0 : 1)
