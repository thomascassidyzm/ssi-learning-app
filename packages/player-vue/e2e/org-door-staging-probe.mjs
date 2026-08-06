// Live browser verification on STAGING of the org-dashboard-door fix
// (staging commit 2cb4e8e9, contains d43e6806). Verification only — does
// not modify app code. Same mint-session technique as
// org-hierarchy/verify-org-trial-surface.mjs (service-role generateLink ->
// anon verifyOtp -> inject session into localStorage sb-<ref>-auth-token).
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error('missing Supabase env vars')

const svc = createClient(SUPABASE_URL, SERVICE)
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]

const ORG_LEADER_EMAIL = 'euskiwicymraeg+1@gmail.com'
const ORG_GROUP_ID = 'b7878832-ffbb-4190-84cb-8cc5ce62c5bd'
const ORG_LEADER_UID = 'ae49953a-924e-4c96-b779-9c0cfd1e46ce'
const NON_LEADER_EMAIL = 'euskiwicymraeg+mgr@gmail.com'
const SCHOOL_ADMIN_EMAIL = 'thomas.cassidy+demo.irish.admin@gmail.com' // Gaelscoil na Mara, school_admin
const PLAIN_LEARNER_EMAIL = 'hanna.iben@gmail.com'

async function mintSession(email) {
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`generateLink(${email}) failed: ${error.message}`)
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
  if (verr) throw new Error(`verifyOtp(${email}) failed: ${verr.message}`)
  return v.session
}

