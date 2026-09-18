// The school door, end to end, as it stands since job #188: pick a language,
// type the school admin's email, tap "Set up my school", land on the schools
// dashboard with NO code typed; then mint that account's six digits with the
// admin API (no mail is sent to anyone) and confirm them in the dashboard
// banner, which should then disappear. Before #188 this script typed the code
// at the door; that step no longer exists on /schools1.
//
//   BASE=https://staging.saysomethingin.app EMAIL=head+probe@example.org node e2e/_otp-signup-proof.mjs
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const EMAIL = process.env.EMAIL
if (!EMAIL) { console.error('EMAIL is required'); process.exit(1) }
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth:{persistSession:false} })

const browser = await chromium.launch({ args: ['--disable-gpu','--no-sandbox'], ...(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {}) })
const p = await (await browser.newContext({ viewport:{width:1200,height:900} })).newPage()
p.on('response', r => {
  if (r.url().includes('/api/auth/setup-mint')) console.log('SETUP-MINT ->', r.status())
  if (r.url().includes('/api/onboarding/provision')) console.log('PROVISION ->', r.status())
  if (r.url().includes('/api/email/verify')) console.log('VERIFY ->', r.status())
})
p.on('framenavigated', f => { if (f === p.mainFrame()) console.log('NAV ->', f.url()) })

await p.goto(`${BASE}/schools1`, { waitUntil:'domcontentloaded', timeout:60000 })
await p.waitForTimeout(6000)

// 1. Choose the language — the heritage door preselects Welsh when the
//    choice is unambiguous, so a missing picker is not a failure.
try {
  await p.locator('.fs-trigger').first().click({ timeout: 5000 })
  await p.waitForTimeout(600)
  const opt = p.locator('[role=option], .fs-option, .fs-opt, .fs-item, .fs-list button, .fs-menu button').first()
  if (await opt.count()) await opt.click({ timeout: 5000 })
  else await p.getByText(/Welsh|Cymraeg/).first().click({ timeout: 5000 })
  await p.waitForTimeout(1000)
} catch (e) { console.log('LANGUAGE: picker step skipped —', String(e.message).split('\n')[0]) }
console.log('LANGUAGE:', (await p.locator('.ob-claim-endonym').allInnerTexts()).join('|'))

// 2. Type the email and set up — no code.
await p.locator('#ob-email').fill(EMAIL)
await p.waitForTimeout(300)
await p.locator('button', { hasText: /Set up my school/ }).first().click()
await p.waitForTimeout(15000)
const body1 = (await p.locator('body').innerText()).replace(/\s+/g,' ')
console.log('CODE SCREEN SHOWN (must be false):', body1.includes('Check your email'))
console.log('ON DASHBOARD:', /\/schools|\/org\//.test(p.url()), p.url())
console.log('BANNER SHOWN:', await p.locator('.mailbox-banner').count() > 0)
await p.screenshot({ path: `${process.env.CS_SCRATCH}/door-1-landing.png`, fullPage:true })

// 3. Mint the code out-of-band and confirm it in the banner.
const { data: link, error } = await admin.auth.admin.generateLink({ type:'magiclink', email: EMAIL })
if (error) { console.error('generateLink failed:', error.message); process.exit(1) }
await p.locator('.mailbox-banner__input').first().fill(link.properties.email_otp)
await p.locator('.mailbox-banner__btn').first().click()
await p.waitForTimeout(8000)
console.log('BANNER STATUS:', (await p.locator('.mailbox-banner__status').allInnerTexts()).join('|'))
await p.waitForTimeout(500)
await p.screenshot({ path: `${process.env.CS_SCRATCH}/door-2-confirmed.png`, fullPage:true })
await browser.close()
