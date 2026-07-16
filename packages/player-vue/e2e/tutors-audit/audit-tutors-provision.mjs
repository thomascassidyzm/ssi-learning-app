// Real-browser audit of the POST-auth tutor path: mint a real session for a
// fresh test email (admin.generateLink + verifyOtp, no email sent — same
// technique as e2e/demo-schools), inject it, then drive /tutors through
// provisioning into /tutors/dashboard. Looks for the entitlement_grants trap,
// dead ends, and console/network errors along the way.
//
// Usage: node e2e/tutors-audit/audit-tutors-provision.mjs
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import fs from 'fs'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const TEST_EMAIL = `tutor.audit.${Date.now().toString(36)}@gmail.com`
const OUT = 'e2e/tutors-audit/out'
fs.mkdirSync(OUT, { recursive: true })

if (!SERVICE || !ANON) throw new Error('missing SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY in env')

const svc = createClient(SUPABASE_URL, SERVICE)

async function mintSession(email) {
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`generateLink(${email}) failed: ${error.message}`)
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
  if (verr) throw new Error(`verifyOtp(${email}) failed: ${verr.message}`)
  return v.session
}

async function injectSession(ctx, session) {
  await ctx.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value)
  }, [`sb-swfvymspfxmnfhevgdkg-auth-token`, JSON.stringify(session)])
}

const browser = await chromium.launch()
const consoleErrors = []
const pageErrors = []
const netFailures = []

try {
  console.log('test email:', TEST_EMAIL)
  const session = await mintSession(TEST_EMAIL)
  console.log('minted session for fresh account, user id:', session.user.id)

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await injectSession(ctx, session)
  const page = await ctx.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('response', async (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      let body = ''
      try { body = (await res.text()).slice(0, 300) } catch {}
      netFailures.push(`${res.status()} ${res.url()} — ${body}`)
    }
  })

  async function shot(name) {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
    console.log('shot:', name)
  }

  console.log('\n--- 1. Visit /tutors while already signed in (fresh account) ---')
  await page.goto(BASE + '/tutors', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await shot('10-tutors-signedin')
  console.log('body (first 500):\n', (await page.locator('body').innerText()).slice(0, 500))

  // Pick a course and continue (already-signed-in shortcut = no OTP step)
  const courseRow = page.locator('.ob-lang-row, .ob-lang-tile').first()
  if (await courseRow.count()) {
    await courseRow.click()
    console.log('clicked first course option')
  }
  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Send"), button:has-text("Start")').first()
  if (await continueBtn.count()) {
    console.log('continue button disabled?', await continueBtn.isDisabled())
    await continueBtn.click()
    await page.waitForTimeout(3000)
    await shot('11-after-provision')
    console.log('url after provision click:', page.url())
    console.log('body after provision (first 800):\n', (await page.locator('body').innerText()).slice(0, 800))
  } else {
    console.log('NO CONTINUE/SEND BUTTON FOUND on signed-in choose step')
  }

  // Finish-details step (institution/display name) if present
  const finishBtn = page.locator('button:has-text("Continue"), button:has-text("Start teaching"), button:has-text("Go to")').first()
  if (await finishBtn.count()) {
    await shot('12-finish-details-step')
    await finishBtn.click()
    await page.waitForTimeout(2500)
  }

  console.log('\n--- 2. Land on /tutors/dashboard ---')
  await page.waitForTimeout(1500)
  console.log('final url:', page.url())
  await shot('13-tutors-dashboard')
  console.log('dashboard body (first 800):\n', (await page.locator('body').innerText()).slice(0, 800))

  // If not on dashboard, force nav there directly and see what happens
  if (!page.url().includes('/tutors/dashboard')) {
    await page.goto(BASE + '/tutors/dashboard', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await shot('14-tutors-dashboard-direct')
    console.log('direct dashboard nav body (first 800):\n', (await page.locator('body').innerText()).slice(0, 800))
  }

  console.log('\n--- 3. Check /tutors/dashboard/setup or course-selection surfaces for entitlement_grants trap ---')
  for (const path of ['/tutors/dashboard/upgrade']) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch((e) => console.log(path, 'nav error', String(e)))
    await page.waitForTimeout(1500)
    console.log(path, '->', page.url())
    await shot('15-' + path.replace(/\//g, '_'))
  }

  await ctx.close()
} catch (err) {
  console.error('FATAL:', err)
} finally {
  console.log('\n=== console errors ===')
  console.log(consoleErrors.join('\n') || '(none)')
  console.log('\n=== page errors ===')
  console.log(pageErrors.join('\n') || '(none)')
  console.log('\n=== network failures (4xx/5xx on /api) ===')
  console.log(netFailures.join('\n') || '(none)')
  await browser.close()
}
