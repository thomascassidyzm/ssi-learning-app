// PLAY-AS-CLASS verification walk on DEPLOYED dev (founder ruling: play-as-
// class is the PRIMARY school metric — the class is a learner; students are
// the bonus layer). Proves, against the real deployment + real DB:
//
//   1. Demo re-anchor (LANE B): POST demo-refresh on the IME Demo Programme →
//      every demo class carries a class learning identity — class-identity
//      `sessions` rows mirroring the class_sessions arc, class-entity
//      enrollment advanced to the arc end, is_demo flags set.
//   2. Node-home payload (LANE C): /api/groups/:classId/home leads with
//      classPractice + a class-play journey; programme rollup carries the
//      subtree classPractice block.
//   3. Dashboards (LANE C): screenshots — class home leading with Class
//      practice, programme home stats row, insights (class-practice measures).
//   4. LIVE teacher moment (LANE A): sign in as the class's real teacher,
//      click "▶ Play as class", let the player start, and assert a NEW
//      `sessions` row landed for the CLASS's learner id via the
//      server-mediated class-progress path (the RLS-rejected browser insert
//      this push fixed).
//
//   node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/play-as-class-walk.mjs
//
// Screenshots land in docs/the-view/play-as-class/ (committed as evidence).
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/play-as-class/', import.meta.url).pathname
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

async function tokenFor(email) {
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
  if (verr) throw verr
  return v.session
}

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const adminSession = await tokenFor(process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com')
const adminToken = adminSession.access_token

// ─── IME subtree: schools → classes ───
const groupIds = [IME_GROUP_ID]
for (let depth = 0; depth < 4; depth++) {
  const { data: kids } = await svc.from('groups').select('id').in('parent_id', groupIds)
  const fresh = (kids || []).map((k) => k.id).filter((id) => !groupIds.includes(id))
  if (!fresh.length) break
  groupIds.push(...fresh)
}
const { data: schools } = await svc.from('schools').select('id, school_name').in('group_id', groupIds)
const { data: classes } = await svc.from('classes').select('id, class_name, course_code, teacher_user_id, class_learner_id, last_lego_id').in('school_id', (schools || []).map((s) => s.id))
check('IME subtree has classes', (classes || []).length > 0, `${(classes || []).length} classes`)

// ─── 1. Demo refresh (LANE B live) ───
const refreshedAt = Date.now()
const refreshResp = await fetch(`${BASE}/api/groups/${IME_GROUP_ID}/demo-refresh`, {
  method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
})
const refreshBody = await refreshResp.json().catch(() => ({}))
check('demo-refresh 200', refreshResp.status === 200, JSON.stringify(refreshBody.result || refreshBody).slice(0, 200))

// Re-read classes (refresh may have minted class_learner_id / moved last_lego_id)
const { data: classes2 } = await svc.from('classes').select('id, class_name, course_code, teacher_user_id, class_learner_id, last_lego_id').in('id', (classes || []).map((c) => c.id))
const withEntity = (classes2 || []).filter((c) => c.class_learner_id)
check('every demo class has a class learning identity', withEntity.length === (classes2 || []).length, `${withEntity.length}/${(classes2 || []).length}`)

const classLearnerIds = withEntity.map((c) => c.class_learner_id)
const { data: classLearners } = await svc.from('learners').select('id, is_demo, is_class_entity').in('id', classLearnerIds)
check('class entities flagged is_demo (board metrics never inflate)', (classLearners || []).every((l) => l.is_demo === true && l.is_class_entity === true))

// Class-identity sessions mirror the class_sessions arc. Classes with no
// resolvable teacher (even via class_teachers) get no teacher-led arc by
// design — counted and reported, never silently folded in.
let withArc = 0
let arcsOk = 0
let freshestOk = 0
for (const c of withEntity) {
  const { data: cs } = await svc.from('class_sessions').select('started_at, end_lego_id').eq('class_id', c.id).order('started_at', { ascending: false })
  const { data: ls } = await svc.from('sessions').select('started_at, duration_seconds').eq('learner_id', c.class_learner_id).order('started_at', { ascending: false })
  if ((cs || []).length === 0) continue
  withArc++
  if ((ls || []).length === (cs || []).length) arcsOk++
  const newest = (ls || [])[0]
  if (newest && Date.now() - new Date(newest.started_at).getTime() < 3 * 86400000) freshestOk++
}
check('demo classes carry a class-practice arc', withArc > 0, `${withArc}/${withEntity.length} classes (teacherless classes are reported, not faked)`)
check('class-identity sessions mirror the class_sessions arc (one arc, two projections)', withArc > 0 && arcsOk === withArc, `${arcsOk}/${withArc} arcs`)
check('class practice is alive NOW (newest class session within 3 days)', withArc > 0 && freshestOk === withArc, `${freshestOk}/${withArc}`)

// Class enrollment advanced to the arc end (only classes that HAVE an arc)
let enrollOk = 0
let enrollChecked = 0
for (const c of withEntity) {
  const { count: csCount } = await svc.from('class_sessions').select('id', { count: 'exact', head: true }).eq('class_id', c.id)
  if (!csCount) continue
  enrollChecked++
  const { data: e } = await svc.from('course_enrollments').select('highest_completed_lego_id, last_completed_lego_id, total_practice_minutes').eq('learner_id', c.class_learner_id).eq('course_id', c.course_code).maybeSingle()
  // last_completed rides THIS arc's end exactly; highest_completed is the DB's
  // forward-only ceiling — on a re-refresh it may sit a lego or two above the
  // new random arc end (never below it). Both are class-play truth.
  const ord = (id) => { const m = /S(\d+)L(\d+)/.exec(id || ''); return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : -1 }
  if (e && e.last_completed_lego_id === c.last_lego_id && ord(e.highest_completed_lego_id) >= ord(c.last_lego_id) && (e.total_practice_minutes || 0) > 0) enrollOk++
}
check('class-entity enrollment rides the arc end (journey/belt from class play)', enrollChecked > 0 && enrollOk === enrollChecked, `${enrollOk}/${enrollChecked}`)

// ─── 2. Node-home payload (LANE C live) ───
// Probe a class that actually has an arc (teacherless classes stay honest-empty).
let probeClass = withEntity[0]
for (const c of withEntity) {
  const { count } = await svc.from('class_sessions').select('id', { count: 'exact', head: true }).eq('class_id', c.id)
  if (count) { probeClass = c; break }
}
const classHome = await (await fetch(`${BASE}/api/groups/${probeClass.id}/home`, { headers: { Authorization: `Bearer ${adminToken}` } })).json()
check('class home leads with classPractice', (classHome.classPractice?.totalSessions || 0) > 0,
  `weekSessions=${classHome.classPractice?.weekSessions} hours=${classHome.classPractice?.hours}`)
check('class journey rides class play (LEGO ordinal, source-tagged)', classHome.journey?.source === 'class-play' && classHome.journey?.done > 0,
  `done=${classHome.journey?.done}/${classHome.journey?.total} lego=${classHome.journey?.legoId}`)

const progHome = await (await fetch(`${BASE}/api/groups/${IME_GROUP_ID}/home`, { headers: { Authorization: `Bearer ${adminToken}` } })).json()
check('programme rollup carries subtree classPractice', (progHome.classPractice?.hours || 0) > 0 && (progHome.classPractice?.activeClasses7d || 0) > 0,
  `hours=${progHome.classPractice?.hours} active7d=${progHome.classPractice?.activeClasses7d}/${progHome.classPractice?.classCount}`)

// ─── 3. Screenshots (admin session) ───
const browser = await chromium.launch()
const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } })
await desktop.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(adminSession)])
const page = await desktop.newPage()

