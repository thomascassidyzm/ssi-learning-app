/**
 * CONTROL for #177: does the EXISTING £15 Premium checkout open cleanly on
 * production, driven the same headless way as the dev-alias probe? If it does
 * and dev's does not, the dev failure is the environment (Paddle approved
 * domains), not the plan picker. Nothing is purchased.
 */
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://saysomethingin.app'
const OUT = process.env.CS_SCRATCH
const svc = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim(), { auth: { persistSession: false } })
const pub = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_ANON_KEY.trim(), { auth: { persistSession: false } })

const STAMP = String(Date.now()).slice(-7)
const EMAIL = `thomas.cassidy+zz.cs177p.${STAMP}@gmail.com`
const PASSWORD = 'SsiTest2026!'
let browser, userId = null

try {
  const { data: created, error } = await svc.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
  if (error) throw error
  userId = created.user.id
  const { data: signed } = await pub.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  const ref = new URL(process.env.SUPABASE_URL.trim()).hostname.split('.')[0]

  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${ref}-auth-token`, JSON.stringify(signed.session)])
  const p = await ctx.newPage()
  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {})
  await p.waitForTimeout(4000)
  console.log('BUILD:', await p.evaluate(() => fetch('/version.json').then(r => r.text())))

  await p.locator('.bottom-nav button, footer button, [aria-label*="ettings"]').last().click().catch(() => {})
  await p.waitForTimeout(3000)
  let go = p.getByText(/go premium/i).first()
  for (let i = 0; i < 25 && !(await go.isVisible().catch(() => false)); i++) {
    await p.mouse.wheel(0, 900); await p.waitForTimeout(400); go = p.getByText(/go premium/i).first()
  }
  console.log('GO PREMIUM row visible:', await go.isVisible().catch(() => false))
  await go.click()
  await p.waitForTimeout(10000)
  let frameText = ''
  for (const f of p.frames()) {
    if (!/paddle/i.test(f.url())) continue
    const t = await f.locator('body').innerText().catch(() => '')
    if (t.length > frameText.length) frameText = t
  }
  await p.screenshot({ path: `${OUT}/177-control-premium-${new URL(BASE).hostname}.png` })
  console.log('PROD PREMIUM CHECKOUT TEXT:', frameText.replace(/\s+/g, ' ').slice(0, 400) || '(empty)')
} catch (e) {
  console.error('CONTROL FAILED:', e)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (userId) { try { await svc.from('learners').delete().eq('user_id', userId) } catch {} ; try { await svc.auth.admin.deleteUser(userId) } catch {} ; console.log('TORN DOWN', userId) }
}
