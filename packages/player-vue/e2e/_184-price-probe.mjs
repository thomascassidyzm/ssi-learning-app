/** #177 staging price read: open the picker, tap a price, set country to the UK,
 * step to Paddle's order summary and READ the price. No card, no purchase. */
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.CS_SCRATCH
const svc = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim(), { auth: { persistSession: false } })
const STAMP = String(Date.now()).slice(-7)
const EMAIL = `thomas.cassidy+zz.cs184p.${STAMP}@gmail.com`
const PASSWORD = 'SsiTest2026!'
let browser, userId = null
const log = (...a) => console.log(...a)
try {
  const { data: created, error } = await svc.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
  if (error) throw error
  userId = created.user.id
  const pub = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_ANON_KEY.trim(), { auth: { persistSession: false } })
  const { data: signed, error: sErr } = await pub.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (sErr) throw sErr
  const ref = new URL(process.env.SUPABASE_URL.trim()).hostname.split('.')[0]
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/London' })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${ref}-auth-token`, JSON.stringify(signed.session)])
  const p = await ctx.newPage()
  const openPicker = async () => {
    await p.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await p.waitForTimeout(6000)
    await p.locator('.bottom-nav button, footer button, [aria-label*="ettings"]').last().click().catch(() => {})
    await p.waitForTimeout(2500)
    let u = p.getByText(/^upgrade$/i).first()
    for (let i = 0; i < 25 && !(await u.isVisible().catch(() => false)); i++) { await p.mouse.wheel(0, 900); await p.waitForTimeout(400); u = p.getByText(/^upgrade$/i).first() }
    await u.click(); await p.waitForTimeout(1500)
  }
  const paddleFrame = () => p.frames().find(f => /paddle/i.test(f.url()) && f.url().includes('checkout'))
  const readPrice = async (label, tag) => {
    await openPicker()
    await p.locator('.plan-btn', { hasText: label }).first().click()
    await p.waitForTimeout(9000)
    const title = await p.locator('.checkout-title').first().innerText().catch(() => '(none)')
    // country → United Kingdom, then Continue to the summary
    for (const f of p.frames()) {
      if (!/paddle/i.test(f.url())) continue
      await f.locator('select').first().selectOption({ label: 'United Kingdom' }).catch(() => {})
      await p.waitForTimeout(2500)
      await f.locator('input[name*="postcode" i], input[name*="zip" i], input[id*="postcode" i], input[id*="zip" i]').first().fill('SW1A 1AA').catch(() => {})
      await p.waitForTimeout(1000)
      await f.getByRole('button', { name: /continue/i }).first().click().catch(() => {})
      await p.waitForTimeout(6000)
      await f.getByRole('button', { name: /continue/i }).first().click().catch(() => {})
    }
    await p.waitForTimeout(11000)
    let text = ''
    for (const f of p.frames()) {
      if (!/paddle/i.test(f.url())) continue
      const t = await f.locator('body').innerText().catch(() => '')
      if (t.length > text.length) text = t
    }
    await p.screenshot({ path: `${OUT}/184-${tag}.png` })
    log(`\n=== ${tag} — overlay title: ${JSON.stringify(title)}`)
    log(text.replace(/\s+/g, ' ').slice(0, 700))
    await p.locator('.checkout-close').first().click().catch(() => {})
    await p.waitForTimeout(2000)
  }
  await readPrice('£25/month', 'family-monthly')
} catch (e) { console.error('PROBE FAILED:', e) }
finally {
  if (browser) await browser.close().catch(() => {})
  if (userId) { try { await svc.from('learners').delete().eq('user_id', userId) } catch {} ; try { await svc.auth.admin.deleteUser(userId) } catch {} ; log('\nTORN DOWN', userId) }
}
