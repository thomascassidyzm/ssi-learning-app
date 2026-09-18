// Job #149 — LIVE proof on staging that the drained seed review plays all four
// of its clips, one of them the English one.
//
// mintonman's second Basque report: "only the basque is spoken (with English
// displayed) … missing the four-state exercise progress bar completely … the
// basque words begin to appear card by card but then the app moves on."
//
// Signs in as Mr Tom Tester, whose eus_for_eng cursor is parked at S0148L01 so
// the very next rounds carry seed-phase reviews (spaced-rep offset >= 144),
// plays, then reads that learner's own player_events back. Pre-fix the whole
// sandwich wrote ONE audio_play at role target1. Post-fix it writes four across
// four cycle ids, exactly one of them role 'known'.
//
//   LD_LIBRARY_PATH=… CHROME_BIN=… node e2e/_149-seed-sandwich-probe.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const EMAIL = 'thomas.cassidy+mrtomtester@gmail.com'
const LEARNER = 'e5d60bc7-e478-4a35-a968-69c5c5a5b6bd'
const OUT = process.env.OUT || `${process.env.CS_SCRATCH || '/tmp'}/p149`
fs.mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const version = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
console.log('served build', JSON.stringify(version))
if (process.env.EXPECT_BUILD) check('served build is the promoted commit', version.buildNumber === process.env.EXPECT_BUILD, version.buildNumber)

const startedAt = new Date().toISOString()

const j = await (await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
const sess = await (await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: j.hashed_token }) })).json()
check('minted a session', !!sess.access_token, sess.error_description || sess.msg || '')
if (!sess.access_token) process.exit(1)

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sess)])
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => logs.push(m.text()))
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message))
const dismissLater = async () => { const b = page.getByRole('button', { name: 'Later', exact: true }); if (await b.count()) await b.first().click().catch(() => {}) }

await page.goto(`${BASE}/?course=eus_for_eng&stream`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(12000); await dismissLater()
await page.screenshot({ path: `${OUT}/1-loaded.png` })

for (const name of ['Continue', 'Start', 'Play', 'Resume']) {
  const b = page.getByRole('button', { name: new RegExp(`^${name}`, 'i') })
  if (await b.count()) { await b.first().click().catch(() => {}); break }
}
await page.waitForTimeout(3000); await dismissLater()

// Let it run. A round holds ~12-18 cycles; the seed review sits among the
// spaced-rep block, so give it several minutes and shoot whenever the current
// cycle is a sandwich slot.
let shots = 0
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(4000)
  const seen = logs.some(l => /seed_rep/.test(l))
  if (seen && shots < 3) {
    await page.screenshot({ path: `${OUT}/2-seed-review-${++shots}.png` })
  }
  const rows = await (await fetch(`${U}/rest/v1/player_events?select=payload&user_id=eq.${LEARNER}&event_type=eq.audio_play&occurred_at=gte.${startedAt}&limit=2000`, { headers: H })).json()
  const sand = rows.filter(r => /_seed_rep_/.test(r.payload?.cycleId || ''))
  if (sand.length >= 4) break
}

const rows = await (await fetch(`${U}/rest/v1/player_events?select=occurred_at,payload&user_id=eq.${LEARNER}&event_type=eq.audio_play&occurred_at=gte.${startedAt}&order=occurred_at.asc&limit=2000`, { headers: H })).json()
const sand = rows.filter(r => /_seed_rep_/.test(r.payload?.cycleId || ''))
console.log('sandwich plays written:', JSON.stringify(sand.map(r => [r.payload.cycleId, r.payload.role])))

const byLego = new Map()
for (const r of sand) {
  const lego = r.payload.legoId
  if (!byLego.has(lego)) byLego.set(lego, [])
  byLego.get(lego).push(r.payload.role)
}
check('a drained seed review actually played', sand.length > 0, `${sand.length} plays`)
for (const [lego, roles] of byLego) {
  check(`${lego} played all four slots`, roles.length === 4, roles.join(','))
  check(`${lego} spoke the English clip`, roles.filter(r => r === 'known').length === 1, roles.join(','))
}
await page.screenshot({ path: `${OUT}/3-final.png` })
fs.writeFileSync(`${OUT}/console.log`, logs.join('\n'))
await browser.close()
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
