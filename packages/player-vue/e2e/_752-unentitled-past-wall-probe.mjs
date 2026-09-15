// #752 live probe — a genuinely UNENTITLED learner whose saved position lies
// past the free preview must be held at the wall: wall shown, landed on the
// last preview round, localStorage and DB cursor left exactly as saved.
// Signs in as +colombo-wall (empty entitlement list, no class cover), plants a
// saved position at S0031L01 on cym_s_for_eng (past Yellow), opens the player
// and reads localStorage + the DB cursor + the screen for ~25s. Removes the
// planted row at the end. LOCAL=0 plants only the DB row (cold device).
import { chromium } from '../../../node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim().replace(/"/g, '')
const ANON = fs.readFileSync(process.env.ENV_LOCAL, 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim().replace(/"/g, '')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+colombo-wall@gmail.com'
const LEARNER = '268f0dbd-f15f-482d-8f80-fda96cf3f831'
const COURSE = 'cym_s_for_eng'
const REAL_LEGO = 'S0031L01', REAL_ROUND = 56
const PLANT_LOCAL = process.env.LOCAL !== '0'
const OUT = process.env.OUT
fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const enrollUrl = `${U}/rest/v1/course_enrollments?learner_id=eq.${LEARNER}&course_id=eq.${COURSE}`
const readDb = async () => (await fetch(`${enrollUrl}&select=last_completed_lego_id,last_completed_round_index,current_cycle_index,last_practiced_at`, { headers: H }).then(r => r.json()))[0] ?? null

const pre = await readDb()
if (pre) { log('enrollment already exists — refusing to overwrite', pre); process.exit(2) }
const helix = { active_thread: 1, threads: { 1: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 }, 2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 }, 3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 } }, injected_content: {} }
const anHourAgo = new Date(Date.now() - 3600e3).toISOString()
const ins = await fetch(`${U}/rest/v1/course_enrollments`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ learner_id: LEARNER, course_id: COURSE, enrolled_at: anHourAgo, last_practiced_at: anHourAgo, total_practice_minutes: 0, helix_state: helix, last_completed_lego_id: REAL_LEGO, last_completed_round_index: REAL_ROUND, current_cycle_index: 0 }) })
if (!ins.ok) { log('insert failed', ins.status, await ins.text()); process.exit(2) }
log('DB before:', JSON.stringify(await readDb()))

const cleanup = async () => { if (process.env.KEEP_ROW !== '1') { const del = await fetch(enrollUrl, { method: 'DELETE', headers: H }); log('test enrollment removed:', del.status) }; await removeRealGrant?.() }
process.on('SIGINT', async () => { await cleanup(); process.exit(130) })
process.on('SIGTERM', async () => { await cleanup(); process.exit(143) })

const link = await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }).then(r => r.json())
const verified = await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }) }).then(r => r.json())
if (!verified.access_token) { log('verify failed', verified); await cleanup(); process.exit(2) }
const session = { access_token: verified.access_token, refresh_token: verified.refresh_token, expires_in: verified.expires_in, expires_at: Math.floor(Date.now() / 1000) + (verified.expires_in || 3600), token_type: 'bearer', user: verified.user }
const ent = await fetch(`${BASE}/api/entitlement/user`, { headers: { Authorization: `Bearer ${verified.access_token}` } }).then(r => r.json())
log('server entitlement list for this account:', JSON.stringify(ent))

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
page.on('console', m => {
  const t = m.text()
  if (m.type() === 'error' || m.type() === 'warning' || (process.env.VERBOSE && /jumpToRound|Position saved|Loaded position|resume|Resume|paywall|Paywall|initialize|landed|RESUME|retreat|entitle|Entitle|starting at|cursor|beyond|wall/i.test(t)))
    log(`  [${m.type()}]`, t.replace(/\s+/g, ' ').slice(0, 240))
})
page.on('pageerror', e => log('  [pageerror]', String(e).slice(0, 200)))
const posKey = `ssi_learning_position_${COURSE}`
await page.addInitScript(([authKey, sess, course, posKey, lego, plantLocal]) => {
  const ls = window.localStorage
  if (ls.getItem('__752_seeded')) return
  ls.setItem(authKey, JSON.stringify(sess))
  ls.setItem('ssi-last-course', course); ls.setItem('ssi-last-course-origin', 'chosen')
  if (plantLocal) ls.setItem(posKey, JSON.stringify({ legoId: lego, seedId: lego.slice(0, 5), seedNumber: 31, cycleId: null, itemInRound: 0, lastUpdated: Date.now(), courseCode: course }))
  ls.setItem('__752_seeded', '1')
}, ['sb-swfvymspfxmnfhevgdkg-auth-token', session, COURSE, posKey, REAL_LEGO, PLANT_LOCAL])

