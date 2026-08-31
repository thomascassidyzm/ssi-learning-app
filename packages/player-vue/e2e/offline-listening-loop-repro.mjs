// OFFLINE LISTENING-LOOP REPRO RIG — Tom, on his iPhone in airplane mode,
// Spanish, tonight (2026-08-31): he skipped belts until he ran out of new
// LEGOs. Then: "display comes up as TEXT for the next LEGO, but then when it
// realises it hasnt got it, it goes to the play what you have" ... "it should
// probably NOT try and play the listening exercises - its doing that now and
// its got stuck in a loop" ... "its stuck in a listening exercise loop of
// death now". Telemetry: a 13-minute window (21:34-21:47 UTC) inside a live
// session with ZERO audio_play events.
//
// This is a REUSABLE PROBE, not a one-shot report — the parent conversation
// writing the fix re-runs it to check the fix. It prints PASS/FAIL:
//   FAIL = the same unplayable cycle (esp. a `listening_*` cycle) is
//          re-selected repeatedly with no audio landing in between — the loop.
//   PASS = forward navigation past the cached edge settles to a definite,
//          non-repeating state (recycled USE content, or a plain "you're
//          offline, here's what's cached" message) and audio keeps sounding,
//          OR it never selects an unplayable cycle in the first place.
//
// WHY A FREE-TIER COURSE, NOT spa_for_eng: `gateSeed()` (LearningPlayer.vue)
// blocks ALL forward navigation — belt-skip AND natural round-advance —
// past the free-preview boundary (Yellow belt, seed 19) for a guest on a
// PREMIUM course. Tom's phone is a subscribed account; this probe is a guest
// browser session. To actually reach "ran out of new LEGOs" by skipping many
// belts we need a `pricing_tier=free` course, which `checkCourseAccess`
// (packages/core/src/pricing/access.ts) grants full access to unconditionally.
// pol_for_eng (Polish, free tier, 668 seeds / 748 LEGOs / 6110 phrases) is
// used here. The belt-skip / offline-cache machinery under test does not
// care about course pricing — only the paywall gate does — so this is a
// faithful repro of the mechanism, with an explicit, logged workaround for
// the one thing course choice changes (see "GAP" logging below if the
// paywall fires anyway).
//
// GENUINE OFFLINE, NOT A MOCK: context.setOffline(true) is Chromium's CDP
// Network.emulateNetworkConditions(offline:true) — real network-layer
// disconnection courtesy of Playwright, not a request-routing shim. The
// app's own shell + cached audio still serve from the real service worker's
// CacheStorage/IndexedDB (as they would on a phone in airplane mode);
// anything not already on disk simply fails to fetch.
//
// Run against a local production build with a real service worker
// (playwright's mocked network only works reliably with the SW present):
//   pnpm --filter @ssi/core build && pnpm --filter player-vue build
//   pnpm --filter player-vue preview --port 4173 --host &
//   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs \
//   BASE_URL=http://localhost:4173 node e2e/offline-listening-loop-repro.mjs
//
// Or against a live deployment (no local build needed, but you don't control
// how much is already cached from a prior run in that browser profile):
//   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs \
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/offline-listening-loop-repro.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const COURSE = process.env.COURSE_CODE || 'pol_for_eng' // free tier — see header
const OUT = process.env.OUT_DIR || `${process.env.CS_SCRATCH || '/tmp'}/offline-listening-loop/`
const WARM_MS = Number(process.env.WARM_MS || 45_000)
const FORWARD_SKIP_TAPS = Number(process.env.FORWARD_SKIP_TAPS || 25)
const WATCH_MS = Number(process.env.WATCH_MS || 120_000)
// Loop verdict thresholds: FAIL if the SAME (text,isListening) pane state is
// sampled this many times inside a WATCH_MS run with fewer than this many
// new audio plays in the same window.
const REPEAT_FAIL_THRESHOLD = Number(process.env.REPEAT_FAIL_THRESHOLD || 5)
const PLAYS_FLOOR_FOR_PASS = Number(process.env.PLAYS_FLOOR_FOR_PASS || 1)

