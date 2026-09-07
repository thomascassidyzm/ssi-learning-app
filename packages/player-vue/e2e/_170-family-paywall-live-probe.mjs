// Job #170 — prove SSi Family is sellable on LIVE production.
// A brand-new real learner account, signed in for real, reaching the paywall
// and opening the Paddle checkout. NO purchase is completed, no card entered.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const URL_=env.SUPABASE_URL, SERVICE=env.SUPABASE_SERVICE_KEY, ANON=env.VITE_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY
const BASE = process.env.BASE || 'https://saysomethingin.app'
const EMAIL = process.env.EMAIL || `zz-probe-170-${Date.now()}@ssi-probe.test`
const PASSWORD = 'Probe170-' + Math.random().toString(36).slice(2) + '!A9'
const S = process.env.CS_SCRATCH

const admin = createClient(URL_, SERVICE, { auth:{autoRefreshToken:false,persistSession:false} })
const { data: created, error: cErr } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
if (cErr) { console.error('createUser failed:', cErr.message); process.exit(1) }
console.log('NEW AUTH USER:', created.user.id, EMAIL)

const anon = createClient(URL_, ANON, { auth:{autoRefreshToken:false,persistSession:false} })
const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (sErr) { console.error('signIn failed:', sErr.message); process.exit(1) }
const ref = new globalThis.URL(URL_).hostname.split('.')[0]
const storageKey = `sb-${ref}-auth-token`
console.log('REAL SESSION OK for', signIn.user.email)

const b = await chromium.launch({ args:['--disable-gpu','--no-sandbox'] })
const ctx = await b.newContext({ viewport:{width:420,height:900} })
await ctx.addInitScript(([k,s])=>localStorage.setItem(k,JSON.stringify(s)), [storageKey, signIn.session])
const p = await ctx.newPage()
p.on('console', m=>{ const t=m.text(); if(/paddle|checkout|family/i.test(t)) console.log('CONSOLE:', t.slice(0,200)) })
p.on('pageerror', e=>console.log('PAGEERROR', e.message.slice(0,200)))
p.on('request', r=>{ if(/paddle/i.test(r.url()) && /checkout|transaction|prices/i.test(r.url())) console.log('PADDLE REQ ->', r.method(), r.url().slice(0,140)) })

await p.goto(`${BASE}/?screen=settings`, { waitUntil:'domcontentloaded', timeout:60000 })
await p.waitForTimeout(12000)
console.log('URL:', p.url())
const txt = () => p.locator('body').innerText()
console.log('SIGNED IN (no "Save Progress" nudge):', !(await txt()).includes('Save Progress'))
await p.screenshot({ path:`${S}/f1-settings.png`, fullPage:true })

// Find the subscription section
const body = (await txt()).replace(/\s+/g,' ')
console.log('BODY SNIPPET:', body.slice(0,900))
const famRow = p.locator('.setting-row', { hasText:/Family/i })
console.log('FAMILY ROWS FOUND:', await famRow.count())
if (await famRow.count()) {
  console.log('FAMILY ROW TEXT:', (await famRow.first().innerText()).replace(/\s+/g,' '))
  await famRow.first().scrollIntoViewIfNeeded()
  await p.screenshot({ path:`${S}/f2-family-row.png`, fullPage:true })
  await famRow.first().click()
  await p.waitForTimeout(15000)
  await p.screenshot({ path:`${S}/f3-checkout.png`, fullPage:true })
  console.log('AFTER CLICK URL:', p.url())
  // Paddle renders its checkout in an iframe
  for (const f of p.frames()) {
    if (/paddle/i.test(f.url())) {
      console.log('PADDLE FRAME:', f.url().slice(0,180))
      try { console.log('PADDLE FRAME TEXT:', (await f.locator('body').innerText()).replace(/\s+/g,' ').slice(0,700)) } catch(e){ console.log('frame text err', e.message.slice(0,80)) }
    }
  }
  console.log('PAGE TEXT AFTER CLICK:', (await txt()).replace(/\s+/g,' ').slice(0,700))
}
await b.close()
console.log('PROBE EMAIL:', EMAIL, 'AUTH ID:', created.user.id)
