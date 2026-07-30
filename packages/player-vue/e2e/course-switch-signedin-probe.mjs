// COURSE-SWITCH WATERFALL — SIGNED-IN LANE (founder ruling 2026-07-30).
//
// Same measurement as course-switch-waterfall-probe.mjs but as a REAL
// signed-in learner with a mid-course cursor (tester account), which is the
// founder's actual condition: mode pre-check enrollment read, resolveStartLegoId,
// entitlement-token /cycles, learner enrollments fetch — all live.
//
// Session is minted via service-role generateLink (no email sent) and
// injected into localStorage before the app boots. Uses the tester account
// thomas.cassidy+bumface@gmail.com (zho cursor S0008L01), NEVER the founder's
// real account.
//
// Usage (service key read from ~/.ssi-sentinel.env):
//   BASE_URL=https://staging.saysomethingin.app node e2e/course-switch-signedin-probe.mjs
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT_DIR || '/tmp/course-switch-signedin/'
mkdirSync(OUT, { recursive: true })

const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg' // public, from the deployed bundle
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+bumface@gmail.com'
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()

const svc = createClient(SB_URL, serviceKey)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: TESTER })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const session = v.session
console.log(`minted session for ${TESTER}`)

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const projectRef = new URL(SB_URL).hostname.split('.')[0]
await page.addInitScript(([key, sess]) => {
  try {
    localStorage.setItem('ssi-has-played', 'true')
    localStorage.setItem(key, JSON.stringify(sess))
  } catch {}
}, [`sb-${projectRef}-auth-token`, session])

