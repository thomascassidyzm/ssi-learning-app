// PER-VOICE PACE PROBE (plate S-345) — checked by DRIVING THE REAL PLAYER on a
// real deploy, not by reading code.
//
//   "the player reads the pace of the voice that rendered the clip"
//
// THE DISCRIMINATOR. The retired belt ramp gave a session ONE target rate: every
// target clip, both voices, played at the belt's number. Per-voice pace divides
// the target number by the MEASURED pace of the voice that actually rendered
// that clip — so a course whose two target voices differ in pace now plays them
// at DIFFERENT rates inside one session. That is a shape the old code could not
// produce, whatever the belt.
//
// spa_for_eng, measured live on `public.course_voice_pace()` 2026-09-08:
//     target1  azure_es-ES-ElviraNeural  effectivePaceRatio 0.985  (measured)
//     target2  azure_es-ES-AlvaroNeural  effectivePaceRatio 1.000  (measured)
//     known    xai_eve                   UNMEASURED -> uncorrected
// so Easy must show {0.81, 0.80} on target clips (0.8/0.985, 0.8/1.0) and 1.0
// on known clips; Fast must show {0.91, 0.90}.
//
//   BASE_URL=https://staging.saysomethingin.app node e2e/per-voice-pace-probe.mjs
//
// Prints PASS/FAIL per assertion, exits 1 on any fail.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT_DIR || `${process.env.CS_SCRATCH || '/tmp'}/per-voice-pace/`
const COURSE = process.env.COURSE || 'spa_for_eng'
const PLAY_MS = Number(process.env.PLAY_MS || 60000)
const READY_MS = Number(process.env.READY_TIMEOUT_MS || 45000)
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// Patch play() rather than read the element once: the player deliberately reuses
// a single Audio element, so only an ordered event log is honest.
const RECORDER = () => {
  window.__events = []
  window.__console = []
  const proto = HTMLMediaElement.prototype
  const realPlay = proto.play
  proto.play = function patchedPlay(...args) {
    try {
      window.__events.push({
        k: 'play',
        t: Math.round(performance.now()),
        rate: this.playbackRate,
        src: String(this.src || '').slice(-48),
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

  await page.addInitScript(RECORDER)
  await page.addInitScript(([course, m]) => {
    try {
      localStorage.setItem('ssi-last-course', course)
      localStorage.setItem('ssi-learning-mode', m)
    } catch { /* ignore */ }
  }, [COURSE, mode])

  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
  await page.locator('.mode-switch').first().waitFor({ state: 'visible', timeout: READY_MS }).catch(() => {})

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
  await browser.close()
  return { events, errors }
}

const rates = (events) => [...new Set(events.filter((e) => e.k === 'play').map((e) => e.rate))]
  .sort((a, b) => a - b)

const run = async (mode, expectedTargets) => {
  const { events, errors } = await runMode(mode)
  const plays = events.filter((e) => e.k === 'play')
  const uniq = rates(events)
  const targets = uniq.filter((r) => r < 1)
  console.log(`\n${mode.toUpperCase()}: ${plays.length} clips, rates ${JSON.stringify(uniq)}`)

  check(`${mode}: a real session played`, plays.length >= 6, `${plays.length} clips`)
  check(`${mode}: known clips play uncorrected at 1.0×`, uniq.includes(1),
    JSON.stringify(uniq))
  check(`${mode}: TWO distinct target rates — the two voices are paced separately`,
    targets.length === 2, JSON.stringify(targets))
  check(`${mode}: the rates are the ones the measured voices imply`,
    JSON.stringify(targets) === JSON.stringify(expectedTargets),
    `saw ${JSON.stringify(targets)}, expected ${JSON.stringify(expectedTargets)}`)
  check(`${mode}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
  return { plays: plays.length, uniq }
}

console.log(`BASE_URL = ${BASE}\ncourse   = ${COURSE}`)
await run('easy', [0.8, 0.81])
await run('fast', [0.9, 0.91])

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
