// THE MODEL — deployed-dev verification (docs/THE-MODEL.md §8 step 5).
// Real sessions against the DEPLOYED dev build; screenshots to docs/the-model/.
//
//   node --env-file=../../.env --env-file=../../.env.local e2e/the-model/verify-the-model.mjs
//
// Covers, end to end, on the live deployment:
//   1. deploy gate — version.json serves EXPECT_BUILD
//   2. admin: /admin/structure — tree, VISIBLE plain-word chips (the founder's
//      clipping bug), badge-not-select labels, verbs-first node panel, no
//      Invites nav tab (desktop + mobile screenshots)
//   3. live chain: create test group → mint teacher invite AT the node →
//      redeem with a fresh account → GROUP: tag written
//   4. demo-mint at the node — links-first response (leader /group/, learner /with/)
//   5. delete the minted subtree — the FK fix live (school/class/group delete)
//   6. teacher persona on /schools — classes + play-as-class present
//   7. groupless tutor — SAME shell, no bounce, create-class prompt, no play-as-class
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-model/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
if (!SB_URL || !SERVICE || !ANON) throw new Error('missing supabase env')
const svc = createClient(SB_URL, SERVICE)
const projectRef = new URL(SB_URL).hostname.split('.')[0]

const results = []
function step(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`)
}

// 1) deploy gate
const EXPECT = process.env.EXPECT_BUILD || 'eabb19a'
{
  const r = await fetch(`${BASE}/version.json`, { cache: 'no-store' })
  const { buildNumber } = await r.json()
  step('deploy gate: dev serves the candidate build', buildNumber === EXPECT, `deployed=${buildNumber} expected=${EXPECT}`)
  if (buildNumber !== EXPECT) process.exit(2)
}

async function mintSession(email) {
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`generateLink(${email}): ${error.message}`)
  const anon = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
  if (verr) throw new Error(`verifyOtp(${email}): ${verr.message}`)
  return v.session
}

const adminSession = await mintSession(process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com')
console.log('admin session ok', adminSession.user.id)
const authed = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })

const browser = await chromium.launch()
async function makePage(session, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    [`sb-${projectRef}-auth-token`, JSON.stringify(session)])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  return page
}

// ── 2) Structure surface, desktop ──
const page = await makePage(adminSession, { width: 1440, height: 1100 })
await page.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)

step('structure: tree renders', await page.locator('.groups-tree, .structure-layout').count() > 0, page.url())

// chips: all six, plain words, every one actually visible with a real box
{
  const chips = page.locator('.chip-group .chip')
  const n = await chips.count()
  const labels = []
  let allVisible = n === 6
  for (let i = 0; i < n; i++) {
    const c = chips.nth(i)
    labels.push((await c.innerText()).trim())
    const box = await c.boundingBox()
    if (!box || box.height < 20 || !(await c.isVisible())) allVisible = false
  }
  const expected = ['All', 'Groups', 'Schools', 'Trial', 'Paid', 'Demo']
  step('chips: six plain-word filters', JSON.stringify(labels) === JSON.stringify(expected), labels.join('/'))
  step('chips: every chip fully visible (founder clipping bug dead)', allVisible)
  // the chip row must sit clear of the panel below it (no overlap)
  const groupBox = await page.locator('.chip-group').boundingBox()
  const panelBox = await page.locator('.structure-panel').first().boundingBox()
  step('chips: row sits clear above the organisations panel',
    !!groupBox && !!panelBox && groupBox.y + groupBox.height <= panelBox.y + 1,
    groupBox && panelBox ? `chipsBottom=${Math.round(groupBox.y + groupBox.height)} panelTop=${Math.round(panelBox.y)}` : 'missing boxes')
}

// tree rows: quiet badges, not permanently-open selects
{
  const openSelects = await page.locator('.tree-node select, .groups-tree select').count()
  const badges = await page.locator('.label-badge').count()
  step('tree: labels are badges, no always-open selects', openSelects === 0 && badges > 0, `selects=${openSelects} badges=${badges}`)
}

// nav: Invites demoted
step('nav: no Invites tab', await page.locator('.tabs a.tab:has-text("Invites")').count() === 0)

await page.screenshot({ path: `${OUT}structure-desktop.png` })

// node panel: verbs on top
{
  await page.locator('.structure-name').first().click().catch(() => {})
  await page.waitForTimeout(800)
  const verbs = page.locator('.verb-row .verb-btn')
  const verbCount = await verbs.count()
  const verbText = verbCount ? (await page.locator('.verb-row').innerText()).replace(/\s+/g, ' ') : ''
  step('node panel: verbs on top', verbCount >= 3, verbText.slice(0, 120))
  await page.screenshot({ path: `${OUT}structure-node-panel.png` })
}

// mobile
{
  const m = await makePage(adminSession, { width: 390, height: 844 })
  await m.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
  await m.waitForTimeout(2500)
  const chips = m.locator('.chip-group .chip')
  let mobileVisible = (await chips.count()) === 6
  for (let i = 0; i < (await chips.count()); i++) {
    const box = await chips.nth(i).boundingBox()
    if (!box || box.height < 20) mobileVisible = false
  }
  step('mobile: chips visible', mobileVisible)
  await m.screenshot({ path: `${OUT}structure-mobile.png` })
  await m.context().close()
}

// ── 3) live chain: group → invite at node → redeem → GROUP tag ──
const token = adminSession.access_token
const ts = Date.now().toString(36)
let testGroupId = null
let demoChildGroupId = null
{
  const r = await fetch(`${BASE}/api/groups`, {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({ name: `THE-MODEL verify ${ts}`, label: 'group', is_demo: true }),
  })
  const j = await r.json().catch(() => ({}))
  testGroupId = j.group?.id || j.id || null
  step('chain: test group born in the tree', r.ok && !!testGroupId, `status=${r.status} id=${testGroupId}`)
}

let inviteCode = null
if (testGroupId) {
  const r = await fetch(`${BASE}/api/groups/${testGroupId}/invites`, {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({ role: 'teacher', limits: { max_uses: 2 } }),
  })
  const j = await r.json().catch(() => ({}))
  inviteCode = j.code || j.invite?.code || null
  step('chain: teacher invite minted AT the node', r.ok && !!inviteCode, `status=${r.status} code=${inviteCode}`)
}

let probeTeacher = null
if (inviteCode) {
  probeTeacher = await mintSession(`themodel.teacher.${ts}@gmail.com`)
  const r = await fetch(`${BASE}/api/code/redeem`, {
    method: 'POST', headers: authed(probeTeacher.access_token),
    body: JSON.stringify({ code: inviteCode, codeKind: 'invite' }),
  })
  const j = await r.json().catch(() => ({}))
  step('chain: fresh account redeems the group invite', r.ok, `status=${r.status} ${JSON.stringify(j).slice(0, 120)}`)
  const { data: tags } = await svc.from('user_tags').select('tag_type, tag_value, role_in_context')
    .eq('user_id', probeTeacher.user.id).is('removed_at', null)
  const hasGroupTag = (tags || []).some(t => t.tag_type === 'group' && t.tag_value === `GROUP:${testGroupId}` && t.role_in_context === 'teacher')
  step('chain: GROUP: teacher tag written (interior-node affiliation live)', hasGroupTag, JSON.stringify(tags))
}

// ── 4) demo-mint at the node, links-first ──
if (testGroupId) {
  const r = await fetch(`${BASE}/api/groups/${testGroupId}/demo-mint`, {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({ name: `THE-MODEL demo ${ts}`, shape: 'school', course_code: 'spa_for_eng_v2' }),
  })
  const j = await r.json().catch(() => ({}))
  demoChildGroupId = j.group_id || null
  const links = j.links || []
  const leader = links.find(l => l.role === 'leader')
  const student = links.find(l => l.role === 'student')
  step('demo-mint: one gesture at the node succeeds', r.ok && !!demoChildGroupId, `status=${r.status}`)
  step('demo-mint: links-first response (leader /group/, learner /with/)',
    !!leader?.url?.includes('/group/') && !!student?.url?.includes('/with/'),
    links.map(l => `${l.role}:${l.url}`).join(' '))
}

// ── 5) delete the minted subtree — FK fix live ──
if (demoChildGroupId) {
  const r = await fetch(`${BASE}/api/groups/${demoChildGroupId}`, { method: 'DELETE', headers: authed(token) })
  step('delete: demo child (school+class+codes) deletes clean — FK fix live', r.ok, `status=${r.status}`)
}
if (testGroupId) {
  const r = await fetch(`${BASE}/api/groups/${testGroupId}`, { method: 'DELETE', headers: authed(token) })
  step('delete: test group deletes clean', r.ok, `status=${r.status}`)
}

// ── 6) teacher persona: /schools with classes + play-as-class ──
{
  const teacher = await mintSession('thomas.cassidy+ang_school_teacher@gmail.com')
  const t = await makePage(teacher, { width: 1280, height: 900 })
  await t.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
  await t.waitForTimeout(3500)
  const body = (await t.locator('body').innerText()).replace(/\s+/g, ' ')
  const hasDash = await t.locator('.dashboard-view, main.dashboard').count() > 0
  step('teacher: lands in the schools dashboard', hasDash, t.url())
  const hasPlay = /play as class|▶/i.test(body) || (await t.locator('[class*="play"]').count()) > 0
  step('teacher: play-as-class affordance present (has classes)', hasPlay)
  await t.screenshot({ path: `${OUT}teacher-dashboard.png` })
  await t.context().close()
}

// ── 7) teacher WITHOUT class (the redeemed group-invite teacher): prompt, no play-as-class ──
if (probeTeacher) {
  const t = await makePage(probeTeacher, { width: 1280, height: 900 })
  await t.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
  await t.waitForTimeout(3500)
  const hasDash = await t.locator('.dashboard-view, main.dashboard').count() > 0
  step('teacher-no-class: lands in the schools shell', hasDash, t.url())
  const body = (await t.locator('body').innerText()).replace(/\s+/g, ' ')
  step('teacher-no-class: teaching empty state (create/join a class)', /no classes yet|create (one|a class)|first class/i.test(body))
  step('teacher-no-class: play-as-class absent', !/play as class/i.test(body))
  await t.screenshot({ path: `${OUT}teacher-no-class.png` })
  await t.context().close()
}

// ── 8) groupless tutor via the REAL provisioning path: same shell, class visible ──
{
  const tutorSession = await mintSession(`themodel.tutor.${ts}@gmail.com`)
  const r = await fetch(`${BASE}/api/onboarding/provision`, {
    method: 'POST', headers: authed(tutorSession.access_token),
    body: JSON.stringify({ track: 'tutor', course_code: 'spa_for_eng_v2' }),
  })
  step('tutor: real provisioning succeeds', r.ok, `status=${r.status}`)
  const t = await makePage(tutorSession, { width: 1280, height: 900 })
  await t.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
  await t.waitForTimeout(3500)
  const url = t.url()
  const bounced = /no.?access/i.test(await t.locator('body').innerText()) || /tutors\/dashboard/.test(url)
  const hasDash = await t.locator('.dashboard-view, main.dashboard').count() > 0
  step('tutor: SAME schools shell, no bounce (dissolution live)', hasDash && !bounced, url)
  const body = (await t.locator('body').innerText()).replace(/\s+/g, ' ')
  step('tutor: their class is visible in the shell', /class/i.test(body) && !/no.?access/i.test(body))
  await t.screenshot({ path: `${OUT}tutor-dashboard.png` })
  await t.context().close()
}
if (probeTeacher) {
  await svc.from('user_tags').delete().eq('user_id', probeTeacher.user.id)
  await svc.from('learners').delete().eq('user_id', probeTeacher.user.id)
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILED:', failed.map(f => f.name).join(' | ')); process.exit(1) }
