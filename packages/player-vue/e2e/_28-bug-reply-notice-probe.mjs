// Job #28 live probe — a reply to a bug report, as the learner meets it.
// Read-only except for the ZZ Share Walker test account's own inbox row,
// which was written by tools/support/reply-to-bug-report.mjs before this ran.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = process.env.EMAIL
const OUT = process.env.OUT || '/home/tomcassidy/probe-28'
fs.mkdirSync(OUT, { recursive: true })
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })

const link = await fetch(`${U}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: BASE } }),
}).then((r) => r.json())
if (!link.hashed_token) { console.error('no hashed_token', link); process.exit(1) }
const verified = await fetch(`${U}/auth/v1/verify`, {
  method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
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
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160)) })
await page.addInitScript(([key, sess]) => window.localStorage.setItem(key, JSON.stringify(sess)),
  ['sb-swfvymspfxmnfhevgdkg-auth-token', session])

await page.goto(`${BASE}/?screen=library`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
console.log('URL:', page.url())
await shot(page, '1-library-notice-card')
console.log('notice card present:', await page.locator('.inbox-card').count())

await page.goto(`${BASE}/me/inbox`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await shot(page, '2-inbox-list')
const head = page.locator('.inbox-msg-head')
console.log('inbox messages:', await head.count())
if (await head.count()) {
  await head.first().click()
  await page.waitForTimeout(1500)
  await shot(page, '3-reply-open')
  console.log('body text:', (await page.locator('.inbox-msg-text, .inbox-msg-rich').first().innerText()).slice(0, 400))
}
await browser.close()
