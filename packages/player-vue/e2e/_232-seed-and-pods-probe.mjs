// Job #232 — LIVE proof on staging of Tom's two rulings of 2026-09-18:
//
//   1. A DRAINED SEED IS NEVER RE-SERVED. Spaced rep stops at offset 89, so no
//      cycle whose id names a seed review (`_seed_rep_` on the walk, `_seedrep`
//      on the bundle) may ever play again. Proved on `eus_for_eng`, a course on
//      the bundle allow-list where Mr Tom Tester is parked at round 386 — deep
//      enough that the ≥144 tier fired within minutes before the ruling (job
//      #149 captured exactly that, four clips per review, live on staging).
//      Run twice: the default BUNDLE path, and `?fullscript=walk`.
//
//   2. PODS BY MODE. Layer-2 pods every 2 completed rounds on EASY, every 4 on
//      FAST. The cadence is a work DEBT (`course_enrollments.rounds_since_pod`),
//      so it is provable in one round rather than four: park the debt one short
//      of the threshold and the next completed round must fire a lap; park it
//      two short and it must not. A layer-2 pod is `pod_lap_start` with
//      `isLayer1: false` — a cups lap carries `isLayer1: true`.
//
// Writes it makes, all to the tester's own rows, all snapshotted and restored
// at the end: `learners.preferences.learning_mode` and the enrollment's
// `rounds_since_pod`.
//
//   TMPDIR=$CS_SCRATCH/p232 \
//   CHROME_PATH=/home/tomcassidy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
//   node packages/player-vue/e2e/_232-seed-and-pods-probe.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+mrtomtester@gmail.com'
const LEARNER = 'e5d60bc7-e478-4a35-a968-69c5c5a5b6bd'
const OUT = process.env.OUT || `${process.env.CS_SCRATCH || '/tmp'}/p232`
fs.mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}
const rest = async (path, init) => {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H, ...init })
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

const version = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
console.log('served build', JSON.stringify(version))
if (process.env.EXPECT_BUILD) {
  check('served build is the promoted commit', version.buildNumber === process.env.EXPECT_BUILD, version.buildNumber)
  if (version.buildNumber !== process.env.EXPECT_BUILD) process.exit(1)
}

// ---- snapshot what we are about to touch -----------------------------------
const learnerRow = (await rest(`learners?select=preferences&id=eq.${LEARNER}`))[0]
const enrolBefore = await rest(`course_enrollments?select=course_id,rounds_since_pod&learner_id=eq.${LEARNER}`)
console.log('BEFORE', JSON.stringify({ prefs: learnerRow?.preferences?.learning_mode ?? null, enrolBefore }))

const setMode = (mode) => rest(`learners?id=eq.${LEARNER}`, {
  method: 'PATCH',
  body: JSON.stringify({ preferences: { ...(learnerRow?.preferences || {}), learning_mode: mode } }),
})
const setDebt = (course, n) => rest(`course_enrollments?learner_id=eq.${LEARNER}&course_id=eq.${course}`, {
  method: 'PATCH', body: JSON.stringify({ rounds_since_pod: n }),
})

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})

const session = async () => {
  const j = await (await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  return (await (await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: j.hashed_token }) })).json())
}

