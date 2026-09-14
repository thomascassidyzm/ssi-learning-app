// Job #677: the one-door round trip on staging. Three reports from real signed-in
// sessions through the three UI doors — the learner sheet, the schools dashboard modal,
// the player's content flag — then bug_reports read back with the service key to show
// each row carries account code, email, role, course and build. The watcher is then run
// once with --include-tests by hand to post them, marked TEST SENDER.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY; CHROME_BIN; short TMPDIR (memory notes).
import { chromium } from '@playwright/test'

const BASE = process.env.PROBE_URL || 'https://staging.saysomethingin.app'
const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_KEY
const MARK = `job677-roundtrip-${Date.now()}`
const out = { base: BASE, marker: MARK, steps: [] }
const step = (name, data = {}) => { out.steps.push({ name, ...data }); console.error(name, JSON.stringify(data)) }
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

// A real session for the account, minted server-side (generate_link, then verify) and seeded
// into the STAGING origin's localStorage the way supabase-js stores it. A magic link's own
// redirect lands on production, which is not where the build under test is.
async function mintSession(email) {
  const r = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email }) })
  const j = await r.json()
  if (!j.hashed_token) throw new Error(`no hashed_token for ${email}: ${JSON.stringify(j).slice(0, 200)}`)
  const v = await fetch(`${SB_URL}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: j.hashed_token }) })
  const sess = await v.json()
  if (!sess.access_token) throw new Error(`verify failed for ${email}: ${JSON.stringify(sess).slice(0, 200)}`)
  return sess
}
const STORAGE_KEY = `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`

const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}), args: ['--autoplay-policy=no-user-gesture-required'] })
async function session(email, redirect) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => step('pageerror', { email, e: String(e).slice(0, 160) }))
  page.on('response', async (r) => { if (r.url().includes('/api/report/bug')) step('api', { email, status: r.status(), body: (await r.text().catch(() => '')).slice(0, 200) }) })
  const sess = await mintSession(email)
  await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v) }, [STORAGE_KEY, JSON.stringify(sess)])
  await page.goto(redirect, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(7000)
  const signed = await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token')))
  step('signed-in', { email, signed, url: page.url().split('#')[0] })
  return page
}

// 1. Learner sheet, as the +ssi account.
try {
  const page = await session('thomas.cassidy+ssi@gmail.com', `${BASE}/`)
  await page.goto(`${BASE}/?screen=settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const row = page.locator('[data-walk="report-bug"]').first()
  await row.scrollIntoViewIfNeeded(); await row.tap({ timeout: 8000 })
  await page.locator('[data-walk="report-bug-text"]').fill(`PROBE, not a real bug: job #677 round trip through the learner sheet (${MARK}). Safe to ignore.`)
  await page.locator('[data-walk="report-bug-send"]').tap({ timeout: 8000 })
  await page.locator('[data-walk="report-bug-thanks"]').waitFor({ timeout: 15000 })
  step('learner-sheet', { ok: true })
  // 2. Content flag, same account, QA mode in the player.
  await page.goto(`${BASE}/?qa_mode=true`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  const flag = page.locator('.qa-report-btn .flag-btn').first()
  const found = await flag.count()
  step('flag-button', { found })
  if (found) {
    await flag.tap({ timeout: 8000 })
    await page.waitForTimeout(4000)
    step('content-flag', { ok: true, via: 'button' })
  } else {
    await page.screenshot({ path: `${process.env.CS_SCRATCH}/677-no-flag.png` })
    step('content-flag', { ok: false, why: 'flag button not rendered on the home route in QA mode' })
  }
} catch (e) { step('learner-or-flag-failed', { e: String(e).slice(0, 300) }) }

// 3. Schools dashboard modal, as the test school's admin.
try {
  const page = await session('thomas.cassidy+chepstowtest-leader@gmail.com', `${BASE}/schools`)
  await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await page.locator('.user-trigger').first().tap({ timeout: 10000 })
  await page.locator('[data-walk="schools-report-bug"]').tap({ timeout: 8000 })
  await page.locator('[data-walk="schools-report-bug-happened"]').fill(`PROBE, not a real bug: job #677 round trip through the dashboard modal (${MARK}). Safe to ignore.`)
  await page.locator('[data-walk="schools-report-bug-send"]').tap({ timeout: 8000 })
  await page.locator('[data-walk="schools-report-bug-toast"]').waitFor({ timeout: 15000 })
  step('dashboard-modal', { ok: true })
} catch (e) { step('dashboard-failed', { e: String(e).slice(0, 300) }) }

await browser.close()
// Read back.
const r = await fetch(`${SB_URL}/rest/v1/bug_reports?select=id,source,account_code,reporter_email,platform_role,educational_role,school_role,school_id,course_code,app_version,deployment_env,context,posted_at,created_at&order=created_at.desc&limit=4`, { headers: H })
out.rows = await r.json()
console.log(JSON.stringify(out, null, 1))
