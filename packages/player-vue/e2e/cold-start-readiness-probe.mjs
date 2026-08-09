// Cold-start readiness probe (diagnosis, 2026-08-08).
//
// Tom, on staging after clearing his cache: "the play button appears ready —
// it stops flashing while loading, but when you actually press play it still
// takes a few seconds to play, and if you wanted to change belt position or do
// anything else, none of that functionality is ready just yet."
//
// This probe measures that window from a GENUINELY cold browser: a throwaway
// user-data-dir per run, so there is no service worker, no HTTP cache, no
// IndexedDB audio cache and no localStorage carried in from a previous run.
//
// It records, on one wall clock started at navigation:
//   t_ready   — the awakening loading screen goes away and the play affordance
//               is on screen (this is the moment that "looks ready")
//   t_belt    — the belt badge appears (PlayerRestingState isPlayerReady)
//   t_mode    — the Easy/Fast switch appears (same gate)
//   t_press   — we tap the player
//   t_audio   — audio is genuinely AUDIBLE: a media element reports
//               currentTime advancing past zero, not merely a resolved play()
//
// It also samples which elements are running a CSS animation, so "it stops
// flashing" is measured rather than assumed, and it snapshots whether the belt
// pill and course-name controls actually do anything when tapped at t_ready.
//
//   BASE_URL=https://staging.saysomethingin.app \
//   RUNS=3 THROTTLE=fast3g OUT_DIR=/tmp/coldstart \
//   node e2e/cold-start-readiness-probe.mjs
//
// THROTTLE: 'none' (default) | 'fast3g' | 'slow4g'
// MODE: 'press' (default — measures time to audio) | 'controls' (taps the belt
//       pill and the course name at t_ready and reports whether anything opened)

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT_DIR || '/tmp/coldstart/'
const RUNS = Number(process.env.RUNS || 3)
const THROTTLE = process.env.THROTTLE || 'none'
const MODE = process.env.MODE || 'press'
const BUDGET_MS = Number(process.env.BUDGET_MS || 90000)
// How long to wait after the button says ready before pressing. 0 = press the
// instant it looks ready (what Tom did). A non-zero value tests whether the
// outstanding work simply needed more time — i.e. whether an honest readiness
// signal was available all along.
const PRESS_DELAY_MS = Number(process.env.PRESS_DELAY_MS || 0)

mkdirSync(OUT, { recursive: true })

const PROFILES = {
  none: null,
  // Chrome DevTools' own "Fast 3G" preset.
  fast3g: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  // A realistic mid-range mobile 4G.
  slow4g: { downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8, latency: 80 },
}

const instrument = () => {
  window.__t0 = performance.now()
  window.__audio = { firstPlayCall: null, firstAudible: null, srcs: [] }
  window.__rejections = []
  addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason).slice(0, 200)))

  // The brand welcome chime is not learning audio — it plays on its own during
  // the loading screen, so counting it would flatter the measurement badly.
  const isLesson = (src) => !!src && !/welcome-brand|placeholder|silent/i.test(src)

  const watch = (el) => {
    if (el.__ssiWatched) return
    el.__ssiWatched = true
    el.addEventListener('timeupdate', () => {
      const src = String(el.src || el.currentSrc || '')
      if (el.currentTime <= 0.05) return
      if (window.__audio.firstAudible === null) window.__audio.firstAudible = performance.now()
      if (isLesson(src) && window.__audio.firstLessonAudible === null) {
        window.__audio.firstLessonAudible = performance.now()
        window.__audio.firstLessonSrc = src.slice(0, 140)
      }
    })
  }

  window.__audio.firstLessonAudible = null
  window.__audio.firstLessonSrc = null

  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    const src = String(this.src || this.currentSrc || '(nosrc)')
    if (window.__audio.firstPlayCall === null) window.__audio.firstPlayCall = performance.now()
    if (isLesson(src) && window.__audio.firstLessonPlayCall == null) {
      window.__audio.firstLessonPlayCall = performance.now()
    }
    window.__audio.srcs.push({ t: Math.round(performance.now()), src: src.slice(0, 120) })
    watch(this)
    return origPlay.apply(this, args)
  }
}

