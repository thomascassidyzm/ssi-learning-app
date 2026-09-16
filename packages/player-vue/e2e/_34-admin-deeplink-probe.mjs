// Job #34 probe — does /admin/insights-lab survive a COLD deep link on a phone
// for a real ssi_admin whose localStorage role cache says "learner"?
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = fs.readFileSync(process.env.ANON_FILE,'utf8').trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const OUT = process.env.OUT || '/home/tomcassidy/probe-34'
fs.mkdirSync(OUT, { recursive: true })
const TARGET = '/admin/insights-lab'

async function sessionFor(email) {
  const link = await fetch(`${U}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email }),
  }).then(r => r.json())
  if (!link.hashed_token) throw new Error('no hashed_token for ' + email + ' ' + JSON.stringify(link))
  const v = await fetch(`${U}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
  }).then(r => r.json())
  if (!v.access_token) throw new Error('verify failed ' + JSON.stringify(v))
  return { access_token: v.access_token, refresh_token: v.refresh_token, expires_in: v.expires_in,
           expires_at: Math.floor(Date.now()/1000) + (v.expires_in || 3600), token_type: 'bearer', user: v.user }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] })

async function arm(name, email, roleCache) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const sess = await sessionFor(email)
  await page.addInitScript(([k, s, rc]) => {
    window.localStorage.setItem(k, JSON.stringify(s))
    if (rc) window.localStorage.setItem('ssi-user-role', JSON.stringify(rc))
  }, ['sb-swfvymspfxmnfhevgdkg-auth-token', sess, roleCache])
  await page.goto(`${BASE}${TARGET}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  const url = page.url()
  const cached = await page.evaluate(() => localStorage.getItem('ssi-user-role'))
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`[${name}] ${email} cachePlanted=${JSON.stringify(roleCache)} -> ${url}  roleCacheNow=${cached}`)
  await ctx.close()
  return url
}

await arm('A-admin-stale-learner-cache', 'thomas.cassidy+ssi@gmail.com', { platformRole: null, educationalRole: null })
await arm('B-admin-no-cache', 'thomas.cassidy+ssi@gmail.com', null)
await arm('C-nonadmin-hey', 'tom.cassidy@hey.com', null)
await browser.close()
