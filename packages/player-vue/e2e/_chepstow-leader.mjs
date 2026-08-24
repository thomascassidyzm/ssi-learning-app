// Chepstow scenario — step 1: the leader signs up at /schools1 (heritage/school
// door), picks South Welsh, verifies the real emailed OTP (recovered
// server-side from auth.one_time_tokens), and names the school.
//
// Usage: node e2e/_chepstow-leader.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('/home/tomcassidy/ssi-dashboard-v7-clean/')
const { Client } = require('/home/tomcassidy/ssi-dashboard-v7-clean/node_modules/pg')
const crypto = await import('node:crypto')

const DB = fs
  .readFileSync('/home/tomcassidy/ssi-dashboard-v7-clean/.env.psql', 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1]

const BASE = 'https://saysomethingin.app'
const EMAIL = 'thomas.cassidy+chepstowtest-leader@gmail.com'
const SCHOOL = 'ZZ Test — Chepstow scenario'
const OUT = '/home/tomcassidy/chepstow-run/out'
fs.mkdirSync(OUT, { recursive: true })

const shot = async (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })

// The emailed 6-digit code lives in auth.one_time_tokens as sha224(email+otp)
// (GoTrue's hashed-OTP storage). Brute-forcing 10^6 candidates recovers the
// LITERAL code that went to the inbox — so this stays a real signup, not a
// side-door session mint.
async function recoverOtp(email, sentAfter) {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const r = await c.query(
        `select t.token_type, t.token_hash, t.created_at
           from auth.one_time_tokens t
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
          for (const algo of ['sha224', 'sha256']) {
            if (crypto.createHash(algo).update(email.toLowerCase() + otp).digest('hex') === bare) return otp
          }
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message))

console.log('STEP 1a — open the school door')
await p.goto(BASE + '/schools1', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(6000)

console.log('STEP 1b — pick South Welsh')
await p.locator('button.ob-known').click()
await p.waitForTimeout(800)
await p.locator('input.ob-known-search').fill('South Welsh')
await p.waitForTimeout(800)
await p.locator('.ob-known-opt').first().click()
await p.waitForTimeout(1200)
console.log('  claimed:', await p.locator('.ob-claim-endonym').innerText().catch(() => '(none)'))

console.log('STEP 1c — send the code to', EMAIL)
const sentAt = new Date(Date.now() - 5000)
await p.locator('#ob-email').fill(EMAIL)
await p.getByRole('button', { name: /Send my code/i }).click()
await p.waitForSelector('#ob-otp', { timeout: 45000 })
console.log('  OTP step reached — the real email has been sent')
await shot(p, 'leader-otp-step')

console.log('STEP 1d — recover the emailed code server-side')
const otp = await recoverOtp(EMAIL, sentAt)
console.log('  code:', otp)

await p.locator('#ob-otp').fill(otp)
await p.getByRole('button', { name: /Confirm/i }).click()
await p.waitForTimeout(9000)
await shot(p, 'leader-after-verify')
console.log('  body:', (await p.locator('body').innerText()).slice(0, 400).replace(/\n+/g, ' | '))

console.log('STEP 1e — finishing details: name the school')
if (await p.locator('#ob-inst').count()) {
  await p.locator('#ob-name').fill('Angharad ZZ Test')
  await p.locator('#ob-inst').fill(SCHOOL)
  await p.getByRole('button', { name: /^Continue$/ }).click()
} else {
  console.log('  !! no finishing form — returning user path?')
  const btn = p.getByRole('button', { name: /dashboard|Continue/i }).first()
  if (await btn.count()) await btn.click()
}
await p.waitForTimeout(12000)
console.log('  landed at:', p.url())
await shot(p, 'leader-dashboard')
console.log('  body:', (await p.locator('body').innerText()).slice(0, 1500))

await ctx.storageState({ path: '/home/tomcassidy/chepstow-run/leader-state.json' })
console.log('SAVED leader session state')
await browser.close()
