/**
 * #233 — walk the Family purchase the way Tom walked it, SIGNED OUT, on
 * staging (Paddle renders on staging and production only, by design).
 *
 * Three questions, in the order a buyer meets them:
 *   1. Does choosing Family while signed out ask for a code from a mailbox?
 *      It must not. It must ask for an email and go to payment.
 *   2. Does the Family choice survive account creation? The Paddle checkout
 *      that opens must be the FAMILY price, first time, with no second trip
 *      through the picker.
 *   3. Does the payer land somewhere they can add their family?
 *
 * NOTHING IS EVER PURCHASED. Checkout is opened and read, never completed.
 * Every account and row this makes is torn down at the end.
 */
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.CS_SCRATCH
const svc = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim(), { auth: { persistSession: false } })

const STAMP = String(Date.now()).slice(-7)
const EMAIL = `thomas.cassidy+zz.cs233.${STAMP}@gmail.com`
const PASSWORD = 'SsiTest2026!'

// The second account: already exists, to prove the takeover rail refuses it.
const EXISTING = `thomas.cassidy+zz.cs233x.${STAMP}@gmail.com`

let browser
const madeUsers = []
const log = (...a) => console.log(...a)

async function paddleSays(p, tag) {
  await p.waitForTimeout(11000)
  const title = await p.locator('.checkout-title').first().innerText().catch(() => '(no overlay)')
  let frameText = ''
  for (const f of p.frames()) {
    if (!/paddle/i.test(f.url())) continue
    const t = await f.locator('body').innerText().catch(() => '')
    if (t && t.length > frameText.length) frameText = t
  }
  await p.screenshot({ path: `${OUT}/233-${tag}.png` })
  log(`\n--- PADDLE (${tag}) --- overlay title: ${JSON.stringify(title)}`)
  log((frameText.replace(/\s+/g, ' ').slice(0, 500)) || '(paddle frame text empty)')
  return { title, frameText }
}

