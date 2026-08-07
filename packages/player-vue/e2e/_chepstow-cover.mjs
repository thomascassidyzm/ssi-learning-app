// Chepstow scenario — step 5: the cover teacher opens the class-scoped
// co-teacher link in a CLEAN session, signs up with her own email, and lands
// in the class.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire('/home/tomcassidy/ssi-dashboard-v7-clean/')
const { Client } = require('/home/tomcassidy/ssi-dashboard-v7-clean/node_modules/pg')
const DB = fs
  .readFileSync('/home/tomcassidy/ssi-dashboard-v7-clean/.env.psql', 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1]

const EMAIL = 'thomas.cassidy+chepstowtest-cover@gmail.com'
const LINK = JSON.parse(fs.readFileSync('/home/tomcassidy/chepstow-run/redeem-links.json', 'utf8'))[0]
const OUT = '/home/tomcassidy/chepstow-run/out'

async function recoverOtp(email, sentAfter) {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
p.on('response', (r) => {
  if (/\/api\/(invite|redeem|onboarding)/.test(r.url())) console.log('API', r.status(), r.url())
})
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const dump = async (l) => console.log(`\n--- ${l} ---\n` + (await p.locator('body').innerText()).slice(0, 2500))
const controls = async (l) => {
  console.log(`\n--- ${l} CONTROLS ---`)
  for (const c of await p.evaluate(() =>
    [...document.querySelectorAll('button,a,input,[role="button"]')]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || '').trim().slice(0, 55),
        ph: el.getAttribute('placeholder'),
        id: el.id || null,
        cls: String(el.className || '').slice(0, 40),
        href: el.getAttribute('href'),
        vis: el.getBoundingClientRect().width > 0,
      }))
      .filter((c) => c.vis),
  ))
    console.log(JSON.stringify(c))
}

console.log('opening the co-teacher link:', LINK)
await p.goto(LINK, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(9000)
await shot('cover-redeem-landing')
await dump('REDEEM LANDING')
await controls('REDEEM LANDING')

// Name field, if the link asks new arrivals to say who they are.
const nameField = p.locator('input[type="text"]:visible').first()
if (await nameField.count()) {
  await nameField.fill('Bethan ZZ Cover')
  console.log('filled name field')
}
const emailField = p.locator('input[type="email"]:visible').first()
if (!(await emailField.count())) {
  // Some redeem flows gate the email behind a continue button first.
  const go = p.getByRole('button', { name: /Continue|Join|Next|Accept/i }).first()
  if (await go.count()) {
    await go.click()
    await p.waitForTimeout(6000)
    await dump('AFTER CONTINUE')
    await controls('AFTER CONTINUE')
  }
}

const sentAt = new Date(Date.now() - 5000)
const emailField2 = p.locator('input[type="email"]:visible').first()
await emailField2.fill(EMAIL)
await p.waitForTimeout(400)
await shot('cover-email-filled')
await p.getByRole('button', { name: /Send|Code|Continue|Join/i }).first().click()
await p.waitForTimeout(8000)
await shot('cover-otp-step')
await dump('OTP STEP')

const otp = await recoverOtp(EMAIL, sentAt)
console.log('code:', otp)
const otpField = p.locator('input[inputmode="numeric"]:visible, #ob-otp').first()
await otpField.fill(otp)
await p.getByRole('button', { name: /Confirm|Join|Continue/i }).first().click()
await p.waitForTimeout(12000)
await shot('cover-after-verify')
await dump('AFTER VERIFY')
await controls('AFTER VERIFY')
console.log('URL:', p.url())

await ctx.storageState({ path: '/home/tomcassidy/chepstow-run/cover-state.json' })
console.log('SAVED cover session state')
await browser.close()
