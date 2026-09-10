// #421 — THE DEAD PLATFORM-ADMIN DOOR, reproduced (2026-09-08, read-only).
//
// Tom, on staging, two deploys behind: "the link to the platform admin doesn't
// work. The link just doesn't open anything." This drives the real Settings
// screen as a real ssi_admin and serves the /admin route's chunk the way this
// host actually serves a chunk that is no longer there — Vercel answers an
// unknown /assets/*.js with the SPA index.html, 200 text/html, not a 404.
//
// PRE-FIX OUTPUT: URL unchanged, settings overlay still open, admin topbar
// absent, and one console error — Couldn't resolve component "default" at
// "/admin" — a wording router/index.ts's stale-chunk recovery did not know, so
// the reload never fired. See src/router/staleChunkError.ts.
//
//   ADMIN_EMAIL=<harness admin> LD_LIBRARY_PATH=<pwlibs> \
//     node e2e/_421-stale-door-probe.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import { requireAccount } from './real-account-guard.mjs'
const ADMIN = requireAccount('ADMIN_EMAIL', 'signs in as an ssi_admin and opens Settings', 'thomas.cassidy+e2e-admin@gmail.com')
const envFile = readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
const pick = (k) => envFile.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const SUPABASE_URL = pick('SUPABASE_URL'), ANON = pick('SUPABASE_ANON_KEY'), SVC = pick('SUPABASE_SERVICE_ROLE_KEY')
const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.CS_SCRATCH + '/shots'; mkdirSync(OUT, { recursive: true })
const svc = createClient(SUPABASE_URL, SVC)
const { data: link } = await svc.auth.admin.generateLink({ type: 'magiclink', email: ADMIN })
const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: v } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
const ref = new URL(SUPABASE_URL).hostname.split('.')[0]

const html = await (await fetch(BASE + '/')).text()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, val]) => { try { localStorage.setItem(k, val) } catch {} }, [`sb-${ref}-auth-token`, JSON.stringify(v.session)])
let stale = false
const staled = []
await ctx.route('**/assets/*Admin*.js', async (route) => {
  if (stale) { staled.push(route.request().url().split('/').pop()); return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) }
  return route.continue()
})
const p = await ctx.newPage()
const log = []
p.on('console', m => { if (m.type() === 'error' || /Router|chunk/i.test(m.text())) log.push(m.type() + ': ' + m.text().slice(0, 180)) })
p.on('framenavigated', f => { if (f === p.mainFrame()) log.push('NAV -> ' + f.url()) })
await p.goto(BASE + '/?screen=settings', { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForTimeout(9000)
stale = true
const row = p.locator('.setting-row.clickable', { hasText: 'Platform admin' }).first()
await row.scrollIntoViewIfNeeded().catch(() => {})
await row.click({ timeout: 10000 }).catch(e => log.push('CLICK ERR ' + e.message.slice(0, 100)))
await p.waitForTimeout(8000)
console.log('chunks served stale HTML:', JSON.stringify(staled))
console.log('URL AFTER CLICK:', p.url())
console.log('admin topbar:', !!(await p.$('.admin-topbar')), '| settings overlay:', !!(await p.$('.settings-overlay')))
console.log('visible text:', (await p.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n/g, ' | '))
await p.screenshot({ path: OUT + '/3-stale-after-click.png' })
console.log('LOG:\n' + log.join('\n'))
await browser.close()