try {
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
  const p = await ctx.newPage()
  p.on('console', m => { const t = m.text(); if (/paddle|checkout|plan|buyer|family/i.test(t)) log('  [page]', t.slice(0, 180)) })

  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {})
  await p.waitForTimeout(4000)
  log('BUILD:', await p.evaluate(() => fetch('/version.json').then(r => r.text())))
  log('SIGNED IN?', await p.evaluate(() => Object.keys(localStorage).some(k => /sb-.*-auth-token/.test(k))))

  // ── STEP 1. Signed out, reach the picker the way a browsing visitor does.
  await p.goto(`${BASE}/?openCourses=1`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(8000)
  await p.screenshot({ path: `${OUT}/233-0-courses.png`, fullPage: true })
  const cta = p.locator('.section-header__cta').first()
  log('\nUPGRADE CTA visible:', await cta.isVisible().catch(() => false))
  await cta.click().catch(() => {})
  await p.waitForTimeout(1500)
  const pickerText = (await p.locator('.plans-card').innerText().catch(() => '(NO PICKER)')).replace(/\s+/g, ' ')
  log('PICKER:', pickerText)
  await p.screenshot({ path: `${OUT}/233-1-picker.png` })

  // ── STEP 2. Choose Family monthly. THE OLD FLOW OPENED THE OTP MODAL HERE.
  await p.locator('.plan-btn', { hasText: '£25/month' }).first().click()
  await p.waitForTimeout(2500)
  const otpUp = await p.getByText(/we'?ll send you a code|check your email|verification code/i).first().isVisible().catch(() => false)
  const detailsUp = await p.locator('.plans-card', { hasText: /your details/i }).first().isVisible().catch(() => false)
  log('\nAFTER CHOOSING FAMILY — old OTP screen shown:', otpUp, '| details step shown:', detailsUp)
  await p.screenshot({ path: `${OUT}/233-2-after-family.png`, fullPage: true })
  if (detailsUp) log('DETAILS CARD:', (await p.locator('.plans-card').innerText()).replace(/\s+/g, ' '))

  // ── STEP 3. Fill it in and pay. No mailbox, no code.
  const inputs = p.locator('.plans-card input[type="email"]')
  await inputs.nth(0).fill(EMAIL)
  await inputs.nth(1).fill(EMAIL)
  await p.locator('.plans-card input[type="checkbox"]').first().check().catch(() => {})
  await p.waitForTimeout(400)
  const pw = p.locator('.plans-card input[type="password"]')
  await pw.nth(0).fill(PASSWORD).catch(() => {})
  await pw.nth(1).fill(PASSWORD).catch(() => {})
  await p.screenshot({ path: `${OUT}/233-3-details-filled.png` })
  await p.locator('.plans-card button[type="submit"]').first().click()

  const paid = await paddleSays(p, '4-family-checkout')
  log('\nIS THIS THE FAMILY PRICE?', /25/.test(paid.frameText) ? 'frame mentions 25' : 'no 25 in frame text')
  log('OVERLAY TITLE SAYS FAMILY?', /family/i.test(paid.title))

  const created = (await svc.auth.admin.listUsers({ perPage: 200 })).data.users.find(u => u.email === EMAIL)
  if (created) {
    madeUsers.push(created.id)
    log('\nACCOUNT MINTED SERVER-SIDE:', created.email,
        '| email_confirmed_at:', created.email_confirmed_at,
        '| onboarded_via:', created.user_metadata?.onboarded_via)
    const { data: lrn } = await svc.from('learners').select('id, needs_verification').eq('user_id', created.id).maybeSingle()
    log('LEARNER ROW:', JSON.stringify(lrn))
  } else {
    log('\nNO ACCOUNT FOUND for', EMAIL, '— the details step did not mint one')
  }

  // ── STEP 4. The takeover rail: an address that already has an account.
  const { data: ex } = await svc.auth.admin.createUser({ email: EXISTING, password: PASSWORD, email_confirm: true })
  if (ex?.user) madeUsers.push(ex.user.id)
  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 } })
  const p2 = await ctx2.newPage()
  await p2.goto(`${BASE}/?openCourses=1`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p2.waitForTimeout(8000)
  await p2.locator('.section-header__cta').first().click().catch(() => {})
  await p2.waitForTimeout(1500)
  await p2.locator('.plan-btn', { hasText: '£25/month' }).first().click()
  await p2.waitForTimeout(2000)
  const i2 = p2.locator('.plans-card input[type="email"]')
  await i2.nth(0).fill(EXISTING)
  await i2.nth(1).fill(EXISTING)
  await p2.locator('.plans-card button[type="submit"]').first().click()
  await p2.waitForTimeout(4000)
  log('\nEXISTING ADDRESS →', (await p2.locator('.plans-card').innerText().catch(() => '(gone)')).replace(/\s+/g, ' '))
  await p2.screenshot({ path: `${OUT}/233-5-existing-account.png` })

  // ── STEP 5. Where the payer lands. We do not buy anything: we give the
  // minted account the subscription row a completed Family purchase would
  // have written, then open the redirect Paddle is configured to send them to.
  if (created) {
    const { data: lrn } = await svc.from('learners').select('id').eq('user_id', created.id).maybeSingle()
    if (lrn) {
      await svc.from('subscriptions').insert({
        learner_id: lrn.id,
        status: 'active',
        plan_name: 'SSi Family',
        provider: 'paddle',
      })
      const pub = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_ANON_KEY.trim(), { auth: { persistSession: false } })
      const { data: signed } = await pub.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
      const ref = new URL(process.env.SUPABASE_URL.trim()).hostname.split('.')[0]
      const ctx3 = await browser.newContext({ viewport: { width: 430, height: 900 } })
      await ctx3.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} },
        [`sb-${ref}-auth-token`, JSON.stringify(signed.session)])
      const p3 = await ctx3.newPage()
      await p3.goto(`${BASE}/?family=1&just_subscribed=1`, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await p3.waitForTimeout(15000)
      const famText = (await p3.locator('.family-modal, [class*="family"]').first().innerText().catch(() => '(NO FAMILY SURFACE)')).replace(/\s+/g, ' ')
      log('\nLANDING AFTER A FAMILY PURCHASE:', famText.slice(0, 400))
      log('URL NOW:', p3.url())
      await p3.screenshot({ path: `${OUT}/233-6-landing.png`, fullPage: true })
    }
  }
} catch (e) {
  log('\nPROBE ERROR:', e?.message || e)
} finally {
  for (const id of madeUsers) {
    const { data: l } = await svc.from('learners').select('id').eq('user_id', id).maybeSingle()
    if (l) {
      await svc.from('subscriptions').delete().eq('learner_id', l.id)
      await svc.from('learners').delete().eq('id', l.id)
    }
    await svc.auth.admin.deleteUser(id).catch(() => {})
    log('torn down:', id)
  }
  if (browser) await browser.close()
}
