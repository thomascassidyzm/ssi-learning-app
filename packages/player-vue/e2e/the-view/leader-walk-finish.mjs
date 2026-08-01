// LEADER-SURFACE FINISH walk — 2026-07-20. Completes member-mount-verify.mjs
// with the four remaining walk legs on a deployed build:
//   A. PERSONAL leader link: redeem fresh → deep drill programme → region →
//      school → class (teaching cards, flat student rows), then a direct
//      /admin/structure attempt which MUST be refused (redirected off /admin).
//   B. OPEN leader code (capture species): one identity screen, then the same
//      node-home landing.
//   C. Teacher OPEN link on a school in the subtree: still lands on the
//      teacher /schools surface, NOT the org mount.
// Screenshots to /tmp/leader-finish/. Probe accounts + codes cleaned after.
//   BASE_URL=<deployment> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/leader-walk-finish.mjs          (from packages/player-vue)
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = '/tmp/leader-finish/'
mkdirSync(OUT, { recursive: true })

const PROGRAMME = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a' // IME Demo Programme
const SUNRISE_SCHOOL_NODE = '741e9b6e-9542-4ac4-9d28-e29471ceaf41' // Sunrise Public School, Pune (under Pilot Districts Region)
const RUN_TAG = process.env.RUN_TAG || 'finish0720'

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })

const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const adminToken = v.session.access_token

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

