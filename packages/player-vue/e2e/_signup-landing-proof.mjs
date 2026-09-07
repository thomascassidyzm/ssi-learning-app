import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const URL_ = env.SUPABASE_URL, SERVICE = env.SUPABASE_SERVICE_KEY, ANON = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
const BASE = process.env.BASE || 'http://localhost:47121'
const EMAIL = process.env.EMAIL
const PASSWORD = 'Proof-' + Math.random().toString(36).slice(2) + '!A9'

const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken:false, persistSession:false } })
const { data: created, error: cErr } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
if (cErr) { console.error('createUser failed:', cErr.message); process.exit(1) }
console.log('AUTH USER:', created.user.id, EMAIL)

const anon = createClient(URL_, ANON, { auth: { autoRefreshToken:false, persistSession:false } })
const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (sErr) { console.error('signIn failed:', sErr.message); process.exit(1) }
const ref = new globalThis.URL(URL_).hostname.split('.')[0]
const storageKey = `sb-${ref}-auth-token`
console.log('SESSION OK, storageKey', storageKey)

const browser = await chromium.launch({ args: ['--disable-gpu','--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
await ctx.addInitScript(([k, s]) => {
  localStorage.setItem(k, JSON.stringify(s))
  // Record what the role cache holds at document-start (what the router guard
  // will read) and every write to it thereafter.
  window.__roleAtStart = localStorage.getItem('ssi-user-role')
  window.__roleWrites = []
  const set = localStorage.setItem.bind(localStorage)
  localStorage.setItem = (kk, vv) => { if (kk === 'ssi-user-role') window.__roleWrites.push(vv); return set(kk, vv) }
  const rm = localStorage.removeItem.bind(localStorage)
  localStorage.removeItem = (kk) => { if (kk === 'ssi-user-role') window.__roleWrites.push('REMOVED'); return rm(kk) }
}, [storageKey, signIn.session])
const p = await ctx.newPage()
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE-ERR', m.text().slice(0,200)) })
p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0,200)))
p.on('response', async r => { if (r.url().includes('/api/onboarding/provision')) { console.log('PROVISION ->', r.status()); try { console.log('PROVISION BODY:', JSON.stringify(await r.json())) } catch {} } })
p.on('response', r => { if (r.status() === 406) console.log('406 ->', r.url().slice(0,160)) })
p.on('framenavigated', f => { if (f === p.mainFrame()) console.log('NAV ->', f.url()) })

await p.goto(`${BASE}/schools1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(6000)
console.log('STEP1 url:', p.url())
console.log('STEP1 shows "Continuing as":', (await p.locator('body').innerText()).includes('Continuing as'))
await p.screenshot({ path: `${process.env.CS_SCRATCH}/1-door.png` })

// Pick a language, exactly as a head would: open the taught-language menu
// and click the first option.
if (await p.locator('.ob-known').count()) {
  await p.locator('.ob-known').first().click()
  await p.waitForTimeout(600)
  const opts = p.locator('.ob-known-opts button')
  console.log('language options:', await opts.count())
  await opts.first().click()
  await p.waitForTimeout(1200)
}
console.log('CHOSEN:', (await p.locator('.ob-claim-endonym').allInnerTexts()).join('|'))
await p.screenshot({ path: `${process.env.CS_SCRATCH}/1b-chosen.png` })

const btn = p.locator('button', { hasText: /^Continue$/ }).first()
console.log('continue button count:', await btn.count())
await btn.click()
await p.waitForTimeout(12000)
console.log('AFTER url:', p.url())
console.log('ROLE AT DOCUMENT START of landing page:', await p.evaluate(() => window.__roleAtStart))
console.log('ROLE WRITES on landing page:', JSON.stringify(await p.evaluate(() => window.__roleWrites)))
const txt = (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 600)
console.log('AFTER text:', txt)
console.log('SAW finishing-details screen:', await p.locator('#ob-inst').count() > 0)
await p.screenshot({ path: `${process.env.CS_SCRATCH}/2-landing.png`, fullPage: true })
await browser.close()