// Runs in the page. Returns one sample of every readiness signal we care about.
const sampleFn = () => {
  const visible = (el) => {
    if (!el) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const has = (sel) => visible(document.querySelector(sel))

  // Which elements are mid-animation right now — this is "is it flashing?",
  // measured rather than guessed.
  const animating = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.animationName && cs.animationName !== 'none' && visible(el)) {
      animating.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')}:${cs.animationName}`)
    }
    if (animating.length > 12) break
  }

  // The bottom-nav centre button IS the play button Tom is describing. While
  // the app is loading it carries .is-disabled, which is what runs the
  // `play-pulse` keyframes — the "flashing". When .is-disabled drops, the
  // flashing stops and the button reads as ready.
  const centre = document.querySelector('.center-btn')
  const centreAnim = centre ? getComputedStyle(centre).animationName : null

  return {
    t: Math.round(performance.now() - (window.__t0 || 0)),
    loadingText: has('.loading-text'),
    loadingCopy: (document.querySelector('.loading-text')?.textContent || '').trim().slice(0, 60),
    centreBtn: visible(centre),
    centreDisabled: !!centre?.classList.contains('is-disabled'),
    centrePulsing: !!centreAnim && centreAnim !== 'none' && /play-pulse/.test(centreAnim),
    // "Looks ready" = the centre button is on screen and no longer flashing.
    looksReady: visible(centre) && !centre.classList.contains('is-disabled'),
    // The engine already has an honest "still fetching" surface. Does it show
    // during the press-to-sound gap, or does the learner just get silence?
    bufferingDialog: has('.buffering-prompt, [class*="buffering"]'),
    beltBadge: has('.belt-badge'),
    modeSwitch: has('.mode-switch'),
    beltPill: has('.belt-timer-unified'),
    beltSkip: has('.belt-header-skip'),
    courseName: has('.course-name--tappable'),
    restingState: has('.resting-state'),
    preparing: has('.preparing-text'),
    animating: [...new Set(animating)],
    audio: window.__audio,
    rejections: window.__rejections.slice(0, 5),
  }
}

const firstTrue = (samples, key) => samples.find((s) => s[key])?.t ?? null

// Tap each learner-facing control on the resting screen and report whether it
// actually did anything. "Did anything" is measured as a change in the visible
// text of the page, or an overlay/modal/sheet appearing.
const CONTROLS = [
  ['beltPill', '.belt-timer-unified'],
  ['beltStepBack', '.belt-header-skip--back'],
  ['beltStepForward', '.belt-header-skip--forward'],
  ['courseName', '.course-name--tappable'],
  ['settings', '.pill-btn[title*="etting"], .nav-item[data-id="settings"]'],
]

async function probeControls(page, shotPrefix) {
  const out = {}
  for (const [key, sel] of CONTROLS) {
    const el = page.locator(sel).first()
    if (!(await el.count())) { out[key] = { present: false }; continue }
    const before = await page.evaluate(() => ({
      text: document.body.innerText.slice(0, 4000),
      overlays: document.querySelectorAll('[class*="modal"], [class*="overlay"], [class*="picker"], [class*="sheet"], [class*="selector"]').length,
    }))
    let clicked = true
    try { await el.click({ timeout: 2000, force: true }) } catch { clicked = false }
    await page.waitForTimeout(700)
    const after = await page.evaluate(() => ({
      text: document.body.innerText.slice(0, 4000),
      overlays: document.querySelectorAll('[class*="modal"], [class*="overlay"], [class*="picker"], [class*="sheet"], [class*="selector"]').length,
    }))
    out[key] = {
      present: true,
      clicked,
      disabledAttr: await el.evaluate((n) => n.hasAttribute('disabled') || n.classList.contains('is-disabled')).catch(() => null),
      textChanged: before.text !== after.text,
      overlayOpened: after.overlays > before.overlays,
    }
    await page.screenshot({ path: `${OUT}${shotPrefix}-${key}.png` }).catch(() => {})
    // Put the screen back how we found it.
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(400)
  }
  return out
}