// ── sniffers (same shape as the guest probe) ────────────────────────────────
const consoleLines = []
page.on('console', (msg) => {
  const t = msg.type()
  if (t === 'warning' || t === 'error') consoleLines.push(`[${t}] ${msg.text().slice(0, 300)}`)
})
const coldStarts = []
page.on('request', (req) => {
  if (!req.url().includes('/api/player-events')) return
  try {
    const body = JSON.parse(req.postData() || '{}')
    for (const ev of body.events || []) if (ev?.event_type === 'cold_start') coldStarts.push(ev)
  } catch { /* fine */ }
})
let recording = null
page.on('request', (req) => {
  if (!recording) return
  const url = req.url()
  if (url.startsWith('data:') || url.includes('/api/player-events')) return
  recording.rows.push({ url, start: Date.now() - recording.t0, end: null, status: null })
})
page.on('requestfinished', async (req) => {
  if (!recording) return
  const row = recording.rows.find((r) => r.url === req.url() && r.end === null)
  if (row) {
    row.end = Date.now() - recording.t0
    try { row.status = (await req.response())?.status() ?? null } catch { /* gone */ }
  }
})
page.on('requestfailed', (req) => {
  if (!recording) return
  const row = recording.rows.find((r) => r.url === req.url() && r.end === null)
  if (row) { row.end = Date.now() - recording.t0; row.status = 'FAILED' }
})
const short = (url) => {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 80 ? u.pathname.slice(0, 77) + '…' : u.pathname
    return u.host.replace('.saysomethingin.app', '').replace('.supabase.co', '[supabase]') + path + (u.search ? u.search.slice(0, 60) : '')
  } catch { return url.slice(0, 100) }
}
const printWaterfall = (label, rows, readyMs) => {
  console.log(`\n── WATERFALL: ${label} (READY at ${readyMs}ms) ──`)
  for (const r of rows.sort((a, b) => a.start - b.start)) {
    const dur = r.end != null ? r.end - r.start : NaN
    const marker = r.start <= readyMs ? (r.end != null && r.end <= readyMs ? ' ' : '⏳') : '·'
    console.log(`${marker} ${String(r.start).padStart(6)}ms +${String(isNaN(dur) ? '???' : dur).padStart(5)}ms [${r.status ?? '…'}] ${short(r.url)}`)
  }
}
const courseNameText = async () =>
  ((await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || '').trim()
const waitSwitchReady = async (nameFragment, timeout = 60000) => {
  const deadline = Date.now() + timeout
  for (;;) {
    const name = await courseNameText()
    const badge = await page.locator('.belt-badge').isVisible().catch(() => false)
    if (name.toLowerCase().includes(nameFragment.toLowerCase()) && badge) return
    if (Date.now() > deadline) throw new Error(`timeout waiting for READY on "${nameFragment}" (name="${name}", badge=${badge})`)
    await page.waitForTimeout(50)
  }
}
const pickCourse = async (rowText) => {
  await page.locator('.course-name--tappable').first().click()
  await page.waitForSelector('.course-row', { timeout: 15000 })
  const row = page.locator(`.course-row:has-text("${rowText}")`).first()
  if (!(await row.count())) throw new Error(`no course row matching "${rowText}"`)
  const hasVariants = await row.evaluate((el) => el.classList.contains('has-variants'))
  if (hasVariants) {
    await row.click()
    await page.waitForSelector('.course-row.variant', { timeout: 5000 })
    return page.locator('.course-row.variant').first()
  }
  return row
}
const measureSwitch = async (label, rowText, nameFragment) => {
  const row = await pickCourse(rowText)
  recording = { t0: Date.now(), rows: [] }
  const t0 = recording.t0
  await row.click()
  await waitSwitchReady(nameFragment)
  const readyMs = Date.now() - t0
  const rows = recording.rows
  recording = null
  console.log(`\n===== ${label}: click → READY = ${readyMs}ms =====`)
  printWaterfall(label, rows, readyMs)
  await page.screenshot({ path: `${OUT}${label.replace(/[^a-z0-9]+/gi, '-')}.png` })
  return readyMs
}

// ── boot signed-in ───────────────────────────────────────────────────────────
console.log(`BASE = ${BASE} (signed in as tester)`)
const boot0 = Date.now()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
if (await page.locator('.course-row').count()) {
  const row = page.locator('.course-row:has-text("Chinese")').first()
  await row.click()
}
await page.waitForSelector('.belt-badge', { timeout: 60000, state: 'visible' })
console.log(`\n===== PHASE 0 (signed-in boot): → READY = ${Date.now() - boot0}ms (course: "${await courseNameText()}") =====`)

// ── switches ─────────────────────────────────────────────────────────────────
await page.waitForTimeout(3000)
consoleLines.length = 0
const p1 = await measureSwitch('SIGNEDIN-1-switch-italian-cold', 'Italian', 'Italian')
console.log('console warn/error:'); consoleLines.forEach((l) => console.log('  ' + l))

await page.waitForTimeout(8000)
consoleLines.length = 0
const p2 = await measureSwitch('SIGNEDIN-2-switch-back-chinese-cursor', 'Chinese', 'Chinese')
console.log('console warn/error:'); consoleLines.forEach((l) => console.log('  ' + l))

await page.waitForTimeout(3000)
await page.evaluate(async () => {
  try { indexedDB.deleteDatabase('ssi-script-cache') } catch {}
  try { indexedDB.deleteDatabase('ssi-audio-cache-v2') } catch {}
  try { for (const k of await caches.keys()) await caches.delete(k) } catch {}
  const kill = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && (k.startsWith('ssi-instant-playback-') || k.startsWith('ssi-content-version-'))) kill.push(k)
  }
  kill.forEach((k) => localStorage.removeItem(k))
})
console.log('\n[caches nuked]')
consoleLines.length = 0
const p3 = await measureSwitch('SIGNEDIN-3-switch-italian-after-nuke', 'Italian', 'Italian')
console.log('console warn/error:'); consoleLines.forEach((l) => console.log('  ' + l))

await page.waitForTimeout(5000)
console.log('\n===== SUMMARY (signed-in) =====')
console.log(`Switch 1 (cold course):        ${p1}ms`)
console.log(`Switch 2 (back, has cursor):   ${p2}ms`)
console.log(`Switch 3 (cache-nuked):        ${p3}ms`)
console.log(`Target: ≤ 2000–3000ms`)
console.log('\ncold_start telemetry:')
for (const ev of coldStarts) {
  const p = ev.payload || ev
  console.log(`  fresh=${p.isFreshLoad} mountToReady=${p.mountToReadyMs}ms scriptPath=${p.scriptPath} animFloor=${p.animFloorMs} warmAudio=${p.warmAudioMs} returnUser=${p.returnUser}`)
}
await browser.close()
