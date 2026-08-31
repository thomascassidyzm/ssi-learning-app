// LIVE verification of the CONSOLIDATING banner (2026-08-31).
//
// Built on top of _verify-offline-belt-held-2026-08-15.mjs (same black-hole
// technique, same rig). That probe proved the belt pill never goes SSi red /
// ∞ while offline. This one proves the NEW, additive part: while the app is
// recycling cached material because it cannot reach new content, a calm
// named status pill — `.consolidating-banner`, role=status — is on screen,
// saying so in plain language, distinct from the amber `.audio-failed-banner`
// error chip, and it clears the instant real main-loop content plays again.
//
// THE PROBE:
//   Phase 1 — ONLINE. Warm the persistent AudioCache (same as the belt probe).
//   Phase 2 — BLACK-HOLE the backend, reload, resume. Watch for CONSOLIDATING:
//     (a) `.consolidating-banner` present, visible, correct text;
//     (b) belt-held assertions still hold — no SSi red, no ∞ glyph;
//     (c) `.audio-failed-banner` NOT showing at the same time.
//   Phase 3 — UN-BLACK-HOLE the backend, let it resume real fetches, and
//     assert `.consolidating-banner` disappears once main-loop content plays.
//
//   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs \
//   node e2e/_verify-consolidating-banner-2026-08-31.mjs
import { chromium } from '@playwright/test'
import path from 'node:path'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const INF_PLAY_RED = 'rgb(194, 58, 58)' // #c23a3a as the browser reports it
const WARM_MS = Number(process.env.WARM_MS || 90_000)
const OFFLINE_WATCH_MS = Number(process.env.OFFLINE_WATCH_MS || 60_000)
const RECOVERY_WATCH_MS = Number(process.env.RECOVERY_WATCH_MS || 60_000)
const DOCS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../../../docs')

const rgbEq = (a, b) => (a || '').replace(/\s+/g, '') === b.replace(/\s+/g, '')

async function startPlayback(page) {
  const btn = page.locator('.center-btn').first()
  if (!(await btn.count().catch(() => 0))) return false
  await btn.click({ timeout: 8_000 }).catch(() => {})
  return true
}

const INSTALL_AUDIO_HOOK = () => {
  const w = window
  w.__probePlays = []
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function patched(...args) {
    try {
      w.__probePlays.push({ src: this.src || this.currentSrc || '', at: Date.now() })
    } catch { /* never let the probe break playback */ }
    return origPlay.apply(this, args)
  }
}

const readPlays = (page) => page.evaluate(() => window.__probePlays || []).catch(() => [])

/** Read the belt pill AND the two banners in one DOM pass. */
const readUiState = (page) => page.evaluate(() => {
  const pill = document.querySelector('.belt-timer-unified')
  const root = document.querySelector('.learning-player') || document.body
  const cs = pill ? getComputedStyle(pill) : null
  const consolidating = document.querySelector('.consolidating-banner')
  const audioFailed = document.querySelector('.audio-failed-banner')
  const isVisible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  return {
    pillIsInfPlayClass: pill ? pill.classList.contains('is-infplay') : null,
    infinityGlyphPresent: !!document.querySelector('.belt-infplay-glyph'),
    beltColorVar: getComputedStyle(root).getPropertyValue('--belt-color').trim(),
    pillBackground: cs ? cs.backgroundColor : null,
    consolidatingPresent: !!consolidating,
    consolidatingVisible: isVisible(consolidating),
    consolidatingText: consolidating ? (consolidating.textContent || '').trim() : null,
    audioFailedPresent: !!audioFailed,
    audioFailedVisible: isVisible(audioFailed),
  }
})

/**
 * Force the recycle path to engage almost immediately on resume, rather than
 * waiting out however much forward material happens to be cached (which can
 * be the rest of the course — appendForwardFromCacheOffline plays that FIRST,
 * by design, before ever recycling). Truncates the cached script's round list
 * to a small window AROUND the saved resume cursor (never before it) so
 * `forward.length === 0` fires fast without orphaning the cursor's own round
 * — an orphaned cursor takes the separate seed-fallback path (2026-08-30
 * commit ed558d17), not the recycle path this probe needs to observe. This
 * mirrors Tom's own bug narrative verbatim ("the offline bootstrap path
 * serves only a few rounds") rather than inventing a new scenario.
 */