// GRANT=1: once the wall is up, every entitlement fetch answers a FULL grant
// (the server still serves the preview bundle, so the remembered LEGO is not in
// the engine queue). Expected since the #752 addition: wall down, playback NOT
// resumed at the retreat (resting screen stays), localStorage still S0031L01.
// The boot fetch answers for real (empty); every later one — the wall's own
// refresh included — answers the grant.
// GRANT=db (job #757): the REAL grant. The wall's own refresh is held until a
// real user_entitlements row (access_type full) exists for this learner, then
// continued — so the real server answers the refresh with the grant, and the
// real content gate hands the full bundle to the player's refetch. Expected
// since #757: wall down, the script refetched, playback RESUMED on S0031L01
// within a few seconds, localStorage and DB cursor on S0031L01 throughout.
// The row is removed with the enrollment at the end.
let entCalls = 0
let grantedAt = null
let entitlementRowId = null
const entUrl = `${U}/rest/v1/user_entitlements`
const plantRealGrant = async () => {
  const r = await fetch(entUrl, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ learner_id: LEARNER, access_type: 'full', granted_courses: null, expires_at: null, redeemed_at: new Date().toISOString() }) })
  const rows = await r.json().catch(() => null)
  if (!r.ok || !rows?.[0]?.id) { log('real grant insert failed', r.status, JSON.stringify(rows)); return false }
  entitlementRowId = rows[0].id
  grantedAt = Date.now()
  log('REAL GRANT planted: user_entitlements', entitlementRowId)
  return true
}
const removeRealGrant = async () => {
  if (!entitlementRowId) return
  const del = await fetch(`${entUrl}?id=eq.${entitlementRowId}`, { method: 'DELETE', headers: H })
  log('real grant removed:', del.status); entitlementRowId = null
}
if (process.env.GRANT === '1') {
  await page.route('**/api/entitlement/user', async route => {
    if (++entCalls === 1) return route.continue()
    log('entitlement fetch → forced FULL grant')
    grantedAt = grantedAt ?? Date.now()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entitlements: [{ id: 'fake', access_type: 'full', granted_courses: null, expires_at: null, redeemed_at: new Date().toISOString(), entitlement_code_id: null }] }) })
  })
} else if (process.env.GRANT === 'db') {
  await page.route('**/api/entitlement/user', async route => {
    if (++entCalls === 1) return route.continue()
    if (!entitlementRowId) await plantRealGrant()
    log('entitlement fetch → continued to the real server with the real grant in place')
    return route.continue()
  })
}
page.on('request', r => { const u = r.url(); if (u.includes('/api/courses/') || u.includes('/api/progress') || u.includes('course_enrollments') || u.includes('/api/entitlement')) log('  [req]', r.method(), u.replace(BASE, '').slice(0, 140)) })
page.on('response', r => { const u = r.url(); if ((u.includes('/api/courses/') || u.includes('/api/entitlement')) && r.status() >= 400) log('  [resp]', r.status(), u.replace(BASE, '').slice(0, 120)) })
const readLocal = () => page.evaluate(k => { try { const p = JSON.parse(localStorage.getItem(k) || 'null'); return p && { legoId: p.legoId, seed: p.seedNumber, item: p.itemInRound } } catch { return null } }, posKey)
const readScreen = () => page.locator('.known-text, .prompt-text, [class*="known"]').first().textContent().then(t => (t || '').trim().slice(0, 40)).catch(() => null)
const wallVisible = () => page.locator('.paywall-overlay').first().isVisible().catch(() => false)
// Playing = the centre button is in its Stop shape (BottomNav isStopMode).
const isPlaying = () => page.locator('.center-btn.is-stop').first().isVisible().catch(() => false)
// No auto-wait: the line is usually absent, and a waiting locator costs 30s per read.
const loadingLine = () => page.locator('.preparing-text').first().textContent({ timeout: 100 }).then(t => (t || '').trim().slice(0, 40)).catch(() => null)

