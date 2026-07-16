// Ad-hoc real-browser verification for /admin/demo-schools (matches the
// e2e/schools-nav harness style: mint real sessions via admin.generateLink +
// verifyOtp — no email ever sent — inject into localStorage, drive with
// Playwright against a real deployed URL). Creates and then tears down one
// real demo org each run.
//
// Fixtures are prefixed ZZQA- so any that escape teardown (a crashed run,
// a killed process) are obvious in the admin list and easy to grep/filter —
// see the 2026-07-16 cleanup that had to hand-identify 5 stragglers by name.
//
// Usage: BASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_ANON_KEY=... \
//   node e2e/demo-schools/verify-demo-schools.mjs [--purge]
//
// --purge: after the run, hard-delete the fixture org (schools, classes,
// learners, staff accounts) instead of leaving it merely 'expired'. Always
// used by the CI/manual verify path now — a verify run must clean up after
// itself, not rely on a later human sweep.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const COURSE_CODE = process.env.COURSE_CODE || 'zho_for_eng'
const SHOULD_PURGE = process.argv.includes('--purge')

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

async function injectSession(ctx, session, platformRole) {
  await ctx.addInitScript(([key, value, roleKey, roleValue]) => {
    window.localStorage.setItem(key, value)
    // useUserRole's router-guard cache (localStorage 'ssi-user-role') is read
    // SYNCHRONOUSLY by router.beforeEach for /admin — unlike the async
    // /schools guard, a cold load with an empty cache bounces to '/' before
    // the real DB role check ever resolves. Seed it so admin routes work on
    // first paint, exactly like a real returning admin's cached session.
    if (roleValue) window.localStorage.setItem(roleKey, roleValue)
  }, ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(session), 'ssi-user-role', platformRole ? JSON.stringify({ platformRole, educationalRole: null }) : ''])
}

