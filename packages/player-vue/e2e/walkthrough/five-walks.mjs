// Walkthrough engine e2e — drives ALL FIVE walks end-to-end on the DEPLOYED
// dev build, as the right persona each (IME demo personal links + a minted
// ssi_admin session), asserting per step: the anchor resolves, the pulse ring
// sits on the real element, Next/Back work, the walk completes, and NO
// mutating request fired during any walk (walks are show-and-point; the one
// click-advance step only opens an inline form). Also: the two offering
// surfaces show entry points, and NOTHING auto-plays on plain navigation.
// Deployed builds strip console.log — all assertions are DOM/attribute-based
// (html[data-walk-active] is the runtime's e2e breadcrumb).
//
//   PATH=/opt/homebrew/bin:$PATH node --env-file=<envfile-with-supabase-keys> \
//     e2e/walkthrough/five-walks.mjs
//   (needs SUPABASE_URL + SUPABASE_SERVICE_KEY + SUPABASE_ANON_KEY — or the
//    VITE_/SERVICE_ROLE variants; BASE_URL overrides the dev alias)
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/walkthrough-engine/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const LEADER_URL = `${BASE}/group/QJM-868` // IME Programme Leader (personal link = login)
const TEACHER_URL = `${BASE}/redeem/ZKD-834` // IME Teacher, Sunrise Public School Pune

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.png`, fullPage: false }).catch(() => {})

// ── ssi_admin session (service-role magiclink → verifyOtp → localStorage) ──
const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const SVC_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const svc = createClient(SB_URL, SVC_KEY)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({
  type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com',
})
if (linkErr) throw linkErr
const { data: adminSession, error: otpErr } = await anon.auth.verifyOtp({ type: 'email', token_hash: linkData.properties.hashed_token })
if (otpErr) throw otpErr

const browser = await chromium.launch()

// Mutation watch: any non-GET /api call that isn't telemetry is a walk-safety
// violation while a walk is running.
function watchMutations(page) {
  const log = []
  page.on('request', (req) => {
    if (req.method() === 'GET') return
    const u = req.url()
    if (!u.includes('/api/')) return
    if (u.includes('/api/player-events')) return // telemetry batch, always allowed
    log.push(`${req.method()} ${new URL(u).pathname}`)
  })
  return log
}

async function newPage({ admin = false, viewport = { width: 1380, height: 950 } } = {}) {
  const ctx = await browser.newContext({ viewport })
  if (admin) {
    await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
      [`sb-${projectRef}-auth-token`, JSON.stringify(adminSession.session)])
  }
  const page = await ctx.newPage()
  return { ctx, page, mutations: watchMutations(page) }
}

const walkState = (p) => p.evaluate(() => document.documentElement.getAttribute('data-walk-active'))

async function assertNoAutoPlay(p, label) {
  await p.waitForTimeout(3000)
  const active = await walkState(p)
  const card = await p.locator('.walk-card').count()
  check(`${label}: nothing auto-plays on plain navigation`, active === null && card === 0, `attr=${active} cards=${card}`)
}

async function assertStep(p, walkId, stepIdx, anchorId, name) {
  await p.waitForFunction(
    ([id, i]) => document.documentElement.getAttribute('data-walk-active') === `${id}:${i}`,
    [walkId, stepIdx], { timeout: 8000 },
  ).catch(() => {})
  const state = await walkState(p)
  check(`${walkId} step ${stepIdx}: active`, state === `${walkId}:${stepIdx}`, `attr=${state}`)
  await p.waitForTimeout(700) // ring transition + scrollIntoView settle
  const anchorBox = await p.locator(`[data-walk="${anchorId}"]`).first().boundingBox().catch(() => null)
  const ringBox = await p.locator('.walk-ring').boundingBox().catch(() => null)
  check(`${walkId} step ${stepIdx}: anchor "${anchorId}" resolves in DOM`, !!anchorBox)
  const aligned = !!anchorBox && !!ringBox &&
    Math.abs(ringBox.x - (anchorBox.x - 6)) <= 10 && Math.abs(ringBox.y - (anchorBox.y - 6)) <= 10
  check(`${walkId} step ${stepIdx}: pulse ring sits on the anchor`, aligned,
    aligned ? '' : `anchor=${JSON.stringify(anchorBox)} ring=${JSON.stringify(ringBox)}`)
  const cardVisible = await p.locator('.walk-card').isVisible().catch(() => false)
  check(`${walkId} step ${stepIdx}: card renders`, cardVisible)
  await shot(p, name)
}

const nextBtn = (p) => p.locator('.walk-card .walk-btn-primary')
const backBtn = (p) => p.locator('.walk-card .walk-btn', { hasText: 'Back' })

async function finishWalk(p, walkId) {
  // Terminal card (…:done) then Done → attribute cleared.
  await p.waitForFunction(
    (id) => (document.documentElement.getAttribute('data-walk-active') || '').startsWith(`${id}:`) &&
            (document.documentElement.getAttribute('data-walk-active') || '').endsWith(':done'),
    walkId, { timeout: 6000 },
  ).catch(() => {})
  const state = await walkState(p)
  check(`${walkId}: terminal card reached`, (state || '').endsWith(':done'), `attr=${state}`)
  await shot(p, `${walkId}-terminal`)
  await nextBtn(p).click().catch(() => {})
  await p.waitForTimeout(400)
  check(`${walkId}: completes and clears`, (await walkState(p)) === null)
}

// ════ A. LEADER (IME Programme Leader personal link) — walks 3, 4, 1 ════
{
  const { ctx, page: p, mutations } = await newPage()
  await p.goto(LEADER_URL, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForURL((u) => u.pathname.startsWith('/schools/org/'), { timeout: 45000 })
  await p.waitForSelector('.nh-stats, .stat-value', { timeout: 20000 }).catch(() => {})
  await assertNoAutoPlay(p, 'leader node home')
  await shot(p, 'a0-leader-node-home-quiet')

  // Offering surface 1: How this works → Show me links
  await p.locator('.htw-toggle').first().click()
  await p.waitForTimeout(500)
  const waysOffer = p.locator('[data-walk-offer="ways-in"]')
  check('offering: How-this-works carries "Show me — Ways in"', await waysOffer.count() > 0)
  await shot(p, 'a1-htw-show-me-links')

  // ── WALK 3: ways-in ──
  const mutStart3 = mutations.length
  await waysOffer.first().click()
  await assertStep(p, 'ways-in', 0, 'ways-in-ledger', 'w3-step0-ledger')
  await nextBtn(p).click()
  await assertStep(p, 'ways-in', 1, 'ways-in-copy', 'w3-step1-copy')
  await backBtn(p).click() // Back works
  await assertStep(p, 'ways-in', 0, 'ways-in-ledger', 'w3-step0-back')
  await nextBtn(p).click()
  await assertStep(p, 'ways-in', 1, 'ways-in-copy', 'w3-step1-again')
  await nextBtn(p).click()
  await assertStep(p, 'ways-in', 2, 'ways-in-remint', 'w3-step2-remint')
  await nextBtn(p).click()
  await assertStep(p, 'ways-in', 3, 'ways-in-revoke', 'w3-step3-revoke')
  await nextBtn(p).click()
  await finishWalk(p, 'ways-in')
  check('ways-in: zero mutating requests during walk', mutations.length === mutStart3, mutations.slice(mutStart3).join(', '))

  // ── WALK 4: reading-insights (member insights mount) ──
  await p.locator('a, button', { hasText: 'See insights' }).first().click()
  await p.waitForURL((u) => u.pathname.includes('/insights'), { timeout: 20000 })
  await p.waitForSelector('.nre-controls', { timeout: 25000 }).catch(() => {})
  await assertNoAutoPlay(p, 'leader insights')
  const insightsOffer = p.locator('[data-walk-offer="reading-insights"]')
  check('offering: insights page carries its Show-me link', await insightsOffer.count() > 0)
  const mutStart4 = mutations.length
  await insightsOffer.first().click()
  await assertStep(p, 'reading-insights', 0, 'insights-measure', 'w4-step0-measure')
  await nextBtn(p).click()
  await assertStep(p, 'reading-insights', 1, 'insights-window', 'w4-step1-window')
  await nextBtn(p).click()
  await assertStep(p, 'reading-insights', 2, 'insights-compare', 'w4-step2-compare')
  await nextBtn(p).click()
  await assertStep(p, 'reading-insights', 3, 'insights-overview', 'w4-step3-overview')
  await nextBtn(p).click()
  await finishWalk(p, 'reading-insights')
  check('reading-insights: zero mutating requests during walk', mutations.length === mutStart4, mutations.slice(mutStart4).join(', '))

  // ── WALK 1: invite-first-teacher, on the Sunrise school node home ──
  await p.locator('.verb-btn', { hasText: 'Overview' }).first().click().catch(() => {})
  await p.waitForTimeout(1500)
  // All-schools lens → open Sunrise Public School's node home
  await p.locator('.lens-chips .chip', { hasText: 'All schools' }).first().click().catch(() => {})
  await p.waitForTimeout(2000)
  await p.locator('.child-btn', { hasText: 'Sunrise Public School' }).first().click()
  await p.waitForTimeout(2500)
  await p.waitForSelector('.nh-stats, .stat-value', { timeout: 20000 }).catch(() => {})
  check('walk1: on a school node home', p.url().includes('/schools/org/'), p.url())
  await p.locator('.htw-toggle').first().click().catch(() => {})
  await p.waitForTimeout(500)
  const inviteOffer = p.locator('[data-walk-offer="invite-first-teacher"]')
  check('offering: school node home offers invite-first-teacher', await inviteOffer.count() > 0)
  const mutStart1 = mutations.length
  await inviteOffer.first().click()
  await assertStep(p, 'invite-first-teacher', 0, 'verb-invite-person', 'w1-step0-verb')
  // click-advance step: Next must be ABSENT; the user's REAL tap advances
  check('walk1 step 0: click step hides Next (user does the real thing)', await nextBtn(p).count() === 0)
  await p.locator('[data-walk="verb-invite-person"]').click()
  await assertStep(p, 'invite-first-teacher', 1, 'invite-form-role', 'w1-step1-role')
  await nextBtn(p).click()
  await assertStep(p, 'invite-first-teacher', 2, 'invite-form-submit', 'w1-step2-submit')
  await nextBtn(p).click()
  await assertStep(p, 'invite-first-teacher', 3, 'ways-in-ledger', 'w1-step3-ledger')
  await nextBtn(p).click()
  await finishWalk(p, 'invite-first-teacher')
  check('invite-first-teacher: zero mutating requests (nothing minted)', mutations.length === mutStart1, mutations.slice(mutStart1).join(', '))

  await ctx.close()
}

// ════ B. TEACHER (IME Teacher personal link) — walk 2 on class detail ════
{
  const { ctx, page: p, mutations } = await newPage()
  await p.goto(TEACHER_URL, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(4000)
  // Land on the teacher dashboard, then open the first class row.
  await p.locator('.row-clickable').first().click().catch(() => {})
  await p.waitForURL((u) => u.pathname.includes('/classes/'), { timeout: 20000 }).catch(() => {})
  await p.waitForSelector('.page-head-actions, .join-card', { timeout: 20000 }).catch(() => {})
  check('teacher: on class detail', p.url().includes('/classes/'), p.url())
  await assertNoAutoPlay(p, 'class detail')
  const classOffer = p.locator('[data-walk-offer="run-class-session"]')
  check('offering: class detail offers run-class-session', await classOffer.count() > 0)
  await shot(p, 'b0-class-detail-quiet')
  const mutStart2 = mutations.length
  const urlBefore = p.url()
  await classOffer.first().click()
  await assertStep(p, 'run-class-session', 0, 'class-join-link', 'w2-step0-join-link')
  await nextBtn(p).click()
  await assertStep(p, 'run-class-session', 1, 'class-join-code', 'w2-step1-join-code')
  await backBtn(p).click()
  await assertStep(p, 'run-class-session', 0, 'class-join-link', 'w2-step0-back')
  await nextBtn(p).click()
  await nextBtn(p).click()
  await assertStep(p, 'run-class-session', 2, 'class-play', 'w2-step2-play')
  await nextBtn(p).click()
  await finishWalk(p, 'run-class-session')
  check('run-class-session: no session started (URL unchanged)', p.url() === urlBefore, p.url())
  check('run-class-session: zero mutating requests during walk', mutations.length === mutStart2, mutations.slice(mutStart2).join(', '))
  await ctx.close()
}

// ════ C. SSI ADMIN (minted session) — walk 5 + noticing-invitation CTA ════
{
  const { ctx, page: p, mutations } = await newPage({ admin: true })
  await p.goto(`${BASE}/admin/invites`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.mode-toggle', { timeout: 25000 })
  await assertNoAutoPlay(p, 'admin invites desk')
  const deskOffer = p.locator('[data-walk-offer="invites-desk"]')
  check('offering: invites desk offers its walk', await deskOffer.count() > 0)
  await shot(p, 'c0-invites-desk-quiet')
  const mutStart5 = mutations.length
  await deskOffer.first().click()
  await assertStep(p, 'invites-desk', 0, 'invites-mode-strip', 'w5-step0-modes')
  await nextBtn(p).click()
  await assertStep(p, 'invites-desk', 1, 'invites-org-who', 'w5-step1-who')
  await nextBtn(p).click()
  await assertStep(p, 'invites-desk', 2, 'invites-org-submit', 'w5-step2-submit')
  await nextBtn(p).click()
  await assertStep(p, 'invites-desk', 3, 'invites-active-toggle', 'w5-step3-kill-switch')
  await nextBtn(p).click()
  await finishWalk(p, 'invites-desk')
  check('invites-desk: zero mutating requests (nothing minted/toggled)', mutations.length === mutStart5, mutations.slice(mutStart5).join(', '))

  // Offering surface 2: a noticing invitation whose CTA is walk:<id>.
  // Find a teacherless school anywhere under the structure roots via the API.
  const token = adminSession.session.access_token
  async function findTeacherlessSchool(nodeId, depth = 0) {
    if (depth > 3) return null
    const resp = await fetch(`${BASE}/api/groups/${nodeId}/home`, { headers: { Authorization: `Bearer ${token}` } })
    if (!resp.ok) return null
    const home = await resp.json()
    for (const c of home.children || []) {
      if (c.hasSchool && c.rollup?.teacherCount === 0) return c.id
    }
    for (const c of home.children || []) {
      if (!c.hasSchool) {
        const found = await findTeacherlessSchool(c.id, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  // Start from the IME programme root (the leader link's granted node).
  const { data: inviteRow } = await svc.from('invite_codes').select('grants_group_id').eq('code', 'QJM-868').maybeSingle()
  const rootId = inviteRow?.grants_group_id ?? null
  let teacherless = null
  if (rootId) teacherless = await findTeacherlessSchool(rootId)
  if (teacherless) {
    await p.goto(`${BASE}/admin/groups/${teacherless}`, { waitUntil: 'networkidle' }).catch(() => {})
    await p.waitForSelector('.nh-stats, .notice-card', { timeout: 20000 }).catch(() => {})
    await p.waitForTimeout(1500)
    const cta = p.locator('[data-walk-cta="invite-first-teacher"]')
    check('offering: noticing invitation carries the walk CTA on a teacherless school', await cta.count() > 0)
    await shot(p, 'c1-noticing-walk-cta')
    if (await cta.count()) {
      await cta.first().click()
      await p.waitForTimeout(600)
      check('noticing CTA starts the walk', ((await walkState(p)) || '').startsWith('invite-first-teacher:'))
      await shot(p, 'c2-noticing-walk-started')
      await p.locator('.walk-close').click().catch(() => {}) // Skip works
      check('skip (×) ends the walk', (await walkState(p)) === null)
    }
  } else {
    console.log('SKIP — no teacherless school found under the IME root; noticing walk CTA verified at unit level (evaluateRules) only')
  }
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
