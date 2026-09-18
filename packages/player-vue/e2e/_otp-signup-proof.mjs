// The flow Tom named: pick a language, type the school admin's email, enter the
// code, land on the schools admin dashboard. The OTP is minted with the admin
// API (generateLink) rather than read from a mailbox — no mail is sent to
// anyone, and the app's own verifyOtp + provision run for real.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const BASE = process.env.BASE || 'https://saysomethingin.app'
const EMAIL = process.env.EMAIL
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth:{persistSession:false} })

const browser = await chromium.launch({ args: ['--disable-gpu','--no-sandbox'] })
const p = await (await browser.newContext({ viewport:{width:1200,height:900} })).newPage()
p.on('response', r => { if (r.url().includes('/api/onboarding/provision')) console.log('PROVISION ->', r.status()) })
p.on('framenavigated', f => { if (f === p.mainFrame()) console.log('NAV ->', f.url()) })

await p.goto(`${BASE}/schools1`, { waitUntil:'domcontentloaded', timeout:60000 })
await p.waitForTimeout(6000)

// 1. Choose the language.
await p.locator('.ob-known').first().click()
await p.waitForTimeout(600)
await p.locator('.ob-known-opts button').first().click()
await p.waitForTimeout(1000)
console.log('LANGUAGE:', (await p.locator('.ob-claim-endonym').allInnerTexts()).join('|'))

// 2. Enter the school admin's email and ask for the code.
await p.locator('#ob-email').fill(EMAIL)
await p.waitForTimeout(300)
await p.locator('button', { hasText: /Send my code/ }).first().click()
await p.waitForTimeout(9000)
console.log('ON CODE SCREEN:', (await p.locator('body').innerText()).includes('Check your email'))
await p.screenshot({ path: `${process.env.CS_SCRATCH}/otp-1-code.png` })

// 3. Mint the same account's code out-of-band and type it in.
const { data: link, error } = await admin.auth.admin.generateLink({ type:'magiclink', email: EMAIL })
if (error) { console.error('generateLink failed:', error.message); process.exit(1) }
const otp = link.properties.email_otp
console.log('OTP minted, length', (otp||'').length)
await p.locator('#ob-otp').fill(otp)
await p.waitForTimeout(300)
await p.locator('button', { hasText: /Confirm|Start/ }).first().click()
await p.waitForTimeout(15000)

console.log('AFTER url:', p.url())
console.log('SAW finishing-details screen:', await p.locator('#ob-inst').count() > 0)
console.log('AFTER text:', (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,320))
await p.screenshot({ path: `${process.env.CS_SCRATCH}/otp-2-landing.png`, fullPage:true })
await browser.close()
