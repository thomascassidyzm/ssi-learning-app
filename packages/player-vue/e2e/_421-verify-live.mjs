// #421 — VERIFYING BOTH FIXES ON THE DEPLOYED SITE (read-only).
//
// A: the platform-admin door opens on an ordinary tap.
// B: the door ALSO opens for the tab Tom actually had — one whose /admin
//    chunk is no longer served, which this host answers with the SPA
//    fallback rather than a 404. Pre-fix the URL never changed and the
//    settings overlay stayed open; post-fix the recovery reload fires and
//    the admin shell renders.
// And the money path: /api/subscription reports isPlatformAdmin, so the
// SUBSCRIPTION section names his access instead of selling him a plan.
//
//   ADMIN_EMAIL=<harness admin> BASE_URL=https://staging.saysomethingin.app \
//     LD_LIBRARY_PATH=<pwlibs> node e2e/_421-verify-live.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import { requireAccount } from './real-account-guard.mjs'
const ADMIN = requireAccount('ADMIN_EMAIL', 'signs in as an ssi_admin and opens Settings', 'x@y.z')
const envFile = readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
const pick = (k) => envFile.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const U = pick('SUPABASE_URL'), A = pick('SUPABASE_ANON_KEY'), S = pick('SUPABASE_SERVICE_ROLE_KEY')
const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.CS_SCRATCH + '/shots'; mkdirSync(OUT, { recursive: true })
const { data: link } = await createClient(U, S).auth.admin.generateLink({ type: 'magiclink', email: ADMIN })
const { data: v } = await createClient(U, A, { auth: { persistSession: false } }).auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
const ref = new URL(U).hostname.split('.')[0]
const html = await (await fetch(BASE + '/')).text()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, val]) => { try { localStorage.setItem(k, val) } catch {} }, [`sb-${ref}-auth-token`, JSON.stringify(v.session)])
let stale = false, reloads = 0
// Stale ONLY the chunk names this page already holds — after the recovery
// reload the app asks for the CURRENT build's names, which are still served,
// exactly as they would be for a tab that was a deploy behind.
await ctx.route('**/assets/*Admin*.js', async (r) => {
  if (stale) { stale = false; return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) }
  return r.continue()
})
const p = await ctx.newPage()
p.on('framenavigated', f => { if (f === p.mainFrame()) reloads++ })
await p.goto(BASE + '/?screen=settings', { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForTimeout(9000)
console.log('BUILD:', await p.evaluate(() => fetch('/version.json').then(r => r.text())))
const api = await p.evaluate(async () => {
  const raw = localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('-auth-token')))
  const tok = JSON.parse(raw).access_token
  return await (await fetch('/api/subscription', { headers: { Authorization: 'Bearer ' + tok } })).json()
})
console.log('API /api/subscription:', JSON.stringify(api))
const labels = await p.$$eval('.setting-row .setting-label', els => els.map(e => e.textContent.trim()))
console.log('UPGRADE ROW STILL SHOWN:', labels.some(l => /^upgrade$/i.test(l)))
const sub = await p.evaluate(() => [...document.querySelectorAll('section')].map(s => s.innerText.replace(/\n/g, ' | ')).find(t => t.startsWith('SUBSCRIPTION')))
console.log('SUBSCRIPTION SECTION:', sub)
await p.screenshot({ path: OUT + '/live-1-settings.png', fullPage: true })
// A: normal tap
let row = p.locator('.setting-row.clickable', { hasText: 'Platform admin' }).first()
await row.click({ timeout: 10000 })
await p.waitForTimeout(5000)
console.log('A) normal tap ->', p.url(), '| admin topbar:', !!(await p.$('.admin-topbar')))
await p.screenshot({ path: OUT + '/live-2-admin.png' })
// B: the stale-chunk case Tom hit
await p.goto(BASE + '/?screen=settings', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(8000)
stale = true; const before = reloads
row = p.locator('.setting-row.clickable', { hasText: 'Platform admin' }).first()
await row.scrollIntoViewIfNeeded().catch(() => {})
await row.click({ timeout: 10000 })
await p.waitForTimeout(12000)
console.log('B) stale-chunk tap ->', p.url(), '| navigations since:', reloads - before, '| admin topbar:', !!(await p.$('.admin-topbar')))
await p.screenshot({ path: OUT + '/live-3-stale-recovered.png' })
await browser.close()
