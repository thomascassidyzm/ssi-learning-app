/**
 * #177 — does the plan picker actually put SSi Family in front of a new
 * customer, on the right price?
 *
 * A brand-new throwaway account, the path Tom took: Settings → Subscription →
 * See plans. Tap each price and read what the LIVE Paddle checkout says.
 * NOTHING IS EVER PURCHASED — no card, no payment method, checkout is opened
 * and closed. Disposable account, torn down at the end.
 */
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.CS_SCRATCH
const svc = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim(), { auth: { persistSession: false } })

const STAMP = String(Date.now()).slice(-7)
// A real, deliverable-looking address: Paddle validates the customer email and
// refuses an invalid TLD. Nothing is ever sent here — sign-in is out-of-band.
const EMAIL = `thomas.cassidy+zz.cs177.${STAMP}@gmail.com`
const PASSWORD = 'SsiTest2026!'

let browser, userId = null
const log = (...a) => console.log(...a)

async function readCheckout(p, tag) {
  // Paddle renders inline into .consumer-checkout-frame. Give it time to load.
  await p.waitForTimeout(9000)
  const title = await p.locator('.checkout-title').first().innerText().catch(() => '(no overlay)')
  let frameText = ''
  for (const f of p.frames()) {
    if (!/paddle/i.test(f.url())) continue
    const t = await f.locator('body').innerText().catch(() => '')
    if (t && t.length > frameText.length) frameText = t
  }
  await p.screenshot({ path: `${OUT}/177-${tag}.png`, fullPage: false })
  log(`\n--- ${tag} --- overlay title: ${JSON.stringify(title)}`)
  log(frameText.replace(/\s+/g, ' ').slice(0, 400) || '(paddle frame text empty)')
  return { title, frameText }
}

