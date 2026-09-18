import pw from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.js'
const { chromium } = pw
import { readFileSync } from 'node:fs'
const rd = (f) => Object.fromEntries(readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]))
const env = rd('/home/tomcassidy/SSi/ssi-learning-app/.env.local')
const SUPA = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY
const SVC = rd('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env').SUPABASE_SERVICE_KEY
const ref = new URL(SUPA).hostname.split('.')[0]
async function session(email) {
  const j = await (await fetch(`${SUPA}/auth/v1/admin/generate_link`, { method:'POST', headers:{ apikey:SVC, Authorization:`Bearer ${SVC}`, 'Content-Type':'application/json' }, body: JSON.stringify({ type:'magiclink', email }) })).json()
  if (!j.email_otp) throw new Error('no otp: '+JSON.stringify(j).slice(0,200))
  const s = await (await fetch(`${SUPA}/auth/v1/verify`, { method:'POST', headers:{ apikey:ANON, 'Content-Type':'application/json' }, body: JSON.stringify({ type:'magiclink', email, token: j.email_otp }) })).json()
  if (!s.access_token) throw new Error('no token: '+JSON.stringify(s).slice(0,200))
  return s
}
const BASE = process.env.BASE || 'http://localhost:5199'
const OUT = process.env.CS_SCRATCH
const browser = await chromium.launch({ executablePath: process.env.CHROME })
// 1. A real school leader, no view-as.
const leader = await session('thomas.cassidy+chepstowtest-leader@gmail.com')
let ctx = await browser.newContext({ viewport:{width:1100,height:820} })
await ctx.addInitScript(([k,v]) => localStorage.setItem(k,v), [`sb-${ref}-auth-token`, JSON.stringify(leader)])
let page = await ctx.newPage()
await page.goto(BASE+'/schools', { waitUntil:'networkidle', timeout:60000 }).catch(()=>{})
await page.waitForTimeout(3000)
await page.click('.user-trigger').catch(e=>console.log('no trigger', e.message))
await page.waitForTimeout(600)
console.log('LEADER menu:', await page.$$eval('.user-menu-pop .menu-item', els=>els.map(e=>e.textContent.trim())))
await page.screenshot({ path: `${OUT}/menu-leader.png` })
await page.goto(BASE+'/schools/handbook', { waitUntil:'networkidle' }).catch(()=>{})
await page.waitForTimeout(2500)
console.log('HANDBOOK tabs:', await page.$$eval('.scope-tab', els=>els.map(e=>({t:e.textContent.trim(), pressed:e.getAttribute('aria-pressed')}))))
await page.screenshot({ path: `${OUT}/handbook-mine.png` })
const lot = (await page.$$('.scope-tab'))[1]; if (lot) { await lot.click(); await page.waitForTimeout(800) }
console.log('HANDBOOK after Read the lot:', await page.$$eval('.scope-tab', els=>els.map(e=>({t:e.textContent.trim(), pressed:e.getAttribute('aria-pressed')}))))
await page.screenshot({ path: `${OUT}/handbook-thelot.png` })
await ctx.close()
// 2. ssi_admin viewing as a school leader.
const admin = await session('thomas.cassidy+ssi@gmail.com')
ctx = await browser.newContext({ viewport:{width:1100,height:820} })
await ctx.addInitScript(([k,v,persona]) => { localStorage.setItem(k,v); sessionStorage.setItem('ssi-viewing-as', persona) },
  [`sb-${ref}-auth-token`, JSON.stringify(admin), JSON.stringify({ key:'user:probe', userId:'', role:'school_admin', name:'leejames' })])
page = await ctx.newPage()
await page.goto(BASE+'/schools', { waitUntil:'networkidle', timeout:60000 }).catch(()=>{})
await page.waitForTimeout(3500)
await page.click('.user-trigger').catch(e=>console.log('no trigger', e.message))
await page.waitForTimeout(600)
console.log('VIEW-AS menu:', await page.$$eval('.user-menu-pop .menu-item', els=>els.map(e=>e.textContent.trim())))
await page.screenshot({ path: `${OUT}/menu-viewas.png` })
const bug = await page.$('[data-walk="schools-report-bug"]')
if (bug) { await bug.click(); await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/modal-viewas.png` })
  console.log('MODAL note:', await page.$eval('.rb-overlay .rb-note', e=>e.textContent.trim()).catch(()=>'(none)')) }
await ctx.close()
await browser.close()
