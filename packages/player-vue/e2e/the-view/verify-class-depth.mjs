// THE VIEW — class depth + learner-page death + groups-in-place:
// deployed-dev verification (founder rulings 2026-07-19).
// Real admin session against the DEPLOYED dev build; screenshots to docs/the-view/.
//
//   node --env-file=../../.env --env-file=../../.env.local e2e/the-view/verify-class-depth.mjs
//
// Covers, live:
//   1. deploy gate — version.json serves EXPECT_BUILD
//   2. org node home renders; drilling org → child keeps the MAP RAIL's DOM
//      element alive (instance reuse — the continuity ruling, not a repaint)
//   3. drilling on to a CLASS keeps the same surface too (same container pair)
//   4. class home carries the teaching density: belts on student rows, LEGOs
//      counts, Course journey / Belt distribution / benchmark cards
//   5. clicking a student expands IN PLACE (journey/streak/last-7-days),
//      URL unchanged — the individual learner page is dead
//   6. /admin/users/:id/progress redirects (no 404, no dead page)
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/', import.meta.url).pathname
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
const EXPECT = process.env.EXPECT_BUILD
if (!EXPECT) throw new Error('set EXPECT_BUILD=<short sha>')
{
  const r = await fetch(`${BASE}/version.json`, { cache: 'no-store' })
  const { buildNumber } = await r.json()
  step('deploy gate: dev serves the candidate build', buildNumber === EXPECT, `deployed=${buildNumber} expected=${EXPECT}`)
  if (buildNumber !== EXPECT) process.exit(2)
}

// Pick real data: the class with the most student-progress rows, then walk up
// to its school node and that node's parent group (the drill path org→class).
const { data: csp } = await svc.from('class_student_progress').select('class_id')
const byClass = new Map()
for (const r of csp ?? []) byClass.set(r.class_id, (byClass.get(r.class_id) || 0) + 1)
const candidates = [...byClass.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
if (!candidates.length) throw new Error('no class with students found')
// Prefer a class whose school node has a PARENT group, so the drill can start
// one level above the school (org → school → class).
let cls, school, schoolNodeId, parentGroupId
for (const cid of candidates.slice(0, 12)) {
  const { data: c } = await svc.from('classes').select('id, class_name, school_id').eq('id', cid).single()
  if (!c?.school_id) continue
  const { data: s } = await svc.from('schools').select('id, school_name, node_group_id, group_id').eq('id', c.school_id).single()
  if (!s?.node_group_id) continue
  const { data: node } = await svc.from('groups').select('id, parent_id').eq('id', s.node_group_id).single()
  const parent = node?.parent_id || s.group_id
  if (!cls) { cls = c; school = s; schoolNodeId = s.node_group_id; parentGroupId = parent }
  if (parent) { cls = c; school = s; schoolNodeId = s.node_group_id; parentGroupId = parent; break }
}
if (!cls) throw new Error('no usable class found')
const classId = cls.id
console.log(`data: class=${cls.class_name} (${byClass.get(classId)} students) school=${school.school_name} node=${schoolNodeId} parent=${parentGroupId}`)
const START = parentGroupId || schoolNodeId

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

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(adminSession)])
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

// ── 2) org node home + rail-alive drill to the school node ──
await page.goto(`${BASE}/admin/groups/${START}`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForSelector('.map-rail', { timeout: 20000 })
await page.waitForTimeout(1200)
step('org node home renders (rail + identity + stats)',
  (await page.locator('.map-rail').count()) === 1 && (await page.locator('.identity-name').count()) === 1 && (await page.locator('.stat-card').count()) >= 4)
await page.screenshot({ path: `${OUT}drill-1-org.png` })

// Tag the rail's live DOM element, drill into the school node via the rail,
// and prove the SAME element is still on the page afterwards.
if (parentGroupId) {
  await page.evaluate(() => { window.__railEl = document.querySelector('.map-rail') })
  await page.locator(`.rail-row.is-child .rail-link`).filter({ hasText: school.school_name }).first().click()
    .catch(async () => { await page.locator('.rail-row.is-child .rail-link').first().click() })
  await page.waitForTimeout(2500)
  const railAliveAfterSchool = await page.evaluate(() => document.querySelector('.map-rail') === window.__railEl)
  step('CONTINUITY: org → school drill keeps the SAME rail element mounted (no repaint)', railAliveAfterSchool, page.url())
  await page.screenshot({ path: `${OUT}drill-2-school.png` })
} else {
  step('CONTINUITY: org → school drill', true, 'skipped — school node has no parent group in this dataset')
}

// ── 3) drill on to the class — still the same surface ──
const classViaUi = await (async () => {
  // go back to the school node and click the class row in the children list
  await page.goto(`${BASE}/admin/groups/${schoolNodeId}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForSelector('.map-rail', { timeout: 20000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => { window.__railEl3 = document.querySelector('.map-rail') })
  // The class is reached through the "All classes" lens — a filter over the
  // one view, then its row opens the class home in the same surface.
  await page.locator('.chip').filter({ hasText: 'All classes' }).first().click()
  await page.waitForTimeout(2000)
  const row = page.locator('.child-btn').filter({ hasText: cls.class_name }).first()
  if (await row.count()) await row.click()
  else if (await page.locator('.child-btn').count()) await page.locator('.child-btn').first().click()
  else return { ok: false, why: 'no class row found under the All classes lens' }
  await page.waitForTimeout(2500)
  const alive = await page.evaluate(() => document.querySelector('.map-rail') === window.__railEl3)
  return { ok: alive, why: page.url() }
})()
step('CONTINUITY: school → class drill keeps the SAME rail element mounted', classViaUi.ok, classViaUi.why)

// ── 4) class teaching density ──
await page.waitForSelector('.identity-name', { timeout: 20000 })
const text = (await page.locator('.node-home').innerText()).replace(/\s+/g, ' ')
step('class home: belts on student rows', (await page.locator('.child-belt .belt-dot').count()) > 0)
step('class home: LEGOs count column', /LEGOs/i.test(text))
step('class home: Course journey card', /Course journey/i.test(text))
step('class home: Belt distribution card', /Belt distribution/i.test(text))
step('class home: practice benchmark card', /Practice min\/student\/week/i.test(text))
await page.screenshot({ path: `${OUT}drill-3-class-teaching-data.png`, fullPage: true })

// ── 5) student expands IN PLACE ──
const urlBefore = page.url()
await page.locator('.child-btn').first().click()
await page.waitForTimeout(600)
const detail = page.locator('.child-detail')
step('student row expands in place (no navigation)', (await detail.count()) === 1 && page.url() === urlBefore, page.url())
const dText = (await detail.count()) ? (await detail.innerText()).replace(/\s+/g, ' ') : ''
step('expansion carries journey + streak + last-7-days', /Streak/i.test(dText) && /Last 7 days/i.test(dText) && /Course journey/i.test(dText), dText.slice(0, 120))
await page.screenshot({ path: `${OUT}drill-4-student-expanded.png`, fullPage: true })

// ── 6) the learner page is dead but never 404s ──
const { data: anyLearner } = await svc.from('learners').select('id').limit(1).single()
await page.goto(`${BASE}/admin/users/${anyLearner.id}/progress`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(1500)
const landed = page.url()
step('learner-page URL redirects to the user admin page (no 404)',
  landed.includes(`/admin/users/${anyLearner.id}`) && !landed.includes('/progress'), landed)

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
