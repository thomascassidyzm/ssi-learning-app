// Job #128 — LIVE proof on staging that a cycle id now NAMES the phrase it plays.
//
// Signs in as the real ZZ Test teacher (thomas.cassidy+mrtomtester@gmail.com,
// teacher of "Y7 Welsh", cym_n_for_eng), taps Play as class, lets a few cycles
// run, then reads that class learner's own diary back out of player_events and
// checks the shape of the ids written. Finally opens the class's Course journey
// card and shoots it.
//
//   LD_LIBRARY_PATH=… CHROME_BIN=… TMPDIR=/home/tomcassidy/.tmpbig/p128 \
//   node e2e/_128-class-play-cycleid-probe.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+mrtomtester@gmail.com'
const CLASS_ID = 'd52efceb-da67-413b-a660-9fbe6c48a494'
const CLASS_LEARNER = '2ffd2a0d-80e1-4fa9-9c69-28e509ed0949'
const OUT = process.env.OUT || '/home/tomcassidy/.tmpbig/p128'
fs.mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const version = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
console.log('served build', JSON.stringify(version))
if (process.env.EXPECT_BUILD) check('served build is the promoted commit', version.buildNumber === process.env.EXPECT_BUILD, version.buildNumber)

const startedAt = new Date().toISOString()

const j = await (await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
const sess = await (await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: j.hashed_token }) })).json()
check('minted a session for the teacher', !!sess.access_token, sess.error_description || sess.msg || '')
if (!sess.access_token) process.exit(1)

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sess)])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const dismissLater = async () => { const b = page.getByRole('button', { name: 'Later', exact: true }); if (await b.count()) await b.first().click().catch(() => {}) }

// The cached-role rule: the very first open of a fresh device reaches the player.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(8000); await dismissLater()
await page.goto(`${BASE}/schools/classes/${CLASS_ID}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(9000); await dismissLater(); await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/1-class-page.png`, fullPage: true })

const pac = page.locator('button', { hasText: /Play as class/i })
check('Play as class is on the class page', (await pac.count()) >= 1, `count=${await pac.count()}`)
if (await pac.count()) await pac.first().click().catch(() => {})
await page.waitForTimeout(6000); await dismissLater()
await page.screenshot({ path: `${OUT}/2-after-play-tap.png`, fullPage: true })

// Whatever tray/confirm the flow puts up, take the obvious way in.
for (const name of [/^Play$/i, /Start/i, /Continue/i, /Play as class/i]) {
  const b = page.locator('button', { hasText: name })
  if (await b.count()) { await b.first().click().catch(() => {}); await page.waitForTimeout(3000) }
}
// The transport lives in the BottomNav pill: slot 3 is Play/Stop.
const centre = page.locator('button.center-btn')
await centre.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
for (let i = 0; i < 12; i++) {
  const disabled = await centre.getAttribute('aria-disabled').catch(() => null)
  if (disabled !== 'true') break
  await page.waitForTimeout(2500)
}
await centre.click().catch(() => {})
await page.waitForTimeout(4000)
const isStop = await centre.evaluate((el) => el.classList.contains('is-stop')).catch(() => false)
check('the class player is playing', isStop, `center-btn is-stop=${isStop}`)
await page.screenshot({ path: `${OUT}/3-player.png`, fullPage: true })

// Let a few cycles run. A cycle is ~11s.
await page.waitForTimeout(90_000)
await page.screenshot({ path: `${OUT}/4-playing.png`, fullPage: true })
check('no page errors while playing', errors.length === 0, errors.join(' | ').slice(0, 300))

// What did the class actually write?
const rows = await (await fetch(
  `${U}/rest/v1/player_events?select=occurred_at,payload&learner_id=eq.${CLASS_LEARNER}&event_type=eq.audio_play&occurred_at=gte.${startedAt}&order=occurred_at.desc&limit=50`,
  { headers: H },
)).json()
const ids = rows.map((r) => (r.payload || {}).cycleId).filter(Boolean)
console.log('cycle ids written this run:', JSON.stringify([...new Set(ids)], null, 2))
check('the class wrote audio_play rows', ids.length > 0, `${ids.length} rows`)
const phraseIds = ids.filter((id) => /_(build|use)_/.test(id))
const named = phraseIds.filter((id) => /^S\d{4}L\d{2}_(build|use)_\d{2}(_|$)/.test(id))
check('every phrase cycle id names its phrase', phraseIds.length > 0 && named.length === phraseIds.length,
  `${named.length}/${phraseIds.length} named :: ${[...new Set(phraseIds)].slice(0, 6).join(', ')}`)

// And the card still draws.
await page.goto(`${BASE}/schools/classes/${CLASS_ID}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
let brainPayload = null
page.on('response', async (r) => { if (r.url().includes('/brain')) { try { brainPayload = await r.json() } catch { /* not json */ } } })
await page.goto(`${BASE}/schools/classes/${CLASS_ID}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(12000); await dismissLater()
const card = await page.$('.cb')
if (card) await card.screenshot({ path: `${OUT}/5-course-journey-card.png` })
else await page.screenshot({ path: `${OUT}/5-course-journey-card.png`, fullPage: true })
const read = await page.evaluate(() => ({
  dots: document.querySelectorAll('.cb-draw circle').length,
  arcs: document.querySelectorAll('.cb-draw path.cb-arc').length,
  tiles: [...document.querySelectorAll('.cb-stat-value')].map((e) => e.textContent.trim()),
}))
console.log('card:', JSON.stringify({ ...read, distinctPhrases: brainPayload?.distinctPhrases, events: brainPayload?.events?.length, tally: brainPayload?.tally }))
check('the Course journey card still draws', read.dots > 0, JSON.stringify(read))

await browser.close()
console.log(`\nshots in ${OUT}`)
console.log(failures ? `${failures} FAILED` : 'ALL PASS')
process.exit(failures ? 1 : 0)