async function runOnce(index, label) {
  const profile = `${OUT}profile-${label}-${index}-${Date.now()}`
  // A throwaway persistent context is the only way to be certain nothing —
  // service worker, HTTP cache, IndexedDB — survives from the previous run.
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_BIN,
    viewport: { width: 390, height: 844 },
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
  })

  const page = await ctx.newPage()
  const requests = []
  const consoleLines = []
  const keyLines = []
  let navAt = Date.now()
  page.on('console', (m) => {
    const line = `${Date.now() - navAt} [${m.type()}] ${m.text().slice(0, 240)}`
    consoleLines.push(line)
    // The app logs its own cold-start budget; keep those whatever else scrolls by.
    if (/\[ColdStart\]|\[ScriptCache\]|\[LearningPlayer\]|\[SimplePlayer\]|\[PlayerConductor\]/.test(m.text())) keyLines.push(line)
  })
  page.on('response', (r) => {
    const url = r.url()
    if (/\/api\/audio\/|\.mp3|amazonaws/i.test(url)) {
      requests.push({ t: Date.now() - navAt, url: url.slice(-40), status: r.status() })
    }
  })

  await page.addInitScript(instrument)

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.clearBrowserCache')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  const prof = PROFILES[THROTTLE]
  if (prof) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof })

  // Prove emptiness rather than assume it.
  const preState = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      const dbs = (await indexedDB.databases?.()) || []
      return { swCount: regs.length, dbs: dbs.map((d) => d.name), localStorageKeys: Object.keys(localStorage).length }
    } catch (e) { return { error: String(e) } }
  }).catch(() => ({ error: 'pre-nav evaluate unavailable' }))

  const wallStart = Date.now()
  navAt = wallStart
  await page.goto(BASE + '/', { waitUntil: 'commit' })

  const emptiness = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => [])
    const dbs = (await indexedDB.databases?.().catch(() => [])) || []
    return { swCount: regs.length, dbs: dbs.map((d) => d.name), localStorageKeys: Object.keys(localStorage).length }
  }).catch(() => ({ error: 'unavailable' }))

  const samples = []
  let tReady = null
  let tPress = null
  let pressed = false
  let controlProbe = null

  while (Date.now() - wallStart < BUDGET_MS) {
    let s
    try { s = await page.evaluate(sampleFn) } catch { await page.waitForTimeout(100); continue }
    samples.push(s)

    // "Looks ready": the centre play button has stopped flashing.
    if (tReady === null && s.looksReady) {
      tReady = s.t
      await page.screenshot({ path: `${OUT}${label}-${index}-a-looks-ready.png` }).catch(() => {})

    }

    // MODE=controls: tap the visible controls DURING the loading window — the
    // belt pill, the belt step chevrons and the course name are all on screen
    // long before readiness, which is what makes the app read as unresponsive.
    // Then tap them again once it looks ready, so the difference is measured.
    if (MODE === 'controls' && !controlProbe && s.beltPill && s.courseName) {
      controlProbe = { duringWindowAt: s.t, during: null, afterReady: null }
      controlProbe.during = await probeControls(page, `${label}-${index}-during`)
    }

    // The press: as soon as it looks ready, tap the player, exactly as Tom did.
    if (MODE === 'press' && tReady !== null && !pressed && s.t >= tReady + PRESS_DELAY_MS) {
      pressed = true
      // The bottom-nav centre button is the thing Tom presses.
      const target = page.locator('.center-btn').first()
      try { await target.click({ timeout: 4000, force: true }) } catch { /* fall through */ }
      tPress = (await page.evaluate(() => Math.round(performance.now() - window.__t0)))
      await page.screenshot({ path: `${OUT}${label}-${index}-b-pressed.png` }).catch(() => {})
    }

    // MODE=beltjump: the control Tom named. At the instant the play button says
    // ready, tap the belt pill and time how long until the belt surface is
    // actually on screen, then jump a belt and time the sound.
    if (MODE === 'beltjump' && tReady !== null && !controlProbe) {
      const jumpT0 = Date.now()
      controlProbe = { readyAt: tReady }
      try { await page.locator('.belt-timer-unified').first().click({ timeout: 3000, force: true }) } catch { /* recorded below */ }
      const modal = page.locator('.progress-modal, [class*="progress-modal"], [class*="modal"]').first()
      try {
        await modal.waitFor({ state: 'visible', timeout: 20000 })
        controlProbe.beltSurfaceVisibleAfterMs = Date.now() - jumpT0
      } catch {
        controlProbe.beltSurfaceVisibleAfterMs = null
      }
      await page.screenshot({ path: `${OUT}${label}-${index}-belt-modal.png` }).catch(() => {})
      controlProbe.beltOptions = await page.locator('[class*="belt"]:visible').count().catch(() => null)
      break
    }

    if (MODE === 'controls' && tReady !== null && controlProbe && !controlProbe.afterReady) {
      controlProbe.readyAt = tReady
      controlProbe.afterReady = await probeControls(page, `${label}-${index}-after`)
      break
    }

    // Done when lesson audio is genuinely audible and every control has surfaced.
    if (MODE === 'press' && s.audio?.firstLessonAudible && s.beltBadge && s.modeSwitch) break

    await page.waitForTimeout(100)
  }

  const last = samples[samples.length - 1] || {}
  const t0abs = await page.evaluate(() => window.__t0).catch(() => 0)
  const audio = last.audio || {}

  await page.screenshot({ path: `${OUT}${label}-${index}-c-final.png` }).catch(() => {})

  const buildSha = await page.evaluate(() => {
    const el = document.querySelector('[data-build], .env-label')
    return {
      env: el?.textContent?.trim() || null,
      meta: document.querySelector('meta[name="build"]')?.content || null,
      globals: window.__BUILD_SHA__ || window.__COMMIT__ || null,
    }
  }).catch(() => null)

  const result = {
    label, index, base: BASE, throttle: THROTTLE, mode: MODE,
    emptinessBeforeNav: preState,
    emptinessAtCommit: emptiness,
    buildSha,
    t_ready_ms: tReady,
    t_beltBadge_ms: firstTrue(samples, 'beltBadge'),
    t_modeSwitch_ms: firstTrue(samples, 'modeSwitch'),
    t_beltPill_ms: firstTrue(samples, 'beltPill'),
    t_courseName_ms: firstTrue(samples, 'courseName'),
    t_press_ms: tPress,
    t_firstPlayCall_ms: audio.firstPlayCall ? Math.round(audio.firstPlayCall - t0abs) : null,
    t_firstAnyAudible_ms: audio.firstAudible ? Math.round(audio.firstAudible - t0abs) : null,
    t_firstAudible_ms: audio.firstLessonAudible ? Math.round(audio.firstLessonAudible - t0abs) : null,
    firstAudibleSrc: audio.firstLessonSrc || null,
    gap_ready_to_audible_ms: (tReady !== null && audio.firstLessonAudible) ? Math.round(audio.firstLessonAudible - t0abs) - tReady : null,
    gap_press_to_audible_ms: (tPress !== null && audio.firstLessonAudible) ? Math.round(audio.firstLessonAudible - t0abs) - tPress : null,
    gap_ready_to_beltBadge_ms: (tReady !== null && firstTrue(samples, 'beltBadge') !== null) ? firstTrue(samples, 'beltBadge') - tReady : null,
    controlProbe,
    audioSrcs: (audio.srcs || []).slice(0, 8),
    rejections: last.rejections || [],
    animatingAtReady: samples.find((s) => s.t === tReady)?.animating || [],
    audioRequests: requests.length,
    audioRequestsBeforeReady: tReady === null ? null : requests.filter((r) => r.t <= tReady).length,
    audioRequestTimeline: requests.slice(0, 250),
    bufferingShown: samples.some((s) => s.bufferingDialog),
    samples,
    keyLines,
    consoleTail: consoleLines.slice(-60),
  }

  writeFileSync(`${OUT}run-${label}-${index}.json`, JSON.stringify(result, null, 2))
  await ctx.close()
  rmSync(profile, { recursive: true, force: true })
  return result
}

