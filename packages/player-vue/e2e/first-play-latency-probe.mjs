// FIRST-PLAY LATENCY PROBE (baseline measure, 2026-08-30).
//
// THE METRIC: time from selecting a course to first audio ACTUALLY PLAYING,
// for a genuinely FRESH DEVICE (empty cache, no service worker, no IndexedDB,
// no localStorage), on a THROTTLED connection, AS A FIRST-TIME VISITOR
// (guest, not signed in). Default course, unchanged: zho_for_eng
// (Chinese-for-English) — App.vue:536 auto-selects it for any fresh/anon
// visitor with no saved course and no ?course= URL param.
//
// METHOD NOTE — "selecting a course" for this cohort:
// A first-time guest never clicks a course row. App.vue's boot resolver
// (PREFERRED_DEFAULT = 'zho_for_eng') assigns activeCourse the instant the
// courses list loads — before the learner does anything. So for THIS
// specific measurement (fresh guest, default course), "course selection"
// IS the page load / boot resolution, not a separate click. t0 = navigation
// start. This is stated explicitly, per the brief, so the number can be
// judged rather than assumed. (A *manual* course switch — BrowseScreen.vue
// select-course → PlayerContainer.vue handleCourseSelect — is a different,
// warm-app scenario already covered by course-switch-waterfall-probe.mjs and
// is out of scope here.)
//
// The learner must still tap the transport (BottomNav .center-btn) to start
// playback — SimplePlayer will not auto-play on boot regardless of the
// browser's autoplay policy, because starting a lesson is a deliberate
// learner action, not autoplay. That tap is recorded as its own explicit
// leg (t_press) so it isn't silently absorbed into either neighbour.
//
// FIRST-AUDIO-PLAYING DETECTION (the hard part — stated explicitly):
// We do NOT trust any UI state class (e.g. .center-btn.is-stop) as a proxy
// for audio actually sounding — Tom's brief calls this out as the way a
// sloppy harness lies. Instead we hook HTMLMediaElement.prototype.play at
// document-start (page.addInitScript, runs before any app code) and attach
// a `timeupdate` listener to every element that is ever played. The event
// fires only once the element's currentTime is genuinely advancing — a
// resolved play() promise is NOT enough (autoplay-suspended or
// buffering-stalled elements resolve play() without ever advancing).
// t_playing = the first timeupdate where currentTime > 0.05s, i.e. the FIRST
// video/audio frame has genuinely been rendered to the output device.
// We separate this into:
//   firstAnyAudible    — any <audio>/<video> element (would include a brand
//                        welcome chime if one exists on this path)
//   firstLessonAudible — the first element whose src does NOT match the
//                        welcome/placeholder/silent-keepalive patterns
// The Aran welcome-message note in the brief is handled by this split: if
// firstAnyAudible fires before firstLessonAudible, the gap between the two
// IS the welcome message's occupied time on the critical path, reported
// verbatim and left alone.
//
// NETWORK WATERFALL LEGS (the breakdown matters as much as the total):
//   nav                — page navigation start (== "course selection", see above)
//   press              — learner taps the transport to start the lesson
//   round-map          — GET /api/courses/:code/round-map (position resolution)
//   cycles(limit=1)    — GET /api/courses/:code/cycles?from=...&limit=1 (or the
//                        first cycles/ request seen, in case limit=15 fires
//                        first — both are logged, first-seen wins the leg)
//   first-audio-byte   — first /api/audio/:id (or S3/CDN mp3) response COMPLETE
//   first-audio-playing— t_playing, as defined above
//
// Usage:
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//   RUNS=5 THROTTLE=fast3g OUT_DIR=$CS_SCRATCH/first-play/ \
//   node e2e/first-play-latency-probe.mjs
//
// THROTTLE: 'none' | 'fast3g' (default) | 'slow4g' — CDP Network.emulateNetworkConditions.
//   fast3g = Chrome DevTools' own "Fast 3G" preset: 1.6Mbps down / 750Kbps up / 150ms RTT.
//   slow4g = realistic mid-range mobile 4G: 4Mbps down / 1Mbps up / 80ms RTT.

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { chromium } from '@playwright/test'

