// Job #233 — LIVE proof on staging of Tom's 2026-09-18 pod cadence, one run per
// (course × mode), and of the deleted seed-phase review tier on both producers.
//
//   Pods are a work DEBT (`course_enrollments.rounds_since_pod`, counted by
//   `usePodLapScheduler.noteRoundCompleted`), fired when the debt reaches the
//   MODE's interval — 2 completed rounds on EASY, 4 on FAST. So with the debt
//   parked at 0, EASY must fire a layer-2 lap after rounds 2 and 4, FAST after
//   4 and 8 and at NO round between.
//
//   A layer-2 pod is `pod_lap_start` with `isLayer1: false`; a cups lap carries
//   `isLayer1: true` and is expected EVERY round — it is not a pod.
//
//   A drained-seed review would show as an `audio_play` whose cycleId matches
//   `_seed_rep_` (walk) or `_seedrep` (bundle). None may appear on either path.
//
// Writes only the tester's own two rows (`learners.preferences.learning_mode`
// and the enrolment's `rounds_since_pod`), snapshotted and restored at the end.
//
//   COURSE=spa_for_eng MODE=easy MINUTES=10 LABEL=spa-easy \
//   TMPDIR=$CS_SCRATCH/p233 CHROME_PATH=.../chrome \
//   node packages/player-vue/e2e/_233-pod-cadence-probe.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+mrtomtester@gmail.com'
const LEARNER = 'e5d60bc7-e478-4a35-a968-69c5c5a5b6bd'
const COURSE = process.env.COURSE || 'spa_for_eng'
const MODE = process.env.MODE || 'easy'
const MINUTES = Number(process.env.MINUTES || 10)
const LABEL = process.env.LABEL || `${COURSE}-${MODE}`
const EXTRA = process.env.EXTRA_QS || ''
const OUT = process.env.OUT || `${process.env.CS_SCRATCH || '/tmp'}/p233`
fs.mkdirSync(OUT, { recursive: true })

const rest = async (path, init) => {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H, ...init })
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

const version = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
console.log(LABEL, 'served build', JSON.stringify(version))
if (process.env.EXPECT_BUILD && version.buildNumber !== process.env.EXPECT_BUILD) {
  console.log(`FAIL — served build ${version.buildNumber} is not ${process.env.EXPECT_BUILD}`)
  process.exit(1)
}

const learnerRow = (await rest(`learners?select=preferences&id=eq.${LEARNER}`))[0]
const enrolBefore = await rest(`course_enrollments?select=course_id,rounds_since_pod&learner_id=eq.${LEARNER}`)
console.log('BEFORE', JSON.stringify({ mode: learnerRow?.preferences?.learning_mode ?? null, enrolBefore }))

const setMode = (mode) => rest(`learners?id=eq.${LEARNER}`, {
  method: 'PATCH', body: JSON.stringify({ preferences: { ...(learnerRow?.preferences || {}), learning_mode: mode } }),
})
const setDebt = (course, n) => rest(`course_enrollments?learner_id=eq.${LEARNER}&course_id=eq.${course}`, {
  method: 'PATCH', body: JSON.stringify({ rounds_since_pod: n }),
})

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})

