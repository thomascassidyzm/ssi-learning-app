/**
 * #255 — can an ALREADY-SUBSCRIBED learner reach a second Paddle checkout?
 *
 * Staging only (Paddle refuses to render on a dev preview domain, by design).
 * A disposable account is given a real 'active' subscription row, then every
 * door is walked: Settings, the course picker, the belt-map lock / in-player
 * paywall, the plan picker itself, and the 409 already_registered re-entry.
 *
 * NOTHING IS EVER PURCHASED. No card is entered; the pass condition is that
 * Paddle never opens at all.
 */
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.CS_SCRATCH
const svc = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim(), { auth: { persistSession: false } })

const STAMP = String(Date.now()).slice(-7)
const EMAIL = `thomas.cassidy+zz.cs255.${STAMP}@gmail.com`
const PASSWORD = 'SsiTest2026!'

let browser, userId = null, learnerId = null, subId = null
const log = (...a) => console.log(...a)
const results = []
const record = (door, verdict, detail) => { results.push({ door, verdict, detail }); log(`\n[${door}] ${verdict} — ${detail}`) }

// Did a Paddle checkout open? Two independent tells: our own overlay, and a
// paddle iframe on the page.
async function paddleOpened(p) {
  const overlay = await p.locator('.checkout-title').first().isVisible().catch(() => false)
  const frame = p.frames().some(f => /paddle/i.test(f.url()))
  return { overlay, frame, any: overlay || frame }
}
const noticeUp = (p) => p.locator('text=/already have a subscription/i').first().isVisible().catch(() => false)
// .plans-card is the shared shell for all THREE steps (prices, details,
// already-subscribed notice), so "is the picker up" means "is a price button
// on screen" — otherwise the notice itself reads as a picker.
const pickerUp = (p) => p.locator('.plan-btn', { hasText: '£' }).first().isVisible().catch(() => false)

async function grantSubscription() {
  const { data, error } = await svc.from('subscriptions').insert({
    learner_id: learnerId,
    status: 'active',
    plan_id: 'pri_probe_255',
    plan_name: 'SSi Premium',
    provider: 'paddle',
    provider_subscription_id: `sub_probe_255_${STAMP}`,
  }).select('id').single()
  if (error) throw error
  subId = data.id
  log('GRANTED active subscription row', subId)
}
async function revokeSubscription() {
  if (!subId) return
  await svc.from('subscriptions').delete().eq('id', subId)
  log('revoked subscription row', subId)
  subId = null
}