// ── LD_LIBRARY_PATH + chromium exec, the working pattern on this box (the
// headless_shell binary Playwright picks by default is missing libnspr4 and
// friends on this box's OS; the full `chromium-*/chrome-linux64/chrome`
// build + one of these lib dirs is what other probes in this repo use). ────
const LIB_PATHS = [
  `${homedir()}/.ssi-sentinel-libs`,
  `${homedir()}/.pwlibs/root/usr/lib/x86_64-linux-gnu`,
  `${homedir()}/cslibs/root/usr/lib/x86_64-linux-gnu`,
]
const existingLib = LIB_PATHS.find((p) => existsSync(p))
if (existingLib) process.env.LD_LIBRARY_PATH = `${existingLib}:${process.env.LD_LIBRARY_PATH || ''}`
const CHROME_PATH = process.env.CHROME_BIN || execSync(
  `ls ${homedir()}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -1`
).toString().trim()
console.error('chrome exec:', CHROME_PATH, '| LD_LIBRARY_PATH:', process.env.LD_LIBRARY_PATH)

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || `${process.env.CS_SCRATCH || '/tmp'}/first-play-latency/`
const RUNS = Number(process.env.RUNS || 5)
const THROTTLE = process.env.THROTTLE || 'fast3g'
const BUDGET_MS = Number(process.env.BUDGET_MS || 90000)
const EXPECT_COURSE = process.env.EXPECT_COURSE || 'zho_for_eng'

mkdirSync(OUT, { recursive: true })

const PROFILES = {
  none: null,
  fast3g: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  slow4g: { downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8, latency: 80 },
}

// Runs at document-start, before any app JS — this is what makes the
// audio-play hook trustworthy rather than a race against app boot.
const instrument = () => {
  window.__t0 = performance.now()
  window.__audio = { firstPlayCall: null, firstAnyAudible: null, firstLessonAudible: null, firstLessonSrc: null, firstLessonPlayCall: null, srcs: [] }
  window.__rejections = []
  addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason).slice(0, 200)))

  // Anything that isn't the actual lesson prompt/target audio — a brand
  // welcome chime, a placeholder tone, or the pause-phase silent keepalive.
  const isLesson = (src) => !!src && !/welcome|brand|placeholder|silent|keepalive/i.test(src)

  const watch = (el) => {
    if (el.__ssiWatched) return
    el.__ssiWatched = true
    el.addEventListener('timeupdate', () => {
      const src = String(el.src || el.currentSrc || '')
      if (el.currentTime <= 0.05) return
      if (window.__audio.firstAnyAudible === null) window.__audio.firstAnyAudible = performance.now()
      if (isLesson(src) && window.__audio.firstLessonAudible === null) {
        window.__audio.firstLessonAudible = performance.now()
        window.__audio.firstLessonSrc = src.slice(0, 200)
      }
    })
  }

  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    const src = String(this.src || this.currentSrc || '(nosrc)')
    if (window.__audio.firstPlayCall === null) window.__audio.firstPlayCall = performance.now()
    if (isLesson(src) && window.__audio.firstLessonPlayCall === null) {
      window.__audio.firstLessonPlayCall = performance.now()
    }
    window.__audio.srcs.push({ t: Math.round(performance.now()), src: src.slice(0, 160) })
    watch(this)
    return origPlay.apply(this, args)
  }
}

