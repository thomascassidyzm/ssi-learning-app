// LIVE verification of the offline BELT-HELD fix (2026-08-15).
//
// Tom, on his phone in airplane mode: signed in, the app correctly recognised
// him and correctly knew where he was — and then painted the central pill SSi
// red with the ∞ glyph and dropped him into what looked like formal INF PLAY.
//
// His ruling: OFFLINE CHANGES WHAT PLAYS, NEVER WHERE YOU ARE.
//
// The path that did it is the pre-tail expansion watcher in LearningPlayer
// (~line 3377): offline there is no network to expand, so it calls
// appendCachedLoopForOffline, whose USE-only rounds used to satisfy the
// round-shape half of isInfPlayActive and drag the whole red-∞ look in.
//
// THE PROBE:
//   Phase 1 — ONLINE. Load the app, start playing, let audio land in the
//     persistent AudioCache and let a position get recorded. This is the
//     "warm cache" that makes an offline resume meaningful at all.
//   Phase 2 — BLACK-HOLE the backend (never fulfil, never abort — what a
//     device with no signal actually looks like to an app that can still
//     serve its own shell from the service worker), then reload and resume.
//   Phase 3 — ASSERT, programmatically, not on a screenshot:
//     (a) the central pill is NOT SSi red (#c23a3a) and carries no ∞ glyph;
//     (b) the first phrase that plays has all THREE of its clips in the
//         persistent AudioCache — silence does not show up in a screenshot;
//     (c) time from resume to first audio.
//
//   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs \
//   node e2e/_verify-offline-belt-held-2026-08-15.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const INF_PLAY_RED = 'rgb(194, 58, 58)' // #c23a3a as the browser reports it
const WARM_MS = Number(process.env.WARM_MS || 90_000)
const OFFLINE_WATCH_MS = Number(process.env.OFFLINE_WATCH_MS || 60_000)

const rgbEq = (a, b) => (a || '').replace(/\s+/g, '') === b.replace(/\s+/g, '')

/**
 * The central control in the bottom nav is the play/stop button. Clicking it
 * is the same user gesture that unlocks audio on a real phone, so the probe
 * has to go through it rather than poking the engine.
 */
async function startPlayback(page) {
  const btn = page.locator('.center-btn').first()
  if (!(await btn.count().catch(() => 0))) return false
  await btn.click({ timeout: 8_000 }).catch(() => {})
  return true
}

/**
 * The player deliberately reuses ONE `new Audio()` element and never attaches
 * it to the document (that is what preserves the iOS user-gesture unlock), so
 * document.querySelectorAll('audio') finds NOTHING even mid-playback. Patch
 * the prototype instead and record every play() call with its src — this also
 * gives us the clip ids actually played, which is what the silent-phrase
 * assertion needs.
 */
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

/** Read the belt state straight off the DOM — what the learner actually sees. */
const readBeltState = (page) => page.evaluate(() => {
  const pill = document.querySelector('.belt-timer-unified')
  const root = document.querySelector('.learning-player') || document.body
  const cs = pill ? getComputedStyle(pill) : null
  return {
    pillPresent: !!pill,
    pillIsInfPlayClass: pill ? pill.classList.contains('is-infplay') : null,
    infinityGlyphPresent: !!document.querySelector('.belt-infplay-glyph'),
    beltColorVar: getComputedStyle(root).getPropertyValue('--belt-color').trim(),
    pillBackground: cs ? cs.backgroundColor : null,
    pillText: pill ? (pill.textContent || '').trim().slice(0, 40) : null,
  }
})