mkdirSync(OUT, { recursive: true })
console.log(`[rig] BASE=${BASE} COURSE=${COURSE} OUT=${OUT}`)
console.log(`[rig] WARM_MS=${WARM_MS} FORWARD_SKIP_TAPS=${FORWARD_SKIP_TAPS} WATCH_MS=${WATCH_MS}`)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// TRUTH, not attempts: HTMLMediaElement.play() being CALLED proves nothing —
// SimplePlayer calls it on clips that then fail with error code 4 (no
// supported source) and self-logs "running SILENT" while never halting (its
// own standing ruling). __probePlayAttempts records every call; __probePlaying
// / __probeAudioErrors record what actually happened via the 'playing' event
// (audio genuinely started making sound) and the 'error' event.
//
// SimplePlayer.ts:452 does `this.audio = new Audio()` and DELIBERATELY NEVER
// attaches it to the document (that is what preserves the iOS user-gesture
// unlock — see the file's own comments). A detached element's events are
// dispatched only to listeners on the element itself; document-level capture
// listeners never see them, because capture/bubble both require the target to
// be IN the tree those ancestors belong to. So we wrap the `Audio` global
// constructor itself and attach listeners directly to every instance it
// creates — this needs no cooperation from the app's own code and works
// regardless of DOM attachment.
const INSTALL_HOOKS = () => {
  const w = window
  w.__probePlayAttempts = []
  w.__probePlaying = []
  w.__probeAudioErrors = []
  const OrigAudio = window.Audio
  function PatchedAudio(...args) {
    const el = new OrigAudio(...args)
    el.addEventListener('playing', () => {
      w.__probePlaying.push({ src: el.src || el.currentSrc || '', at: Date.now() })
    })
    el.addEventListener('error', () => {
      w.__probeAudioErrors.push({ src: el.src || el.currentSrc || '', code: el.error?.code ?? null, at: Date.now() })
    })
    const origPlay = el.play.bind(el)
    el.play = (...playArgs) => {
      try { w.__probePlayAttempts.push({ src: el.src || el.currentSrc || '', at: Date.now() }) } catch { /* never break playback */ }
      return origPlay(...playArgs)
    }
    return el
  }
  PatchedAudio.prototype = OrigAudio.prototype
  window.Audio = PatchedAudio
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})

const consoleLog = []
ctx.on('console', (m) => {
  const t = m.text()
  if (/Offline|listening|recycle|cached|cull|skip|InfPlay|infplay|Round|belt|paywall|SimplePlayer/i.test(t)) {
    consoleLog.push({ at: Date.now(), type: m.type(), text: t })
  }
})

await ctx.addInitScript(INSTALL_HOOKS)
await ctx.addInitScript((course) => {
  try { localStorage.setItem('ssi-last-course', course) } catch { /* ignore */ }
}, COURSE)

const page = await ctx.newPage()

const readPlayAttempts = () => page.evaluate(() => window.__probePlayAttempts || []).catch(() => [])
const readPlaying = () => page.evaluate(() => window.__probePlaying || []).catch(() => [])
const readAudioErrors = () => page.evaluate(() => window.__probeAudioErrors || []).catch(() => [])

/** Inventory the persistent AudioCache — the store the player actually reads. */
const readAudioCache = () => page.evaluate(async () => {
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
}).catch(() => ({ db: null, count: 0, ids: [] }))

/** The pane's current text + whether the app itself believes this is a listening cycle. */
const readPaneState = () => page.evaluate(() => {
  const known = document.querySelector('.known-text')
  return {
    text: known ? (known.textContent || '').trim().slice(0, 140) : null,
    isListening: !!document.querySelector('.known-text.listening-label'),
    paywallVisible: !!document.querySelector('.paywall-overlay'),
  }
}).catch(() => ({ text: null, isListening: false, paywallVisible: false }))

async function startPlayback() {
  const btn = page.locator('.center-btn').first()
  if (!(await btn.count().catch(() => 0))) return false
  await btn.click({ timeout: 8_000 }).catch(() => {})
  return true
}

