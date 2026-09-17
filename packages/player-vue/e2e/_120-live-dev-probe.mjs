// #120 live probe — the folded Course journey card on the deepest real class,
// on the dev alias, signed in as an ssi_admin. Read-only throughout.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+ssi@gmail.com'
const CLASS = process.env.CLASS_ID || 'fbc5dcb8-a5bf-4b27-a3ca-9004967f406f' // Blwyddyn 9 1, the deepest real class
const OUT = process.env.OUT || '/home/tomcassidy/.tmpbig/probe-120'
fs.mkdirSync(OUT, { recursive: true })

const ANON = (await fetch(`${BASE}/assets/`).then(() => null).catch(() => null), process.env.SUPABASE_ANON_KEY)
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
  access_token: verified.access_token,
  refresh_token: verified.refresh_token,
  expires_in: verified.expires_in,
  expires_at: Math.floor(Date.now() / 1000) + (verified.expires_in || 3600),
  token_type: 'bearer',
  user: verified.user,
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
let payload = null
page.on('response', async (r) => {
  if (r.url().includes('/brain')) { try { payload = await r.json() } catch { /* not json */ } }
})
await page.addInitScript(([k, s]) => window.localStorage.setItem(k, JSON.stringify(s)), ['sb-swfvymspfxmnfhevgdkg-auth-token', session])
await page.goto(`${BASE}/admin/classes/${CLASS}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.cb-draw svg', { timeout: 40000 })
await page.waitForTimeout(1500)
const brain = await page.$('.cb')
await brain.screenshot({ path: `${OUT}/live-card.png` })
const read = await page.evaluate(() => ({
  dots: document.querySelectorAll('.cb-draw circle').length,
  arcs: document.querySelectorAll('.cb-draw path.cb-arc').length,
  cloth: document.querySelectorAll('.cb-cloth').length,
  tiles: [...document.querySelectorAll('.cb-stat-value')].map((e) => e.textContent.trim()),
}))
console.log(JSON.stringify({ axisFrom: payload?.axisFrom, chunksSent: payload?.legos?.length, legosTotal: payload?.legosTotal, events: payload?.events?.length, ...read }, null, 2))
await browser.close()
console.log('shot in ' + OUT)