await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' })
log('page open (local planted:', PLANT_LOCAL, ')')
let firstWallAt = null
for (let t = 0; t < 50; t++) {
  await page.waitForTimeout(500)
  const wall = await wallVisible()
  if (wall && firstWallAt === null) {
    firstWallAt = (t + 1) * 0.5; await page.screenshot({ path: `${OUT}/wall.png` })
  }
  if (t % 4 === 3 || (wall && firstWallAt === (t + 1) * 0.5)) log(`  t+${(t + 1) * 0.5}s wall=${wall} local=${JSON.stringify(await readLocal())} screen=${await readScreen()}`)
  // GRANT modes: the moment the grant is in, hand over to the fine-grained loop below.
  if (process.env.GRANT && grantedAt) break
}
// GRANT modes: after the grant, watch for the wall going down, the loading
// line, play resuming and the held LEGO's phrase on screen — with timings from
// the grant. Reads every 250ms for up to 40s.
if (process.env.GRANT) {
  const heldKnown = process.env.HELD_KNOWN || 'that you speak'
  let wallDownAt = null, playingAt = null, phraseAt = null, sawLoading = null
  for (let t = 0; t < 160; t++) {
    await page.waitForTimeout(250)
    const now = Date.now()
    const wall = await wallVisible(), playing = await isPlaying(), screen = await readScreen(), line = await loadingLine()
    if (line && !sawLoading) { sawLoading = line; log(`  loading line shown: "${line}"`) }
    if (!wall && wallDownAt === null && grantedAt) { wallDownAt = now; log(`  wall DOWN at +${((now - grantedAt) / 1000).toFixed(1)}s after grant`) }
    if (playing && playingAt === null && grantedAt) { playingAt = now; log(`  PLAYING at +${((now - grantedAt) / 1000).toFixed(1)}s after grant, screen="${screen}"`); await page.screenshot({ path: `${OUT}/resumed.png` }) }
    if (screen && screen.toLowerCase().includes(heldKnown) && phraseAt === null && grantedAt) { phraseAt = now; log(`  held LEGO's phrase on screen at +${((now - grantedAt) / 1000).toFixed(1)}s after grant`) }
    if (t % 8 === 7) log(`  g+${((t + 1) * 0.25).toFixed(2)}s wall=${wall} playing=${playing} local=${JSON.stringify(await readLocal())} screen=${screen}`)
    if (playingAt && phraseAt && t > 40) break
  }
  log('GRANT RESULT', JSON.stringify({ grantedAt: !!grantedAt, wallDownAfterMs: wallDownAt && grantedAt ? wallDownAt - grantedAt : null, playingAfterMs: playingAt && grantedAt ? playingAt - grantedAt : null, phraseAfterMs: phraseAt && grantedAt ? phraseAt - grantedAt : null, loadingLine: sawLoading, local: await readLocal(), db: await readDb() }))
}
// MAYBE_LATER=1: dismiss the wall and play on inside the preview. The saved
// place must survive — the memory is spent only by a prompt on the remembered
// round, and S0031L01 is not in the preview queue.
if (process.env.MAYBE_LATER === '1' && await wallVisible()) {
  await page.locator('.paywall-btn-ghost').first().click()
  await page.waitForTimeout(600)
  log('MAYBE LATER tapped. wall=', await wallVisible(), 'local=', JSON.stringify(await readLocal()))
  await page.locator('.center-btn').first().click().catch(e => log('play tap failed', String(e).slice(0, 80)))
  for (let t = 0; t < 30; t++) {
    await page.waitForTimeout(500)
    if (t % 4 === 3) log(`  play+${(t + 1) * 0.5}s wall=${await wallVisible()} local=${JSON.stringify(await readLocal())} screen=${await readScreen()}`)
  }
  await page.screenshot({ path: `${OUT}/played-on.png` })
  // PREV=1 (job #757 addition): tap "Previous phrase" inside the preview.
  // That path (handleRoundBack → persistCursorAtCurrentRound → setRemoteCursor)
  // used to bypass the hold and write a preview position over the DB cursor.
  // Expected since #757: DB cursor still S0031L01 / 56 after the tap.
  if (process.env.PREV === '1') {
    await page.locator('button.pill-btn[title="Previous phrase"]').first().click().catch(e => log('previous tap failed', String(e).slice(0, 80)))
    for (let t = 0; t < 12; t++) {
      await page.waitForTimeout(500)
      if (t % 4 === 3) log(`  prev+${(t + 1) * 0.5}s wall=${await wallVisible()} local=${JSON.stringify(await readLocal())} DB=${JSON.stringify(await readDb())} screen=${await readScreen()}`)
    }
    const db = await readDb()
    log('PREV RESULT', JSON.stringify({ dbLego: db?.last_completed_lego_id, dbRound: db?.last_completed_round_index, cycle: db?.current_cycle_index, local: await readLocal(), screen: await readScreen() }))
  }
}
await page.screenshot({ path: `${OUT}/end.png` })
log('RESULT wallFirstSeenAt:', firstWallAt, '| wallNow:', await wallVisible(), '| local:', JSON.stringify(await readLocal()), '| DB:', JSON.stringify(await readDb()), '| screen:', await readScreen())
await browser.close()
await cleanup()
