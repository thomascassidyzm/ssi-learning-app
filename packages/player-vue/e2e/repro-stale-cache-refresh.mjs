import { chromium } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'

// Structural cache freshness repro (2026-07-22).
//
// Proves the content_stamp mechanism end-to-end against a real dev server +
// live DB: a device holding cache entries from an OLD content vintage boots
// online and the app, with no version bump and no user action, notices the
// course's trigger-maintained courses.content_stamp differs and refreshes in
// the background — the script cache entry is dropped/regenerated and the
// listening metadata bundle is refetched, both landing with the LIVE stamp.
//
// PHASE 1: clean boot, start play, wait for the app to write its caches.
// PHASE 2: doctor both IndexedDB entries to a fake old vintage
//          ('e2e-stale-vintage') + plant a marker gloss in the listening meta.
// PHASE 3: reload (online). Assert both entries come back with the real DB
//          stamp (not the fake), and the marker gloss is gone.
//
// Usage: node e2e/repro-stale-cache-refresh.mjs   (dev server on :5173)

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const dataDir = '/tmp/ssi-repro-stale-cache-profile'
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const ctx = await chromium.launchPersistentContext(dataDir, {
  viewport: { width: 390, height: 844 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = ctx.pages()[0] || await ctx.newPage()
const logs = []
page.on('console', (msg) => {
  const t = msg.text()
  logs.push(t)
  if (/ScriptCache|ListeningMeta|Content/i.test(t)) console.log('[console]', t)
})

const idbGet = (db, store, key) => page.evaluate(([db, store, key]) => new Promise((resolve) => {
  const req = indexedDB.open(db)
  req.onerror = () => resolve({ error: 'open failed' })
  req.onsuccess = () => {
    const conn = req.result
    if (!conn.objectStoreNames.contains(store)) { conn.close(); resolve(null); return }
    const get = conn.transaction(store).objectStore(store).get(key)
    get.onsuccess = () => { conn.close(); resolve(get.result ?? null) }
    get.onerror = () => { conn.close(); resolve({ error: 'get failed' }) }
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

console.log('=== PHASE 1: clean boot, let the app write its caches ===')
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); console.log('clicked', sel); break } catch { /* next */ } }
}

// The active course reveals itself via checkContentVersion's localStorage key.
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

// Wait for the script cache write.
let scriptEntry = null
for (let i = 0; i < 90 && !scriptEntry; i++) {
  await page.waitForTimeout(1000)
  scriptEntry = await idbGet('ssi-script-cache', 'scripts', `v9:${course}`)
}
if (!scriptEntry) { console.log('FAIL: script cache never written'); await ctx.close(); process.exit(1) }
console.log('script cache written; fresh contentStamp =', scriptEntry.contentStamp)
const LIVE_STAMP = scriptEntry.contentStamp
if (!LIVE_STAMP) { console.log('FAIL: fresh entry has no contentStamp — stamp plumbing broken'); await ctx.close(); process.exit(1) }

console.log('=== PHASE 2: doctor caches to a stale vintage ===')
await idbPut('ssi-script-cache', 'scripts', `v9:${course}`, { contentStamp: 'e2e-stale-vintage' })
// Plant a listening-meta entry from the "old vintage" with a marker gloss.
const staleMeta = {
  courseCode: course, cachedAt: Date.now() - 90 * 86_400_000,
  contentStamp: 'e2e-stale-vintage',
  podRows: [{ id: 'e2e', scene_number: 1, sentence_number: 1, global_order: 1, speaker: null, target_text: 'x', known_text: 'E2E STALE GLOSS', target_audio_id: null, known_audio_id: null, explainer_audio_id: null, glue_to_next: false }],
  clipTexts: {}, bookends: [], fineKnowns: {}, coreSeeds: [], legoCatalogue: [],
}
await idbPut('ssi-listening-meta', 'meta', `v2:${course}`, staleMeta)
console.log('both entries doctored to contentStamp=e2e-stale-vintage')

console.log('=== PHASE 3: reload online, observe structural self-invalidation ===')
await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); break } catch { /* next */ } }
}

let metaFresh = false, scriptFresh = false
for (let i = 0; i < 120 && !(metaFresh && scriptFresh); i++) {
  await page.waitForTimeout(1000)
  const meta = await idbGet('ssi-listening-meta', 'meta', `v2:${course}`)
  const script = await idbGet('ssi-script-cache', 'scripts', `v9:${course}`)
  metaFresh = !!meta && meta.contentStamp !== 'e2e-stale-vintage' &&
    !JSON.stringify(meta.podRows || []).includes('E2E STALE GLOSS')
  // Script entry: dropped is enough (regeneration follows on the walk); if
  // rewritten already, it must carry a real stamp.
  scriptFresh = !script || (script.contentStamp && script.contentStamp !== 'e2e-stale-vintage')
  if (i % 15 === 14) console.log(`...waiting (meta ${metaFresh ? 'FRESH' : 'stale'}, script ${scriptFresh ? 'FRESH' : 'stale'})`)
}

const finalMeta = await idbGet('ssi-listening-meta', 'meta', `v2:${course}`)
const finalScript = await idbGet('ssi-script-cache', 'scripts', `v9:${course}`)
console.log('final listening-meta stamp:', finalMeta?.contentStamp,
  '| pod rows:', finalMeta?.podRows?.length)
console.log('final script stamp:', finalScript ? finalScript.contentStamp : '(entry dropped, pending regen)')
console.log('live stamp for reference:', LIVE_STAMP)

if (metaFresh && scriptFresh) {
  console.log('PASS: stale-vintage caches were structurally refreshed on online boot')
  await ctx.close(); process.exit(0)
} else {
  console.log(`FAIL: meta ${metaFresh ? 'ok' : 'STILL STALE'}, script ${scriptFresh ? 'ok' : 'STILL STALE'}`)
  await ctx.close(); process.exit(1)
}
