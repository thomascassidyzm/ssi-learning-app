// COURSE-SWITCH WATERFALL PROBE (founder ruling 2026-07-30: READY in 2–3s).
//
// Measures, against a DEPLOYED build, the time from tapping a course in the
// Choose Course selector to the player being READY to play (belt-badge is
// v-if="isPlayerReady" in PlayerRestingState, so its visibility together with
// the course name having changed IS the ready signal), plus the full network
// waterfall in that window and the app's own cold_start telemetry
// (mountToReadyMs / scriptPath) as ground truth.
//
// The profile is stamped as a RETURN USER (ssi-has-played=true) so the splash
// floor is 300ms, matching the founder's real conditions, not 2800ms.
//
// Phases:
//   0. fresh guest boot → default course → READY            [app cold]
//   1. switch to Italian                                    [app warm, course cold]
//   2. switch back to the first course                      [app warm, course warm]
//   3. nuke caches (script IDB + instant-playback LS + Cache API) then
//      switch to Italian again                              [the "update cleared the cache" case]
//
// Usage: BASE_URL=https://staging.saysomethingin.app node e2e/course-switch-waterfall-probe.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT_DIR || '/tmp/course-switch-waterfall/'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

// Optional mobile-network emulation: THROTTLE=1 → ~150ms RTT, 8/2 Mbps.
if (process.env.THROTTLE) {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150,
    downloadThroughput: 8 * 1024 * 1024 / 8,
    uploadThroughput: 2 * 1024 * 1024 / 8,
  })
  console.log('[probe] network throttled: 150ms RTT, 8/2 Mbps')
}

// Return-user stamp BEFORE any app code runs → splash floor 300ms, not 2800ms.
await page.addInitScript(() => {
  try { localStorage.setItem('ssi-has-played', 'true') } catch {}
})

// ── console + telemetry sniffers ────────────────────────────────────────────
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
    for (const ev of body.events || []) {
      if (ev?.event_type === 'cold_start') coldStarts.push(ev)
    }
  } catch { /* beacon blobs unreadable — fine */ }
})

// ── network waterfall recorder ──────────────────────────────────────────────
let recording = null // { t0, rows }
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

// READY after a switch = course name shows the NEW course AND belt-badge
// (isPlayerReady) is visible.
const waitSwitchReady = async (nameFragment, timeout = 45000) => {
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
    await row.click() // expand
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

// ── PHASE 0: fresh boot ──────────────────────────────────────────────────────
console.log(`BASE = ${BASE}`)
const boot0 = Date.now()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
if (await page.locator('.course-row').count()) {
  // First-run modal auto-opened — pick Spanish (variant-aware).
  const row = page.locator('.course-row:has-text("Spanish")').first()
  const hasVariants = await row.evaluate((el) => el.classList.contains('has-variants')).catch(() => false)
  await row.click()
  if (hasVariants) {
    await page.waitForSelector('.course-row.variant', { timeout: 5000 })
    await page.locator('.course-row.variant').first().click()
  }
}
await page.waitForSelector('.belt-badge', { timeout: 60000, state: 'visible' })
const firstCourseName = await courseNameText()
console.log(`\n===== PHASE 0: boot → READY = ${Date.now() - boot0}ms (course: "${firstCourseName}") =====`)
await page.screenshot({ path: `${OUT}phase0-ready.png` })
// A word from the first course's name to switch back to in phase 2.
const firstFragment = (firstCourseName.split(/\s+/)[0] || 'Spanish')

// ── PHASE 1: warm app, cold new course ──────────────────────────────────────
await page.waitForTimeout(3000)
consoleLines.length = 0
const p1 = await measureSwitch('PHASE1-switch-to-italian-cold', 'Italian', 'Italian')
console.log('console warn/error during phase 1:'); consoleLines.forEach((l) => console.log('  ' + l))

// ── PHASE 2: warm both ───────────────────────────────────────────────────────
await page.waitForTimeout(8000) // let the full-script handoff land + cache write
consoleLines.length = 0
const p2 = await measureSwitch('PHASE2-switch-back-warm', firstFragment, firstFragment)
console.log('console warn/error during phase 2:'); consoleLines.forEach((l) => console.log('  ' + l))

// ── PHASE 3: the "update cleared the cache" case ────────────────────────────
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
console.log('\n[caches nuked: script IDB, audio IDB, Cache API, instant-playback LS]')
consoleLines.length = 0
const p3 = await measureSwitch('PHASE3-switch-italian-after-cache-nuke', 'Italian', 'Italian')
console.log('console warn/error during phase 3:'); consoleLines.forEach((l) => console.log('  ' + l))

// ── summary ──────────────────────────────────────────────────────────────────
await page.waitForTimeout(5000) // let telemetry flush
console.log('\n===== SUMMARY =====')
console.log(`Phase 1 (warm app, cold course):        ${p1}ms`)
console.log(`Phase 2 (warm both):                    ${p2}ms`)
console.log(`Phase 3 (cache-nuked switch):           ${p3}ms`)
console.log(`Target: ≤ 2000–3000ms for ALL of the above`)
console.log('\ncold_start telemetry events observed:')
for (const ev of coldStarts) {
  const p = ev.payload || ev
  console.log(`  fresh=${p.isFreshLoad} mountToReady=${p.mountToReadyMs}ms scriptPath=${p.scriptPath} animFloor=${p.animFloorMs} warmAudio=${p.warmAudioMs} returnUser=${p.returnUser}`)
}
await browser.close()