try {
  const { data: created, error } = await svc.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
  if (error) throw error
  userId = created.user.id
  log('NEW ACCOUNT:', EMAIL, userId)

  // Sign this account in out-of-band and hand the app its own session, so the
  // probe spends its time on the picker rather than on the onboarding maze.
  const pub = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_ANON_KEY.trim(), { auth: { persistSession: false } })
  const { data: signed, error: sErr } = await pub.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (sErr) throw sErr
  const ref = new URL(process.env.SUPABASE_URL.trim()).hostname.split('.')[0]
  const storageKey = `sb-${ref}-auth-token`
  const sessionJson = JSON.stringify(signed.session)

  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [storageKey, sessionJson])
  const p = await ctx.newPage()
  p.on('console', m => { const t = m.text(); if (/paddle|checkout|plan/i.test(t)) log('  [page]', t.slice(0, 160)) })

  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {})
  await p.waitForTimeout(4000)
  log('BUILD:', await p.evaluate(() => fetch('/version.json').then(r => r.text())))

  const pickerOf = async (tag) => {
    const text = (await p.locator('.plans-card').innerText().catch(() => '(NO PICKER)')).replace(/\s+/g, ' ')
    await p.screenshot({ path: `${OUT}/177-picker-${tag}.png` })
    log(`\nPICKER via ${tag}: ${text}`)
    return text
  }
  const closePicker = async () => { await p.locator('.plans-close').first().click().catch(() => {}); await p.waitForTimeout(800) }

  // ENTRY POINT 1 — Settings → Subscription → Upgrade.
  await p.locator('.bottom-nav button, footer button, [aria-label*="ettings"]').last().click().catch(() => {})
  await p.waitForTimeout(3000)
  let upgrade = p.getByText(/^upgrade$/i).first()
  for (let i = 0; i < 25 && !(await upgrade.isVisible().catch(() => false)); i++) {
    await p.mouse.wheel(0, 900); await p.waitForTimeout(400); upgrade = p.getByText(/^upgrade$/i).first()
  }
  log('SETTINGS: one Upgrade row visible:', await upgrade.isVisible().catch(() => false))
  log('SETTINGS: old separate rows gone:',
      !(await p.getByText(/^go premium$/i).first().isVisible().catch(() => false)) &&
      !(await p.getByText(/^go family$/i).first().isVisible().catch(() => false)))
  await p.screenshot({ path: `${OUT}/177-1-settings.png`, fullPage: true })
  await upgrade.click()
  await p.waitForTimeout(1200)
  const pickerText = await pickerOf('settings')
  await closePicker()

  // ENTRY POINT 2 — the course picker's upgrade CTA. ?openCourses=1 is the
  // app's own way in (it is the Paddle success redirect), so no guessing.
  await p.goto(`${BASE}/?openCourses=1`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(7000)
  const cta = p.locator('.section-header__cta').first()
  const ctaSeen = await cta.isVisible().catch(() => false)
  log('\nCOURSE PICKER: upgrade CTA visible:', ctaSeen, '| label:', ctaSeen ? await cta.innerText() : '(none)')
  let pickerFromCourses = '(CTA not reached)'
  if (ctaSeen) {
    await cta.click()
    await p.waitForTimeout(1500)
    pickerFromCourses = await pickerOf('course-picker')
    await closePicker()
  }

  // ENTRY POINT 3 — the in-player paywall, the real conversion moment. Raised
  // the way a learner raises it without playing for an hour: the belt map's
  // padlocked belt runs the same entitlement gate (gateSeed) that seed 20 does.
  const COURSE = 'spa_for_eng'
  await p.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(12000)
  await p.locator('[aria-label*="Tap to jump to a belt"]').first().click().catch(() => {})
  await p.waitForTimeout(3000)
  const locked = p.locator('.map-chip.is-paywalled')
  const lockedCount = await locked.count().catch(() => 0)
  log('\nBELT MAP: padlocked belts:', lockedCount)
  let pickerFromWall = '(paywall not reached)'
  if (lockedCount) {
    await locked.last().click().catch(() => {})
    await p.waitForTimeout(4000)
  }
  const wall = p.locator('.paywall-card')
  const wallUp = await wall.isVisible().catch(() => false)
  log('IN-PLAYER PAYWALL raised:', wallUp)
  if (wallUp) {
    log('PAYWALL TEXT:', (await wall.innerText()).replace(/\s+/g, ' ').slice(0, 240))
    await p.screenshot({ path: `${OUT}/177-3-paywall.png` })
    await p.locator('.paywall-btn-primary').first().click()
    await p.waitForTimeout(1500)
    pickerFromWall = await pickerOf('in-player-paywall')
    await closePicker()
  }

  // Tap a price and read what Paddle renders. On the dev alias Paddle refuses
  // the domain, so this reads the overlay title and whatever the frame says.
  const tap = async (label, tag) => {
    const btn = p.locator('.plan-btn', { hasText: label }).first()
    await btn.click()
    const r = await readCheckout(p, tag)
    await p.locator('.checkout-close').first().click().catch(() => {})
    await p.waitForTimeout(2500)
    return r
  }

  const reopen = async () => {
    // Back to a known page first — entry point 3 left us in the player.
    await p.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await p.waitForTimeout(6000)
    await p.locator('.bottom-nav button, footer button, [aria-label*="ettings"]').last().click().catch(() => {})
    await p.waitForTimeout(2500)
    let u = p.getByText(/^upgrade$/i).first()
    for (let i = 0; i < 25 && !(await u.isVisible().catch(() => false)); i++) {
      await p.mouse.wheel(0, 900); await p.waitForTimeout(400); u = p.getByText(/^upgrade$/i).first()
    }
    await u.click().catch(() => {})
    await p.waitForTimeout(1200)
  }
  await reopen()
  const fam = await tap('£25/month', '3-family-monthly')
  await reopen()
  const famY = await tap('£250/year', '4-family-annual')
  await reopen()
  const prem = await tap('£15/month', '5-premium-monthly')

  log('\n=== VERDICT ===')
  log('picker via Settings        :', pickerText.slice(0, 120))
  log('picker via course picker    :', pickerFromCourses.slice(0, 120))
  log('picker via in-player paywall:', pickerFromWall.slice(0, 120))
  log('family monthly →', fam.title, '|', /25/.test(fam.frameText) ? 'shows 25' : 'NO 25 SEEN')
  log('family annual  →', famY.title, '|', /250/.test(famY.frameText) ? 'shows 250' : 'NO 250 SEEN')
  log('premium monthly→', prem.title, '|', /15/.test(prem.frameText) ? 'shows 15' : 'NO 15 SEEN')
} catch (e) {
  console.error('PROBE FAILED:', e)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (userId) {
    try { await svc.from('learners').delete().eq('user_id', userId) } catch {}
    try { await svc.auth.admin.deleteUser(userId) } catch {}
    log('\nTORN DOWN', userId)
  }
}
