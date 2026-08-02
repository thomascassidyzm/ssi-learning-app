// INSIGHTS DEFAULT-COURSE verify — 2026-07-20 (founder rule: at ANY node, ANY
// mount, the course selector defaults to the node's busiest course by RECENT
// ACTIVITY, preferring one whose compare cohort clears the k-floor; dataless
// courses are flagged in the dropdown; a dark node names WHY).
//
// Verifies on DEPLOYED dev, read-only (NO demo-refresh — founder is mid-demo):
//   1. API · Coastal Districts Region opens ALIVE on an active course.
//   2. API · option ordering + hasData flags; dataless explicit pick stays
//      honest+named; window switch never re-defaults the course.
//   3. UI · admin mount /admin/groups/:id/analytics — alive, screenshot.
//   4. UI · leader mount /org/:id/insights (fresh personal leader
//      link on Coastal) — alive, window chips don't reset the course.
//
//   BASE_URL=<deployment> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/insights-default-course-verify.mjs   (from packages/player-vue)
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = '/tmp/insights-default-fix/'
mkdirSync(OUT, { recursive: true })

const PROGRAMME = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a' // IME Demo Programme
const PILOT = 'd01926e1-b1f4-4e3f-bae5-f03f2dbe15c9'     // Pilot Districts Region
const COASTAL = '652bd018-4b84-477e-8e06-676d5d6a7630'   // Coastal Districts Region

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]

const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const adminToken = v.session.access_token

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const api = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${adminToken}` } })
  return r.json().catch(() => ({}))
}

// ── 0. Wait for the deploy: the new response carries hasData on courses ──
let ready = false
for (let i = 0; i < 40 && !ready; i++) {
  const j = await api(`/api/groups/${COASTAL}/rate-compare`)
  if (j?.options?.courses?.length && j.options.courses[0].hasData !== undefined) ready = true
  else { process.stdout.write(`waiting for deploy (${i})…\r`); await new Promise((r) => setTimeout(r, 15000)) }
}
check('deploy carries the new course census (hasData present)', ready)
if (!ready) process.exit(1)

// ── 1. Every demo node opens ALIVE on an active course ──
const nodes = [['Coastal region', COASTAL], ['Pilot region', PILOT], ['Programme', PROGRAMME]]
const home = await api(`/api/groups/${COASTAL}/home`)
const schoolChild = (home.children || []).find((c) => c.hasSchool || c.commercial || c.label === 'school')
if (schoolChild) nodes.push([`Coastal school "${schoolChild.name}"`, schoolChild.id])

let coastalDefault = null
for (const [name, id] of nodes) {
  const j = await api(`/api/groups/${id}/rate-compare`)
  const applied = j?.applied?.course_code
  const opt = (j?.options?.courses || []).find((c) => c.code === applied)
  const alive = j.insufficientData === false && (j.cohortSize ?? 0) >= 1
  check(`${name} · opens alive on an ACTIVE course`, alive && opt?.hasData === true,
    `course=${applied} hasData=${opt?.hasData} insufficient=${j.insufficientData} cohort=${j.cohortSize} reason="${j.reason || ''}"`)
  const flags = (j?.options?.courses || []).map((c) => c.hasData)
  const sorted = flags.every((f, i) => i === 0 || !(f === true && flags[i - 1] === false))
  check(`${name} · dropdown sorted active-first`, sorted, JSON.stringify(j?.options?.courses))
  if (id === COASTAL) coastalDefault = { applied, courses: j?.options?.courses || [] }
}

// ── 2. Dataless explicit pick stays honest + named; window never re-defaults ──
const dataless = coastalDefault.courses.find((c) => c.hasData === false)
if (dataless) {
  const j = await api(`/api/groups/${COASTAL}/rate-compare?course_code=${dataless.code}`)
  // the pick is honoured; the compare may ladder to a live global comparison,
  // or land on a NAMED (never generic) empty state
  check('explicit dataless pick honoured, never the generic empty state',
    j.applied.course_code === dataless.code
      && (j.insufficientData === false || (j.reason && j.reason !== 'Not enough data to compare fairly yet.')),
    `insufficient=${j.insufficientData} reason="${j.reason || ''}"`)
} else {
  console.log('note: Coastal currently offers no dataless course to explicit-pick (all active)')
}
for (const w of ['today', '7d', 'all']) {
  const j = await api(`/api/groups/${COASTAL}/rate-compare?window=${w}`)
  check(`window=${w} · default course unchanged`, j.applied.course_code === coastalDefault.applied,
    `got ${j.applied.course_code}, expected ${coastalDefault.applied}`)
  const jp = await api(`/api/groups/${COASTAL}/rate-compare?window=${w}&course_code=${coastalDefault.applied}`)
  check(`window=${w} · pinned course honoured`, jp.applied.course_code === coastalDefault.applied)
}

// ── 3. UI · ADMIN mount ──
const browser = await chromium.launch()
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await adminCtx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
{
  const p = await adminCtx.newPage()
  await p.goto(`${BASE}/admin/groups/${COASTAL}/analytics`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.nre-widget-card', { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(2000)
  const body = await p.locator('body').innerText().catch(() => '')
  await p.screenshot({ path: `${OUT}admin-coastal-insights.png`, fullPage: true })
  check('ADMIN mount · Coastal insights alive (no empty state)',
    !/Not enough data|No practice recorded|no other|a fair comparison needs/i.test(body) && /Compare to/i.test(body))
  await p.close()
}

// ── 4. UI · LEADER mount (/org/:id/insights) via fresh personal link ──
const mintResp = await fetch(`${BASE}/api/groups/${COASTAL}/invites`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ role: 'leader', limits: {}, personal: { name: 'Insights Verify Probe' } }),
})
const mint = await mintResp.json()
check('minted a fresh Coastal leader link', mintResp.ok && !!mint.url, mint.code || mint.error)
if (mintResp.ok) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const p = await ctx.newPage()
  await p.goto(mint.url.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(6000)
  // the human path: the node-home "See insights" verb (a raw goto races the
  // shell's post-redemption landing navigation)
  await p.locator('a, button', { hasText: 'See insights' }).first().click({ timeout: 20000 }).catch(() => {})
  await p.waitForSelector('.nre-widget-card', { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(2000)
  let body = await p.locator('body').innerText().catch(() => '')
  await p.screenshot({ path: `${OUT}leader-coastal-insights.png`, fullPage: true })
  check('LEADER mount · Coastal insights alive (no empty state)',
    !/Not enough data|No practice recorded|no other|a fair comparison needs/i.test(body) && /Compare to/i.test(body))

  // window chip switch must NOT reset the course select
  const courseBefore = await p.locator('.nre-field-wide .frost-select, .nre-field-wide').first().innerText().catch(() => '')
  const chip = p.locator('button, [role=radio]', { hasText: 'Last 7 days' }).first()
  await chip.click({ timeout: 8000 }).catch(() => {})
  await p.waitForTimeout(3500)
  const courseAfter = await p.locator('.nre-field-wide .frost-select, .nre-field-wide').first().innerText().catch(() => '')
  body = await p.locator('body').innerText().catch(() => '')
  await p.screenshot({ path: `${OUT}leader-coastal-insights-7d.png`, fullPage: true })
  check('LEADER mount · window switch keeps the course', courseBefore.trim() !== '' && courseBefore === courseAfter,
    `before="${courseBefore.replaceAll('\n', ' ')}" after="${courseAfter.replaceAll('\n', ' ')}"`)
  await p.close()
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