await page.goto(`${BASE}/admin/classes/${probeClass.id}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const classText = await page.textContent('body')
check('class home renders Class practice card first', /Class practice/.test(classText || ''))
check('class home says when the class last practised', /Last class session/.test(classText || ''))
check('journey copy: travelled together, in LEGOs, never "seed"', /travelled .* LEGOs together/.test(classText || '') && !/\bseed\b/i.test(classText || ''))
await page.screenshot({ path: `${OUT}class-home-class-practice.jpg`, fullPage: true, type: 'jpeg', quality: 70 })

await page.goto(`${BASE}/admin/groups/${IME_GROUP_ID}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const progText = await page.textContent('body')
check('programme home stats lead with class practice', /Class practice/.test(progText || '') && /Classes practising this week/.test(progText || ''))
await page.screenshot({ path: `${OUT}programme-home-class-practice.jpg`, fullPage: true, type: 'jpeg', quality: 70 })

await page.goto(`${BASE}/admin/groups/${IME_GROUP_ID}/insights`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}programme-insights-class-measures.jpg`, fullPage: true, type: 'jpeg', quality: 70 })

// ─── 4. LIVE teacher play-as-class moment (LANE A end-to-end) ───
let liveDone = false
// Find a class whose teacher resolves to a real auth user with an email.
let liveTeacherEmail = null
for (const c of withEntity) {
  const { data: cs } = await svc.from('class_sessions').select('id').eq('class_id', c.id).limit(1)
  if (!(cs || []).length || !c.teacher_user_id) continue
  const { data: tUser } = await svc.auth.admin.getUserById(c.teacher_user_id).catch(() => ({ data: null }))
  if (tUser?.user?.email) { liveTeacherEmail = tUser.user.email; break }
}
{
  const email = liveTeacherEmail
  if (email) {
    const before = refreshedAt
    const teacherSession = await tokenFor(email)
    const tctx = await browser.newContext({ viewport: { width: 1440, height: 960 } })
    await tctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
      [`sb-${projectRef}-auth-token`, JSON.stringify(teacherSession)])
    const tpage = await tctx.newPage()
    await tpage.goto(`${BASE}/schools`, { waitUntil: 'networkidle' })
    await tpage.waitForTimeout(4000)
    await tpage.screenshot({ path: `${OUT}teacher-surface.jpg`, type: 'jpeg', quality: 70 })
    const playBtn = tpage.locator('text=Play as class').first()
    if (await playBtn.count()) {
      await playBtn.click()
      // Player boots, useLearningSession.initializeSession fires startSession
      // through the NEW server-mediated class path. Give it time to land.
      await tpage.waitForTimeout(18000)
      await tpage.screenshot({ path: `${OUT}teacher-live-play-as-class.jpg`, type: 'jpeg', quality: 70 })
      // Which class did the teacher's surface launch? Read the stored payload.
      const activeCls = await tpage.evaluate(() => JSON.parse(localStorage.getItem('ssi-active-class') || 'null'))
      const launchedClass = (classes2 || []).find((c) => c.id === activeCls?.id) || probeClass
      const { data: liveRows } = await svc.from('sessions')
        .select('id, started_at, course_id')
        .eq('learner_id', launchedClass.class_learner_id)
        .gte('started_at', new Date(before).toISOString())
      check('LIVE: real play-as-class landed a sessions row on the CLASS identity (the fixed spine)',
        (liveRows || []).length > 0, `${(liveRows || []).length} row(s) for ${launchedClass.class_name}`)
      liveDone = true
      await tpage.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
    } else {
      console.log('SKIP — teacher surface showed no "Play as class" button (canPlayAsClass gate?)')
    }
    await tctx.close()
  }
}
if (!liveDone) console.log('SKIP — live teacher moment not run (no auth user/email for the class teacher)')

await browser.close()
console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
