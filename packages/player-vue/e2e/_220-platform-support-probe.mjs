// Job #220 live probe — the platform support inbox on staging, as an ssi_admin meets it.
// It LISTS, OPENS the ZZ-test school's thread, and SENDS one reply, then reads the row
// back to prove it was authored as the admin and that the open question was closed.
// The school it writes to is `ZZ Test — Chepstow scenario` (is_test), whose admin is one
// of Tom's own +aliases — no real school is written to.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = process.env.EMAIL || 'thomas.cassidy+e2e-admin@gmail.com'
const THREAD = process.env.THREAD || 'a9d15c0f-ef73-486a-98eb-48c1acda9515'
const OUT = process.env.OUT || '/home/tomcassidy/probe-220-platform-support'
fs.mkdirSync(OUT, { recursive: true })
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const rest = (q) => fetch(`${U}/rest/v1/${q}`, { headers: H }).then((r) => r.json())

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
console.log('signed in as', verified.user.id, EMAIL)

const before = await rest(`support_messages?select=id,direction,answered_at&thread_id=eq.${THREAD}&order=created_at.asc`)
console.log('before: turns', before.length, 'open questions', before.filter((m) => m.direction === 'in' && !m.answered_at).length)

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160)) })
await page.addInitScript(([key, sess]) => window.localStorage.setItem(key, JSON.stringify(sess)),
  ['sb-swfvymspfxmnfhevgdkg-auth-token', session])

await page.goto(`${BASE}/admin/support`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)
console.log('URL:', page.url())
console.log('lede:', await page.locator('.support-sub').first().innerText().catch(() => '—'))
await shot(page, '1-list-waiting-only')

await page.locator('.support-toggle input').check()
await page.waitForTimeout(800)
await shot(page, '2-list-all')
const heads = page.locator('.report-head')
const n = await heads.count()
console.log('rows:', n)
let schoolRow = -1
for (let i = 0; i < n; i++) {
  const t = await heads.nth(i).innerText()
  if (i < 12) console.log(`  [${i}] ${t.replace(/\n/g, ' | ').slice(0, 120)}`)
  if (schoolRow < 0 && /ZZ Test — Chepstow/.test(t)) schoolRow = i
}
if (schoolRow < 0) { console.error('the ZZ-test school thread is not in the list'); await browser.close(); process.exit(1) }

await heads.nth(schoolRow).click()
await page.waitForTimeout(2500)
await shot(page, '3-thread-open')
const body = await page.locator('.report.is-open .report-body').first().innerText()
console.log('--- thread as rendered ---')
console.log(body.slice(0, 1400))

const stamp = new Date().toISOString()
const text = `Job #220 staging check, ${stamp} — answered from the platform inbox at Admin → Support.`
const box = page.locator('.report.is-open textarea')
await box.fill(text)
await shot(page, '4-reply-typed')
await page.locator('.report.is-open .report-send').click()
await page.waitForTimeout(4000)
await shot(page, '5-after-send')
console.log('--- after send ---')
console.log((await page.locator('.report.is-open .report-body').first().innerText()).slice(0, 900))

const after = await rest(`support_messages?select=id,direction,author_source,author_via,author_user_id,author_name,in_reply_to,answered_at,body,created_at&thread_id=eq.${THREAD}&order=created_at.asc`)
const mine = after.find((m) => m.body === text)
console.log('row written:', mine ? {
  direction: mine.direction, author_source: mine.author_source, author_via: mine.author_via,
  author_user_id: mine.author_user_id, author_name: mine.author_name, in_reply_to: mine.in_reply_to,
} : 'NOT FOUND')
console.log('authored as the signed-in ssi_admin:', mine?.author_user_id === verified.user.id)
console.log('open questions after:', after.filter((m) => m.direction === 'in' && !m.answered_at).length)
const thread = (await rest(`support_threads?select=last_message_at,last_read_at&id=eq.${THREAD}`))[0]
console.log('thread:', thread)
const fan = await rest(`user_messages?select=recipient_user_id,source,title,created_at&source=eq.support_reply&order=created_at.desc&limit=4`)
console.log('inbox fan-out (newest 4):', fan)

await browser.close()
console.log('shots in', OUT)
