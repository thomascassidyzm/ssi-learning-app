// Verifies provision.ts rejects a disposable-domain email on the tutor track.
// Mints a real session for a mailinator.com address (no email sent), then
// drives the already-signed-in provisioning path and expects the 400.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const TEST_EMAIL = `tutor.audit.disposable.${Date.now().toString(36)}@mailinator.com`

const svc = createClient(SUPABASE_URL, SERVICE)

async function mintSession(email) {
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`generateLink(${email}) failed: ${error.message}`)
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
  if (verr) throw new Error(`verifyOtp(${email}) failed: ${verr.message}`)
  return v.session
}

const browser = await chromium.launch()
try {
  console.log('test email:', TEST_EMAIL)
  const session = await mintSession(TEST_EMAIL)
  const ctx = await browser.newContext()
  await ctx.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [`sb-swfvymspfxmnfhevgdkg-auth-token`, JSON.stringify(session)])
  const page = await ctx.newPage()
  const netResults = []
  page.on('response', async (res) => {
    if (res.url().includes('/api/onboarding/provision')) {
      let body = ''
      try { body = await res.text() } catch {}
      netResults.push(`${res.status()} — ${body}`)
    }
  })

  await page.goto(BASE + '/tutors', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const courseRow = page.locator('.ob-lang-row, .ob-lang-tile').first()
  await courseRow.click()
  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Send"), button:has-text("Start")').first()
  await continueBtn.click()
  await page.waitForTimeout(2500)
  console.log('body after attempt:\n', (await page.locator('body').innerText()).slice(0, 400))
  console.log('\nprovision responses:', netResults.join('\n'))
  const blocked = netResults.some((r) => r.startsWith('400'))
  console.log('\n' + (blocked ? 'PASS — disposable domain blocked' : 'FAIL — disposable domain was NOT blocked'))
  await ctx.close()
} finally {
  await browser.close()
}