try {
  const { data: created, error } = await svc.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
  if (error) throw error
  userId = created.user.id
  log('NEW ACCOUNT:', EMAIL, userId)

  // A trigger already mints the learner row for a new auth user, so take the
  // existing one and only create it if it is genuinely absent.
  let { data: learner } = await svc.from('learners').select('id').eq('user_id', userId).maybeSingle()
  if (!learner) {
    const { data: made, error: lErr } = await svc.from('learners').insert({ user_id: userId }).select('id').single()
    if (lErr) throw lErr
    learner = made
  }
  learnerId = learner.id
  log('LEARNER:', learnerId)

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
  p.on('console', m => { const t = m.text(); if (/REFUSED|checkout|paddle/i.test(t)) log('  [page]', t.slice(0, 160)) })

  // ─────────────────────────────────────────────────────────────────────
  // PART 1 — the guard itself, exercised through the real picker.
  // Open the picker while NOT subscribed, then become subscribed, then tap a
  // price. This is the exact double-buy: an existing subscriber tapping
  // Family. Paddle must not open.
  // ─────────────────────────────────────────────────────────────────────
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
  await p.waitForTimeout(6000)
  log('BUILD:', await p.evaluate(() => fetch('/version.json').then(r => r.text()).catch(() => '(none)')))

  const openPickerViaSettings = async () => {
    await p.locator('.bottom-nav button, footer button, [aria-label*="ettings"]').last().click().catch(() => {})
    await p.waitForTimeout(2500)
    let u = p.getByText(/^upgrade$/i).first()
    for (let i = 0; i < 25 && !(await u.isVisible().catch(() => false)); i++) {
      await p.mouse.wheel(0, 900); await p.waitForTimeout(350); u = p.getByText(/^upgrade$/i).first()
    }
    const seen = await u.isVisible().catch(() => false)
    if (seen) { await u.click(); await p.waitForTimeout(1500) }
    return seen
  }

  const sawUpgradeUnsubscribed = await openPickerViaSettings()
  log('picker open (unsubscribed):', await pickerUp(p), '| upgrade row seen:', sawUpgradeUnsubscribed)
  await p.screenshot({ path: `${OUT}/255-1-picker-open.png` })

  await grantSubscription()

  const famBtn = p.locator('.plan-btn', { hasText: '£25' }).first()
  if (await famBtn.isVisible().catch(() => false)) {
    await famBtn.click()
    await p.waitForTimeout(9000)
    const opened = await paddleOpened(p)
    await p.screenshot({ path: `${OUT}/255-2-family-tap.png` })
    record('PLAN PICKER → Family £25/mo (the double-buy tap)',
      opened.any ? 'FAIL' : 'PASS',
      `paddle overlay=${opened.overlay} paddle iframe=${opened.frame} | already-subscribed notice=${await noticeUp(p)}`)
    await p.locator('text=/^Close$/i').last().click().catch(() => {})
    await p.waitForTimeout(1000)
  } else {
    record('PLAN PICKER → Family £25/mo', 'NOT REACHED', 'no £25 button on screen')
  }

  // ─────────────────────────────────────────────────────────────────────
  // PART 2 — every door, as a subscriber, from a clean load.
  // ─────────────────────────────────────────────────────────────────────
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(7000)

  // DOOR: Settings
  const upgradeSeen = await openPickerViaSettings()
  const pickerFromSettings = await pickerUp(p)
  await p.screenshot({ path: `${OUT}/255-3-settings.png`, fullPage: true })
  record('SETTINGS', (pickerFromSettings || (await paddleOpened(p)).any) ? 'FAIL' : 'PASS',
    `upgrade row visible=${upgradeSeen} | plan picker open=${pickerFromSettings} | notice=${await noticeUp(p)}`)
  await p.locator('.plans-close').first().click().catch(() => {})

  // DOOR: course picker
  await p.goto(`${BASE}/?openCourses=1`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(8000)
  const cta = p.locator('.section-header__cta').first()
  const ctaSeen = await cta.isVisible().catch(() => false)
  let coursePickerVerdict = 'no upgrade CTA rendered for a subscriber'
  if (ctaSeen) {
    await cta.click(); await p.waitForTimeout(6000)
    const opened = await paddleOpened(p)
    coursePickerVerdict = `CTA tapped: picker=${await pickerUp(p)} paddle=${opened.any} notice=${await noticeUp(p)}`
  }
  await p.screenshot({ path: `${OUT}/255-4-courses.png`, fullPage: true })
  record('COURSE PICKER', /paddle=true|picker=true/.test(coursePickerVerdict) ? 'FAIL' : 'PASS', coursePickerVerdict)

  // DOOR: belt-map lock / in-player paywall
  await p.goto(`${BASE}/?course=spa_for_eng`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(14000)
  await p.locator('[aria-label*="Tap to jump to a belt"]').first().click().catch(() => {})
  await p.waitForTimeout(3500)
  const lockedCount = await p.locator('.map-chip.is-paywalled').count().catch(() => 0)
  if (lockedCount) { await p.locator('.map-chip.is-paywalled').last().click().catch(() => {}); await p.waitForTimeout(4000) }
  const wallUp = await p.locator('.paywall-card').isVisible().catch(() => false)
  let wallVerdict = `padlocked belts=${lockedCount} paywall raised=${wallUp}`
  if (wallUp) {
    await p.locator('.paywall-btn-primary').first().click().catch(() => {})
    await p.waitForTimeout(7000)
    const opened = await paddleOpened(p)
    wallVerdict += ` | Subscribe tapped: picker=${await pickerUp(p)} paddle=${opened.any} notice=${await noticeUp(p)}`
  }
  await p.screenshot({ path: `${OUT}/255-5-beltmap.png`, fullPage: true })
  record('BELT-MAP LOCK / IN-PLAYER PAYWALL', /paddle=true|picker=true/.test(wallVerdict) ? 'FAIL' : 'PASS', wallVerdict)

  // ─────────────────────────────────────────────────────────────────────
  // PART 3 — the 409 already_registered re-entry (commit 7bc794f4).
  // Signed OUT, choose Family, type the SUBSCRIBED account's email, sign in
  // with the password, and see whether the resume opens Paddle.
  // ─────────────────────────────────────────────────────────────────────
  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 } })
  const q = await ctx2.newPage()
  q.on('console', m => { const t = m.text(); if (/checkout|paddle/i.test(t)) log('  [409 page]', t.slice(0, 160)) })
  await q.goto(`${BASE}/?openCourses=1`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await q.waitForTimeout(9000)
  await q.locator('.section-header__cta').first().click().catch(() => {})
  await q.waitForTimeout(2500)
  if (!(await pickerUp(q))) {
    // Fallback: Settings, for a build where the course-picker CTA is absent.
    await q.locator('.bottom-nav button, footer button, [aria-label*="ettings"]').last().click().catch(() => {})
    await q.waitForTimeout(2500)
    let u2 = q.getByText(/^upgrade$/i).first()
    for (let i = 0; i < 25 && !(await u2.isVisible().catch(() => false)); i++) {
      await q.mouse.wheel(0, 900); await q.waitForTimeout(350); u2 = q.getByText(/^upgrade$/i).first()
    }
    await u2.click().catch(() => {})
    await q.waitForTimeout(1500)
  }
  let re409 = 'picker not reached signed-out'
  if (await pickerUp(q)) {
    await q.locator('.plan-btn', { hasText: '£25' }).first().click().catch(() => {})
    await q.waitForTimeout(1500)
    // details step
    const inputs = q.locator('.field-input')
    await inputs.nth(0).fill(EMAIL).catch(() => {})
    await inputs.nth(1).fill(EMAIL).catch(() => {})
    await q.locator('.submit-btn').first().click().catch(() => {})
    await q.waitForTimeout(4000)
    await q.screenshot({ path: `${OUT}/255-6-409-step.png` })
    const existing = await q.locator('text=/already have an account/i').first().isVisible().catch(() => false)
    if (existing) {
      await q.locator('input[type=password]').first().fill(PASSWORD).catch(() => {})
      await q.locator('.submit-btn').first().click().catch(() => {})
      await q.waitForTimeout(9000)
      const opened = await paddleOpened(q)
      re409 = `409 branch reached, signed in: paddle=${opened.any} (overlay=${opened.overlay} iframe=${opened.frame}) notice=${await noticeUp(q)}`
    } else {
      re409 = 'server did not report already_registered — 409 branch not reached'
    }
    await q.screenshot({ path: `${OUT}/255-7-409-result.png` })
  }
  record('409 ALREADY_REGISTERED RE-ENTRY', /paddle=true/.test(re409) ? 'FAIL' : (/reached, signed in/.test(re409) ? 'PASS' : 'NOT REACHED'), re409)

  log('\n=== VERDICT TABLE ===')
  for (const r of results) log(`${r.verdict.padEnd(11)} ${r.door} :: ${r.detail}`)
} catch (e) {
  console.error('PROBE FAILED:', e)
} finally {
  if (browser) await browser.close().catch(() => {})
  await revokeSubscription().catch(() => {})
  if (learnerId) { try { await svc.from('learners').delete().eq('id', learnerId) } catch {} }
  if (userId) { try { await svc.auth.admin.deleteUser(userId) } catch {} }
  log('\nTORN DOWN', userId)
}
