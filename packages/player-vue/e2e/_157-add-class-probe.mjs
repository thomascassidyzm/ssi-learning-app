// #157 live probe — Add a class, teacherless, on a leader's own node.
// Read-only against everything except the ZZ Probe 147 test org.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const NODE = '5173cc61-ee87-4437-8b6c-b04d9f782e8d'   // ZZ Probe 147 School node
const EMAIL = 'zz-probe-147-1788786910@ssi-probe.test'
const OUT = process.env.OUT || '/home/tomcassidy/probe-157'
fs.mkdirSync(OUT, { recursive: true })
const CLASS_NAME = process.env.CLASS_NAME || `ZZ 157 Teacherless ${Date.now().toString().slice(-5)}`

const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const db = async (path, init) => {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H, ...init })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return t }
}

// Real sign-in for a test account: a magic link minted by the admin API.
const linkResp = await fetch(`${U}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: `${BASE}/org/${NODE}` } }),
})
const link = await linkResp.json()
if (!link.hashed_token) { console.error('no hashed_token', link); process.exit(1) }
const ANON = process.env.SUPABASE_ANON_KEY
const verified = await fetch(`${U}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
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

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160)) })

await page.addInitScript(([key, sess]) => {
  window.localStorage.setItem(key, JSON.stringify(sess))
}, ['sb-swfvymspfxmnfhevgdkg-auth-token', session])
await page.goto(`${BASE}/org/${NODE}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
console.log('URL after sign-in:', page.url())
await shot(page, '1-node-home')

const addClass = page.getByRole('button', { name: 'Add a class', exact: true })
console.log('Add a class verb visible:', await addClass.count())
await addClass.first().click()
await page.waitForTimeout(1500)
await shot(page, '2-form-open')

await page.locator('[data-walk="add-class-name"]').fill(CLASS_NAME)
// FrostSelect: open the pill, then pick the first course offered.
await page.locator('.course-select-wrap').click()
await page.waitForTimeout(800)
await shot(page, '3-course-menu')
const opts = page.locator('[role="option"]')
console.log('course options:', await opts.count())
await opts.first().click()
await page.waitForTimeout(500)
await shot(page, '4-filled')
await page.locator('[data-walk="add-class-submit"]').click()
await page.waitForTimeout(4000)
await shot(page, '5-after-submit')

const rows = await db(`classes?select=id,class_name,teacher_user_id,group_id,school_id,course_code,student_join_code&class_name=eq.${encodeURIComponent(CLASS_NAME)}`)
console.log('DB row:', JSON.stringify(rows))
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ classRows: rows, className: CLASS_NAME }, null, 2))

// The class as the leader now sees it, in the classes lens.
await page.goto(`${BASE}/org/${NODE}?lens=classes`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
await shot(page, '6-classes-lens')
console.log('lens page mentions the class:', (await page.content()).includes(CLASS_NAME))

await browser.close()
