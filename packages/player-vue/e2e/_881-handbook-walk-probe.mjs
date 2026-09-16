// #861 probe — verifies a Getting-people-in walk actually launches: sign in
// as a real ZZ Test Chepstow role, open the Handbook, expand a capability,
// tap its real "Show me — <title>" button, and confirm the overlay renders
// on the destination page. READ-ONLY: no mutating action is ever clicked.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = process.env.EMAIL || 'thomas.cassidy+chepstowtest-leader@gmail.com'
const CAPABILITY = process.env.CAPABILITY || 'Add a teacher by name'
const OUT = process.env.OUT || '/home/tomcassidy/.cs-scratch/cs-10ab36c2-fef4-4b9a-9172-044a2a1e6ec2/881-shots'
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
await page.waitForTimeout(4000)

const heading = page.locator('.entry-head', { hasText: CAPABILITY }).first()
await heading.scrollIntoViewIfNeeded()
await heading.click()
await page.waitForTimeout(500)

const realBtn = page.locator('button', { hasText: `Show me — ${CAPABILITY}` })
console.log('real Show-me button count:', await realBtn.count())
await realBtn.click()
await page.waitForTimeout(3000)
console.log('url after Show me:', page.url())
const overlayCount = await page.locator('[data-walk-overlay]').count()
console.log('walk overlay present:', overlayCount)
await page.screenshot({ path: `${OUT}/walk-launched.png` })
await browser.close()
process.exit(overlayCount ? 0 : 1)
