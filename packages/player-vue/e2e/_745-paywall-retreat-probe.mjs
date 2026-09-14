// #745 live probe — a paywall raised off a STALE entitlement snapshot must not
// lose the learner's real position when the refreshed snapshot grants access.
// Signs in as the ZZ Test cover teacher (class coverage grants cym_s_for_eng),
// plants a saved position at S0031L01 (past Yellow), forces the FIRST
// entitlement fetch to answer empty (stale snapshot → wall), then lets the
// wall's own refresh answer for real. Reads localStorage + the DB cursor
// before, at the wall, and after playback resumes.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim().replace(/"/g, '')
const ANON = fs.readFileSync(process.env.ENV_LOCAL, 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim().replace(/"/g, '')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+chepstowtest-cover@gmail.com'
const LEARNER = '4d4f147e-d1bc-4ab6-8418-715fdff041fd'
const COURSE = 'cym_s_for_eng'
const REAL_LEGO = 'S0031L01', REAL_ROUND = 56
const OUT = process.env.OUT
fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const enrollUrl = `${U}/rest/v1/course_enrollments?learner_id=eq.${LEARNER}&course_id=eq.${COURSE}`
const readDb = async () => (await fetch(`${enrollUrl}&select=last_completed_lego_id,last_completed_round_index,current_cycle_index,last_practiced_at`, { headers: H }).then(r => r.json()))[0] ?? null

// Test setup: the account has no enrollment on this course. Plant one at the
// real position (practised an hour ago). Removed again at the end.
const pre = await readDb()
if (pre) { log('enrollment already exists — refusing to overwrite', pre); process.exit(2) }
const helix = { active_thread: 1, threads: { 1: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 }, 2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 }, 3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 } }, injected_content: {} }
const anHourAgo = new Date(Date.now() - 3600e3).toISOString()
const ins = await fetch(`${U}/rest/v1/course_enrollments`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ learner_id: LEARNER, course_id: COURSE, enrolled_at: anHourAgo, last_practiced_at: anHourAgo, total_practice_minutes: 0, helix_state: helix, last_completed_lego_id: REAL_LEGO, last_completed_round_index: REAL_ROUND, current_cycle_index: 0 }) })
if (!ins.ok) { log('insert failed', ins.status, await ins.text()); process.exit(2) }
log('DB before:', JSON.stringify(await readDb()))

const link = await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }).then(r => r.json())
const verified = await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }) }).then(r => r.json())
if (!verified.access_token) { log('verify failed', verified); process.exit(2) }
const session = { access_token: verified.access_token, refresh_token: verified.refresh_token, expires_in: verified.expires_in, expires_at: Math.floor(Date.now() / 1000) + (verified.expires_in || 3600), token_type: 'bearer', user: verified.user }

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log('  [console]', m.text().slice(0, 200)) })
page.on('pageerror', e => log('  [pageerror]', String(e).slice(0, 200)))
const posKey = `ssi_learning_position_${COURSE}`
await page.addInitScript(([authKey, sess, course, posKey, lego]) => {
  const ls = window.localStorage
  if (ls.getItem('__745_seeded')) return
  ls.setItem(authKey, JSON.stringify(sess))
  ls.setItem('ssi-last-course', course); ls.setItem('ssi-last-course-origin', 'chosen')
  ls.setItem(posKey, JSON.stringify({ legoId: lego, seedId: lego.slice(0, 5), seedNumber: 31, cycleId: null, itemInRound: 0, lastUpdated: Date.now(), courseCode: course }))
  // The STALE snapshot: an empty entitlement list cached a moment ago.
  ls.setItem('ssi_user_entitlements', JSON.stringify({ entitlements: [], cachedAt: Date.now() }))
  ls.setItem('__745_seeded', '1')
}, ['sb-swfvymspfxmnfhevgdkg-auth-token', session, COURSE, posKey, REAL_LEGO])

let wallSeen; const wallUp = new Promise(r => { wallSeen = r })
let calls = 0
await page.route('**/api/entitlement/user', async route => {
  const n = ++calls
  if (n === 1) { log(`entitlement fetch #${n} → forced EMPTY (stale snapshot)`); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entitlements: [] }) }) }
  await wallUp
  log(`entitlement fetch #${n} → passed through to the real API`)
  return route.continue()
})

const readLocal = () => page.evaluate(k => { try { const p = JSON.parse(localStorage.getItem(k) || 'null'); return p && { legoId: p.legoId, seed: p.seedNumber, item: p.itemInRound } } catch { return null } }, posKey)

await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' })
log('page open; waiting for the wall')
try {
  await page.locator('.paywall-overlay').first().waitFor({ state: 'visible', timeout: 90_000 })
} catch (e) {
  log('WALL NEVER ROSE'); await page.screenshot({ path: `${OUT}/no-wall.png` }); log('local:', JSON.stringify(await readLocal()))
  await browser.close(); process.exit(3)
}
await page.waitForTimeout(500)
log('WALL UP. local cursor at the wall:', JSON.stringify(await readLocal()), '| DB:', JSON.stringify(await readDb()))
await page.screenshot({ path: `${OUT}/1-wall.png` })
wallSeen()
try {
  await page.locator('.paywall-overlay').first().waitFor({ state: 'hidden', timeout: 30_000 })
  log('WALL DOWN after the refreshed grant')
} catch { log('wall did not close within 30s'); await page.screenshot({ path: `${OUT}/wall-stuck.png` }) }
await page.waitForTimeout(12_000) // let playback resume and the first prompt fire
await page.screenshot({ path: `${OUT}/2-after.png` })
const known = await page.locator('.known-text, .prompt-text, [class*="known"]').first().textContent().catch(() => null)
log('AFTER RESUME. local cursor:', JSON.stringify(await readLocal()), '| DB:', JSON.stringify(await readDb()), '| on screen:', (known || '').trim().slice(0, 80))
await browser.close()
if (process.env.KEEP_ROW !== '1') {
  const del = await fetch(enrollUrl, { method: 'DELETE', headers: H })
  log('test enrollment removed:', del.status)
}
