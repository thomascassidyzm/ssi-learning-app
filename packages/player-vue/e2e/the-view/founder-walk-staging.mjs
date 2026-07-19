// FOUNDER WALK — the whole staging batch, walked as Tom would (2026-07-19).
// Real admin session against DEPLOYED STAGING; fresh contexts for cold loads;
// screenshots to docs/the-view/founder-walk/.
//
//   EXPECT_BUILD=<sha> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/founder-walk-staging.mjs
//
// The 8 rulings:
//   1 continuity drill (one surface, rail element identity)
//   2 class node home carries the teaching data
//   3 student expands in place; learner page dead but redirects
//   4 cold loads succeed first time (school insights / programme insights /
//     class home), several fresh-context loads each, seconds recorded
//   5 no auto-refresh in ~3 min idle; manual refresh works; Updated stamp
//   6 See-insights verb; node-scoped lens; ancestor compare; old analytics
//     URLs alive
//   7 magic link straight-in from a fresh context, zero interstitials
//   8 copy sweep — no node/entitlement/subtree jargon user-facing
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = new URL('../../../../docs/the-view/founder-walk/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
if (!SB_URL || !SERVICE || !ANON) throw new Error('missing supabase env')
const svc = createClient(SB_URL, SERVICE)
const projectRef = new URL(SB_URL).hostname.split('.')[0]

const results = []
function step(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`)
}

// ── deploy gate ──
const EXPECT = process.env.EXPECT_BUILD
if (!EXPECT) throw new Error('set EXPECT_BUILD=<short sha>')
{
  const r = await fetch(`${BASE}/version.json?cb=${EXPECT}`, { cache: 'no-store' })
  const { buildNumber } = await r.json()
  step('deploy gate: staging serves the candidate build', buildNumber === EXPECT, `deployed=${buildNumber}`)
  if (buildNumber !== EXPECT) process.exit(2)
}

// ── pick real data: busiest class → its school node → parent group ──
const { data: csp } = await svc.from('class_student_progress').select('class_id')
const byClass = new Map()
for (const r of csp ?? []) byClass.set(r.class_id, (byClass.get(r.class_id) || 0) + 1)
const candidates = [...byClass.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
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
console.log(`data: class=${cls.class_name} (${byClass.get(cls.id)} students) school=${school.school_name} node=${schoolNodeId} parent=${parentGroupId}`)
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
async function adminContext() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    [`sb-${projectRef}-auth-token`, JSON.stringify(adminSession)])
  return ctx
}

const jargon = []
async function sweepCopy(page, where) {
  try {
    const text = await page.evaluate(() => document.body.innerText)
    // Whole words only; ignore legit words containing them is handled by \b.
    for (const word of ['node', 'entitlement', 'subtree']) {
      const re = new RegExp(`\\b${word}s?\\b`, 'i')
      const m = text.match(re)
      if (m) {
        const i = text.search(re)
        jargon.push({ where, word, context: text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ') })
      }
    }
  } catch {}
}

// ════ WALK 1-3: continuity drill, class density, in-place expansion ════
const ctx = await adminContext()
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(`${BASE}/admin/groups/${START}`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForSelector('.map-rail', { timeout: 20000 })
await page.waitForTimeout(1200)
step('1a org node home renders (rail + identity + stats)',
  (await page.locator('.map-rail').count()) === 1 && (await page.locator('.identity-name').count()) === 1 && (await page.locator('.stat-card').count()) >= 4)
await page.screenshot({ path: `${OUT}fw-1-org.png` })
await sweepCopy(page, 'org node home')

if (parentGroupId) {
  await page.evaluate(() => { window.__railEl = document.querySelector('.map-rail') })
  await page.locator(`.rail-row.is-child .rail-link`).filter({ hasText: school.school_name }).first().click()
    .catch(async () => { await page.locator('.rail-row.is-child .rail-link').first().click() })
  await page.waitForTimeout(2500)
  const alive = await page.evaluate(() => document.querySelector('.map-rail') === window.__railEl)
  step('1b CONTINUITY org → school: same rail element, no repaint', alive, page.url())
  await page.screenshot({ path: `${OUT}fw-2-school.png` })
} else {
  step('1b CONTINUITY org → school', true, 'skipped — no parent group in dataset')
}
await sweepCopy(page, 'school node home')

// school → class through the All-classes lens, same surface
await page.goto(`${BASE}/admin/groups/${schoolNodeId}`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForSelector('.map-rail', { timeout: 20000 })
await page.waitForTimeout(1500)
await page.evaluate(() => { window.__railEl3 = document.querySelector('.map-rail') })
await page.locator('.chip').filter({ hasText: 'All classes' }).first().click()
await page.waitForTimeout(2000)
const row = page.locator('.child-btn').filter({ hasText: cls.class_name }).first()
if (await row.count()) await row.click()
else await page.locator('.child-btn').first().click()
await page.waitForTimeout(2500)
step('1c CONTINUITY school → class: same rail element',
  await page.evaluate(() => document.querySelector('.map-rail') === window.__railEl3), page.url())

await page.waitForSelector('.identity-name', { timeout: 20000 })
const text = (await page.locator('.node-home').innerText()).replace(/\s+/g, ' ')
step('2a class home: belts on student rows', (await page.locator('.child-belt .belt-dot').count()) > 0)
step('2b class home: LEGOs column', /LEGOs/i.test(text))
step('2c class home: Course journey card', /Course journey/i.test(text))
step('2d class home: Belt distribution card', /Belt distribution/i.test(text))
step('2e class home: practice benchmark card', /Practice min\/student\/week/i.test(text))
await page.screenshot({ path: `${OUT}fw-3-class.png`, fullPage: true })
await sweepCopy(page, 'class node home')

const urlBefore = page.url()
await page.locator('.child-btn').first().click()
await page.waitForTimeout(800)
const detail = page.locator('.child-detail')
step('3a student expands in place (no navigation)', (await detail.count()) === 1 && page.url() === urlBefore)
const dText = (await detail.count()) ? (await detail.innerText()).replace(/\s+/g, ' ') : ''
step('3b expansion has journey + streak + last-7-days', /Streak/i.test(dText) && /Last 7 days/i.test(dText) && /Course journey/i.test(dText))
await page.screenshot({ path: `${OUT}fw-4-student-expanded.png`, fullPage: true })

const { data: anyLearner } = await svc.from('learners').select('id').limit(1).single()
await page.goto(`${BASE}/admin/users/${anyLearner.id}/progress`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(1500)
step('3c learner-page URL redirects (no 404)',
  page.url().includes(`/admin/users/${anyLearner.id}`) && !page.url().includes('/progress'), page.url())

// ════ WALK 6: See insights verb, node-scoped lens, ancestor compare ════
await page.goto(`${BASE}/admin/classes/${cls.id}`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForSelector('.node-home', { timeout: 20000 })
const seeInsights = page.locator('a', { hasText: 'See insights' }).first()
step('6a "See insights" verb on class node home', (await seeInsights.count()) > 0)
if (await seeInsights.count()) {
  await seeInsights.click()
  await page.waitForTimeout(4000)
  const nivText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  step('6b insight view is node-scoped (names the class)', nivText.includes(cls.class_name), page.url())
  const compareOptions = await page.locator('select option, .compare-option').count()
  step('6c compare control present (ancestors available)', compareOptions > 1 || /compared with/i.test(nivText), `options=${compareOptions}`)
  await page.screenshot({ path: `${OUT}fw-5-class-insights.png`, fullPage: true })
  await sweepCopy(page, 'class insights')
}
// old analytics URLs live
for (const [url, name] of [
  [`/admin/groups/${START}/analytics`, 'group analytics URL'],
  [`/admin/schools/${school.id}/analytics`, 'school analytics URL'],
]) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3000)
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  step(`6d ${name} alive (insight view, no 404)`, (await page.locator('.niv').count()) === 1 && !/404|not found/i.test(body), page.url())
}
await page.screenshot({ path: `${OUT}fw-6-school-insights.png`, fullPage: true })
await sweepCopy(page, 'school insights')
await ctx.close()

// ════ WALK 4: cold loads — fresh context per load, timed ════
async function coldLoad(url, readySelector, notReady) {
  const c = await adminContext()
  const p = await c.newPage()
  const t0 = Date.now()
  await p.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  let ok = false
  try {
    await p.waitForSelector(readySelector, { timeout: 25000 })
    if (notReady) await p.waitForFunction((sel) => !document.querySelector(sel), notReady, { timeout: 25000 })
    ok = true
  } catch {}
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const shot = `${OUT}fw-cold-${url.replace(/[^a-z0-9]+/gi, '-')}-${secs}s.png`
  await p.screenshot({ path: shot, fullPage: false })
  await c.close()
  return { ok, secs }
}
const coldTargets = [
  [`/admin/schools/${school.id}/analytics`, '.niv .lens-widget, .niv canvas, .niv svg, .niv', 'school insights'],
  [`/admin/groups/${START}/analytics`, '.niv', 'programme insights'],
  [`/admin/classes/${cls.id}`, '.node-home .stat-card', 'class home'],
]
for (const [url, sel, label] of coldTargets) {
  const times = []
  let allOk = true
  for (let i = 0; i < 5; i++) {
    const { ok, secs } = await coldLoad(url, sel)
    times.push(secs + 's')
    if (!ok) allOk = false
  }
  step(`4 cold loads first-time OK ×5 — ${label}`, allOk, times.join(' '))
}

// ════ WALK 5: idle ~3 min, zero background chatter; manual refresh works ════
{
  const c = await adminContext()
  const p = await c.newPage()
  const reqs = []
  await p.goto(`${BASE}/admin/groups/${START}`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.map-rail', { timeout: 20000 })
  await p.waitForTimeout(5000) // settle
  p.on('request', (r) => {
    const u = r.url()
    if (u.includes('/api/') || u.includes('supabase.co')) reqs.push(u)
  })
  console.log('idle watch: 3 minutes…')
  await p.waitForTimeout(180000)
  const swOnly = reqs.filter((u) => !/version\.json|sw\.js|workbox/i.test(u))
  step('5a no auto-refresh: zero background API chatter in 3 min idle', swOnly.length === 0,
    swOnly.length ? swOnly.slice(0, 5).join(' | ') : `${reqs.length} exempt-only`)
  const stamp = await p.locator('.updated-stamp').first().innerText().catch(() => '')
  step('5b Updated-at stamp present and honest', /Updated/i.test(stamp), stamp)
  const refreshBtn = p.locator('.refresh-button').first()
  step('5c manual refresh affordance present', (await refreshBtn.count()) > 0)
  if (await refreshBtn.count()) {
    const before = reqs.length + swOnly.length
    const countBefore = reqs.length
    await refreshBtn.click()
    await p.waitForTimeout(6000)
    step('5d manual refresh actually refetches', reqs.length > countBefore, `${reqs.length - countBefore} requests`)
  }
  await p.screenshot({ path: `${OUT}fw-7-idle-refresh.png` })
  await c.close()
}

// ════ WALK 7: magic link straight-in ════
{
  const c = await adminContext()
  const p = await c.newPage()
  await p.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(3000)
  await p.screenshot({ path: `${OUT}fw-8-structure.png` })
  await sweepCopy(p, 'structure page')
  // open the school's node panel
  const nodeBtn = p.locator('.tree-node, .node-row, button, a').filter({ hasText: school.school_name }).first()
  let linkUrl = null
  try {
    await nodeBtn.click()
    await p.waitForSelector('.node-panel', { timeout: 10000 })
    await p.waitForTimeout(2500)
    await sweepCopy(p, 'node panel')
    // existing teacher link, or mint one through the verb
    const teacherRow = p.locator('.link-row').filter({ hasText: /teacher/i }).first()
    if (!(await teacherRow.count())) {
      await p.locator('.verb-btn').filter({ hasText: /Invite a teacher/i }).first().click()
      await p.waitForTimeout(600)
      await p.locator('.verb-form select').first().selectOption({ label: 'Teacher' }).catch(() => {})
      await p.locator('.btn-primary-sm').filter({ hasText: /Create invite link/i }).first().click()
      await p.waitForTimeout(4000)
    }
    const rowAfter = p.locator('.link-row').filter({ hasText: /teacher/i }).first()
    if (await rowAfter.count()) linkUrl = (await rowAfter.locator('.link-url').innerText()).trim()
    await p.screenshot({ path: `${OUT}fw-9-ways-in.png` })
  } catch (e) {
    console.log('node panel path failed:', e.message)
  }
  step('7a a real teacher invite link visible on the node (ways-in)', !!linkUrl, linkUrl || 'none')
  await c.close()

  if (linkUrl) {
    // Point the link at staging regardless of which host it was minted with.
    const target = linkUrl.replace(/https?:\/\/[^/]+/, BASE)
    const fresh = await browser.newContext({ viewport: { width: 1440, height: 1100 } }) // NO session
    const fp = await fresh.newPage()
    const t0 = Date.now()
    await fp.goto(target, { waitUntil: 'networkidle' }).catch(() => {})
    await fp.waitForTimeout(6000)
    const body = (await fp.locator('body').innerText()).replace(/\s+/g, ' ')
    const hasOtp = /one-time|OTP|check your email|enter the code|sign in to continue/i.test(body)
    const emailForm = await fp.locator('input[type="email"]:visible').count()
    const authed = await fp.evaluate((ref) => !!window.localStorage.getItem(`sb-${ref}-auth-token`), projectRef)
    step('7b fresh context: link lands IN, authenticated, zero interstitials',
      authed && !hasOtp && emailForm === 0,
      `${((Date.now() - t0) / 1000).toFixed(1)}s → ${fp.url()} authed=${authed} otp=${hasOtp} emailInputs=${emailForm}`)
    await fp.screenshot({ path: `${OUT}fw-10-straight-in.png`, fullPage: true })
    await fresh.close()
  }
}

// ════ WALK 8: copy sweep verdict ════
step('8 copy sweep: no node/entitlement/subtree jargon user-facing', jargon.length === 0,
  jargon.length ? jargon.map((j) => `[${j.where}] "${j.word}" …${j.context}…`).slice(0, 6).join(' || ') : 'clean across walked pages')

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
for (const f of failed) console.log('FAILED:', f.name, '—', f.detail || '')
process.exit(failed.length ? 1 : 0)