try {
  await setMode(MODE)
  // KEEP_DEBT=1 continues the previous run's work debt instead of parking it at
  // 0 — the debt is per-enrolment and survives a session boundary, so a long
  // FAST run that ends three rounds past its first lap can be continued here to
  // show the SECOND lap land on the 8th completed round.
  if (process.env.KEEP_DEBT !== '1') await setDebt(COURSE, 0)
  const enrol = (await rest(`course_enrollments?select=highest_completed_round_index,highest_completed_lego_id,rounds_since_pod&learner_id=eq.${LEARNER}&course_id=eq.${COURSE}`))[0]
  console.log('START-STATE', JSON.stringify({ mode: MODE, course: COURSE, enrol }))

  const j = await (await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  const sess = await (await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: j.hashed_token }) })).json()

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sess)])
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => logs.push(`${new Date().toISOString()} ${m.text()}`))
  const startedAt = new Date().toISOString()

  await page.goto(`${BASE}/?course=${COURSE}&stream${EXTRA}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(15000)
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await later.first().click().catch(() => {})
  // THE PLAY CONTROL IS THE CENTRE FAB, not a named button — `BottomNav.vue`'s
  // `button.center-btn`, which carries `.is-disabled` until the player is ready
  // and swaps to `.is-stop` once it is playing. Job #232's probe looked for a
  // button called Play/Start/Continue, found none, and sat on "Ready when you
  // are" for seven minutes reporting 0 rounds — the run that never ran.
  await page.waitForSelector('button.center-btn:not(.is-disabled)', { timeout: 120000 }).catch(() => {})
  await page.click('button.center-btn').catch(() => {})
  await page.waitForTimeout(4000)
  const started = await page.locator('button.center-btn.is-stop').count()
  console.log(`${LABEL} play tapped — transport shows ${started ? 'PLAYING (stop icon)' : 'NOT PLAYING'}`)
  if (!started) {
    await page.click('button.center-btn').catch(() => {})
    await page.waitForTimeout(4000)
    console.log(`${LABEL} second tap — ${(await page.locator('button.center-btn.is-stop').count()) ? 'PLAYING' : 'STILL NOT PLAYING'}`)
  }
  await page.screenshot({ path: `${OUT}/${LABEL}-playing.png` })

  const deadline = Date.now() + MINUTES * 60_000
  while (Date.now() < deadline) await page.waitForTimeout(15000)
  await page.screenshot({ path: `${OUT}/${LABEL}-end.png` })
  fs.writeFileSync(`${OUT}/${LABEL}-console.log`, logs.join('\n'))
  await ctx.close()

  await new Promise((r) => setTimeout(r, 8000))
  // FILTER BY COURSE. The tester account is shared: job #232's probe was
  // running its own eus_for_eng session against the same learner while run A
  // played spa_for_eng, and a learner+time query alone folded its rounds and
  // its cups lap into this run's timeline. The course code is the run's
  // identity here — every run drives exactly one course.
  const allRows = await rest(`player_events?select=occurred_at,event_type,course_code,session_id,payload&user_id=eq.${LEARNER}&occurred_at=gte.${startedAt}&order=occurred_at.asc&limit=6000`)
  const rows = allRows.filter((r) => r.course_code === COURSE)
  fs.writeFileSync(`${OUT}/${LABEL}-events.json`, JSON.stringify(rows, null, 1))
  if (rows.length !== allRows.length) {
    console.log(`${LABEL} NOTE — dropped ${allRows.length - rows.length} event rows belonging to another course/session on this account`)
  }

  // ---- the timeline ---------------------------------------------------------
  let completed = 0
  const timeline = []
  const seedReviews = []
  for (const r of rows) {
    if (r.event_type === 'round_complete') {
      completed++
      timeline.push(`round ${completed} complete (roundIndex ${r.payload?.roundIndex}, lego ${r.payload?.legoId})`)
    } else if (r.event_type === 'pod_lap_start') {
      timeline.push(`${r.payload?.isLayer1 === false ? '>>> LAYER-2 POD' : '    cups lap (L1)'} after ${completed} completed rounds (podRound ${r.payload?.podRound}, ${r.payload?.plays} plays)`)
    } else if (r.event_type === 'audio_play' && /_seed_?rep/i.test(r.payload?.cycleId || '')) {
      seedReviews.push(r.payload.cycleId)
    }
  }
  console.log(`--- ${LABEL} TIMELINE (${completed} rounds, mode ${MODE}) ---`)
  for (const line of timeline) console.log(line)
  const podsAt = []
  let n = 0
  for (const r of rows) {
    if (r.event_type === 'round_complete') n++
    if (r.event_type === 'pod_lap_start' && r.payload?.isLayer1 === false) podsAt.push(n)
  }
  console.log(`${LABEL} RESULT rounds=${completed} layer2PodsAfterRounds=[${podsAt.join(',')}] drainedSeedReviews=${seedReviews.length} ${seedReviews.slice(0, 5).join(',')}`)
} finally {
  await browser.close()
  await setMode(learnerRow?.preferences?.learning_mode ?? null)
  for (const e of enrolBefore) {
    if (process.env.KEEP_DEBT === '1' && e.course_id === COURSE) continue
    await setDebt(e.course_id, e.rounds_since_pod)
  }
  console.log('RESTORED', JSON.stringify(await rest(`course_enrollments?select=course_id,rounds_since_pod&learner_id=eq.${LEARNER}`)))
}