async function main() {
  // ── Phase 0: ONLINE boot ────────────────────────────────────────────────
  console.log('\n=== Phase 0: online boot ===')
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  // NOTE: Locator.isVisible({timeout}) does NOT wait — it's a synchronous
  // snapshot check that happens to accept (and ignore) a timeout option.
  // waitFor() is the one that actually polls.
  const shellUp = await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false)
  check('shell booted (mode-trigger visible)', shellUp)
  await page.waitForTimeout(3_000)

  const started = await startPlayback()
  check('lesson started online', started)

  // ── Phase 1: WARM — cache a DELIBERATELY SHORT span, not the whole course ─
  console.log(`\n=== Phase 1: warming cache for ${WARM_MS / 1000}s (deliberately short — we WANT an edge) ===`)
  let playedOnline = false
  const warmUntil = Date.now() + WARM_MS
  while (Date.now() < warmUntil) {
    if (!playedOnline && (await readPlaying()).length > 0) {
      playedOnline = true
      console.log('  online playback confirmed (playing event observed — real sound, not just a play() call)')
    }
    await page.waitForTimeout(2_000)
  }
  const warmCache = await readAudioCache()
  console.log(`  cache after warm: ${warmCache.count} clips in ${warmCache.db}`)
  await page.screenshot({ path: `${OUT}1-warm-online.png` })
  check('audio genuinely played online (real warm cache, not a cold probe)', playedOnline && warmCache.count > 0, `${warmCache.count} clips`)

  // ── Phase 2: GO OFFLINE FOR REAL ────────────────────────────────────────
  console.log('\n=== Phase 2: genuine CDP offline (context.setOffline) ===')
  await ctx.setOffline(true)
  const offlineSince = Date.now()
  // Confirm the app itself notices — `navigator.onLine` inside the page.
  const navOffline = await page.evaluate(() => !navigator.onLine).catch(() => null)
  check('navigator.onLine flipped false', navOffline === true, `navigator.onLine reports offline=${navOffline}`)

  // ── Phase 3: SKIP BELTS FORWARD, past the cached edge ───────────────────
  // This is literally Tom's action: "he skipped belts until he ran out of
  // new LEGOs". The header double-chevron (`.belt-header-skip--forward`)
  // is handleSkipToNextBelt — the belt-scale forward jump.
  console.log(`\n=== Phase 3: skipping belts forward offline (up to ${FORWARD_SKIP_TAPS} taps) ===`)
  let tapsLanded = 0
  let paywallHit = false
  for (let i = 0; i < FORWARD_SKIP_TAPS; i++) {
    const chevron = page.locator('.belt-header-skip--forward').first()
    const visible = await chevron.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)
    if (!visible) { console.log(`  tap ${i + 1}: forward chevron not visible/disabled — stopping taps`); break }
    await chevron.click({ timeout: 5_000 }).catch(() => {})
    tapsLanded++
    await page.waitForTimeout(1_800)
    const pane = await readPaneState()
    if (pane.paywallVisible) { paywallHit = true; console.log(`  tap ${i + 1}: paywall appeared — GAP, see below`); break }
    console.log(`  tap ${i + 1}: pane="${pane.text}" listening=${pane.isListening}`)
  }
  await page.screenshot({ path: `${OUT}2-after-belt-skips.png` })
  check('forward belt-skip taps landed without a paywall (free-tier course)', !paywallHit, `${tapsLanded} taps landed, paywallHit=${paywallHit}`)
  if (paywallHit) {
    console.log('  !! GAP: paywall blocked further forward navigation. If this fires even on a')
    console.log('     pricing_tier=free course, something beyond entitlement is gating — note it')
    console.log('     verbatim in the report rather than pushing through.')
  }

  // ── Phase 4: WATCH — this is where the loop lives or doesn't ───────────
  console.log(`\n=== Phase 4: watching for ${WATCH_MS / 1000}s past the cached edge ===`)
  const playingBeforeWatch = (await readPlaying()).length
  const attemptsBeforeWatch = (await readPlayAttempts()).length
  const errorsBeforeWatch = (await readAudioErrors()).length
  const samples = [] // { at, text, isListening }
  const until = Date.now() + WATCH_MS
  let i = 0
  while (Date.now() < until) {
    const pane = await readPaneState()
    samples.push({ at: Date.now(), ...pane })
    if (i % 10 === 0) console.log(`  t+${((Date.now() - offlineSince) / 1000).toFixed(0)}s: "${pane.text}" listening=${pane.isListening}`)
    i++
    await page.waitForTimeout(1_000)
  }
  const playingAfterWatch = (await readPlaying()).length
  const attemptsAfterWatch = (await readPlayAttempts()).length
  const errorsAfterWatch = (await readAudioErrors()).length
  const newPlayingDuringWatch = playingAfterWatch - playingBeforeWatch     // TRUTH: audio actually sounded
  const newAttemptsDuringWatch = attemptsAfterWatch - attemptsBeforeWatch  // play() calls, success or not
  const newErrorsDuringWatch = errorsAfterWatch - errorsBeforeWatch       // audio element 'error' events
  const offlineCacheFinal = await readAudioCache()
  await page.screenshot({ path: `${OUT}3-after-watch.png` })

  // The app's OWN silence detector (SimplePlayer.skipFailedClip): parse every
  // "N clips skipped in a row" line for its running count, and every "Audio
  // unplayable after retry" line for the cycleId that failed — so we can say,
  // authoritatively, whether any FAILING cycle was a listening_-prefixed one.
  const skipRunRegex = /\[SimplePlayer\] (\d+) clips skipped in a row with nothing audible/
  const unplayableRegex = /\[SimplePlayer\] Audio unplayable after retry.*?cycleId=(\S+)/
  let maxConsecutiveSkips = 0
  const failedCycleIds = new Set()
  for (const l of consoleLog) {
    const m1 = l.text.match(skipRunRegex)
    if (m1) maxConsecutiveSkips = Math.max(maxConsecutiveSkips, Number(m1[1]))
    const m2 = l.text.match(unplayableRegex)
    if (m2) failedCycleIds.add(m2[1])
  }
  const failedListeningCycleIds = [...failedCycleIds].filter((id) => id.startsWith('listening_'))

  // ── Verdict computation ──────────────────────────────────────────────
  // Loop signature: the exact same pane text (with the SAME listening flag)
  // recurring REPEAT_FAIL_THRESHOLD+ times while genuinely-new audio plays
  // stayed under the floor for the whole watch window — text repeating
  // because the SAME unplayable cycle keeps getting re-selected, and no
  // sound because none of those repeats ever produced audio.
  const counts = new Map() // key -> count
  for (const s of samples) {
    if (!s.text) continue
    const key = `${s.isListening ? 'LISTENING' : 'plain'}::${s.text}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const topRepeat = sorted[0] || [null, 0]
  const listeningRepeats = sorted.filter(([k]) => k.startsWith('LISTENING::'))

  console.log('\n--- pane-state distribution during watch ---')
  for (const [key, n] of sorted.slice(0, 8)) console.log(`  ${n.toString().padStart(3)}× ${key.slice(0, 100)}`)

  // Loop, TRUTH version: repeated pane text AND no genuine audible playback
  // (the 'playing' event truth-signal, not mere play() attempts) during the
  // same window is the actual "loop of death" — text stuck/churning, silence.
  const loopDetected = topRepeat[1] >= REPEAT_FAIL_THRESHOLD && newPlayingDuringWatch < PLAYS_FLOOR_FOR_PASS
  const listeningLoopDetected = listeningRepeats.some(([, n]) => n >= REPEAT_FAIL_THRESHOLD) && newPlayingDuringWatch < PLAYS_FLOOR_FOR_PASS
  // The app's OWN alarm firing IS a silence-loop signature independent of our
  // sampling cadence: it means SimplePlayer itself observed a sustained run
  // of clips it could not make audible, marching forward and never stopping —
  // which is indistinguishable, from a telemetry/zero-audio_play standpoint,
  // from Tom's report. CONSECUTIVE_SKIP_ALARM in SimplePlayer.ts is the
  // threshold; we treat >=5 as the same bar this rig uses elsewhere.
  const silentMarchDetected = maxConsecutiveSkips >= REPEAT_FAIL_THRESHOLD

  console.log('\n--- console log lines matched (last 40) ---')
  for (const l of consoleLog.slice(-40)) console.log(`  [${new Date(l.at).toISOString().slice(11, 19)}] ${l.type}: ${l.text.slice(0, 160)}`)

  const cullAdvanceLogs = consoleLog.filter((l) => /all cycles skipped by the runtime cull/i.test(l.text))

  console.log('\n--- summary ---')
  console.log(`warm cache clips:                 ${warmCache.count}`)
  console.log(`offline cache clips (unchanged expected — no network to grow it): ${offlineCacheFinal.count}`)
  console.log(`belt-skip taps landed:            ${tapsLanded}${paywallHit ? ' (stopped by paywall)' : ''}`)
  console.log(`play() ATTEMPTS during watch:      ${newAttemptsDuringWatch}  (calls made, success or not — NOT proof of sound)`)
  console.log(`genuine 'playing' events during watch: ${newPlayingDuringWatch}  (TRUTH signal — audio actually sounded)`)
  console.log(`audio element 'error' events during watch: ${newErrorsDuringWatch}`)
  console.log(`distinct pane states sampled:     ${counts.size} (over ${samples.length} samples)`)
  console.log(`most-repeated pane state:         ${topRepeat[1]}× "${(topRepeat[0] || '').slice(0, 100)}"`)
  console.log(`"all cycles skipped by cull" round-advance logs seen: ${cullAdvanceLogs.length}`)
  console.log(`app's own max "clips skipped in a row" alarm value: ${maxConsecutiveSkips}`)
  console.log(`distinct FAILING cycleIds (from "Audio unplayable" logs): ${failedCycleIds.size}${failedCycleIds.size ? ` — ${[...failedCycleIds].slice(0, 6).join(', ')}${failedCycleIds.size > 6 ? ', …' : ''}` : ''}`)
  console.log(`of those, listening_-prefixed cycleIds: ${failedListeningCycleIds.length}${failedListeningCycleIds.length ? ` — ${failedListeningCycleIds.join(', ')}` : ' (none — see report for what this run DID and did not cover)'}`)
  console.log(`LOOP DETECTED (pane-text repeat + silence): ${loopDetected}`)
  console.log(`LISTENING-SPECIFIC pane-text LOOP DETECTED: ${listeningLoopDetected}`)
  console.log(`SUSTAINED SILENT MARCH (app's own alarm):   ${silentMarchDetected}`)

  check('no cycle (listening or otherwise) got stuck repeating with genuine silence', !loopDetected,
    `top repeat ${topRepeat[1]}× over ${WATCH_MS / 1000}s, only ${newPlayingDuringWatch} genuine plays`)
  check('specifically: no LISTENING-cycle stuck-loop-of-death (pane-text signature)', !listeningLoopDetected,
    listeningRepeats.length ? `${listeningRepeats.map(([k, n]) => `${n}×`).join(', ')}` : 'no listening cycles observed at all')
  check('no sustained silent march (app\'s own "running SILENT" alarm never fired >=threshold)', !silentMarchDetected,
    `max consecutive skips=${maxConsecutiveSkips}, failing cycleIds=${failedCycleIds.size}, of which listening_*=${failedListeningCycleIds.length}`)
  check('audio kept genuinely sounding through the whole watch window (no silence stall)', newPlayingDuringWatch >= PLAYS_FLOOR_FOR_PASS,
    `${newPlayingDuringWatch} genuine 'playing' events in ${WATCH_MS / 1000}s (vs ${newAttemptsDuringWatch} play() attempts and ${newErrorsDuringWatch} errors)`)

  writeFileSync(`${OUT}evidence.json`, JSON.stringify({
    base: BASE, course: COURSE, warmMs: WARM_MS, forwardSkipTaps: FORWARD_SKIP_TAPS, watchMs: WATCH_MS,
    warmCache, offlineCacheFinal, tapsLanded, paywallHit,
    playingBeforeWatch, playingAfterWatch, attemptsBeforeWatch, attemptsAfterWatch, errorsBeforeWatch, errorsAfterWatch,
    samples, consoleLog, maxConsecutiveSkips, failedCycleIds: [...failedCycleIds], failedListeningCycleIds,
    verdict: { loopDetected, listeningLoopDetected, silentMarchDetected, failures },
  }, null, 2))

  await ctx.setOffline(false)
  await browser.close()

  console.log(`\nEvidence JSON: ${OUT}evidence.json`)
  console.log(`Screenshots: ${OUT}{1-warm-online,2-after-belt-skips,3-after-watch}.png`)
  console.log(failures === 0 ? '\nALL PASS — no repro of the loop under this run\'s conditions.' : `\n${failures} FAILURES — loop (or a gap) reproduced/observed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('[rig] FATAL', e); process.exit(2) })
