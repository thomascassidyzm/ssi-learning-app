// Job #28 live probe — the admin Support inbox, as staff meet it.
// READ-ONLY: it lists reports and opens one. It never sends a reply.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = process.env.EMAIL
const OUT = process.env.OUT || '/home/tomcassidy/probe-28-admin'
fs.mkdirSync(OUT, { recursive: true })
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })

const link = await fetch(`${U}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: `${BASE}/admin/support` } }),
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

await page.goto(`${BASE}/admin/support`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
console.log('URL:', page.url())
await shot(page, '1-support-list')
const rows = page.locator('.report-head')
console.log('report rows:', await rows.count())
console.log('lede:', await page.locator('.support-sub').first().innerText().catch(() => '—'))
// The answered one: tick Show answered too, then open the report this was built for.
await page.locator('.support-toggle input').check()
await page.waitForTimeout(600)
const answered = page.locator('.report.is-answered .report-head')
console.log('answered rows:', await answered.count())
if (await answered.count()) {
  await answered.first().click()
  await page.waitForTimeout(1200)
  await shot(page, '3-answered-open')
  console.log('answered row text:', (await page.locator('.report.is-answered .report-body').first().innerText()).slice(0, 700))
  await answered.first().click()
}
await page.locator('.support-toggle input').uncheck()
await page.waitForTimeout(400)

if (await rows.count()) {
  await rows.first().click()
  await page.waitForTimeout(1200)
  await shot(page, '2-report-open')
  console.log('open row text:', (await page.locator('.report-body').first().innerText()).slice(0, 500))
}
await browser.close()
