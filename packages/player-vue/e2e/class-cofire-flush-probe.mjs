// Class co-fire probe — does real Play-as-class write LEGO co-fire rows to
// learner_lego_pairings through /api/school/class-progress?
//
// Born as the job #155 diagnostic that found the bundle-path co-fire death
// (the core script generator dropped each phrase's decomposition, so cycles
// carried one lego id, buildPairs() of one id is [], and every bundle-course
// learner wrote zero pairs); kept as the standing end-to-end check that the
// whole chain — cycle → componentLegoIds → tally → flush → RPC → rows — is
// alive on a deployed build.
//
// Signs in as the real ZZ Test teacher, plays the Y7 Welsh class until at
// least a couple of multi-lego cycles have fired, taps pause (the flush
// trigger), waits, then navigates away (the unmount flush). Captures every
// /api/school/class-progress request+response and every console warning from
// usePairingsTelemetry/class-progress, and reads learner_lego_pairings back
// from the live DB before and after.
//
// The use-phrase check can legitimately FAIL on a short run: the class sits
// early in the course and a two-minute window rarely reaches a use phrase.
// Pairs written from BUILD cycles are the verdict.
//
//   LD_LIBRARY_PATH=/home/tomcassidy/.pwlibs/root/usr/lib/x86_64-linux-gnu:/home/tomcassidy/.ssi-sentinel-libs \
//   CHROME_BIN=/home/tomcassidy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
//   TMPDIR=/home/tomcassidy/.tmpbig/p155fix OUT=/home/tomcassidy/.tmpbig/p155fix \
//   BASE_URL=https://staging.saysomethingin.app node e2e/class-cofire-flush-probe.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+chepstowtest-cover@gmail.com'
const CLASS_ID = 'ea59ef42-ab29-46d0-a956-a4fdbe5e1d09'
const CLASS_LEARNER = 'de95dd05-e6cf-454e-89d1-7ac8e4f4b940'
const OUT = process.env.OUT || '/home/tomcassidy/.tmpbig/p155fix'
fs.mkdirSync(OUT, { recursive: true })

const log = (...a) => console.log(...a)
let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

async function readPairings() {
  const rows = await (await fetch(
    `${U}/rest/v1/learner_lego_pairings?select=lego_a,lego_b,fire_count,first_fired_at,last_fired_at&learner_id=eq.${CLASS_LEARNER}&order=last_fired_at.desc&limit=1000`,
    { headers: H },
  )).json()
  return rows
}

const before = await readPairings()
log('learner_lego_pairings BEFORE:', JSON.stringify(before))

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

const consoleCaptures = []
page.on('console', (msg) => {
  const text = msg.text()
  if (/usePairingsTelemetry|class-progress|recordLegoPairings|DEBUG-155/i.test(text)) {
    consoleCaptures.push({ type: msg.type(), text })
    log('[console]', msg.type(), text)
  }
})
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

const classProgressCalls = []
page.on('requestfinished', async (req) => {
  if (!req.url().includes('/api/school/class-progress')) return
  try {
    const body = req.postData()
    const resp = await req.response()
    const status = resp ? resp.status() : null
    let respBody = null
    try { respBody = await resp.text() } catch { /* ignore */ }
    const parsedBody = body ? JSON.parse(body) : null
    const entry = { method: parsedBody?.method, args: parsedBody?.args, status, respBody: respBody?.slice(0, 2000) }
    classProgressCalls.push(entry)
    log('[class-progress]', JSON.stringify(entry).slice(0, 500))
  } catch (e) {
    log('[class-progress capture error]', e.message)
  }
})

const dismissLater = async () => { const b = page.getByRole('button', { name: 'Later', exact: true }); if (await b.count()) await b.first().click().catch(() => {}) }

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

for (const name of [/^Play$/i, /Start/i, /Continue/i, /Play as class/i]) {
  const b = page.locator('button', { hasText: name })
  if (await b.count()) { await b.first().click().catch(() => {}); await page.waitForTimeout(3000) }
}

const centre = page.locator('button.center-btn')
await centre.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
for (let i = 0; i < 12; i++) {
  const disabled = await centre.getAttribute('aria-disabled').catch(() => null)
  if (disabled !== 'true') break
  await page.waitForTimeout(2500)
}
await centre.click().catch(() => {})
await page.waitForTimeout(4000)
let isStop = await centre.evaluate((el) => el.classList.contains('is-stop')).catch(() => false)
check('the class player is playing', isStop, `center-btn is-stop=${isStop}`)
await page.screenshot({ path: `${OUT}/3-player.png`, fullPage: true })

// Let enough cycles run to get multi-lego (BUILD/USE) phrases, not just atoms.
// A cycle is ~11s; run ~120s to be safe.
await page.waitForTimeout(120_000)
await page.screenshot({ path: `${OUT}/4-playing.png`, fullPage: true })
check('no page errors while playing', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300))

// What target1 cycles played (to confirm we actually got use/build phrases)?
const audioRows = await (await fetch(
  `${U}/rest/v1/player_events?select=occurred_at,payload&learner_id=eq.${CLASS_LEARNER}&event_type=eq.audio_play&occurred_at=gte.${startedAt}&order=occurred_at.desc&limit=200`,
  { headers: H },
)).json()
const cycleIds = [...new Set(audioRows.map((r) => (r.payload || {}).cycleId).filter(Boolean))]
log('cycle ids written this run:', JSON.stringify(cycleIds, null, 2))
const usePhraseCycles = cycleIds.filter((id) => /_use_/.test(id))
check('at least one use-phrase cycle played', usePhraseCycles.length > 0, `${usePhraseCycles.length} :: ${usePhraseCycles.slice(0, 5).join(', ')}`)

// TAP PAUSE — the flush trigger.
await centre.click().catch(() => {})
await page.waitForTimeout(1000)
isStop = await centre.evaluate((el) => el.classList.contains('is-stop')).catch(() => false)
check('paused (is-stop now false)', !isStop, `center-btn is-stop=${isStop}`)
await page.waitForTimeout(5000)
await page.screenshot({ path: `${OUT}/5-after-pause.png`, fullPage: true })

const afterPause = await readPairings()
log('learner_lego_pairings AFTER PAUSE:', JSON.stringify(afterPause))

// NAVIGATE AWAY — the unmount flush.
await page.goto(`${BASE}/schools/classes/${CLASS_ID}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(5000)
await page.screenshot({ path: `${OUT}/6-after-navigate-away.png`, fullPage: true })

const after = await readPairings()
log('learner_lego_pairings AFTER UNMOUNT:', JSON.stringify(after))

check('class-progress recordLegoPairings request was sent', classProgressCalls.some((c) => c.method === 'recordLegoPairings'),
  `${classProgressCalls.length} total class-progress calls, methods: ${[...new Set(classProgressCalls.map((c) => c.method))].join(', ')}`)

const pairingsMethodCalls = classProgressCalls.filter((c) => c.method === 'recordLegoPairings')
check('recordLegoPairings calls all succeeded (2xx)', pairingsMethodCalls.length > 0 && pairingsMethodCalls.every((c) => c.status >= 200 && c.status < 300),
  JSON.stringify(pairingsMethodCalls))

check('learner_lego_pairings row count increased', after.length > before.length, `before=${before.length} after=${after.length}`)

fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({
  before, afterPause, after, classProgressCalls, consoleCaptures, pageErrors, cycleIds, usePhraseCycles,
}, null, 2))

await browser.close()
log(`\nshots + results.json in ${OUT}`)
log(failures ? `${failures} FAILED` : 'ALL PASS')
process.exit(0)
