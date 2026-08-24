// EASY POST-VOICE-2 GAP PROBE — Tom's 2026-08-07 ruling, checked in a real
// browser against a real deploy: Easy holds ~1s of silence after voice 2
// before the next cycle starts, and Fast does not.
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//   CHROME_BIN=<chromium> node e2e/easy-post-voice2-gap-probe.mjs
//
// HOW IT MEASURES. The player owns ONE audio element (`new Audio()` in
// SimplePlayer) and every phase assigns its src. So wrapping the Audio
// constructor gives the exact clip timeline a learner hears:
//
//   known.mp3 → [pause clip] → t1.mp3 → t2.mp3 → [linger clip] → known.mp3 …
//
// Both silent phases are `data:audio/wav` URIs, told apart by SIZE: the pause
// clip is a fixed 12s WAV (~128KB of base64), the post-voice2 hold is cut to
// its exact ~1s length (~11KB). So a short data: clip sitting between a target
// voice and the next cycle's prompt IS the gap under test, and the wall-clock
// distance from it to the next real clip is the gap's real length.
//
// Prints PASS/FAIL per assertion plus the measured timeline; exits 1 on fail.
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/easy-gap/'
const PLAY_MS = Number(process.env.PLAY_MS || 70000)
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)

/** Play for a while in `mode` and return the clip timeline. */
async function run(mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

  await page.addInitScript((chosen) => {
    try {
      localStorage.setItem('ssi-last-course', 'spa_for_eng')
      localStorage.setItem('ssi-learning-mode', chosen)
    } catch { /* storage blocked — the on-screen toggle click still covers it */ }
    // Wrap the Audio constructor: record every src assignment and every
    // 'ended', with timestamps, on whatever element the player builds.
    const marks = []
    window.__clipMarks = marks
    const NativeAudio = window.Audio
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
    window.Audio = function WrappedAudio(...args) {
      const el = new NativeAudio(...args)
      Object.defineProperty(el, 'src', {
        configurable: true,
        get() { return desc.get.call(this) },
        set(v) {
          marks.push({ t: performance.now(), kind: 'src', src: String(v).slice(0, 60), len: String(v).length })
          desc.set.call(this, v)
        },
      })
      el.addEventListener('ended', () => {
        marks.push({ t: performance.now(), kind: 'ended', src: String(el.currentSrc || '').slice(0, 60) })
      })
      return el
    }
    window.Audio.prototype = NativeAudio.prototype
  }, mode)

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(3000)

  // Make the mode explicit on screen too, so we're testing what a learner sees
  // selected — not just what localStorage said.
  const btn = page.locator('.mode-switch-btn', { hasText: new RegExp(`^${mode}$`, 'i') }).first()
  if (await btn.count()) await btn.click({ timeout: 5000 }).catch(() => {})
  const pressed = await btn.getAttribute('aria-pressed').catch(() => null)
  await page.screenshot({ path: `${OUT}${mode}-1-resting.png` })

  // The transport's centre button is the play affordance (BottomNav .center-btn).
  const play = page.locator('.center-btn').first()
  await play.click({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(PLAY_MS)
  await page.screenshot({ path: `${OUT}${mode}-2-playing.png` })

  const marks = await page.evaluate(() => window.__clipMarks || [])
  await ctx.close()
  return { mode, marks, errors, pressed }
}

/**
 * Reduce the raw marks to the gaps that matter: for every SHORT data: clip
 * (the post-voice2 hold), how long until the next real clip starts. Plus the
 * voice2-ended → next-real-src distance, which is the gap as heard.
 */
function analyse(marks) {
  const isData = (m) => m.src.startsWith('data:audio')
  const isShortData = (m) => isData(m) && m.len < 40000     // ~1-2s of silence
  const isPauseClip = (m) => isData(m) && m.len >= 40000    // the fixed 12s clip
  const isReal = (m) => m.kind === 'src' && !isData(m)

  const srcs = marks.filter((m) => m.kind === 'src')
  const holds = []
  for (let i = 0; i < srcs.length; i++) {
    if (!isShortData(srcs[i])) continue
    const next = srcs.slice(i + 1).find((m) => isReal(m))
    if (next) holds.push(Math.round(next.t - srcs[i].t))
  }

  // Silence between the LAST real clip of a cycle and the first of the next,
  // as heard: 'ended' of a real clip → next real src, only where nothing but a
  // short hold sat in between (excludes the pause phase, which is a long clip).
  const heard = []
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    if (m.kind !== 'ended' || m.src.startsWith('data:')) continue
    const rest = marks.slice(i + 1)
    const nextReal = rest.find((x) => x.kind === 'src' && !x.src.startsWith('data:audio'))
    if (!nextReal) continue
    const between = rest.slice(0, rest.indexOf(nextReal)).filter((x) => x.kind === 'src')
    if (between.some(isPauseClip)) continue          // that's the speak pause, not our gap
    heard.push({ ms: Math.round(nextReal.t - m.t), viaHold: between.some(isShortData) })
  }

  return {
    realClips: srcs.filter(isReal).length,
    shortDataClips: srcs.filter(isShortData).length,
    pauseClips: srcs.filter(isPauseClip).length,
    holds,
    heard,
  }
}

const easy = await run('easy')
const fast = await run('fast')
await browser.close()

const eA = analyse(easy.marks)
const fA = analyse(fast.marks)
writeFileSync(`${OUT}timeline.json`, JSON.stringify({ easy: { ...easy, analysis: eA }, fast: { ...fast, analysis: fA } }, null, 2))

console.log('\nEASY:', JSON.stringify(eA))
console.log('FAST:', JSON.stringify(fA), '\n')

// The probe is only meaningful if audio actually ran in both modes.
check('easy: the session actually played clips', eA.realClips >= 4, `${eA.realClips} clips`)
check('fast: the session actually played clips', fA.realClips >= 4, `${fA.realClips} clips`)
check('easy: mode shows as selected', easy.pressed === 'true', String(easy.pressed))
check('fast: mode shows as selected', fast.pressed === 'true', String(fast.pressed))

// Two kinds of hold exist and must not be conflated. The INTRO linger
// (cycle.lingerMs = 2000) predates this change and fires in BOTH modes — it
// now rides the same silent-clip path, which is why it shows up here at all.
// The MODE gap is the ~1s one, and it is Easy-only.
const introHolds = (a) => a.holds.filter((h) => h >= 1700)
const modeGaps = (a) => a.holds.filter((h) => h < 1700)

check('EASY holds a gap after voice 2', modeGaps(eA).length >= 2, JSON.stringify(modeGaps(eA)))
check(
  'EASY: every mode gap measures ~1s (900-1600ms, incl. the next clip fetch)',
  modeGaps(eA).length > 0 && modeGaps(eA).every((h) => h >= 900 && h <= 1600),
  JSON.stringify(modeGaps(eA)),
)
const easyHeard = eA.heard.filter((h) => h.viaHold).map((h) => h.ms)
check(
  'EASY: the silence a learner actually hears between cycles is ~1s or more',
  easyHeard.length > 0 && easyHeard.every((ms) => ms >= 900),
  JSON.stringify(easyHeard),
)

// Fast must be exactly what it was.
check('FAST adds NO mode gap after voice 2', modeGaps(fA).length === 0, JSON.stringify(modeGaps(fA)))
// Drop the FIRST measured transition: at session start the next clip is still
// being fetched cold, so that one number is network time, not pacing (seen at
// 938ms on a cold deploy, 52ms warm). Every later transition is warm.
const fastHeard = fA.heard.filter((h) => !h.viaHold).map((h) => h.ms).slice(1)
check(
  'FAST: next cycle follows voice 2 immediately (<400ms, after the cold first fetch)',
  fastHeard.length > 0 && fastHeard.every((ms) => ms < 400),
  JSON.stringify(fastHeard),
)
check(
  'the pre-existing intro linger (~2s) still fires in BOTH modes',
  introHolds(eA).length > 0 && introHolds(fA).length > 0,
  `easy ${JSON.stringify(introHolds(eA))} / fast ${JSON.stringify(introHolds(fA))}`,
)

check('easy: no page errors', easy.errors.length === 0, easy.errors.join(' | '))
check('fast: no page errors', fast.errors.length === 0, fast.errors.join(' | '))

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} — timeline at ${OUT}timeline.json`)
process.exit(failures === 0 ? 0 : 1)