/** One run: open the player on `url`, play for `minutes`, return this run's events. */
async function play({ label, url, minutes }) {
  const sess = await session()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sess)])
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => logs.push(m.text()))
  const startedAt = new Date().toISOString()

  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(15000)
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await later.first().click().catch(() => {})
  for (const name of ['Continue', 'Start', 'Play', 'Resume']) {
    const b = page.getByRole('button', { name: new RegExp(`^${name}`, 'i') })
    if (await b.count()) { await b.first().click().catch(() => {}); break }
  }
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/${label}-playing.png` })

  const deadline = Date.now() + minutes * 60_000
  while (Date.now() < deadline) await page.waitForTimeout(15000)
  await page.screenshot({ path: `${OUT}/${label}-end.png` })
  fs.writeFileSync(`${OUT}/${label}-console.log`, logs.join('\n'))
  await ctx.close()

  // Give the event queue a moment to flush, then read this run's rows.
  await new Promise((r) => setTimeout(r, 8000))
  const rows = await rest(`player_events?select=occurred_at,event_type,payload&user_id=eq.${LEARNER}&occurred_at=gte.${startedAt}&order=occurred_at.asc&limit=4000`)
  fs.writeFileSync(`${OUT}/${label}-events.json`, JSON.stringify(rows, null, 1))
  return rows
}

const seedReviewPlays = (rows) => rows.filter(
  (r) => r.event_type === 'audio_play' && /_seed_?rep/i.test(r.payload?.cycleId || ''),
)
const layer2Pods = (rows) => rows.filter((r) => r.event_type === 'pod_lap_start' && r.payload?.isLayer1 === false)
const roundsDone = (rows) => rows.filter((r) => r.event_type === 'round_complete')

try {
  // ---- RUN 1 — bundle path, EASY, debt one short of 2 ----------------------
  await setMode('easy')
  await setDebt('eus_for_eng', 1)
  const r1 = await play({ label: '1-eus-bundle-easy', url: `${BASE}/?course=eus_for_eng&stream`, minutes: Number(process.env.MINUTES_1 || 7) })
  check('RUN1 bundle/EASY: rounds actually played', roundsDone(r1).length >= 1, `${roundsDone(r1).length} rounds`)
  check('RUN1 bundle/EASY: NO drained-seed review played', seedReviewPlays(r1).length === 0,
    JSON.stringify(seedReviewPlays(r1).map((r) => [r.payload.cycleId, r.payload.role])))
  check('RUN1 bundle/EASY: a layer-2 pod fired at the 2nd round of debt', layer2Pods(r1).length >= 1,
    `${layer2Pods(r1).length} pod laps, ${roundsDone(r1).length} rounds`)

  // ---- RUN 2 — the WALK, FAST, debt two short of 4 (negative control) ------
  await setMode('fast')
  await setDebt('eus_for_eng', 1)
  const r2 = await play({ label: '2-eus-walk-fast', url: `${BASE}/?course=eus_for_eng&fullscript=walk&stream`, minutes: Number(process.env.MINUTES_2 || 7) })
  const r2rounds = roundsDone(r2).length
  check('RUN2 walk/FAST: rounds actually played', r2rounds >= 1, `${r2rounds} rounds`)
  check('RUN2 walk/FAST: NO drained-seed review played', seedReviewPlays(r2).length === 0,
    JSON.stringify(seedReviewPlays(r2).map((r) => [r.payload.cycleId, r.payload.role])))
  if (r2rounds <= 2) {
    check('RUN2 walk/FAST: no pod yet — debt below 4', layer2Pods(r2).length === 0,
      `${layer2Pods(r2).length} pods after ${r2rounds} rounds`)
  } else {
    console.log(`NOTE — RUN2 played ${r2rounds} rounds, so the debt reached 4; ${layer2Pods(r2).length} pod laps`)
  }

  // ---- RUN 3 — the WALK, FAST, debt one short of 4 -------------------------
  await setMode('fast')
  await setDebt('cym_n_for_eng', 3)
  const r3 = await play({ label: '3-cym-walk-fast', url: `${BASE}/?course=cym_n_for_eng&stream`, minutes: Number(process.env.MINUTES_3 || 6) })
  check('RUN3 walk/FAST: rounds actually played', roundsDone(r3).length >= 1, `${roundsDone(r3).length} rounds`)
  check('RUN3 walk/FAST: a layer-2 pod fired at the 4th round of debt', layer2Pods(r3).length >= 1,
    `${layer2Pods(r3).length} pod laps, ${roundsDone(r3).length} rounds`)
} finally {
  await browser.close()
  // ---- restore --------------------------------------------------------------
  await setMode(learnerRow?.preferences?.learning_mode ?? null)
  for (const e of enrolBefore) await setDebt(e.course_id, e.rounds_since_pod)
  console.log('RESTORED', JSON.stringify(await rest(`course_enrollments?select=course_id,rounds_since_pod&learner_id=eq.${LEARNER}`)))
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
