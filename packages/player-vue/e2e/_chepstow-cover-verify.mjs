// Chepstow scenario — steps 5/6: sign the co-teacher in at the normal /schools
// door (real emailed OTP, recovered server-side) and record exactly what she
// sees — the class, and which management controls she does NOT get.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire('/home/tomcassidy/ssi-dashboard-v7-clean/')
const { Client } = require('/home/tomcassidy/ssi-dashboard-v7-clean/node_modules/pg')
const DB = fs
  .readFileSync('/home/tomcassidy/ssi-dashboard-v7-clean/.env.psql', 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1]

const BASE = 'https://saysomethingin.app'
const EMAIL = 'thomas.cassidy+chepstowtest-cover@gmail.com'
const CLASS_URL = fs.readFileSync('/home/tomcassidy/chepstow-run/class-url.txt', 'utf8').trim()
const OUT = '/home/tomcassidy/chepstow-run/out'

async function recoverOtp(email, sentAfter) {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    for (let a = 0; a < 20; a++) {
      const r = await c.query(
        `select t.token_hash, t.created_at from auth.one_time_tokens t
           join auth.users u on u.id = t.user_id
          where lower(u.email) = $1 order by t.created_at desc limit 5`,
        [email.toLowerCase()],
      )
      for (const row of r.rows) {
        if (sentAfter && new Date(row.created_at) < sentAfter) continue
        const h = String(row.token_hash)
        if (/^\d{6}$/.test(h)) return h
        const bare = h.replace(/^.*_/, '')
        for (let n = 0; n < 1000000; n++) {
          const otp = String(n).padStart(6, '0')
          for (const algo of ['sha224', 'sha256'])
            if (crypto.createHash(algo).update(email.toLowerCase() + otp).digest('hex') === bare) return otp
        }
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  } finally {
    await c.end()
  }
  throw new Error('could not recover OTP for ' + email)
}

const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-gpu', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const dump = async (l, n = 2500) => console.log(`\n--- ${l} ---\n` + (await p.locator('body').innerText()).slice(0, n))

console.log('signing in at /schools as', EMAIL)
await p.goto(BASE + '/schools', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(8000)
const sentAt = new Date(Date.now() - 5000)
await p.locator('input[type="email"]').first().fill(EMAIL)
await p.getByRole('button', { name: /Send me a code/i }).click()
await p.waitForTimeout(8000)
await dump('AFTER SEND', 800)

const otp = await recoverOtp(EMAIL, sentAt)
console.log('code:', otp)
const otpField = p.locator('input:visible').last()
await otpField.fill(otp)
await p.getByRole('button', { name: /Sign in|Confirm|Verify|Continue|→/i }).first().click()
await p.waitForTimeout(14000)
console.log('URL:', p.url())
await shot('cover-dashboard')
await dump('CO-TEACHER DASHBOARD', 3000)

console.log('\n=== does she see the class? open it directly ===')
await p.goto(CLASS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(14000)
await shot('cover-class-detail')
await dump('CO-TEACHER CLASS DETAIL', 3500)

console.log('\n--- CO-TEACHER CLASS CONTROLS ---')
for (const c of await p.evaluate(() =>
  [...document.querySelectorAll('button,a,input,[role="button"]')]
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || '').trim().slice(0, 55),
      cls: String(el.className || '').slice(0, 40),
      href: el.getAttribute('href'),
      vis: el.getBoundingClientRect().width > 0,
    }))
    .filter((c) => c.vis),
))
  console.log(JSON.stringify(c))

await ctx.storageState({ path: '/home/tomcassidy/chepstow-run/cover-state.json' })
console.log('SAVED cover session state')
await browser.close()
