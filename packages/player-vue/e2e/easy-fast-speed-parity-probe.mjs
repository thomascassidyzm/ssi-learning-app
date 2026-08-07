// EASY/FAST SPEED PARITY PROBE — Tom's ruling, 2026-08-07, checked by DRIVING
// THE REAL PLAYER rather than by reading code.
//
//   "Easy should follow the exact speed pattern on-ramps for the target
//    language as Fast — but just with bigger pauses, more repetitions and so on
//    as they currently are."
//
// The bug: Easy cancelled the baked belt ramp and played target audio flat at
// 1.0x, so a WHITE-BELT beginner on EASY heard speech FASTER than the same
// beginner on FAST (0.8x) — backwards from what the names promise.
//
// What this probe measures, in a real Chromium, on a real deploy:
//   1. the actual `playbackRate` on every audio element the player plays,
//      tagged with the clip's role (known vs target voice), in BOTH modes;
//   2. the gap between cycles, to prove Easy's longer pauses SURVIVED the fix;
//   3. the same for a listening exercise, since the ramp reaches those too.
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//     node e2e/easy-fast-speed-parity-probe.mjs
//
// Prints PASS/FAIL per assertion, exits 1 on any fail.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/tmp/easy-fast-speed/'
const COURSE = process.env.COURSE || 'spa_for_eng'
const PLAY_MS = Number(process.env.PLAY_MS || 45000)
const READY_MS = Number(process.env.READY_TIMEOUT_MS || 45000)
// `?pod=1` forces a pod lap immediately. Without it a fresh learner needs ~5
// main rounds before any listening surface fires, so a short run measures no
// listening clips at all and the "listening didn't regress" claim is vacuous.
const PARAMS = process.env.PARAMS || 'pod=1'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// Records the REAL rate the browser was asked to play at, per clip. Patching
// play() (not just reading the element once) is what makes this a measurement
// of behaviour rather than of state we hope is still current.
const RECORDER = () => {
  // ONE ordered event log. The player deliberately reuses a single Audio
  // element (mobile audio unlock), so per-clip listeners mis-attribute — the
  // honest structure is a flat sequence of play/ended events with timestamps.
  window.__events = []
  const proto = HTMLMediaElement.prototype
  const realPlay = proto.play
  proto.play = function patchedPlay(...args) {
    try {
      if (!this.__ssiProbed) {
        this.__ssiProbed = true
        this.addEventListener('ended', () => {
          try { window.__events.push({ k: 'end', t: Math.round(performance.now()) }) } catch { /* ignore */ }
        })
      }
      window.__events.push({
        k: 'play',
        t: Math.round(performance.now()),
        rate: this.playbackRate,
        src: String(this.src || '').slice(-64),
        // Attribute the clip to a LISTENING lap by DOM at play() time:
        // PodTurnDisplay is mounted only while a pod / L1 lap sounds. (Console
        // logs are stripped in deployed builds, so log-correlation measures
        // nothing — learned live, 2026-08-07.)
        lap: !!document.querySelector('.pod-turn-display'),
      })
    } catch { /* never break playback to measure it */ }
    return realPlay.apply(this, args)
  }
}

async function runMode(mode) {
  const browser = await chromium.launch(
    process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
  )
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.addInitScript(RECORDER)
  await page.addInitScript(([course, m]) => {
    try {
      localStorage.setItem('ssi-last-course', course)
      localStorage.setItem('ssi-learning-mode', m)
    } catch { /* ignore */ }
  }, [COURSE, mode])

  const url = PARAMS ? `${BASE}${BASE.includes('?') ? '&' : '?'}${PARAMS.split(',').join('&')}` : BASE
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {})
  await page.locator('.mode-switch').first()
    .waitFor({ state: 'visible', timeout: READY_MS })
    .catch(() => {})

  // Confirm the mode really is the one we asked for before measuring it.
  const selected = await page.locator(`.mode-switch-btn:has-text("${mode === 'easy' ? 'Easy' : 'Fast'}")`)
    .first().getAttribute('aria-pressed').catch(() => null)

  // Start play. The first tap must be a real user gesture (mobile audio unlock).
  // `.center-btn` is the big transport play button on the resting screen; it
  // carries `is-disabled` until the player is ready, so wait it out rather than
  // clicking into a dead control.
  const play = page.locator('.center-btn').first()
  await play.waitFor({ state: 'visible', timeout: READY_MS }).catch(() => {})
  for (let i = 0; i < 30; i++) {
    const cls = (await play.getAttribute('class').catch(() => '')) || ''
    if (!cls.includes('is-disabled')) break
    await page.waitForTimeout(1000)
  }
  await play.click({ timeout: 5000 }).catch(() => {})

  await page.waitForTimeout(PLAY_MS)
  await page.screenshot({ path: `${OUT}${mode}-playing.png` })

  const events = await page.evaluate(() => window.__events || [])
  const belt = await page.evaluate(() => {
    const el = document.querySelector('.belt-badge, [class*="belt"]')
    return el ? el.textContent.trim().slice(0, 40) : null
  })
  await browser.close()
  return { events, belt, selected, errors }
}

