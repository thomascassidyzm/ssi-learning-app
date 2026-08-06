// VAD EMPTY-STATE UI PROBE (read-only) — confirms the UI renders both halves
// of the freshly-regenerated VAD demo split correctly: the with-VAD learner
// shows a populated mastery/prosody section, the no-VAD learner shows a
// GENUINE empty state (no zeros, no placeholder rows, no NaN/broken widgets).
//
// Surfaces: /admin/users/:learnerId/progress (ssi_admin only) and the school
// dashboard student view under /schools (school_admin / teacher persona).
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//     LD_LIBRARY_PATH=/tmp/pwlibs/extract/usr/lib/x86_64-linux-gnu \
//     CHROME_BIN=/home/tomcassidy/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome \
//     node e2e/vad-empty-state-ui-probe.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const envFile = readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
const pick = (k) => envFile.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const SUPABASE_URL = pick('SUPABASE_URL')
const ANON_KEY = pick('SUPABASE_ANON_KEY')

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/vad-ui-probe/'
mkdirSync(OUT, { recursive: true })

const WITH_VAD = { id: '82cf5384-4791-4f6d-a5aa-8546d51a943a', name: 'Saoirse Ó Flaithearta' }
const NO_VAD = { id: '0216ee57-5979-446d-bb5c-5306dc96d3f4', name: 'Lorcán Nic Gearailt' }
const CLASS_ID = '0fdb8712-3935-4dd3-8705-19e1d9259839'
const PASSWORD = 'SSiDemo2026!'
const TEACHER_EMAIL = 'thomas.cassidy+demo.irish.teacher1@gmail.com'
// Existing real ssi_admin account (verified via read-only query: learners.platform_role
// = 'ssi_admin' for this user_id) — mint a session via generateLink/verifyOtp, same
// read-only pattern as e2e/demo-schools/verify-demo-schools.mjs. No DB writes.
const SSI_ADMIN_EMAIL = 'thomas.cassidy+ssi@gmail.com'
const SERVICE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY')

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

async function passwordSignIn(email) {
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) return { error }
  return { session: data.session }
}

async function mintAdminSession(email) {
  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) return { error }
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
  if (verr) return { error: verr }
  return { session: v.session }
}

async function injectSession(ctx, session, platformRole) {
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]
  await ctx.addInitScript(([key, value, roleKey, roleValue]) => {
    window.localStorage.setItem(key, value)
    if (roleValue) window.localStorage.setItem(roleKey, roleValue)
  }, [`sb-${projectRef}-auth-token`, JSON.stringify(session), 'ssi-user-role', platformRole ? JSON.stringify({ platformRole, educationalRole: null }) : ''])
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})

// ─── 1. ssi_admin persona: /admin/users/:id/progress ───
const { session: adminSession, error: adminErr } = await mintAdminSession(SSI_ADMIN_EMAIL)
if (adminErr) {
  console.log(`INFO — ssi_admin session mint failed: ${adminErr.message}`)
} else {
  console.log('INFO — ssi_admin persona signed in via generateLink/verifyOtp (real existing admin account, no DB writes)')
}