const rows = []
for (let i = 1; i <= RUNS; i++) {
  const label = `${THROTTLE}-${MODE}`
  const r = await runOnce(i, label)
  rows.push(r)
  console.log(JSON.stringify({
    run: i, throttle: THROTTLE, mode: MODE,
    emptiness: r.emptinessAtCommit,
    t_ready_ms: r.t_ready_ms,
    t_press_ms: r.t_press_ms,
    t_firstAudible_ms: r.t_firstAudible_ms,
    gap_ready_to_audible_ms: r.gap_ready_to_audible_ms,
    gap_press_to_audible_ms: r.gap_press_to_audible_ms,
    t_beltBadge_ms: r.t_beltBadge_ms,
    gap_ready_to_beltBadge_ms: r.gap_ready_to_beltBadge_ms,
    controlProbe: r.controlProbe,
  }))
}

const nums = (k) => rows.map((r) => r[k]).filter((v) => typeof v === 'number')
const stat = (k) => {
  const v = nums(k)
  if (!v.length) return null
  return { n: v.length, min: Math.min(...v), max: Math.max(...v), median: v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)] }
}

const summary = {
  base: BASE, throttle: THROTTLE, mode: MODE, runs: RUNS,
  t_ready_ms: stat('t_ready_ms'),
  t_firstAudible_ms: stat('t_firstAudible_ms'),
  gap_ready_to_audible_ms: stat('gap_ready_to_audible_ms'),
  gap_press_to_audible_ms: stat('gap_press_to_audible_ms'),
  t_beltBadge_ms: stat('t_beltBadge_ms'),
  gap_ready_to_beltBadge_ms: stat('gap_ready_to_beltBadge_ms'),
}
writeFileSync(`${OUT}summary-${THROTTLE}-${MODE}.json`, JSON.stringify(summary, null, 2))
console.log('SUMMARY', JSON.stringify(summary, null, 2))
