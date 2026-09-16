// Job #34b — Tom's exact path: an ssi_admin who has BEEN to another admin page
// first, then opens /admin/insights-lab by URL. Lands on /admin/structure.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = fs.readFileSync(process.env.ANON_FILE,'utf8').trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const OUT = process.env.OUT || '/home/tomcassidy/probe-34b'
fs.mkdirSync(OUT, { recursive: true })
const EMAIL = 'thomas.cassidy+ssi@gmail.com'

const link = await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }).then(r => r.json())
const v = await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }) }).then(r => r.json())
if (!v.access_token) { console.error('verify failed', v); process.exit(1) }
const session = { access_token: v.access_token, refresh_token: v.refresh_token, expires_in: v.expires_in, expires_at: Math.floor(Date.now()/1000)+(v.expires_in||3600), token_type: 'bearer', user: v.user }

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('console', m => { const t = m.text(); if (/router|Router|admin|redirect/i.test(t)) console.log('   [c]', t.slice(0,180)) })
await page.addInitScript(([k, s]) => window.localStorage.setItem(k, JSON.stringify(s)), ['sb-swfvymspfxmnfhevgdkg-auth-token', session])

async function dump(tag) {
  const ls = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => !k.startsWith('sb-'))))
  const ss = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)))
  console.log(`  [${tag}] url=${page.url()}`)
  console.log(`  [${tag}] local=${JSON.stringify(ls).slice(0,600)}`)
  console.log(`  [${tag}] session=${JSON.stringify(ss).slice(0,400)}`)
}

console.log('STEP 1: /admin/structure')
await page.goto(`${BASE}/admin/structure`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)
await dump('after-structure')
await page.screenshot({ path: `${OUT}/1-structure.png` })

console.log('STEP 2: deep link to /admin/insights-lab (full load, same storage)')
await page.goto(`${BASE}/admin/insights-lab`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
await dump('after-lab-deeplink')
await page.screenshot({ path: `${OUT}/2-lab.png` })

console.log('STEP 3: in-app SPA navigation to the lab')
await page.evaluate(() => history.pushState({}, '', '/admin/insights-lab'))
await page.waitForTimeout(500)
console.log('   (pushState only, no router) url=', page.url())

console.log('STEP 4: reload on the lab url')
await page.goto(`${BASE}/admin/insights-lab`, { waitUntil: 'load' })
await page.waitForTimeout(12000)
await dump('after-reload')
await page.screenshot({ path: `${OUT}/3-reload.png` })
await browser.close()
