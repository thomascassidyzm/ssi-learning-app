// #768 live probe — the long-absence belt rewind must not move an unentitled
// learner's cursor, and must not decide before the subscription verdict.
//
// Signs in as +colombo-wall (genuinely unentitled), plants S0031L01 / round 56
// on cym_s_for_eng with last_practiced_at GAP_DAYS back (default 90, past the
// 60-day belt-regression threshold), and the matching localStorage cursor.
// HOLDS /api/subscription for HOLD_MS (default 6000, under the 8s hydration
// bound) so the TTL block's decision window overlaps pending hydration. Then
// waits for the wall and reads wall / localStorage / DB / player_events.
//
// WARM=1 (the "cached full bundle" half, planted honestly): a first pass runs
// with a REAL user_entitlements row for the learner and a recent
// last_practiced_at, in a persistent browser profile, so the entitled open
// caches whatever the app caches; the entitlement row is then removed, the
// timestamp pushed back GAP_DAYS, and the unentitled open runs in the SAME
// profile. Without WARM the open is cold (no cache).
//
// PASS = DB S0031L01/56 (or the row unchanged), localStorage S0031L01, wall up,
// and NO cursor_move with reason resume_ttl_belt_regression for this learner
// since the probe began. Exit 1 otherwise. Removes every planted row at the
// end, also on SIGINT/SIGTERM.
// Env: CHROME_BIN, ENV_LOCAL (repo .env.local for the anon key), OUT; BASE
// optional (default staging); HOLD_MS, GAP_DAYS, WARM optional.
import { chromium } from '../../../node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const HOLD_MS = Number(process.env.HOLD_MS || 6000)
const GAP_DAYS = Number(process.env.GAP_DAYS || 90)
const WARM = process.env.WARM === '1'
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
const startedIso = new Date(t0).toISOString()
const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(2)}s`, ...a)

const enrollUrl = `${U}/rest/v1/course_enrollments?learner_id=eq.${LEARNER}&course_id=eq.${COURSE}`
const entUrl = `${U}/rest/v1/user_entitlements?learner_id=eq.${LEARNER}`
const readDb = async () => (await fetch(`${enrollUrl}&select=last_completed_lego_id,last_completed_round_index,current_cycle_index,last_practiced_at`, { headers: H }).then(r => r.json()))[0] ?? null
const readRegressionEvents = async () => fetch(`${U}/rest/v1/player_events?user_id=eq.${LEARNER}&event_type=eq.cursor_move&occurred_at=gte.${encodeURIComponent(startedIso)}&select=occurred_at,payload`, { headers: H }).then(r => r.json())
  .then(rows => (Array.isArray(rows) ? rows : []).filter(r => r?.payload?.reason === 'resume_ttl_belt_regression'))

const pre = await readDb()
if (pre) { log('enrollment already exists — refusing to overwrite', pre); process.exit(2) }
const preEnt = await fetch(`${entUrl}&select=id`, { headers: H }).then(r => r.json())
if (Array.isArray(preEnt) && preEnt.length) { log('entitlement rows already exist — refusing', preEnt); process.exit(2) }

const helix = { active_thread: 1, threads: { 1: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 }, 2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 }, 3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 } }, injected_content: {} }
const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString()
const ins = await fetch(`${U}/rest/v1/course_enrollments`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ learner_id: LEARNER, course_id: COURSE, enrolled_at: daysAgo(GAP_DAYS + 30), last_practiced_at: WARM ? new Date(Date.now() - 3600e3).toISOString() : daysAgo(GAP_DAYS), total_practice_minutes: 0, helix_state: helix, last_completed_lego_id: REAL_LEGO, last_completed_round_index: REAL_ROUND, current_cycle_index: 0 }) })
if (!ins.ok) { log('insert failed', ins.status, await ins.text()); process.exit(2) }
log('DB planted:', JSON.stringify(await readDb()))

let entPlanted = false
const cleanup = async () => {
  const del = await fetch(enrollUrl, { method: 'DELETE', headers: H }); log('test enrollment removed:', del.status)
  if (entPlanted) { const d2 = await fetch(entUrl, { method: 'DELETE', headers: H }); log('test entitlement removed:', d2.status); entPlanted = false }
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130) })
process.on('SIGTERM', async () => { await cleanup(); process.exit(143) })

const link = await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }).then(r => r.json())
const verified = await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }) }).then(r => r.json())
if (!verified.access_token) { log('verify failed', verified); await cleanup(); process.exit(2) }
const session = { access_token: verified.access_token, refresh_token: verified.refresh_token, expires_in: verified.expires_in, expires_at: Math.floor(Date.now() / 1000) + (verified.expires_in || 3600), token_type: 'bearer', user: verified.user }

const profileDir = `${OUT}/profile`
const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio']
const posKey = `ssi_learning_position_${COURSE}`
const seed = (page, tag) => page.addInitScript(([authKey, sess, course, posKey, lego, tag]) => {
  const ls = window.localStorage
  if (ls.getItem(tag)) return
  ls.setItem(authKey, JSON.stringify(sess))
  ls.setItem('ssi-last-course', course); ls.setItem('ssi-last-course-origin', 'chosen')
  ls.setItem(posKey, JSON.stringify({ legoId: lego, seedId: lego.slice(0, 5), seedNumber: 31, cycleId: null, itemInRound: 0, lastUpdated: Date.now(), courseCode: course }))
  ls.setItem(tag, '1')
}, ['sb-swfvymspfxmnfhevgdkg-auth-token', session, COURSE, posKey, REAL_LEGO, tag])
const wire = (page) => {
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' || /ResumeTTL|InstantPlayback|legacy|resume gate|paywall|held at the wall|Position saved|cursor/i.test(t)) log(`  [${m.type()}]`, t.replace(/\s+/g, ' ').slice(0, 220)) })
  page.on('pageerror', e => log('  [pageerror]', String(e).slice(0, 200)))
}
const readLocal = (page) => page.evaluate(k => { try { const p = JSON.parse(localStorage.getItem(k) || 'null'); return p && { legoId: p.legoId, seed: p.seedNumber, item: p.itemInRound } } catch { return null } }, posKey)
const readScreen = (page) => page.locator('.known-text, .prompt-text, [class*="known"]').first().textContent({ timeout: 100 }).then(t => (t || '').trim().slice(0, 40)).catch(() => null)
const wallVisible = (page) => page.locator('.paywall-overlay').first().isVisible({ timeout: 100 }).catch(() => false)

if (WARM) {
  // Honest cache planting: a REAL entitled open in the profile we reuse.
  const ent = await fetch(`${U}/rest/v1/user_entitlements`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ learner_id: LEARNER, access_type: 'full', granted_courses: null }) })
  if (!ent.ok) { log('entitlement insert failed', ent.status, await ent.text()); await cleanup(); process.exit(2) }
  entPlanted = true
  log('WARM: real entitlement planted; entitled open to fill the cache')
  const ctx = await chromium.launchPersistentContext(profileDir, { executablePath: process.env.CHROME_BIN, args: launchArgs, viewport: { width: 430, height: 900 } })
  const page = ctx.pages()[0] ?? await ctx.newPage()
  wire(page)
  await seed(page, '__768_seeded_warm')
  await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' })
  for (let t = 0; t < 30; t++) { await page.waitForTimeout(500); const s = await readScreen(page); if (s) { log(`  WARM: player landed on "${s}" wall=${await wallVisible(page)}`); break } }
  await page.waitForTimeout(8000) // let the script/bundle cache fill
  const cacheNames = await page.evaluate(async () => { try { return (await indexedDB.databases()).map(d => d.name) } catch { return ['(indexedDB.databases unavailable)'] } })
  log('  WARM: IndexedDB databases after the entitled open:', JSON.stringify(cacheNames))
  log('  WARM: local=', JSON.stringify(await readLocal(page)), 'db=', JSON.stringify(await readDb()))
  await page.screenshot({ path: `${OUT}/warm.png` })
  await ctx.close()
  const d2 = await fetch(entUrl, { method: 'DELETE', headers: H }); entPlanted = false; log('  WARM: entitlement removed:', d2.status)
  // The entitled open may have advanced/stamped the row; force the probe state.
  const upd = await fetch(enrollUrl, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ last_completed_lego_id: REAL_LEGO, last_completed_round_index: REAL_ROUND, current_cycle_index: 0, last_practiced_at: daysAgo(GAP_DAYS) }) })
  log('  WARM: enrollment reset to the probe state:', upd.status, JSON.stringify(await readDb()))
}

const ctx = WARM
  ? await chromium.launchPersistentContext(profileDir, { executablePath: process.env.CHROME_BIN, args: launchArgs, viewport: { width: 430, height: 900 } })
  : await (await chromium.launch({ executablePath: process.env.CHROME_BIN, args: launchArgs })).newContext({ viewport: { width: 430, height: 900 } })
const page = ctx.pages()[0] ?? await ctx.newPage()
wire(page)
await seed(page, '__768_seeded')
if (WARM) await page.addInitScript(([posKey, lego, course]) => {
  // The entitled open rewrote the local cursor; put the probe's back.
  window.localStorage.setItem(posKey, JSON.stringify({ legoId: lego, seedId: lego.slice(0, 5), seedNumber: 31, cycleId: null, itemInRound: 0, lastUpdated: Date.now(), courseCode: course }))
}, [posKey, REAL_LEGO, COURSE])

let subscriptionAnsweredAt = null, subscriptionRequestedAt = null
await page.route('**/api/subscription**', async route => {
  subscriptionRequestedAt = subscriptionRequestedAt ?? Date.now()
  log('  /api/subscription requested — holding', HOLD_MS, 'ms')
  await new Promise(r => setTimeout(r, HOLD_MS))
  subscriptionAnsweredAt = Date.now()
  log('  /api/subscription released to the real server')
  return route.continue()
})

await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' })
log('page open (cold=' + !WARM + ', gapDays=' + GAP_DAYS + ')')
let firstWallAt = null, landedAt = null
for (let t = 0; t < 60; t++) {
  await page.waitForTimeout(500)
  const wall = await wallVisible(page)
  const screen = await readScreen(page)
  if (screen && landedAt === null) { landedAt = Date.now(); log(`  player landed on "${screen}" local=${JSON.stringify(await readLocal(page))}`) }
  if (wall && firstWallAt === null) { firstWallAt = Date.now(); log('  wall UP'); await page.screenshot({ path: `${OUT}/wall.png` }) }
  if (t % 4 === 3) log(`  wall=${wall} local=${JSON.stringify(await readLocal(page))} screen=${screen} db=${JSON.stringify(await readDb())}`)
  if (firstWallAt && Date.now() - firstWallAt > 4000) break
}
const final = { local: await readLocal(page), db: await readDb(), wall: await wallVisible(page), screen: await readScreen(page), regressionEvents: await readRegressionEvents() }
await page.screenshot({ path: `${OUT}/end.png` })
const ok = final.local?.legoId === REAL_LEGO && final.db?.last_completed_lego_id === REAL_LEGO && final.db?.last_completed_round_index === REAL_ROUND && final.wall && final.regressionEvents.length === 0
log('RESULT', JSON.stringify({ warm: WARM, gapDays: GAP_DAYS, holdMs: HOLD_MS, subscriptionRequestedAtMs: subscriptionRequestedAt && subscriptionRequestedAt - t0, subscriptionAnsweredAtMs: subscriptionAnsweredAt && subscriptionAnsweredAt - t0, landedAtMs: landedAt && landedAt - t0, wallAtMs: firstWallAt && firstWallAt - t0, final }))
log(ok ? 'PASS — no rewind write, both cursors still S0031L01, wall up' : 'FAIL — cursor moved, rewind event fired, or wall down')
await ctx.close()
await cleanup()
process.exit(ok ? 0 : 1)
