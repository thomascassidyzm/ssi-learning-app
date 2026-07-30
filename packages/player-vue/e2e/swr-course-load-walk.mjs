import { chromium } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'

// SWR + progressive course-load walk (founder ruling 2026-07-27).
//
// Verifies against a DEPLOYED build (default: the dev alias) that course
// loading never blocks past readiness-to-start. Production builds strip
// console.log (vite esbuild.pure), so assertions ride the telemetry wire
// (/api/player-events batches — cold_start.scriptPath and script_revalidated
// are themselves deliverables of this feature) plus IndexedDB and the DOM.
//
// PHASE 1 — COLD (no caches): fresh profile boot. cold_start.scriptPath must
//   be 'progressive' (the /cycles bootstrap), never 'full'. Records totalMs.
//   Then waits for the idle full-script handoff to write the script cache.
// PHASE 2 — SWR: doctor the cached entry to a fake old vintage and reload.
//   cold_start.scriptPath must be 'swr' (stale cache served immediately);
//   a script_revalidated event must follow and the entry must come back
//   carrying the live stamp.
// PHASE 3 — NOTICE: reload once more; scriptPath returns to 'cache' and the
//   transient "Your course was updated" notice must appear.
//
// Usage: node e2e/swr-course-load-walk.mjs
//   BASE_URL=… to point elsewhere (defaults to the dev git-branch alias).

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const dataDir = '/tmp/ssi-swr-walk-profile'
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const ctx = await chromium.launchPersistentContext(dataDir, {
  viewport: { width: 390, height: 844 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = ctx.pages()[0] || await ctx.newPage()

// Telemetry sniffer: every /api/player-events batch, tagged with a phase
// marker so each reload only reads its own events.
let phase = 0
const events = []
page.on('request', (req) => {
  if (!req.url().includes('/api/player-events')) return
  try {
    const body = JSON.parse(req.postData() || '{}')
    for (const ev of body.events || []) events.push({ phase, ev })
  } catch { /* beacon blobs may be unreadable — fine, next flush repeats */ }
})
const phaseEvents = (type) => events.filter((e) => e.phase === phase && e.ev?.event_type === type).map((e) => e.ev)

const idbGet = (db, store, key) => page.evaluate(([db, store, key]) => new Promise((resolve) => {
  const req = indexedDB.open(db)
  req.onerror = () => resolve(null)
  req.onsuccess = () => {
    const conn = req.result
    if (!conn.objectStoreNames.contains(store)) { conn.close(); resolve(null); return }
    const get = conn.transaction(store).objectStore(store).get(key)
    get.onsuccess = () => { conn.close(); resolve(get.result ?? null) }
    get.onerror = () => { conn.close(); resolve(null) }
  }
}), [db, store, key])

const idbPut = (db, store, key, patch) => page.evaluate(([db, store, key, patch]) => new Promise((resolve) => {
  const req = indexedDB.open(db)
  req.onsuccess = () => {
    const conn = req.result
    const tx = conn.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    const get = os.get(key)
    get.onsuccess = () => {
      const val = { ...(get.result || {}), ...patch }
      os.put(val, key)
      tx.oncomplete = () => { conn.close(); resolve(true) }
    }
  }
  req.onerror = () => resolve(false)
}), [db, store, key, patch])

const clickPlay = async () => {
  for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
    const btn = page.locator(sel).first()
    if (await btn.count()) { try { await btn.click({ timeout: 8000 }); return sel } catch { /* next */ } }
  }
  return null
}

const waitFor = async (pred, seconds, label) => {
  for (let i = 0; i < seconds * 4; i++) {
    await page.waitForTimeout(250)
    if (await pred()) return true
    if (i % 60 === 59) console.log(`...waiting for ${label}`)
  }
  return pred()
}

const fails = []

console.log(`=== PHASE 1: COLD boot (no caches) against ${BASE} ===`)
phase = 1
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
console.log('clicked:', await clickPlay())

await waitFor(() => phaseEvents('cold_start').length > 0, 90, 'cold_start event (cold)')
const coldEv = phaseEvents('cold_start')[0]?.payload
console.log('COLD cold_start:', JSON.stringify({ scriptPath: coldEv?.scriptPath, totalMs: coldEv?.totalMs, mountToReadyMs: coldEv?.mountToReadyMs, animFloorMs: coldEv?.animFloorMs }))
if (!coldEv) fails.push('cold boot never emitted cold_start')
else if (coldEv.scriptPath === 'full') fails.push('cold boot took the blocking full-walk path')
else if (coldEv.scriptPath !== 'progressive') console.log(`note: cold scriptPath = ${coldEv.scriptPath} (expected progressive on a fresh guest)`)

// Active course via the content-version localStorage key.
let course = null
for (let i = 0; i < 60 && !course; i++) {
  await page.waitForTimeout(1000)
  course = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('ssi-content-version-')) return k.slice('ssi-content-version-'.length)
    }
    return null
  })
}
if (!course) { console.log('FAIL: no active course detected'); await ctx.close(); process.exit(1) }
console.log('active course:', course)