async function runOnce(index) {
  const profile = `${OUT}profile-${index}-${Date.now()}`
  // Throwaway persistent context = the only way to be certain nothing (SW,
  // HTTP cache, IndexedDB, localStorage) survives from a previous run —
  // i.e. a genuinely fresh device, first-time visitor.
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_PATH || undefined,
    viewport: { width: 390, height: 844 },
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
  })
  const page = ctx.pages()[0] || (await ctx.newPage())

  const apiRows = [] // { leg, url, start, end, status }
  const allRequests = [] // every request, for diagnosing which endpoints actually fire
  let navAt = 0
  // NOTE — the brief names /api/courses/:code/round-map and
  // /api/courses/:code/cycles?...&limit=1 as the boot-critical endpoints
  // (per useInstantPlayback.ts). On THIS live dev deployment those endpoints
  // do NOT fire on a fresh guest boot at all — verified against real network
  // traffic, not assumed from the source file. The path actually taken is
  // GET /api/courses/:code/bundle (one batched endpoint) plus a handful of
  // direct Supabase REST queries (course_legos, course_practice_phrases,
  // algorithm_config, listening_pods, listening_pod_sentences). Both are
  // matched below so the probe reports what actually happens on dev, and
  // still auto-detects round-map/cycles if a future deploy re-enables that
  // path.
  const legFor = (url) => {
    if (/\/round-map(\?|$)/.test(url)) return 'round-map'
    if (/\/cycles\?/.test(url)) return /limit=1(&|$)/.test(url) ? 'cycles(limit=1)' : 'cycles(other)'
    if (/\/api\/courses\/[^/]+\/bundle(\?|$)/.test(url)) return 'course-bundle'
    if (/supabase\.co\/rest\/v1\/courses\?/.test(url)) return 'courses-catalogue'
    if (/supabase\.co\/rest\/v1\/(course_legos|course_practice_phrases|algorithm_config|listening_pods|listening_pod_sentences)\b/.test(url)) return 'course-content-query'
    if (/\/api\/audio\//.test(url) || /\.mp3(\?|$)/i.test(url) || /amazonaws|cloudfront/i.test(url)) return 'audio-file'
    return null
  }
  page.on('request', (req) => {
    const url = req.url()
    if (/^https?:/.test(url) && !/\.(js|css|woff2?|png|jpe?g|svg|ico)(\?|$)/i.test(url)) {
      allRequests.push({ t: Date.now() - navAt, url: url.slice(0, 160) })
    }
    const leg = legFor(url)
    if (!leg) return
    apiRows.push({ leg, url: url.slice(0, 180), start: Date.now() - navAt, end: null, status: null })
  })
  page.on('requestfinished', async (req) => {
    const url = req.url()
    const leg = legFor(url)
    if (!leg) return
    const row = apiRows.find((r) => r.url === url.slice(0, 180) && r.end === null)
    if (row) {
      row.end = Date.now() - navAt
      try { row.status = (await req.response())?.status() ?? null } catch { /* gone */ }
    }
  })
  page.on('requestfailed', (req) => {
    const url = req.url()
    const leg = legFor(url)
    if (!leg) return
    const row = apiRows.find((r) => r.url === url.slice(0, 180) && r.end === null)
    if (row) { row.end = Date.now() - navAt; row.status = 'FAILED' }
  })

  const consoleLines = []
  const keyLines = []
  page.on('console', (m) => {
    const line = `${Date.now() - navAt}ms [${m.type()}] ${m.text().slice(0, 240)}`
    consoleLines.push(line)
    // CSP-eval-warning spam and other browser noise floods a plain tail —
    // keep the app's own boot/course/instant-playback logs regardless.
    if (/\[App\]|\[InstantPlayback\]|\[ColdStart\]|\[SimplePlayer\]|round-map|cycles/i.test(m.text())) keyLines.push(line)
  })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))

  await page.addInitScript(instrument)

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.clearBrowserCache')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  const prof = PROFILES[THROTTLE]
  if (prof) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof })

  // Prove emptiness rather than assume it — a stale profile dir would
  // silently turn this into a warm-cache measurement.
  const preState = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      const dbs = (await indexedDB.databases?.()) || []
      return { swCount: regs.length, dbs: dbs.map((d) => d.name), localStorageKeys: Object.keys(localStorage).length }
    } catch (e) { return { error: String(e) } }
  }).catch(() => ({ error: 'pre-nav evaluate unavailable' }))

  const wallStart = Date.now()
  navAt = wallStart
  // t0 = "course selection" for this cohort — see METHOD NOTE above.
  await page.goto(BASE + '/', { waitUntil: 'commit' })

  const emptiness = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => [])
    const dbs = (await indexedDB.databases?.().catch(() => [])) || []
    return { swCount: regs.length, dbs: dbs.map((d) => d.name), localStorageKeys: Object.keys(localStorage).length }
  }).catch(() => ({ error: 'unavailable' }))

  // Confirm which course actually got auto-selected (guard against drift).
  // resolvedCourse: console.log is stripped in this production build (no
  // "[App] Course:" line survives minification), so we read the resolved
  // course back from the network instead — the first course-scoped request
  // (bundle endpoint or a course_code=eq.<code> REST filter) names it
  // unambiguously.
  let resolvedCourse = null
  const courseLine = () => {
    for (const r of allRequests) {
      let m = r.url.match(/\/api\/courses\/([^/?]+)\/(bundle|round-map|cycles)/)
      if (m) return decodeURIComponent(m[1])
      m = r.url.match(/course_code=eq\.([^&]+)/)
      if (m) return decodeURIComponent(m[1])
    }
    return null
  }

  // Wait for the transport to be tappable, then tap it — this IS the
  // learner-initiated "start the lesson" gesture, timed as its own leg.
  // ONE overall deadline for this whole wait — not one budget for "button
  // visible" stacked on top of another for "button enabled", which would
  // silently double the stated BUDGET_MS.
  const pressDeadline = wallStart + BUDGET_MS
  const centre = page.locator('.center-btn').first()
  let tPress = null
  let pressed = false
  let stallReason = null
  try {
    await centre.waitFor({ state: 'visible', timeout: Math.max(0, pressDeadline - Date.now()) })
    let everEnabled = false
    while (Date.now() < pressDeadline) {
      const disabled = await centre.evaluate((el) => el.classList.contains('is-disabled')).catch(() => true)
      if (!disabled) { everEnabled = true; break }
      await page.waitForTimeout(100)
    }
    if (!everEnabled) stallReason = 'center-btn never left is-disabled within budget — app did not reach a playable state (see NOTE re CRITICAL_PATH_TIMEOUT_MS / offline-catalogue-mirror dead-end)'
    await centre.click({ timeout: 8000, force: true })
    pressed = true
    tPress = await page.evaluate(() => Math.round(performance.now() - window.__t0)).catch(() => null)
  } catch (e) {
    stallReason = stallReason || `press-failed: ${String(e).slice(0, 200)}`
    pageErrors.push(`press-failed: ${String(e).slice(0, 200)}`)
  }
  resolvedCourse = courseLine()
  if (!resolvedCourse && !stallReason) stallReason = 'no course-scoped request was ever observed — boot did not reach course content'

  // Poll until lesson audio is genuinely audible or budget runs out.
  let audio = null
  const deadline = wallStart + BUDGET_MS
  while (Date.now() < deadline) {
    audio = await page.evaluate(() => window.__audio).catch(() => null)
    if (audio?.firstLessonAudible) break
    await page.waitForTimeout(100)
  }
  await page.screenshot({ path: `${OUT}run-${index}-final.png` }).catch(() => {})

  const t0abs = await page.evaluate(() => window.__t0).catch(() => 0)
  const msFrom = (perfT) => (perfT == null ? null : Math.round(perfT - t0abs))

  // First-seen timestamp per leg from the network rows.
  const legFirst = (leg, field) => {
    const rows = apiRows.filter((r) => r.leg === leg && r[field] != null).sort((a, b) => a[field] - b[field])
    return rows.length ? rows[0][field] : null
  }
  const cyclesLeg = apiRows.some((r) => r.leg === 'cycles(limit=1)') ? 'cycles(limit=1)' : 'cycles(other)'
  const usesRoundMap = apiRows.some((r) => r.leg === 'round-map' || r.leg === 'cycles(limit=1)' || r.leg === 'cycles(other)')

  const result = {
    index, base: BASE, throttle: THROTTLE,
    resolvedCourse, expectCourse: EXPECT_COURSE, courseMatchesExpected: resolvedCourse === EXPECT_COURSE,
    emptinessBeforeNav: preState,
    emptinessAtCommit: emptiness,
    pressed,
    stallReason,
    usesRoundMapCyclesPath: usesRoundMap, // false on this dev build — see legFor() note
    t_selection_ms: 0, // by definition — navigation start IS course selection for this cohort
    t_press_ms: tPress,
    t_roundMapStart_ms: legFirst('round-map', 'start'),
    t_roundMapEnd_ms: legFirst('round-map', 'end'),
    t_cyclesStart_ms: legFirst(cyclesLeg, 'start'),
    t_cyclesEnd_ms: legFirst(cyclesLeg, 'end'),
    t_courseBundleStart_ms: legFirst('course-bundle', 'start'),
    t_courseBundleEnd_ms: legFirst('course-bundle', 'end'),
    t_coursesCatalogueStart_ms: legFirst('courses-catalogue', 'start'),
    t_coursesCatalogueEnd_ms: legFirst('courses-catalogue', 'end'),
    t_lastContentQueryEnd_ms: (() => {
      const rows = apiRows.filter((r) => r.leg === 'course-content-query' && r.end != null)
      return rows.length ? Math.max(...rows.map((r) => r.end)) : null
    })(),
    t_firstAudioByteStart_ms: legFirst('audio-file', 'start'),
    t_firstAudioByteEnd_ms: legFirst('audio-file', 'end'),
    t_firstAnyAudible_ms: msFrom(audio?.firstAnyAudible),
    t_firstLessonAudible_ms: msFrom(audio?.firstLessonAudible),
    firstLessonSrc: audio?.firstLessonSrc || null,
    firstLessonAudibleMissing: !audio?.firstLessonAudible,
    audioSrcTimeline: (audio?.srcs || []).slice(0, 10),
    apiWaterfall: apiRows,
    allRequests: allRequests.slice(0, 200),
    pageErrors,
    keyLines,
    consoleTail: consoleLines.slice(-40),
  }

  writeFileSync(`${OUT}run-${index}.json`, JSON.stringify(result, null, 2))
  await ctx.close()
  rmSync(profile, { recursive: true, force: true })
  return result
}

