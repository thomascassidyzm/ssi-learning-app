// #761 live probe — backgrounding the app while the subscription answer is
// still in flight must not persist the preview landing over the real place.
// Cold verify of #757: positionInitialized fires before /api/subscription
// answers; the post-init gate waits for the answer, so nothing was held yet,
// and the dormant save (visibilitychange=hidden → saveResumeAudio) wrote
// S0019L01 over S0031L01 in localStorage and the DB. Since #761 the pending
// verdict is itself a write-hold, so both cursors stay on S0031L01.
//
// Signs in as +colombo-wall (genuinely unentitled), plants S0031L01 / round 56
// on cym_s_for_eng in the DB and localStorage, HOLDS /api/subscription for
// HOLD_MS (default 6000, under the 8s hydration bound), waits for the player to
// land (known text on screen), dispatches visibilitychange=hidden, foregrounds,
// then lets the subscription answer through and reads wall / localStorage / DB.
// Exit 1 on any cursor loss. Removes the planted row at the end.
// Env: CHROME_BIN, ENV_LOCAL (repo .env.local for the anon key), OUT; BASE
// optional (default staging); HOLD_MS optional.
import { chromium } from '../../../node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const HOLD_MS = Number(process.env.HOLD_MS || 6000)
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim().replace(/"/g, '')
const ANON = fs.readFileSync(process.env.ENV_LOCAL, 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim().replace(/"/g, '')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+colombo-wall@gmail.com'
const LEARNER = '268f0dbd-f15f-482d-8f80-fda96cf3f831'
const COURSE = 'cym_s_for_eng'
const REAL_LEGO = 'S0031L01', REAL_ROUND = 56
const OUT = process.env.OUT
fs.mkdirSync(OUT, { recursive: true })
const t0 = Date.now()
const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(2)}s`, ...a)

const enrollUrl = `${U}/rest/v1/course_enrollments?learner_id=eq.${LEARNER}&course_id=eq.${COURSE}`
const readDb = async () => (await fetch(`${enrollUrl}&select=last_completed_lego_id,last_completed_round_index,current_cycle_index,last_practiced_at`, { headers: H }).then(r => r.json()))[0] ?? null

const pre = await readDb()
if (pre) { log('enrollment already exists — refusing to overwrite', pre); process.exit(2) }
const helix = { active_thread: 1, threads: { 1: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 }, 2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 }, 3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 } }, injected_content: {} }
const anHourAgo = new Date(Date.now() - 3600e3).toISOString()
const ins = await fetch(`${U}/rest/v1/course_enrollments`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ learner_id: LEARNER, course_id: COURSE, enrolled_at: anHourAgo, last_practiced_at: anHourAgo, total_practice_minutes: 0, helix_state: helix, last_completed_lego_id: REAL_LEGO, last_completed_round_index: REAL_ROUND, current_cycle_index: 0 }) })
if (!ins.ok) { log('insert failed', ins.status, await ins.text()); process.exit(2) }
log('DB before:', JSON.stringify(await readDb()))

const cleanup = async () => { const del = await fetch(enrollUrl, { method: 'DELETE', headers: H }); log('test enrollment removed:', del.status) }
process.on('SIGINT', async () => { await cleanup(); process.exit(130) })
process.on('SIGTERM', async () => { await cleanup(); process.exit(143) })

const link = await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }).then(r => r.json())
const verified = await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }) }).then(r => r.json())
if (!verified.access_token) { log('verify failed', verified); await cleanup(); process.exit(2) }
const session = { access_token: verified.access_token, refresh_token: verified.refresh_token, expires_in: verified.expires_in, expires_at: Math.floor(Date.now() / 1000) + (verified.expires_in || 3600), token_type: 'bearer', user: verified.user }

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || /Position saved|resume gate|paywall|held at the wall/i.test(t)) log(`  [${m.type()}]`, t.replace(/\s+/g, ' ').slice(0, 200)) })
page.on('pageerror', e => log('  [pageerror]', String(e).slice(0, 200)))
const posKey = `ssi_learning_position_${COURSE}`
await page.addInitScript(([authKey, sess, course, posKey, lego]) => {
  const ls = window.localStorage
  if (ls.getItem('__761_seeded')) return
  ls.setItem(authKey, JSON.stringify(sess))
  ls.setItem('ssi-last-course', course); ls.setItem('ssi-last-course-origin', 'chosen')
  ls.setItem(posKey, JSON.stringify({ legoId: lego, seedId: lego.slice(0, 5), seedNumber: 31, cycleId: null, itemInRound: 0, lastUpdated: Date.now(), courseCode: course }))
  ls.setItem('__761_seeded', '1')
}, ['sb-swfvymspfxmnfhevgdkg-auth-token', session, COURSE, posKey, REAL_LEGO])

// Throttle the subscription answer: hold every /api/subscription call for
// HOLD_MS so init lands, and the backgrounding below happens, before hydration.
let subscriptionAnsweredAt = null
await page.route('**/api/subscription**', async route => {
  log('  /api/subscription requested — holding', HOLD_MS, 'ms')
  await new Promise(r => setTimeout(r, HOLD_MS))
  subscriptionAnsweredAt = Date.now()
  log('  /api/subscription released to the real server')
  return route.continue()
})

const readLocal = () => page.evaluate(k => { try { const p = JSON.parse(localStorage.getItem(k) || 'null'); return p && { legoId: p.legoId, seed: p.seedNumber, item: p.itemInRound } } catch { return null } }, posKey)
const readScreen = () => page.locator('.known-text, .prompt-text, [class*="known"]').first().textContent({ timeout: 100 }).then(t => (t || '').trim().slice(0, 40)).catch(() => null)
const wallVisible = () => page.locator('.paywall-overlay').first().isVisible({ timeout: 100 }).catch(() => false)
const setVisibility = (state) => page.evaluate((s) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
}, state)

await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' })
log('page open')
// Background the page every 400ms until the subscription answer is released:
// positionInitialized lands somewhere inside that window (the production
// build strips the console line that would say when), so at least one
// visibilitychange=hidden fires after init and before hydration — the
// learner-visible case is "backgrounded at any moment during the first
// seconds". Each hidden dispatch is the dormant save's trigger.
let hiddenCount = 0, firstHiddenAfterLandingAt = null, lostAt = null, hiddenAt = null
const afterHidden = { local: null, db: null }
for (let i = 0; i < 40 && subscriptionAnsweredAt === null; i++) {
  await page.waitForTimeout(250)
  if (subscriptionAnsweredAt !== null) break
  const screen = await readScreen()
  hiddenAt = Date.now(); hiddenCount++
  await setVisibility('hidden')
  await page.waitForTimeout(150)
  await setVisibility('visible')
  const local = await readLocal()
  if (screen && firstHiddenAfterLandingAt === null) firstHiddenAfterLandingAt = hiddenAt
  if (local?.legoId !== REAL_LEGO && lostAt === null) { lostAt = Date.now(); log(`  LOCAL CURSOR LOST on hidden #${hiddenCount}: local=${JSON.stringify(local)} screen="${screen}"`) }
  if (i % 4 === 3) log(`  hidden #${hiddenCount} wall=${await wallVisible()} local=${JSON.stringify(local)} screen="${screen}"`)
}
log(`backgrounded ${hiddenCount} times before the subscription answer; last hidden at +${((hiddenAt - t0) / 1000).toFixed(2)}s`)
afterHidden.local = await readLocal(); afterHidden.db = await readDb()
log('  after the backgrounding window: local=', JSON.stringify(afterHidden.local), 'db=', JSON.stringify(afterHidden.db))
// Let the held subscription answer land and the gate run.
let firstWallAt = null
for (let t = 0; t < 40; t++) {
  await page.waitForTimeout(500)
  const wall = await wallVisible()
  if (wall && firstWallAt === null) { firstWallAt = Date.now(); log('  wall UP'); await page.screenshot({ path: `${OUT}/wall.png` }) }
  if (t % 4 === 3) log(`  wall=${wall} local=${JSON.stringify(await readLocal())} screen=${await readScreen()}`)
  if (firstWallAt && Date.now() - firstWallAt > 3000) break
}
const final = { local: await readLocal(), db: await readDb(), wall: await wallVisible(), screen: await readScreen() }
await page.screenshot({ path: `${OUT}/end.png` })
// Every backgrounding happened before the answer was released; the first one
// after the player showed text is the one that matters.
const preHydration = firstHiddenAfterLandingAt !== null && subscriptionAnsweredAt !== null && hiddenAt < subscriptionAnsweredAt
const ok = preHydration && final.local?.legoId === REAL_LEGO && final.db?.last_completed_lego_id === REAL_LEGO && final.db?.last_completed_round_index === REAL_ROUND && final.wall
log('RESULT', JSON.stringify({ backgroundedBeforeHydration: preHydration, hiddenCount, lastHiddenAfterOpenMs: hiddenAt - t0, localLostAtMs: lostAt && lostAt - t0, afterHidden, final }))
log(ok ? 'PASS — both cursors still S0031L01, wall up' : 'FAIL — cursor moved or wall down')
await browser.close()
await cleanup()
process.exit(ok ? 0 : 1)