const browser = await chromium.launch()
const results = { steps: [] }
function step(name, ok, detail) {
  results.steps.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`)
}

try {
  // ---- 1. Admin: create the demo school ----
  const adminSession = await mintSession(ADMIN_EMAIL)
  const adminCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await injectSession(adminCtx, adminSession, 'ssi_admin')
  const adminPage = await adminCtx.newPage()
  const adminConsoleErrors = []
  adminPage.on('pageerror', (e) => adminConsoleErrors.push(String(e)))
  adminPage.on('dialog', (d) => d.accept()) // Purge's confirm() prompt

  await adminPage.goto(BASE + '/admin/demo-schools')
  await adminPage.waitForSelector('.admin-demo-schools', { timeout: 20000 })
  step('admin lands on /admin/demo-schools', true)

  const prospectName = `ZZQA-Playwright Trust ${Date.now().toString(36)}`
  await adminPage.fill('.create-form input.frost-input', prospectName)
  // Language pair select is the second frost-select (first is org shape)
  const selects = adminPage.locator('.create-form select.frost-select')
  await selects.nth(1).selectOption(COURSE_CODE)
  step('filled create form', true, prospectName)

  await adminPage.click('.create-form button[type="submit"]')
  await adminPage.waitForSelector('.result-panel .demo-org-card', { timeout: 30000 })
  step('demo school created, result card rendered', true)

  const orgNameText = await adminPage.locator('.result-panel .org-name').textContent()
  step('result card shows correct org name', orgNameText?.trim() === prospectName, orgNameText || '')

  const staffRows = adminPage.locator('.result-panel .staff-row')
  const staffCount = await staffRows.count()
  step('staff rows present', staffCount >= 1, `count=${staffCount}`)

  // Find the school_admin row (single_school shape has exactly one)
  const adminRow = adminPage.locator('.result-panel .staff-row', { has: adminPage.locator('.role-school_admin') })
  const leaderEmail = (await adminRow.locator('.staff-email').textContent())?.trim()
  const leaderPassword = (await adminRow.locator('.staff-password').textContent())?.trim()
  step('captured school leader credentials', !!leaderEmail && !!leaderPassword, leaderEmail)

  // Mint-sign-in-link button works end to end (exercises create-signin-link reuse)
  await adminRow.locator('button', { hasText: 'Mint sign-in link' }).click()
  await adminPage.waitForSelector('.staff-link-field', { timeout: 15000 })
  const mintedLinkText = await adminPage.locator('.staff-link-field .invite-link-url').first().textContent()
  step('mint sign-in link produced a real action_link', !!mintedLinkText && mintedLinkText.includes('http'), mintedLinkText?.slice(0, 60))

  step('no console errors on admin page', adminConsoleErrors.length === 0, adminConsoleErrors.join(' | '))

  // ---- 2. Sign in as the demo school leader, walk every schools tab ----
  const anonForLogin = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: leaderAuth, error: leaderAuthErr } = await anonForLogin.auth.signInWithPassword({ email: leaderEmail, password: leaderPassword })
  if (leaderAuthErr) throw new Error(`leader password sign-in failed: ${leaderAuthErr.message}`)
  step('leader password sign-in works', true)

  const leaderCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await injectSession(leaderCtx, leaderAuth.session)
  const leaderPage = await leaderCtx.newPage()
  const leaderConsoleErrors = []
  leaderPage.on('pageerror', (e) => leaderConsoleErrors.push(String(e)))

  const TABS = [
    ['/schools', '.dashboard-view'],
    ['/schools/classes', 'main.dashboard'],
    ['/schools/students', 'main.students'],
    ['/schools/teachers', 'main.teachers'],
    ['/schools/analytics', '.tiv-root'],
    ['/schools/settings', 'main.settings-screen'],
  ]
  for (const [path, sel] of TABS) {
    try {
      await leaderPage.goto(BASE + path)
      await leaderPage.waitForSelector(sel, { timeout: 15000 })
      // Dashboard widgets populate via several SEQUENTIAL round trips
      // (classes -> per-class progress/sessions/teachers/lego-totals) —
      // give them room to settle before judging the render, not just the
      // container mounting.
      await leaderPage.waitForTimeout(7000)
      const bodyText = await leaderPage.locator('body').innerText()
      const looksBlank = bodyText.trim().length < 20
      step(`leader tab ${path} renders`, !looksBlank, looksBlank ? 'body nearly empty' : `${bodyText.length} chars`)
    } catch (err) {
      step(`leader tab ${path} renders`, false, String(err).slice(0, 200))
    }
  }
  step('no console errors across leader tabs', leaderConsoleErrors.length === 0, leaderConsoleErrors.slice(0, 3).join(' | '))

  // ---- 3. Admin: expire the org ----
  await adminPage.goto(BASE + '/admin/demo-schools')
  await adminPage.waitForSelector('.admin-demo-schools', { timeout: 20000 })
  const row = adminPage.locator('.codes-table tbody tr', { hasText: prospectName }).first()
  await row.waitFor({ timeout: 15000 })
  await row.locator('button', { hasText: 'Expire now' }).click()
  let statusText = ''
  for (let i = 0; i < 10; i++) {
    await adminPage.waitForTimeout(1000)
    statusText = (await row.locator('.status-pill').textContent())?.trim() || ''
    if (statusText === 'Expired') break
  }
  step('org shows Expired after teardown', statusText === 'Expired', statusText)

  // ---- 4. Purge — a verify run must clean up after itself, not leave a
  // fixture for a human to sweep later. Expired orgs are hidden by default
  // now, so tick the toggle to find the row again. ----
  if (SHOULD_PURGE) {
    await adminPage.check('.show-expired-toggle input')
    await row.waitFor({ timeout: 15000 })
    await row.locator('button', { hasText: 'Purge' }).click()
    await adminPage.waitForFunction(
      (name) => !document.querySelector('.codes-table')?.textContent?.includes(name),
      prospectName,
      { timeout: 15000 },
    )
    step('org purged (row gone after hard delete)', true)
  }

  await adminCtx.close()
  await leaderCtx.close()
} catch (err) {
  console.error('FATAL:', err)
  results.fatal = String(err)
} finally {
  await browser.close()
}

const failed = results.steps.filter(s => !s.ok)
console.log(`\n=== ${results.steps.length - failed.length}/${results.steps.length} passed ===`)
if (failed.length || results.fatal) {
  console.log('FAILURES:', JSON.stringify(failed, null, 2))
  process.exit(1)
}
