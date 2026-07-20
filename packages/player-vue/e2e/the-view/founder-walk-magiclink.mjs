// FOUNDER WALK item C re-run: mint a real teacher invite link on the Structure
// page and open it in a FRESH context — must land in, authenticated, zero
// interstitials, no OTP. (The main walk's selectors missed the tree row's
// .structure-name click target; this drives the real UI.)
//
//   node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/founder-walk-magiclink.mjs "<school name>"
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = new URL('../../../../docs/the-view/founder-walk/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const schoolName = process.argv[2] || 'Gaelscoil na Mara'

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]

const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
const session = v.session

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(session)])
const p = await ctx.newPage()
await p.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
await p.locator('.structure-name').filter({ hasText: schoolName }).first().click()
await p.waitForSelector('.node-panel', { timeout: 15000 })
await p.waitForTimeout(2000) // links load

let linkUrl = null
const teacherRow = p.locator('.link-row').filter({ hasText: /teacher/i }).first()
if (await teacherRow.count()) {
  linkUrl = (await teacherRow.locator('.link-url').innerText()).trim()
} else {
  await p.locator('.verb-btn').filter({ hasText: /Invite/i }).first().click()
  await p.locator('.verb-form select').first().selectOption('teacher').catch(() => {})
  await p.locator('.verb-form .btn-primary-sm').first().click()
  await p.waitForTimeout(4000)
  await p.waitForSelector('.link-row', { timeout: 15000 })
  const row = p.locator('.link-row').filter({ hasText: /teacher/i }).first()
  if (await row.count()) linkUrl = (await row.locator('.link-url').innerText()).trim()
}
await p.screenshot({ path: `${OUT}fw-9-ways-in.png` })
console.log(`${linkUrl ? 'PASS' : 'FAIL'} — 7a teacher invite link on the node: ${linkUrl || 'none'}`)
await ctx.close()
if (!linkUrl) { await browser.close(); process.exit(1) }

// fresh context, NO session — the straight-in test
const target = linkUrl.replace(/^Copied!$/, '').replace(/https?:\/\/[^/]+/, BASE)
const fresh = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const fp = await fresh.newPage()
const t0 = Date.now()
await fp.goto(target, { waitUntil: 'networkidle' }).catch(() => {})
await fp.waitForTimeout(6000)
const body = (await fp.locator('body').innerText()).replace(/\s+/g, ' ')
const hasOtp = /one-time|OTP|check your email|enter the code|sign in to continue/i.test(body)
const emailForm = await fp.locator('input[type="email"]:visible').count()
const authed = await fp.evaluate((ref) => !!window.localStorage.getItem(`sb-${ref}-auth-token`), projectRef)
console.log(`${authed && !hasOtp && emailForm === 0 ? 'PASS' : 'FAIL'} — 7b fresh context straight-in: ${((Date.now() - t0) / 1000).toFixed(1)}s → ${fp.url()} authed=${authed} otp=${hasOtp} emailInputs=${emailForm}`)
await fp.screenshot({ path: `${OUT}fw-10-straight-in.png`, fullPage: true })
await browser.close()
process.exit(authed && !hasOtp && emailForm === 0 ? 0 : 1)