const summarise = (events) => {
  const plays = events.filter((e) => e.k === 'play')
  const rates = plays.map((p) => p.rate)
  const uniq = [...new Set(rates)].sort((a, b) => a - b)

  // THE PAUSE, measured where it actually lives. A cycle runs
  // prompt(known, 1.0×) → PAUSE → voice1(target, ramped) → voice2(target), so
  // the pause is: the prompt clip ENDS, then voice1 STARTS. Measuring from the
  // prompt's `ended` event rather than its start keeps the clip's own length
  // out of the number — that is what made a raw inter-clip gap too noisy to
  // assert on.
  const pauses = []
  for (let i = 0; i < events.length - 2; i++) {
    const a = events[i], b = events[i + 1], c = events[i + 2]
    // Listening laps have no learner pause by design (clips run back to back),
    // so a lap clip is not a sample of the thing being measured.
    if (a.lap || c.lap) continue
    if (a.k === 'play' && a.rate === 1 && b.k === 'end' && c.k === 'play' && c.rate < 1) {
      pauses.push(c.t - b.t)
    }
  }
  pauses.sort((x, y) => x - y)

  const lapRates = [...new Set(plays.filter((p) => p.lap).map((p) => p.rate))].sort((a, b) => a - b)
  return {
    clips: plays.length,
    lapClips: plays.filter((p) => p.lap).length,
    lapRates,
    uniqueRates: uniq,
    slowest: uniq[0],
    targetPlays: rates.filter((r) => r !== 1).length,
    pauseSamples: pauses.length,
    medianPause: pauses.length ? pauses[Math.floor(pauses.length / 2)] : 0,
    pauses,
  }
}

console.log(`BASE_URL = ${BASE}`)
console.log(`course   = ${COURSE} (fresh learner ⇒ White belt ⇒ ramp says 0.8×)\n`)

const fast = await runMode('fast')
const easy = await runMode('easy')
const F = summarise(fast.events)
const E = summarise(easy.events)

console.log('FAST:', JSON.stringify(F), 'belt:', fast.belt, 'selected:', fast.selected)
console.log('EASY:', JSON.stringify(E), 'belt:', easy.belt, 'selected:', easy.selected)
console.log('')

check('the player actually played in Fast', F.clips > 0, `${F.clips} clips`)
check('the player actually played in Easy', E.clips > 0, `${E.clips} clips`)

// THE assertions. The exact number is the course's own: white belt = 0.8 × the
// course global_speed (fra_for_eng ⇒ 0.9 × 0.8 = 0.72), so assert the SHAPE —
// a ramp is present, and the two modes agree on it — not a magic number.
// Before the fix, Easy's slowest was flat 1.0× while Fast's was ramped.
check(
  'Fast plays the target voice below 1.0× at White belt (the ramp is on)',
  F.slowest !== undefined && F.slowest < 1,
  JSON.stringify(F.uniqueRates),
)
check(
  'Easy plays the target voice at the SAME ramp — not flat 1.0×',
  E.slowest !== undefined && E.slowest < 1,
  JSON.stringify(E.uniqueRates),
)
check(
  'Easy and Fast use the IDENTICAL set of playback rates',
  JSON.stringify(E.uniqueRates) === JSON.stringify(F.uniqueRates),
  `easy ${JSON.stringify(E.uniqueRates)} vs fast ${JSON.stringify(F.uniqueRates)}`,
)
check(
  'Easy is never FASTER than Fast at White belt',
  E.slowest <= F.slowest,
  `easy slowest ${E.slowest} vs fast slowest ${F.slowest}`,
)

// The guardrail: the fix must not have flattened Easy into Fast.
check(
  'Easy still holds its longer pause between prompt and target voice',
  E.medianPause > F.medianPause,
  `easy ${E.medianPause}ms (n=${E.pauseSamples}) vs fast ${F.medianPause}ms (n=${F.pauseSamples})`,
)

// LISTENING / PODS — the ramp reaches those too, so prove they didn't regress.
// (Easy holds listening at the White rung per T-13; at White that IS the Fast
// value, so at this belt the two must match exactly.)
check(
  'a listening lap actually ran in both modes',
  F.lapClips > 0 && E.lapClips > 0,
  `fast ${F.lapClips} lap clips, easy ${E.lapClips}`,
)
check(
  'listening/pod clips are belt-ramped, not flat 1.0×',
  F.lapRates.some((r) => r < 1) && E.lapRates.some((r) => r < 1),
  `fast ${JSON.stringify(F.lapRates)} vs easy ${JSON.stringify(E.lapRates)}`,
)
check(
  'listening rates agree between the modes at White belt',
  JSON.stringify(F.lapRates) === JSON.stringify(E.lapRates),
  `fast ${JSON.stringify(F.lapRates)} vs easy ${JSON.stringify(E.lapRates)}`,
)

check('no uncaught page errors in Fast', fast.errors.length === 0, fast.errors.join(' | '))
check('no uncaught page errors in Easy', easy.errors.length === 0, easy.errors.join(' | '))

console.log(`\nScreenshots in ${OUT}`)
process.exit(failures > 0 ? 1 : 0)