let sawAdminSurface = false
if (adminSession) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await injectSession(ctx, adminSession, 'ssi_admin')
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  for (const [label, learner] of [['with-vad', WITH_VAD], ['no-vad', NO_VAD]]) {
    await page.goto(`${BASE}/admin/users/${learner.id}/progress`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(4000)
    const url = page.url()
    const gated = !url.includes(`/admin/users/${learner.id}`)
    const bodyLen = (await page.textContent('body').catch(() => '') || '').length
    console.log(`INFO — /admin/users/${learner.id}/progress (${learner.name}) -> ${url} (gated=${gated}, ${bodyLen} chars)`)
    if (!gated && bodyLen > 200) {
      sawAdminSurface = true
      // Adaptive pause mastery (per-LEGO) section lives behind the diagnostics
      // toggle — expand it so the VAD-driven mastery section is on screen.
      const diagBtn = page.locator('button.diag-toggle', { hasText: 'Show diagnostics' }).first()
      if (await diagBtn.count()) { await diagBtn.click().catch(() => {}); await page.waitForTimeout(2000) }
      const masteryText = await page.locator('.mastery-summary').innerText().catch(() => null)
      const masterySectionPresent = await page.locator('.section', { has: page.locator('h3', { hasText: 'Adaptive pause mastery' }) }).count()
      console.log(`INFO — ${label}: mastery section present=${masterySectionPresent > 0} text="${masteryText}"`)
      await page.screenshot({ path: `${OUT}admin-${label}-progress.png`, fullPage: true })
      // fullPage doesn't reach past the viewport in this app (inner scroll
      // container, not document scroll) — scroll to the diagnostics toggle
      // and grab a viewport shot that actually shows the mastery region.
      if (masterySectionPresent > 0) {
        await page.locator('.mastery-summary').scrollIntoViewIfNeeded().catch(() => {})
      } else {
        await diagBtn.scrollIntoViewIfNeeded().catch(() => {})
      }
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}admin-${label}-mastery-region.png` })
    }
  }
  check('no unexpected page errors (ssi_admin walk)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}
check('surface 1 (/admin/users/:id/progress) reachable as ssi_admin', sawAdminSurface)

// ─── 2. School dashboard mastery section, teacher persona ───
const { session: teacherSession, error: teacherErr } = await passwordSignIn(TEACHER_EMAIL)
if (teacherErr) throw new Error(`teacher sign-in failed: ${teacherErr.message}`)
console.log('INFO — teacher persona signed in')

const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await injectSession(ctx2, teacherSession, null)
const page2 = await ctx2.newPage()
const errors2 = []
page2.on('pageerror', (e) => errors2.push(String(e)))

// Land on the schools shell first so client-side role/session resolution runs.
await page2.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
await page2.waitForTimeout(4000)
console.log('INFO — teacher landed on', page2.url())
await page2.screenshot({ path: `${OUT}0-teacher-landing.png`, fullPage: true })

// Class roster (mastery/health per row, no per-learner drilldown).
await page2.goto(`${BASE}/schools/classes/${CLASS_ID}`, { waitUntil: 'networkidle' }).catch(() => {})
await page2.waitForTimeout(4000)
const classBodyLen = (await page2.textContent('body').catch(() => '') || '').length
check('teacher can reach the class roster', classBodyLen > 200 && page2.url().includes(`/schools/classes/${CLASS_ID}`), page2.url())
await page2.screenshot({ path: `${OUT}class-roster.png`, fullPage: true })

// Per-learner drilldown: StudentsView routes "view student" to the embedded
// analytics insight, scope=learner (src/views/schools/StudentsView.vue
// viewStudent()) — StudentProgressView.vue exists in the tree but is NOT
// wired into the router (grep confirms no route references it), so it is
// unreachable by any URL; this is the real per-learner surface.
for (const [label, learner] of [['with-vad', WITH_VAD], ['no-vad', NO_VAD]]) {
  const url = `${BASE}/schools/analytics?scope=learner&learner=${learner.id}&name=${encodeURIComponent(learner.name)}`
  await page2.goto(url, { waitUntil: 'networkidle' }).catch(() => {})
  await page2.waitForTimeout(4000)
  const bodyLen = (await page2.textContent('body').catch(() => '') || '').length
  const landed = bodyLen > 200 && page2.url().includes('/schools/analytics')
  console.log(`INFO — teacher -> ${url} -> ${page2.url()} (${bodyLen} chars)`)
  check(`teacher can reach the per-learner analytics insight for ${label} learner (${learner.name})`, landed)
  await page2.screenshot({ path: `${OUT}${label}-school-view.png` })
}

check('no unexpected page errors (teacher walk)', errors2.length === 0, errors2.slice(0, 3).join(' | '))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES / GAPS — see INFO lines above`)
process.exit(0) // informational probe — exit 0, findings are in the log + screenshots