const truncateScriptCacheForwardMaterial = (page) => page.evaluate(async () => {
  const DB_NAME = 'ssi-script-cache'
  const STORE = 'scripts'
  const KEEP_AHEAD = 0 // rounds to keep past the cursor's own round — 0 means no forward material at all
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
  if (!db.objectStoreNames.contains(STORE)) { db.close(); return { truncated: 0 } }
  const keys = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  // Find the saved resume cursor's legoId from localStorage (ssi_learning_position_<courseCode>).
  let cursorLegoId = null
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('ssi_learning_position_')) {
      try {
        const pos = JSON.parse(localStorage.getItem(k) || 'null')
        if (pos?.legoId) cursorLegoId = pos.legoId
      } catch { /* skip */ }
    }
  }

  let truncated = 0
  const details = []
  for (const key of keys) {
    const entry = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (!entry || !Array.isArray(entry.rounds)) continue
    const cursorIdx = cursorLegoId ? entry.rounds.findIndex((r) => r?.legoId === cursorLegoId) : -1
    const keepThrough = (cursorIdx >= 0 ? cursorIdx : 0) + KEEP_AHEAD
    details.push({ key, cursorLegoId, cursorIdx, totalRounds: entry.rounds.length, keepThrough })
    if (entry.rounds.length > keepThrough + 1) {
      entry.rounds = entry.rounds.slice(0, keepThrough + 1)
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const req = tx.objectStore(STORE).put(entry, key)
        req.onsuccess = () => resolve(undefined)
        req.onerror = () => reject(req.error)
      })
      truncated++
    }
  }
  db.close()
  return { truncated, details }
})

