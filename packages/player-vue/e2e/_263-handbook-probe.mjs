// #263 live probe — the Handbook page, signed in as a real leader, on dev.
// READ-ONLY: it signs in as the ZZ Probe test account and reads two pages.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const NODE = '5173cc61-ee87-4437-8b6c-b04d9f782e8d'
const EMAIL = 'zz-probe-147-1788786910@ssi-probe.test'
const OUT = process.env.OUT || '/home/tomcassidy/probe-263'
fs.mkdirSync(OUT, { recursive: true })

const link = await fetch(`${U}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: `${BASE}/org/${NODE}` } }),
}).then((r) => r.json())
if (!link.hashed_token) { console.error('no hashed_token', link); process.exit(1) }
const verified = await fetch(`${U}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
}).then((r) => r.json())
if (!verified.access_token) { console.error('verify failed', verified); process.exit(1) }
const session = {
  access_token: verified.access_token, refresh_token: verified.refresh_token,
  expires_in: verified.expires_in, expires_at: Math.floor(Date.now() / 1000) + (verified.expires_in || 3600),
  token_type: 'bearer', user: verified.user,
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160)) })
await page.addInitScript(([key, sess]) => window.localStorage.setItem(key, JSON.stringify(sess)),
  ['sb-swfvymspfxmnfhevgdkg-auth-token', session])

for (const [name, url] of [['org', `${BASE}/org/${NODE}/handbook`], ['schools', `${BASE}/schools/handbook`]]) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const entries = await page.locator('.entry-head').count()
  const sections = await page.locator('.handbook-section').count()
  const pills = await page.locator('.entry-badges .status-pill').allTextContents()
  console.log(`${name}: url=${page.url()} sections=${sections} entries=${entries} badges=${[...new Set(pills)].join('|')}`)
  await page.screenshot({ path: `${OUT}/${name}-handbook.png`, fullPage: true })
  if (entries > 0) {
    await page.locator('.entry-head').first().click()
    await page.waitForTimeout(400)
    const body = await page.locator('.entry-body').first().innerText()
    console.log(`  first entry opens, ${body.split('\n').length} lines of prose`)
    await page.screenshot({ path: `${OUT}/${name}-open.png`, fullPage: true })
  }
}
await browser.close()
