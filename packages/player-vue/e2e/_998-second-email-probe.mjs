// Job #998 live probe — job #646 on staging, the EXPERIENCE not the record:
// a learner adds a second email in Settings, and then signs in with that
// second address and lands back on their own account.
//
// Touches only two throwaway @ssi-probe.test accounts it creates itself.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = process.env.SUPABASE_ANON_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const OUT = process.env.OUT || '/home/tomcassidy/probe-998'
fs.mkdirSync(OUT, { recursive: true })
const stamp = Date.now().toString().slice(-6)
const A = `zz-998-first-${stamp}@ssi-probe.test`
const B = `zz-998-second-${stamp}@ssi-probe.test`

// never fatal: a moving player surface can outlast the screenshot's font wait
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 8000 }).catch(e => console.log(`  [shot ${n} skipped]`, e.message.split('\n')[0]))
const db = (path, init) => fetch(`${U}/rest/v1/${path}`, { headers: H, ...init }).then(r => r.text()).then(t => { try { return JSON.parse(t) } catch { return t } })
const link = (email) => fetch(`${U}/auth/v1/admin/generate_link`, { method:'POST', headers:H, body: JSON.stringify({ type:'magiclink', email }) }).then(r => r.json())
const sessionFor = async (email) => {
  const l = await link(email)
  if (!l.hashed_token) throw new Error('no hashed_token for ' + email + ': ' + JSON.stringify(l))
  // The six digits, verified the way the sign-in screen verifies them — so the
  // session this probe holds is the session typing the code would have given.
  const v = await fetch(`${U}/auth/v1/verify`, { method:'POST', headers:{ apikey: ANON, 'Content-Type':'application/json' }, body: JSON.stringify({ type:'email', email, token: l.email_otp }) }).then(r => r.json())
  if (!v.access_token) throw new Error('verify failed for ' + email + ': ' + JSON.stringify(v))
  return { access_token: v.access_token, refresh_token: v.refresh_token, expires_in: v.expires_in, expires_at: Math.floor(Date.now()/1000) + (v.expires_in || 3600), token_type: 'bearer', user: v.user }
}

const fails = []
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails.push(what) }

// ── the first account, with a name that makes "did I land back here?" readable
const sess = await sessionFor(A)
const [learnerA] = await db(`learners?user_id=eq.${sess.user.id}&select=id,display_name,verified_emails`)
if (!learnerA) { console.error('no learner for the first account'); process.exit(1) }
await db(`learners?id=eq.${learnerA.id}`, { method:'PATCH', headers:{...H, Prefer:'return=minimal'}, body: JSON.stringify({ display_name: `ZZ998 ${stamp}` }) })
console.log('first account :', A, learnerA.id)
console.log('second address:', B)

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] })

// ── LEG 1: add the second email, through the real Settings screen
const ctx1 = await browser.newContext({ viewport:{ width:430, height:900 } })
const page = await ctx1.newPage()
page.on('console', m => { if (m.type()==='error') console.log('  [console]', m.text().slice(0,160)) })
await page.addInitScript(([k,s]) => window.localStorage.setItem(k, JSON.stringify(s)), ['sb-swfvymspfxmnfhevgdkg-auth-token', sess])
await page.goto(`${BASE}/?screen=settings`, { waitUntil:'domcontentloaded' })
await page.waitForTimeout(6000)
await shot(page, '1-settings')

const row = page.getByText('Add another email to sign in with').first()
check(await row.count() > 0, 'Settings offers "Add another email to sign in with"')
// the row is a toggle: click until the form is actually open
const emailField = page.locator('input.inline-input[type="email"]').first()
for (let i = 0; i < 4 && !(await emailField.isVisible().catch(() => false)); i++) {
  await row.click(); await page.waitForTimeout(2000)
}
await emailField.waitFor({ state:'visible', timeout: 15000 })
await emailField.click()
await emailField.fill(B)
await shot(page, '2-typed-second-email')
await page.getByRole('button', { name: 'Send verification code' }).click()
await page.waitForTimeout(6000)
await shot(page, '3-code-step')
const codeStep = await page.locator('input.inline-input[inputmode="numeric"]').count()
check(codeStep > 0, 'the code step opens for a fresh address (the old bug refused here)')

// the digits the mailbox would have carried, minted the same way send-code mints them
const otp = (await link(B)).email_otp
check(!!otp, 'a 6-digit code exists for the second address')
await page.locator('input.inline-input[inputmode="numeric"]').fill(otp)
await page.getByRole('button', { name: 'Verify' }).click()
await page.waitForTimeout(7000)
await shot(page, '4-after-verify')
const err = await page.locator('.inline-error').first().textContent().catch(() => null)
check(!err || !/already linked/i.test(err), `no "already linked to another account" refusal (saw: ${err || 'none'})`)

const [afterLink] = await db(`learners?id=eq.${learnerA.id}&select=verified_emails`)
check((afterLink?.verified_emails || []).includes(B), 'the second address is on the first account\'s verified_emails')
const stubs = await db(`learners?verified_emails=cs.{"${B}"}&select=id`)
check(Array.isArray(stubs) && stubs.length === 1, `only the real account holds the address (found ${Array.isArray(stubs) ? stubs.length : '?'} learner rows)`)
await page.reload({ waitUntil:'domcontentloaded' })
await page.waitForTimeout(6000)
check(await page.getByText('2 emails linked').count() > 0, 'Settings says the account now has 2 emails linked')
await page.getByText('2 emails linked').first().click()
await page.waitForTimeout(800)
check(await page.getByText(B, { exact:false }).count() > 0, 'the expanded list shows the second address')
await shot(page, '5-linked-list')
await ctx1.close()

// ── LEG 2: come back as the second address and land on the same account
const sessB = await sessionFor(B)
check(sessB.user.id !== sess.user.id, 'the second address signs in as its own auth user, not the first')
const ctx2 = await browser.newContext({ viewport:{ width:430, height:900 } })
const page2 = await ctx2.newPage()
await page2.addInitScript(([k,s]) => window.localStorage.setItem(k, JSON.stringify(s)), ['sb-swfvymspfxmnfhevgdkg-auth-token', sessB])
await page2.goto(`${BASE}/?screen=settings`, { waitUntil:'domcontentloaded' })
await page2.waitForTimeout(9000)
await shot(page2, '6-signed-in-as-second')
// The account on screen is the FIRST one if it still carries the first
// address: a fresh account for B would hold B and nothing else.
check(await page2.getByText('2 emails linked').count() > 0, 'the account reached by the second address has both emails on it')
await page2.getByText('2 emails linked').first().click()
await page2.waitForTimeout(800)
check(await page2.getByText(A, { exact:false }).count() > 0, 'signed in with the second address, the account on screen is the first account')
await shot(page2, '7-first-account-reached')
const holders = await db(`learners?verified_emails=cs.{"${B}"}&select=id,display_name,user_id`)
check(Array.isArray(holders) && holders.length === 1 && holders[0].id === learnerA.id,
  `no fresh stub was minted by signing in with the linked address (holders: ${JSON.stringify(holders)})`)
await ctx2.close()
await browser.close()

console.log(fails.length ? `\nRED — ${fails.length} check(s) failed` : '\nGREEN — the second email links, and it recovers the account')
process.exitCode = fails.length ? 1 : 0