const printWaterfall = (r) => {
  console.log(`\n── RUN ${r.index} — course=${r.resolvedCourse} throttle=${THROTTLE}${r.stallReason ? ' — STALLED' : ''} ──`)
  if (r.stallReason) console.log(`  STALL: ${r.stallReason}`)
  const row = (name, t) => console.log(`  ${name.padEnd(28)} ${t == null ? 'MISSING' : `${t}ms`}`)
  row('selection (nav start)', 0)
  row('courses-catalogue complete', r.t_coursesCatalogueEnd_ms)
  if (r.usesRoundMapCyclesPath) {
    row('round-map request start', r.t_roundMapStart_ms)
    row('round-map complete', r.t_roundMapEnd_ms)
    row('cycles(limit=1) start', r.t_cyclesStart_ms)
    row('cycles(limit=1) complete', r.t_cyclesEnd_ms)
  } else {
    row('course-bundle request start', r.t_courseBundleStart_ms)
    row('course-bundle complete', r.t_courseBundleEnd_ms)
    row('last content query complete', r.t_lastContentQueryEnd_ms)
  }
  row('press (learner taps play)', r.t_press_ms)
  row('first audio byte start', r.t_firstAudioByteStart_ms)
  row('first audio byte complete', r.t_firstAudioByteEnd_ms)
  row('first audio PLAYING (any)', r.t_firstAnyAudible_ms)
  row('first LESSON audio PLAYING', r.t_firstLessonAudible_ms)
  if (r.t_firstAnyAudible_ms != null && r.t_firstLessonAudible_ms != null && r.t_firstAnyAudible_ms < r.t_firstLessonAudible_ms) {
    console.log(`  >> non-lesson audio (e.g. Aran welcome) occupied ${r.t_firstLessonAudible_ms - r.t_firstAnyAudible_ms}ms of the critical path before the lesson itself sounded`)
  }
  if (!r.usesRoundMapCyclesPath) console.log('  NOTE: this build does not use round-map/cycles on boot — see course-bundle/course-content-query legs instead (verified against live network traffic, not the source-code assumption)')
  if (!r.courseMatchesExpected) console.log(`  !! resolved course "${r.resolvedCourse}" != expected "${r.expectCourse}"`)
  if (r.pageErrors.length) console.log(`  page errors: ${r.pageErrors.join(' | ')}`)
}