// Wait for the idle full-script handoff to persist the script cache.
let entry = null
for (let i = 0; i < 120 && !entry; i++) {
  await page.waitForTimeout(1000)
  entry = await idbGet('ssi-script-cache', 'scripts', `v9:${course}`)
}
if (!entry?.contentStamp) { console.log('FAIL: script cache never written with a stamp'); await ctx.close(); process.exit(1) }
const LIVE_STAMP = entry.contentStamp
console.log('script cache written; live contentStamp =', LIVE_STAMP, '| rounds =', entry.rounds?.length)

console.log('=== PHASE 2: SWR — doctor stamp, reload, expect instant cache play + background revalidation ===')
await idbPut('ssi-script-cache', 'scripts', `v9:${course}`, { contentStamp: 'e2e-stale-vintage' })
phase = 2
await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2000)
await clickPlay()

await waitFor(() => phaseEvents('cold_start').length > 0, 90, 'cold_start event (SWR)')
const swrEv = phaseEvents('cold_start')[0]?.payload
console.log('SWR cold_start:', JSON.stringify({ scriptPath: swrEv?.scriptPath, totalMs: swrEv?.totalMs, mountToReadyMs: swrEv?.mountToReadyMs }))
if (swrEv?.scriptPath !== 'swr') fails.push(`stale-stamp reload took scriptPath=${swrEv?.scriptPath ?? 'none'}, expected 'swr'`)

const revalidated = await waitFor(
  () => phaseEvents('script_revalidated').length > 0, 240, 'script_revalidated event')
const revEv = phaseEvents('script_revalidated')[0]?.payload
console.log('script_revalidated:', revEv ? JSON.stringify({ ms: revEv.ms, rounds: revEv.rounds, fromStamp: revEv.fromStamp }) : 'NEVER')
if (!revalidated) fails.push('background revalidation never emitted script_revalidated')

const after = await idbGet('ssi-script-cache', 'scripts', `v9:${course}`)
console.log('post-revalidation stamp:', after?.contentStamp, '(live =', LIVE_STAMP + ')')
if (after?.contentStamp !== LIVE_STAMP) fails.push('revalidation did not restore the live stamp')
if (!after?.rounds?.length) fails.push('revalidated entry has no rounds')

console.log('=== PHASE 3: next open — fresh cache + "Your course was updated" notice ===')
phase = 3
await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
// The notice shows at ready and auto-hides after 6s — poll from the start.
const noticeVisible = await waitFor(
  async () => await page.locator('.course-updated-notice').isVisible().catch(() => false),
  45, 'course-updated notice')
console.log('"Your course was updated" notice visible:', noticeVisible)
if (!noticeVisible) fails.push('course-updated notice did not show on the next open')
await waitFor(() => phaseEvents('cold_start').length > 0, 60, 'cold_start (post-revalidation)')
const freshEv = phaseEvents('cold_start')[0]?.payload
console.log('post-revalidation cold_start:', JSON.stringify({ scriptPath: freshEv?.scriptPath, totalMs: freshEv?.totalMs }))
if (freshEv && freshEv.scriptPath !== 'cache' && freshEv.scriptPath !== 'infplay_cache') {
  fails.push(`post-revalidation reload took scriptPath=${freshEv.scriptPath}, expected a cache path`)
}

console.log('\n=== SUMMARY ===')
console.log(`cold: path=${coldEv?.scriptPath} ${coldEv?.totalMs}ms | swr: path=${swrEv?.scriptPath} ${swrEv?.totalMs}ms | revalidated in ${revEv?.ms}ms | fresh reopen: path=${freshEv?.scriptPath} ${freshEv?.totalMs}ms`)
if (fails.length) {
  console.log('FAIL:'); fails.forEach((f) => console.log(' -', f))
  await ctx.close(); process.exit(1)
}
console.log('PASS: SWR + progressive course load verified on the deployed build')
await ctx.close(); process.exit(0)