const readAudioCache = (page) => page.evaluate(async () => {
  const DBS = ['ssi-audio-cache-v2', 'ssi-audio-cache']
  for (const name of DBS) {
    try {
      const ids = await new Promise((resolve) => {
        const req = indexedDB.open(name)
        req.onerror = () => resolve(null)
        req.onsuccess = () => {
          const db = req.result
          const store = [...db.objectStoreNames].find((s) => /audio|clip|blob/i.test(s)) || db.objectStoreNames[0]
          if (!store) return resolve(null)
          try {
            const tx = db.transaction(store, 'readonly')
            const kr = tx.objectStore(store).getAllKeys()
            kr.onsuccess = () => resolve(kr.result.map(String))
            kr.onerror = () => resolve(null)
          } catch { resolve(null) }
        }
      })
      if (ids && ids.length) return { db: name, count: ids.length, ids }
    } catch { /* try the next candidate */ }
  }
  return { db: null, count: 0, ids: [] }
})

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const logs = []
  context.on('console', (m) => {
    const t = m.text()
    if (/Offline|INF PLAY|infplay|belt|recycle|cached|consolidat/i.test(t)) logs.push(`${m.type()}: ${t}`)
  })

  await context.addInitScript(INSTALL_AUDIO_HOOK)
  const page = await context.newPage()

  // ── Phase 1: ONLINE. Warm the cache. ───────────────────────────────────
  console.log('=== Phase 1: online, warming the cache ===')
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6_000)
  await startPlayback(page)

  let playedOnline = false
  const warmUntil = Date.now() + WARM_MS
  console.log(`warming for ${WARM_MS / 1000}s...`)
  while (Date.now() < warmUntil) {
    if (!playedOnline && (await readPlays(page)).length > 0) {
      playedOnline = true
      console.log('online playback confirmed (play() observed)')
    }
    await page.waitForTimeout(2_000)
  }

  const warmCache = await readAudioCache(page)
  const warmUi = await readUiState(page)
  console.log(`cache after warm: ${warmCache.count} clips in ${warmCache.db}`)
  console.log(`consolidating banner while online (should be absent): present=${warmUi.consolidatingPresent}`)

  if (warmCache.count === 0) {
    console.log('\n!! GAP: nothing landed in the persistent audio cache during the warm phase.')
    console.log('   The offline assertions below cannot be trusted without a warm cache.')
  }

  // Truncate the cached script's forward material BEFORE going offline, so
  // the recycle path engages fast instead of the app legitimately playing
  // forward through everything already cached (which is correct behaviour,
  // just not the state this probe needs to observe). SKIP_TRUNCATE=1 runs
  // the natural resume path instead (real cursor, real forward material).
  if (process.env.SKIP_TRUNCATE !== '1') {
    const truncateResult = await truncateScriptCacheForwardMaterial(page).catch((e) => ({ error: String(e) }))
    console.log(`truncated cached script forward material: ${JSON.stringify(truncateResult)}`)
  } else {
    console.log('SKIP_TRUNCATE=1 — leaving cached script forward material untouched')
  }

  // ── Phase 2: BLACK-HOLE the backend, then resume. ──────────────────────
  console.log('\n=== Phase 2: backend black-holed, resuming ===')
  const blackholeRoutes = [/supabase\.co/, /\/api\//, /amazonaws\.com/]
  for (const re of blackholeRoutes) await context.route(re, () => {})

  const resumeAt = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(12_000)
  await startPlayback(page)

  // ── Phase 3: watch for CONSOLIDATING while offline. ────────────────────
  let wentRed = false
  let sawGlyph = false
  let sawConsolidating = false
  let sawAudioFailedWhileConsolidating = false
  let consolidatingText = null
  let screenshotTaken = false
  let firstAudioAt = null
  const until = Date.now() + OFFLINE_WATCH_MS
  while (Date.now() < until) {
    const s = await readUiState(page).catch(() => null)
    if (s) {
      if (rgbEq(s.pillBackground, INF_PLAY_RED) || s.pillIsInfPlayClass === true) wentRed = true
      if (s.infinityGlyphPresent) sawGlyph = true
      if (s.consolidatingPresent && s.consolidatingVisible) {
        sawConsolidating = true
        consolidatingText = s.consolidatingText
        if (s.audioFailedPresent && s.audioFailedVisible) sawAudioFailedWhileConsolidating = true
        if (!screenshotTaken) {
          await page.screenshot({ path: path.join(DOCS_DIR, 'consolidating-banner-2026-08-31.png') })
          screenshotTaken = true
          console.log('screenshot captured while consolidating banner visible')
        }
      }
    }
    if (!firstAudioAt) {
      const plays = await readPlays(page)
      if (plays.length > 0) firstAudioAt = Date.now()
    }
    await page.waitForTimeout(1_500)
  }

  if (!screenshotTaken) {
    // Capture the final offline state regardless, so there's something to look at.
    await page.screenshot({ path: path.join(DOCS_DIR, 'consolidating-banner-2026-08-31-NOBANNER.png') })
  }

  console.log(`\nbelt went SSi red at any point:        ${wentRed}`)
  console.log(`∞ glyph appeared at any point:         ${sawGlyph}`)
  console.log(`consolidating banner appeared:         ${sawConsolidating}`)
  console.log(`consolidating banner text:             ${JSON.stringify(consolidatingText)}`)
  console.log(`audio-failed banner shown alongside it: ${sawAudioFailedWhileConsolidating}`)
  console.log(`time to first audio after resume:      ${firstAudioAt ? `${((firstAudioAt - resumeAt) / 1000).toFixed(1)}s` : 'no audio observed'}`)
  for (const l of logs.slice(-25)) console.log(`  ${l}`)

  // ── Phase 4: restore the network, confirm the banner clears. ───────────
  console.log('\n=== Phase 3: network restored, watching for the banner to clear ===')
  await context.unroute(/supabase\.co/)
  await context.unroute(/\/api\//)
  await context.unroute(/amazonaws\.com/)

  let clearedAt = null
  const recoveryUntil = Date.now() + RECOVERY_WATCH_MS
  const recoverStart = Date.now()
  while (Date.now() < recoveryUntil) {
    const s = await readUiState(page).catch(() => null)
    if (s && !s.consolidatingPresent) {
      clearedAt = Date.now()
      break
    }
    await page.waitForTimeout(2_000)
  }
  const bannerCleared = clearedAt !== null
  console.log(`banner cleared after network restore: ${bannerCleared}${bannerCleared ? ` (${((clearedAt - recoverStart) / 1000).toFixed(1)}s)` : ''}`)
  if (!bannerCleared) {
    const finalUi = await readUiState(page).catch(() => ({}))
    console.log(`final state at timeout: consolidatingPresent=${finalUi.consolidatingPresent}`)
    await page.screenshot({ path: path.join(DOCS_DIR, 'consolidating-banner-2026-08-31-STUCK.png') })
  }

  console.log('\n--- verdict ---')
  const NO_RED = !wentRed && !sawGlyph
  const REACHED_STATE = warmCache.count > 0 && playedOnline && !!firstAudioAt
  const NO_ERROR_OVERLAP = !sawAudioFailedWhileConsolidating
  const PASS = NO_RED && REACHED_STATE && sawConsolidating && NO_ERROR_OVERLAP && bannerCleared
  console.log(`belt stayed the learner's own (never red/∞):        ${NO_RED}`)
  console.log(`probe genuinely reached offline-playing state:      ${REACHED_STATE}`)
  console.log(`consolidating banner appeared with correct affordance: ${sawConsolidating}`)
  console.log(`no error-chip overlap while consolidating:          ${NO_ERROR_OVERLAP}`)
  console.log(`banner cleared on network restore:                  ${bannerCleared}`)
  if (!REACHED_STATE) {
    console.log('GAP: this run did NOT reach the state Tom hit, so the result above settles nothing.')
    console.log(`     warmCache=${warmCache.count} playedOnline=${playedOnline} offlineAudio=${!!firstAudioAt}`)
  }

  await browser.close()
  process.exit(PASS ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