const rows = []
for (let i = 1; i <= RUNS; i++) {
  const r = await runOnce(i)
  rows.push(r)
  printWaterfall(r)
}

const nums = (k) => rows.map((r) => r[k]).filter((v) => typeof v === 'number')
const stat = (k) => {
  const v = nums(k).slice().sort((a, b) => a - b)
  if (!v.length) return { n: 0 }
  const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
  return { n: v.length, min: v[0], max: v[v.length - 1], median: Math.round(median) }
}

const summary = {
  base: BASE, throttle: THROTTLE, runs: RUNS, expectCourse: EXPECT_COURSE,
  t_coursesCatalogueEnd_ms: stat('t_coursesCatalogueEnd_ms'),
  t_courseBundleEnd_ms: stat('t_courseBundleEnd_ms'),
  t_lastContentQueryEnd_ms: stat('t_lastContentQueryEnd_ms'),
  t_press_ms: stat('t_press_ms'),
  t_roundMapEnd_ms: stat('t_roundMapEnd_ms'),
  t_cyclesEnd_ms: stat('t_cyclesEnd_ms'),
  t_firstAudioByteEnd_ms: stat('t_firstAudioByteEnd_ms'),
  t_firstAnyAudible_ms: stat('t_firstAnyAudible_ms'),
  t_firstLessonAudible_ms: stat('t_firstLessonAudible_ms'),
  runsMissingFirstLessonAudible: rows.filter((r) => r.firstLessonAudibleMissing).length,
  runsWithCourseMismatch: rows.filter((r) => !r.courseMatchesExpected).length,
  runsStalled: rows.filter((r) => r.stallReason).length,
  stallReasons: rows.filter((r) => r.stallReason).map((r) => ({ run: r.index, reason: r.stallReason })),
}
writeFileSync(`${OUT}summary-${THROTTLE}.json`, JSON.stringify(summary, null, 2))
console.log('\n===== SUMMARY (median, n, min-max) =====')
console.log(JSON.stringify(summary, null, 2))

process.exit(summary.runsMissingFirstLessonAudible > 0 ? 1 : 0)