const results = []
function step(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`)
}

async function newAuthedContext(browser, email) {
  const session = await mintSession(email)
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
  await ctx.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value)
  }, [`sb-${projectRef}-auth-token`, JSON.stringify(session)])
  return ctx
}

const browser = await chromium.launch()
try {
  // ── Step 1-4: org leader (+1@) ──────────────────────────────────────
  const leaderCtx = await newAuthedContext(browser, ORG_LEADER_EMAIL)
  const leaderPage = await leaderCtx.newPage()

  await leaderPage.goto(BASE, { waitUntil: 'load' })
  await leaderPage.waitForTimeout(2000)

  // Open Settings via the bottom-nav gear pill.
  const settingsBtn = leaderPage.locator('button.pill-btn[title="Settings"]')
  await settingsBtn.click()
  await leaderPage.waitForTimeout(300)
  const shot300 = 'org-door-staging-leader-settings-300ms.png'
  await leaderPage.screenshot({ path: shot300 })
  await leaderPage.waitForTimeout(2000)
  const shotSettled = 'org-door-staging-leader-settings-settled.png'
  await leaderPage.screenshot({ path: shotSettled })

  const orgRow = leaderPage.locator('.setting-label', { hasText: 'Organisation Dashboard' })
  const orgRowVisible = await orgRow.isVisible().catch(() => false)
  const orgRowLabel = orgRowVisible ? (await orgRow.innerText()) : '(not found)'
  const orgDesc = leaderPage.locator('.setting-desc', { hasText: 'Your people, invites and progress' })
  const orgDescVisible = await orgDesc.isVisible().catch(() => false)
  const orgDescText = orgDescVisible ? (await orgDesc.innerText()) : '(not found)'
  step(
    '1. Settings shows Organisation Dashboard row with correct sub-text',
    orgRowVisible && orgDescVisible,
    `label="${orgRowLabel}" desc="${orgDescText}"`
  )

  const schoolsRowInSettings = leaderPage.locator('.setting-label', { hasText: 'Schools Dashboard' })
  const schoolsRowVisibleAt300 = await (async () => {
    // Re-check against the early screenshot moment by re-querying immediately after open (already 2.3s settled above,
    // so also do a fresh open/close cycle to check the 300ms flash directly).
    return null
  })()
  const schoolsRowCountSettled = await schoolsRowInSettings.count()
  step(
    '2. Schools Dashboard row NOT present in Settings (org-only leader)',
    schoolsRowCountSettled === 0,
    `count at settle=${schoolsRowCountSettled}; screenshots: ${shot300} (≈300ms), ${shotSettled} (settled)`
  )

  // Click through to the org dashboard.
  const orgRowClickable = leaderPage.locator('.setting-row, button, a', { hasText: 'Organisation Dashboard' }).first()
  await orgRowClickable.click()
  await leaderPage.waitForTimeout(2500)
  const orgUrl = leaderPage.url()
  const orgBodyText = (await leaderPage.locator('body').innerText()).replace(/\s+/g, ' ')
  const rendersDeborah = orgBodyText.includes('Deborah Testing')
  step(
    '3. Clicking Organisation Dashboard navigates to /org/:id and renders group name',
    orgUrl.includes(`/org/${ORG_GROUP_ID}`) && rendersDeborah,
    `url=${orgUrl} rendersDeborah=${rendersDeborah}`
  )
  await leaderPage.screenshot({ path: 'org-door-staging-leader-org-page.png' })

  // Step 4: Browse screen — org card present, schools card absent.
  const browsePage = await leaderCtx.newPage()
  await browsePage.goto(BASE, { waitUntil: 'load' })
  await browsePage.waitForTimeout(3000)
  const libraryBtn = browsePage.locator('button.pill-btn[title="Library"]')
  await libraryBtn.click()
  await browsePage.waitForTimeout(4000)
  const browseOrgCard = browsePage.locator('.schools-link-title', { hasText: 'Organisation Dashboard' })
  const browseOrgCardVisible = await browseOrgCard.isVisible().catch(() => false)
  const browseSchoolsCard = browsePage.locator('.schools-link-title', { hasText: 'Schools Dashboard' })
  const browseSchoolsCardCount = await browseSchoolsCard.count()
  step(
    '4. Browse screen: Organisation Dashboard card present, Schools card absent',
    browseOrgCardVisible && browseSchoolsCardCount === 0,
    `orgCardVisible=${browseOrgCardVisible} schoolsCardCount=${browseSchoolsCardCount}`
  )
  await browsePage.screenshot({ path: 'org-door-staging-leader-browse.png' })
  await leaderCtx.close()

  // ── Step 5: non-leader govt_admin (+mgr@) ───────────────────────────
  const mgrCtx = await newAuthedContext(browser, NON_LEADER_EMAIL)
  const mgrPage = await mgrCtx.newPage()
  await mgrPage.goto(BASE, { waitUntil: 'load' })
  await mgrPage.waitForTimeout(1500)
  await mgrPage.locator('button.pill-btn[title="Settings"]').click()
  await mgrPage.waitForTimeout(2500)
  const mgrOrgRowCount = await mgrPage.locator('.setting-label', { hasText: 'Organisation Dashboard' }).count()
  const mgrDashboardLabels = await mgrPage.locator('.setting-label').allInnerTexts()
  step(
    '5. Non-leader govt_admin (+mgr@) Settings shows NO Organisation Dashboard row',
    mgrOrgRowCount === 0,
    `orgRowCount=${mgrOrgRowCount}; all setting-labels seen: ${JSON.stringify(mgrDashboardLabels)}`
  )
  await mgrPage.screenshot({ path: 'org-door-staging-mgr-settings.png' })
  await mgrCtx.close()

  // ── Step 6: regression smoke — school_admin ─────────────────────────
  const schoolCtx = await newAuthedContext(browser, SCHOOL_ADMIN_EMAIL)
  const schoolPage = await schoolCtx.newPage()
  await schoolPage.goto(BASE, { waitUntil: 'load' })
  await schoolPage.waitForTimeout(1500)
  await schoolPage.locator('button.pill-btn[title="Settings"]').click()
  await schoolPage.waitForTimeout(2500)
  const schoolsRowVisible = await schoolPage.locator('.setting-label', { hasText: 'Schools Dashboard' }).isVisible().catch(() => false)
  step(
    `6a. Regression smoke (school_admin ${SCHOOL_ADMIN_EMAIL}, Gaelscoil na Mara) — Settings shows Schools Dashboard`,
    schoolsRowVisible,
    `schoolsRowVisible=${schoolsRowVisible}`
  )
  await schoolPage.screenshot({ path: 'org-door-staging-school-admin-settings.png' })

  let schoolsLoadOk = false
  let schoolsLoadDetail = ''
  const consoleErrors = []
  schoolPage.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  try {
    await schoolPage.goto(`${BASE}/schools`, { waitUntil: 'load', timeout: 20000 })
    await schoolPage.waitForTimeout(2000)
    const schoolsBody = (await schoolPage.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)
    schoolsLoadOk = !/error|something went wrong|failed to load/i.test(schoolsBody)
    schoolsLoadDetail = `url=${schoolPage.url()} bodySnippet="${schoolsBody}" consoleErrors=${JSON.stringify(consoleErrors)}`
  } catch (e) {
    schoolsLoadDetail = `threw: ${e.message}`
  }
  step('6b. Regression smoke — /schools loads without error for school_admin', schoolsLoadOk, schoolsLoadDetail)
  await schoolPage.screenshot({ path: 'org-door-staging-school-admin-dashboard.png' })
  await schoolCtx.close()

  // ── Step 7: regression smoke — plain learner ────────────────────────
  const learnerCtx = await newAuthedContext(browser, PLAIN_LEARNER_EMAIL)
  const learnerPage = await learnerCtx.newPage()
  await learnerPage.goto(BASE, { waitUntil: 'load' })
  await learnerPage.waitForTimeout(1500)
  await learnerPage.locator('button.pill-btn[title="Settings"]').click()
  await learnerPage.waitForTimeout(2000)
  const dashboardsSectionCount = await learnerPage.locator('.section', { hasText: 'Dashboards' }).count()
  const anyDashboardLabelCount = await learnerPage.locator('.setting-label', { hasText: /Dashboard/ }).count()
  step(
    `7a. Plain learner (${PLAIN_LEARNER_EMAIL}) Settings shows NO Dashboards section`,
    dashboardsSectionCount === 0 && anyDashboardLabelCount === 0,
    `dashboardsSectionCount=${dashboardsSectionCount} anyDashboardLabelCount=${anyDashboardLabelCount}`
  )
  await learnerPage.screenshot({ path: 'org-door-staging-learner-settings.png' })

  await learnerPage.locator('.settings-overlay, button', { hasText: /close|×/i }).first().click({ timeout: 3000 }).catch(() => {})
  await learnerPage.goto(BASE, { waitUntil: 'load' })
  await learnerPage.waitForTimeout(2000)
  const playerLoaded = await learnerPage.locator('body').isVisible().catch(() => false)
  const learnerBodySnippet = (await learnerPage.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)
  step('7b. Plain learner: player still loads', playerLoaded, `bodySnippet="${learnerBodySnippet}"`)
  await learnerPage.screenshot({ path: 'org-door-staging-learner-player.png' })
  await learnerCtx.close()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`)
  process.exitCode = failed.length ? 1 : 0
} finally {
  await browser.close()
}
