// #854 probe — the schools Handbook at phone width, signed in as the ZZ Test Chepstow school
// admin. READ-ONLY: it signs in and reads one page. BASE picks the environment; OUT the folder.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = process.env.SUPABASE_ANON_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = process.env.EMAIL || 'thomas.cassidy+chepstowtest-leader@gmail.com'
const OUT = process.env.OUT || '/tmp/854-shots'
const TAG = process.env.TAG || 'shot'
fs.mkdirSync(OUT, { recursive: true })

const link = await fetch(`${U}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: `${BASE}/schools/handbook` } }),
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await page.addInitScript(([key, sess]) => window.localStorage.setItem(key, JSON.stringify(sess)),
  ['sb-swfvymspfxmnfhevgdkg-auth-token', session])
await page.goto(`${BASE}/schools/handbook`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const entries = await page.locator('.entry-head').count()
const pills = await page.locator('.entry-clip-pill').count()
const marks = await page.locator('.entry-clip-mark').count()
console.log(`${TAG}: url=${page.url()} entries=${entries} show-me-chips=${pills} old-triangles=${marks}`)
const section = page.locator('.handbook-section').first()
await section.scrollIntoViewIfNeeded()
const box = await section.boundingBox()
await page.screenshot({ path: `${OUT}/${TAG}-getting-people-in.png`, clip: { x: 0, y: Math.max(0, box.y), width: 390, height: Math.min(844, box.height) }, fullPage: true })
await page.screenshot({ path: `${OUT}/${TAG}-top.png` })
await browser.close()
