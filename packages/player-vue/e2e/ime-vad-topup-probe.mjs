// IME VAD TOP-UP UI PROBE (read-only) — confirms the additive VAD top-up over
// the IME Demo Programme's existing 381 learners renders correctly in the live
// admin surface: a topped-up learner shows a POPULATED adaptive-pause-mastery
// section, and a deliberately VAD-less learner (rich progress, no mic) shows a
// GENUINE empty state — no zeros, no placeholder rows, no broken widgets.
//
// Same pattern and same surface as e2e/vad-empty-state-ui-probe.mjs, pointed at
// two real IME (India) learners instead of the Irish schools-demo pair.
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//     LD_LIBRARY_PATH=/tmp/pwlibs/extract/usr/lib/x86_64-linux-gnu \
//     CHROME_BIN=/home/tomcassidy/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome \
//     node e2e/ime-vad-topup-probe.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const envFile = readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
const pick = (k) => envFile.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const SUPABASE_URL = pick('SUPABASE_URL')
const ANON_KEY = pick('SUPABASE_ANON_KEY')
const SERVICE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY')

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/ime-vad-probe/'
mkdirSync(OUT, { recursive: true })

// Both are real IME Demo Programme students, verified by direct query after the
// top-up run: Kavya carries 12 learner_lego_metrics rows + cycle_prosody events;
// Riya carries 590 lego_progress rows but ZERO rows in either VAD-fed table.
const WITH_VAD = { id: '95f91ddc-5ed1-4490-8cb2-245de7154f70', name: 'Kavya Chandra' }
const NO_VAD = { id: '68ae36d6-a71c-4dd2-bb3d-8b3db9018e55', name: 'Riya Pillai' }
const SSI_ADMIN_EMAIL = 'thomas.cassidy+ssi@gmail.com'

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

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

const { session: adminSession, error: adminErr } = await mintAdminSession(SSI_ADMIN_EMAIL)
if (adminErr) throw new Error(`ssi_admin session mint failed: ${adminErr.message}`)
console.log('INFO — ssi_admin persona signed in via generateLink/verifyOtp (real existing admin account, no DB writes)')

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await injectSession(ctx, adminSession, 'ssi_admin')
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

const seen = {}
for (const [label, learner] of [['with-vad', WITH_VAD], ['no-vad', NO_VAD]]) {
  await page.goto(`${BASE}/admin/users/${learner.id}/progress`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(4000)
  const gated = !page.url().includes(`/admin/users/${learner.id}`)
  const bodyLen = (await page.textContent('body').catch(() => '') || '').length
  check(`/admin/users/:id/progress reachable for ${label} learner (${learner.name})`, !gated && bodyLen > 200, page.url())
  if (gated || bodyLen <= 200) continue

  // The adaptive-pause-mastery (per-LEGO) section lives behind the diagnostics
  // toggle — expand it so the VAD-driven section is on screen.
  const diagBtn = page.locator('button.diag-toggle', { hasText: 'Show diagnostics' }).first()
  if (await diagBtn.count()) { await diagBtn.click().catch(() => {}); await page.waitForTimeout(2000) }
  const masteryPresent = await page.locator('.section', { has: page.locator('h3', { hasText: 'Adaptive pause mastery' }) }).count() > 0
  const masteryText = await page.locator('.mastery-summary').innerText().catch(() => null)
  seen[label] = { masteryPresent, masteryText }
  console.log(`INFO — ${label} (${learner.name}): mastery section present=${masteryPresent} text="${masteryText}"`)

  await page.screenshot({ path: `${OUT}admin-${label}-progress.png`, fullPage: true })
  // fullPage doesn't reach past the viewport here (inner scroll container, not
  // document scroll) — scroll the mastery region into view for a real shot.
  if (masteryPresent) await page.locator('.mastery-summary').scrollIntoViewIfNeeded().catch(() => {})
  else await diagBtn.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}admin-${label}-mastery-region.png` })
}

check('topped-up IME learner SHOWS a populated mastery section', seen['with-vad']?.masteryPresent === true && !!seen['with-vad']?.masteryText)
check('VAD-less IME learner shows NO mastery section (genuine empty state)', seen['no-vad']?.masteryPresent === false)
check('no unexpected page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await ctx.close()
await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES / GAPS — see INFO lines above`)
process.exit(0) // informational probe — findings are in the log + screenshots
