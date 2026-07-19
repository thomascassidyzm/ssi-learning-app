// Demo-refresh + OPEN-by-the-name walk on DEPLOYED dev (founder rulings
// 2026-07-19). Proves, against the real deployment with a real admin session:
//   1. BEFORE state: IME Demo Programme insights (stale tail) — screenshot.
//   2. POST /api/groups/:id/demo-refresh regenerates the subtree's telemetry
//      (learners touched, sessions written, DB freshness lands TODAY).
//   3. Guard: refresh on a NON-demo group is refused with 403.
//   4. AFTER state: insights re-screenshot — recent activity, honest headline.
//   5. OPEN affordance: /admin/structure at phone width — labeled Open pill
//      visible next to the name, no hover needed; tapping it opens node home.
//
//   EXPECT_BUILD=<sha7> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/demo-refresh-walk.mjs
//
// Screenshots land in docs/the-view/demo-refresh/ (committed as evidence).
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/demo-refresh/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const EXPECT = process.env.EXPECT_BUILD
if (EXPECT) {
  const { buildNumber } = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
  if (buildNumber !== EXPECT) { console.log(`FAIL — deploy gate: deployed=${buildNumber} expected=${EXPECT}`); process.exit(2) }
}

const IME_GROUP_ID = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a' // IME Demo Programme (is_demo)

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
const accessToken = v.session.access_token

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

async function imeLatestSession() {
  const { data: schools } = await svc.from('schools').select('id').eq('group_id', IME_GROUP_ID)
  const { data: classes } = await svc.from('classes').select('id').in('school_id', schools.map((s) => s.id))
  const { data: imeTags } = await svc.from('user_tags').select('user_id').in('tag_value', classes.map((c) => `CLASS:${c.id}`)).eq('role_in_context', 'student')
  const { data: learners } = await svc.from('learners').select('id').in('user_id', imeTags.map((t) => t.user_id)).eq('is_demo', true)
  const ids = learners.map((l) => l.id)
  let latest = null, total = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data: s } = await svc.from('sessions').select('started_at').in('learner_id', chunk).order('started_at', { ascending: false }).limit(1)
    const { count } = await svc.from('sessions').select('id', { count: 'exact', head: true }).in('learner_id', chunk)
    total += count ?? 0
    if (s?.[0] && (!latest || s[0].started_at > latest)) latest = s[0].started_at
  }
  return { latest, total, learners: ids.length }
}

const browser = await chromium.launch()
const desktop = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await desktop.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])

async function shot(ctx, path, name, readySel = '.niv-body, .nre-status, .rc, .nh-stats, .structure-tree') {
  const p = await ctx.newPage()
  await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector(readySel, { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(2000)
  await p.screenshot({ path: `${OUT}${name}.png`, fullPage: true })
  const body = await p.locator('body').innerText().catch(() => '')
  await p.close()
  return body
}

// ── 1. BEFORE ──
const before = await imeLatestSession()
console.log(`before: ${before.total} sessions across ${before.learners} learners, latest=${before.latest}`)
await shot(desktop, `/admin/groups/${IME_GROUP_ID}/analytics`, 'before-insights')

// ── 2. Refresh the IME Demo Programme via the deployed endpoint ──
const t0 = Date.now()
const resp = await fetch(`${BASE}/api/groups/${IME_GROUP_ID}/demo-refresh`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
})
const result = await resp.json().catch(() => ({}))
console.log(`refresh: HTTP ${resp.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s ::`, JSON.stringify(result))
check('refresh succeeds on the demo node', resp.ok && result.success === true)
check('learners touched > 0', (result.learnersTouched ?? 0) > 0, `${result.learnersTouched}`)
check('sessions written > 0', (result.sessionsWritten ?? 0) > 0, `${result.sessionsWritten}`)

// ── 3. Guard: a non-demo group must be refused ──
const { data: realGroup } = await svc.from('groups').select('id, name').eq('is_demo', false).limit(1)
if (realGroup?.[0]) {
  const guardResp = await fetch(`${BASE}/api/groups/${realGroup[0].id}/demo-refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  const guardBody = await guardResp.json().catch(() => ({}))
  check('non-demo node refused with 403', guardResp.status === 403, `${guardResp.status} ${guardBody.error || ''} (${realGroup[0].name})`)
}

// ── 4. DB freshness: latest session is TODAY ──
const after = await imeLatestSession()
console.log(`after: ${after.total} sessions, latest=${after.latest}`)
const today = new Date().toISOString().slice(0, 10)
check('latest demo session lands today', (after.latest || '').startsWith(today), after.latest)
check('replaced, not stacked (count same order of magnitude)', after.total > 0 && after.total < before.total * 4, `${before.total} → ${after.total}`)

// ── 5. AFTER screenshots ──
const insightsBody = await shot(desktop, `/admin/groups/${IME_GROUP_ID}/analytics`, 'after-insights')
check('insights view shows the programme', /IME Demo Programme/i.test(insightsBody))
await shot(desktop, `/admin/groups/${IME_GROUP_ID}`, 'after-node-home')

// School-level insights is where the demo cohort compares against its OWN
// programme peers (a demo node's global compare is honestly insufficient —
// real cohorts exclude demo by design). This must read ALIVE after refresh.
const SUNRISE_SCHOOL_ID = '2fd27c83-936f-4810-a88b-7d7b32315cee'
const schoolBody = await shot(desktop, `/admin/schools/${SUNRISE_SCHOOL_ID}/analytics`, 'after-school-insights')
check('school insights compares within the programme', /IME Demo Programme average/i.test(schoolBody))
check('school insights is not insufficient', !/Not enough data/i.test(schoolBody))

// ── 6. OPEN by the name on a phone viewport ──
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
await phone.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
{
  const p = await phone.newPage()
  await p.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.structure-row', { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(1500)
  const openBtns = p.locator('.structure-row .open-btn')
  const n = await openBtns.count()
  check('Open pill present on tree rows (phone width)', n > 0, `${n} rows`)
  if (n > 0) {
    const first = openBtns.first()
    check('Open pill is visible without hover', await first.isVisible())
    check('Open pill is labeled with the word Open', (await first.innerText()).trim() === 'Open')
    const box = await first.boundingBox()
    check('Open pill tap target ≥ 32px tall', !!box && box.height >= 32, `${box?.height}px`)
  }
  await p.screenshot({ path: `${OUT}open-by-name-phone.png`, fullPage: false })
  // Tapping Open lands on node home
  if (n > 0) {
    await openBtns.first().click()
    await p.waitForTimeout(2500)
    check('tapping Open navigates to a node dashboard', /\/admin\/(groups|schools)\//.test(p.url()), p.url())
    await p.screenshot({ path: `${OUT}open-tapped-node-home-phone.png`, fullPage: false })
  }
  await p.close()
}

await browser.close()
console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
