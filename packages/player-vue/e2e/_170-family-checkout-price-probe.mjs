// Advance the LIVE Paddle Family checkout one step to read the priced summary.
// NO card details, NO purchase.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const BASE='https://saysomethingin.app', S=process.env.CS_SCRATCH
const EMAIL=`zz-probe-170-${Date.now()}@ssi-probe.test`, PW='Probe170-'+Math.random().toString(36).slice(2)+'!A9'
const admin=createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}})
const {data:created,error:cE}=await admin.auth.admin.createUser({email:EMAIL,password:PW,email_confirm:true})
if(cE){console.error(cE.message);process.exit(1)}
const anon=createClient(env.SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY,{auth:{persistSession:false}})
const {data:si}=await anon.auth.signInWithPassword({email:EMAIL,password:PW})
const key=`sb-${new globalThis.URL(env.SUPABASE_URL).hostname.split('.')[0]}-auth-token`
console.log('USER', created.user.id, EMAIL)
const b=await chromium.launch({args:['--disable-gpu','--no-sandbox']})
const ctx=await b.newContext({viewport:{width:1280,height:1000}, locale:'en-GB'})
await ctx.addInitScript(([k,s])=>localStorage.setItem(k,JSON.stringify(s)),[key,si.session])
const p=await ctx.newPage()
await p.goto(`${BASE}/?screen=settings`,{waitUntil:'domcontentloaded',timeout:60000})
await p.waitForTimeout(12000)
await p.locator('.setting-row',{hasText:/Go Family/i}).first().click()
await p.waitForTimeout(14000)
const fr = p.frames().find(f=>/buy\.paddle\.com\/checkout/.test(f.url()))
if(!fr){console.log('NO PADDLE FRAME');process.exit(1)}
console.log('HEADER:', (await fr.locator('body').innerText()).split('\n')[0])
// Country -> United Kingdom, then Continue
try { await fr.locator('select').first().selectOption({label:'United Kingdom'}); console.log('country set: United Kingdom') } catch(e){ console.log('country err', e.message.slice(0,100)) }
await p.waitForTimeout(2500)
try { await fr.locator('input[type=text], input:not([type])').last().fill('SW1A 1AA'); console.log('zip filled') } catch(e){ console.log('zip err', e.message.slice(0,80)) }
await p.waitForTimeout(1000)
await fr.locator('button', {hasText:/Continue/i}).first().click()
await p.waitForTimeout(16000)
const fr2 = p.frames().find(f=>/buy\.paddle\.com\/checkout/.test(f.url())) || fr
console.log('PRICE LINES:'); for (const l of (await fr2.locator('body').innerText()).split('\n')) { if (/\u00a3|VAT|month|year|total|due|Family/i.test(l)) console.log('  |', l.trim()) }
await p.screenshot({path:`${S}/h1-priced-checkout.png`})
await b.close()