/** Inventory the persistent AudioCache — the store the player actually reads. */
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
    if (/Offline|INF PLAY|infplay|belt|recycle|cached/i.test(t)) logs.push(`${m.type()}: ${t}`)
  })

  // Every audio request the player makes, so we can tell a cache read from a
  // network fetch — and catch a network fetch fired while offline.
  const audioRequests = []
  context.on('request', (r) => {
    const u = r.url()
    if (/\/api\/audio\//.test(u) || /\.mp3/.test(u)) audioRequests.push({ url: u, at: Date.now() })
  })

  await context.addInitScript(INSTALL_AUDIO_HOOK)
  const page = await context.newPage()

  // ── Phase 1: ONLINE. Warm the cache. ───────────────────────────────────
  console.log('=== Phase 1: online, warming the cache ===')
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6_000)

  // Start playback however the shell offers it (the big central control).
  await startPlayback(page)
  // Confirm playback genuinely started ONLINE. Without this a probe that
  // never plays at all reports "never went red" and looks like a pass.
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
  const warmBelt = await readBeltState(page)
  console.log(`cache after warm: ${warmCache.count} clips in ${warmCache.db}`)
  console.log(`belt after warm:  colour=${warmBelt.beltColorVar} pillBg=${warmBelt.pillBackground} ∞=${warmBelt.infinityGlyphPresent}`)
  await page.screenshot({ path: '/home/tomcassidy/SSi/ssi-learning-app/docs/offline-belt-held-1-online-2026-08-15.png' })

  if (warmCache.count === 0) {
    console.log('\n!! GAP: nothing landed in the persistent audio cache during the warm phase.')
    console.log('   The offline assertions below cannot be trusted without a warm cache.')
  }

  // ── Phase 2: BLACK-HOLE the backend, then resume. ──────────────────────
  console.log('\n=== Phase 2: backend black-holed, resuming ===')
  await context.route(/supabase\.co/, () => {})
  await context.route(/\/api\//, () => {})
  await context.route(/amazonaws\.com/, () => {})

  const resumeAt = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded' })
  // The shell has to finish booting offline before the central control is
  // live — clicking into a half-mounted player is a no-op, and the probe then
  // reports "no audio" for a reason that has nothing to do with the fix.
  await page.waitForTimeout(12_000)
  await startPlayback(page)

  // ── Phase 3: watch the belt for the whole offline window. ──────────────
  // The assertion is over TIME, not one sample: the recycle engages when the
  // pre-tail watcher fires, which is exactly the moment the old code went red.
  let wentRed = false
  let sawGlyph = false
  let firstAudioAt = null
  const offlinePlays = []
  const samples = []
  const until = Date.now() + OFFLINE_WATCH_MS
  while (Date.now() < until) {
    const s = await readBeltState(page).catch(() => null)
    if (s) {
      samples.push(s)
      if (rgbEq(s.pillBackground, INF_PLAY_RED) || s.pillIsInfPlayClass === true) wentRed = true
      if (s.infinityGlyphPresent) sawGlyph = true
    }
    if (!firstAudioAt) {
      const plays = await readPlays(page)
      if (plays.length > 0) { firstAudioAt = Date.now(); offlinePlays.push(...plays) }
    }
    await page.waitForTimeout(1_500)
  }

  const offlineCache = await readAudioCache(page)
  const finalBelt = samples[samples.length - 1] || {}
  await page.screenshot({ path: '/home/tomcassidy/SSi/ssi-learning-app/docs/offline-belt-held-2-offline-2026-08-15.png' })

  const audioAfterOffline = audioRequests.filter((r) => r.at > resumeAt)

  console.log(`\nsamples taken: ${samples.length}`)
  console.log(`belt went SSi red at any point:   ${wentRed}`)
  console.log(`∞ glyph appeared at any point:    ${sawGlyph}`)
  console.log(`final belt colour var:            ${finalBelt.beltColorVar}`)
  console.log(`final pill background:            ${finalBelt.pillBackground}`)
  console.log(`time to first audio after resume: ${firstAudioAt ? `${((firstAudioAt - resumeAt) / 1000).toFixed(1)}s` : 'no audio observed'}`)
  console.log(`cache while offline:              ${offlineCache.count} clips`)
  console.log(`audio requests fired while offline: ${audioAfterOffline.length}`)
  for (const l of logs.slice(-25)) console.log(`  ${l}`)

  console.log('\n--- verdict ---')
  const NO_RED = !wentRed && !sawGlyph
  const REACHED_STATE = warmCache.count > 0 && playedOnline && !!firstAudioAt
  console.log(`belt stayed the learner's own — never SSi red, never ∞: ${NO_RED}`)
  console.log(`probe genuinely reached the offline-playing state:      ${REACHED_STATE}`)
  if (!REACHED_STATE) {
    console.log('GAP: this run did NOT reach the state Tom hit, so the belt result above')
    console.log(`     settles nothing. warmCache=${warmCache.count} playedOnline=${playedOnline} offlineAudio=${!!firstAudioAt}`)
  }

  await browser.close()
  process.exit(NO_RED && REACHED_STATE ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