async function mint(nodeId, body) {
  const resp = await fetch(`${BASE}/api/groups/${nodeId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body),
  })
  const json = await resp.json()
  if (!resp.ok) throw new Error(`mint failed ${resp.status}: ${json.error}`)
  return json
}

async function deleteAccountByAuthId(uid) {
  if (!uid) return
  await svc.from('govt_admins').delete().eq('user_id', uid)
  await svc.from('user_tags').delete().eq('user_id', uid)
  await svc.from('learners').delete().eq('user_id', uid)
  await svc.auth.admin.deleteUser(uid).catch(() => {})
  console.log('CLEANED probe account', uid)
}

async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await svc.auth.admin.listUsers({ page, perPage: 200 })
    const hit = (data?.users || []).find((u) => u.email === email)
    if (hit) return hit.id
    if (!data || data.users.length < 200) break
  }
  return null
}

const browser = await chromium.launch()
const shots = []
async function newPage(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  const shot = async (name) => { const f = `${OUT}${tag}-${name}.png`; await p.screenshot({ path: f, fullPage: false }); shots.push(f) }
  return { ctx, p, errors, shot }
}

// ─────────────────────────────────────────────────────────────────────────
// A. PERSONAL leader link — deep drill + admin refusal
// ─────────────────────────────────────────────────────────────────────────
const personal = await mint(PROGRAMME, { role: 'leader', limits: {}, personal: { name: 'Finish Walk Probe' } })
console.log('MINTED personal leader link:', personal.code, personal.url)
{
  const { ctx, p, errors, shot } = await newPage('a')
  await p.goto(personal.url, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForURL((u) => u.pathname.startsWith('/schools'), { timeout: 45000 }).catch(() => {})
  await p.waitForTimeout(6000)
  check('A: personal link lands on member node home', new URL(p.url()).pathname === `/org/${PROGRAMME}`, p.url())
  await shot('1-landing')

  // Drill 1: programme → Pilot Districts Region
  const regionRow = p.locator('.child-btn', { hasText: 'Pilot Districts Region' }).first()
  check('A: region child row present', (await regionRow.count()) > 0)
  if (await regionRow.count()) {
    await regionRow.click()
    await p.waitForTimeout(4500)
    const body = (await p.textContent('body').catch(() => '')) || ''
    check('A: region home in member scope', new URL(p.url()).pathname.startsWith('/org/'), p.url())
    check('A: region rail — programme above, you-are-here on region',
      body.includes('IME Demo Programme') && body.includes("you're here") && body.includes('Pilot Districts Region'))
    check('A: region — no All organisations escape', !body.includes('All organisations'))
    await shot('2-region')

    // Drill 2: region → Sunrise Public School, Pune
    const schoolRow = p.locator('.child-btn', { hasText: 'Sunrise' }).first()
    check('A: school child row present under region', (await schoolRow.count()) > 0)
    if (await schoolRow.count()) {
      await schoolRow.click()
      await p.waitForTimeout(4500)
      const sbody = (await p.textContent('body').catch(() => '')) || ''
      check('A: school home in member scope', new URL(p.url()).pathname.startsWith('/org/'), p.url())
      check('A: school rail keeps full ancestry', sbody.includes('IME Demo Programme') && sbody.includes('Pilot Districts Region') && sbody.includes('Sunrise'))
      await shot('3-school')

      // Drill 3: school → a class (via All classes lens, or direct child)
      const classChip = p.locator('.chip', { hasText: 'All classes' }).first()
      if (await classChip.count()) { await classChip.click(); await p.waitForTimeout(3500) }
      const classRow = p.locator('.child-btn', { hasText: 'Grade' }).first()
      check('A: class row present', (await classRow.count()) > 0)
      if (await classRow.count()) {
        await classRow.click()
        await p.waitForTimeout(5000)
        const cbody = (await p.textContent('body').catch(() => '')) || ''
        check('A: class home in member scope', new URL(p.url()).pathname.startsWith('/org/'), p.url())
        check('A: class teaching cards', cbody.includes('Course journey') && cbody.includes('Belt distribution'))
        check('A: flat student rows carry teaching density', cbody.includes('Practice hours') || /LEGOs/i.test(cbody))
        await shot('4-class')
      }
    }
  }

  // Insights keeps the map intact
  await p.goto(`${BASE}/org/${PROGRAMME}/insights`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(6000)
  const ibody = (await p.textContent('body').catch(() => '')) || ''
  check('A: insights opens with the map intact', ibody.includes('IME Demo Programme') && ibody.includes('Insights'))
  await shot('5-insights')

  // Direct /admin/structure attempt — must be refused (redirected off /admin).
  // The deny-not-defer gate renders nothing while checking, then bounces; wait
  // for the bounce itself rather than a fixed beat.
  await p.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForURL((u) => !u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {})
  await p.waitForTimeout(3000)
  const adminPath = new URL(p.url()).pathname
  const abody = (await p.textContent('body').catch(() => '')) || ''
  check('A: /admin/structure refused for leader', !adminPath.startsWith('/admin'), p.url())
  check('A: no admin structure content leaked', !abody.includes('All organisations') && !abody.includes('Mint a demo org'))
  await shot('6-admin-refused')

  check('A: zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}
if (personal.code) await svc.from('invite_codes').delete().eq('code', personal.code)
await deleteAccountByAuthId(personal.account?.auth_user_id)

// ─────────────────────────────────────────────────────────────────────────
// B. OPEN leader code — capture screen, then the same landing
// ─────────────────────────────────────────────────────────────────────────
const OPEN_EMAIL = `thomas.cassidy+openleader-${RUN_TAG}@gmail.com`
const open = await mint(PROGRAMME, { role: 'leader', limits: {} })
console.log('MINTED open leader link:', open.code, open.url)
{
  const { ctx, p, errors, shot } = await newPage('b')
  await p.goto(open.url, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(5000)
  const capture = (await p.textContent('body').catch(() => '')) || ''
  check('B: open code shows ONE identity-capture screen', capture.includes('Tell us who you are'), p.url())
  await shot('1-capture')
  await p.locator('input[placeholder="e.g. Sian Jones"]').fill('Open Leader Probe')
  await p.locator('input[type="email"]').fill(OPEN_EMAIL)
  await p.locator('form button[type="submit"]').click()
  await p.waitForURL((u) => u.pathname.startsWith('/schools'), { timeout: 45000 }).catch(() => {})
  await p.waitForTimeout(6000)
  const body = (await p.textContent('body').catch(() => '')) || ''
  check('B: open leader lands on member node home', new URL(p.url()).pathname === `/org/${PROGRAMME}`, p.url())
  // Stats vocabulary shifted with LANE B (class practice leads) — accept either card set.
  check('B: rail + identity + stats present', body.includes("you're here") && body.includes('IME Demo Programme') && /practice/i.test(body) && body.includes('Learners'))
  check('B: no admin escape', !body.includes('All organisations'))
  await shot('2-landing')
  check('B: zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}
if (open.code) await svc.from('invite_codes').delete().eq('code', open.code)
await deleteAccountByAuthId(await findAuthUserByEmail(OPEN_EMAIL))

// ─────────────────────────────────────────────────────────────────────────
// C. Teacher OPEN link — still lands on the teacher surface
// ─────────────────────────────────────────────────────────────────────────
const TEACHER_EMAIL = `thomas.cassidy+teacherprobe-${RUN_TAG}@gmail.com`
const teacher = await mint(SUNRISE_SCHOOL_NODE, { role: 'teacher', limits: {} })
console.log('MINTED teacher link:', teacher.code, teacher.url)
{
  const { ctx, p, errors, shot } = await newPage('c')
  await p.goto(teacher.url, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(5000)
  const capture = (await p.textContent('body').catch(() => '')) || ''
  check('C: teacher code shows identity capture', capture.includes('Tell us who you are'), p.url())
  await p.locator('input[placeholder="e.g. Sian Jones"]').fill('Teacher Probe')
  await p.locator('input[type="email"]').fill(TEACHER_EMAIL)
  await p.locator('form button[type="submit"]').click()
  await p.waitForURL((u) => u.pathname.startsWith('/schools'), { timeout: 45000 }).catch(() => {})
  await p.waitForTimeout(6000)
  const path = new URL(p.url()).pathname
  const body = (await p.textContent('body').catch(() => '')) || ''
  check('C: teacher lands on teacher surface, NOT the org mount', path.startsWith('/schools') && !path.startsWith('/org/'), p.url())
  check('C: teacher surface renders (no org rail)', !body.includes('WHERE YOU ARE') && !body.includes("you're here"))
  await shot('1-teacher-landing')
  check('C: zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}
if (teacher.code) await svc.from('invite_codes').delete().eq('code', teacher.code)
await deleteAccountByAuthId(await findAuthUserByEmail(TEACHER_EMAIL))

await browser.close()
console.log(shots.join('\n'))
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
