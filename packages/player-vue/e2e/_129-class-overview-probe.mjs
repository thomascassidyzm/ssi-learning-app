// #129 probe — the class Overview page at desktop and phone width, signed in
// as an ssi_admin. Read-only: it navigates and shoots, nothing else.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+ssi@gmail.com'
const CLASS = process.env.CLASS_ID || '01041bae-ef81-4c78-bc21-b1a8f0def808' // Chepstow 8H
const TAG = process.env.TAG || 'shot'
const OUT = process.env.OUT || '/home/tomcassidy/.tmpbig/probe-129'
fs.mkdirSync(OUT, { recursive: true })

const ANON = process.env.SUPABASE_ANON_KEY
const link = await fetch(`${U}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: `${BASE}/admin/classes/${CLASS}` } }),
}).then((r) => r.json())
if (!link.hashed_token) { console.error('no hashed_token', link); process.exit(1) }
const verified = await fetch(`${U}/auth/v1/verify`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
}).then((r) => r.json())
if (!verified.access_token) { console.error('verify failed', verified); process.exit(1) }
const session = {
  access_token: verified.access_token, refresh_token: verified.refresh_token,
  expires_in: verified.expires_in, expires_at: Math.floor(Date.now() / 1000) + (verified.expires_in || 3600),
  token_type: 'bearer', user: verified.user,
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  let payload = null
  page.on('response', async (r) => { if (r.url().includes('/brain')) { try { payload = await r.json() } catch { /* not json */ } } })
  await page.addInitScript(([k, s]) => window.localStorage.setItem(k, JSON.stringify(s)), ['sb-swfvymspfxmnfhevgdkg-auth-token', session])
  await page.goto(`${BASE}/admin/classes/${CLASS}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-walk="class-practice"]', { timeout: 40000 })
  await page.waitForTimeout(3000)
  const practice = await page.$('[data-walk="class-practice"]')
  if (practice) await practice.screenshot({ path: `${OUT}/${TAG}-${name}-practice.png` })
  const journey = await page.$('[data-walk="class-journey"]')
  if (journey) await journey.screenshot({ path: `${OUT}/${TAG}-${name}-journey.png` })
  const read = await page.evaluate(() => ({
    practiceWidth: document.querySelector('[data-walk="class-practice"]')?.getBoundingClientRect().width,
    gridWidth: document.querySelector('.class-cards')?.getBoundingClientRect().width,
    tableWidth: document.querySelector('[data-walk="class-practice"] table')?.getBoundingClientRect().width,
    tableScrolls: (() => { const e = document.querySelector('[data-walk="class-practice"] .table-scroll'); return e ? e.scrollWidth > e.clientWidth + 1 : null })(),
    tiles: [...document.querySelectorAll('.cb-stat')].map((e) => e.textContent.trim()),
  }))
  console.log(name, JSON.stringify({ ...read, beltProgress: payload?.beltProgress, reachedLegoText: payload?.reachedLegoText }, null, 1))
  await page.close()
}
await browser.close()
console.log('shots in ' + OUT)
