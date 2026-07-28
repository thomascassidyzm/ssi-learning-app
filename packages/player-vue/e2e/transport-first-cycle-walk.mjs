// TRANSPORT FIRST-CYCLE WALK — Jonathan's staging desync (2026-07-28).
//
// FOUNDER INVARIANT: the play button must NEVER be visible while a
// prompt/response cycle is playing. The bug: from a cold start, the engine
// could be audibly mid-cycle while the transport showed PLAY, the speak-gap
// bar sat at 0:00 and the voice-2 text never appeared — self-healing at the
// next round boundary. Root cause was an edge-triggered writable isPlaying
// mirror; the fix derives all transport state from the engine (pull).
//
// This walk performs N fresh-profile cold starts (default 5). Each one:
//   1. loads the app as a guest, taps the BottomNav play control
//   2. polls the DOM at 150ms for ~40s of the first cycles, recording:
//      - stop button visible while any <audio>/Audio element is sounding
//      - the speak-gap fill (.phase-segment-fill) reaching a nonzero width
//      - target text appearing (voice-2 phase: .hero-target / lego tiles)
//      - INVARIANT VIOLATIONS: audio sounding while the center button does
//        NOT read stop (excluding return-arrow contexts off the player)
//
// Usage:  node e2e/transport-first-cycle-walk.mjs
//   BASE_URL=…   target deployment (default: dev git-branch alias)
//   RUNS=…       number of cold starts (default 5)
import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const RUNS = Number(process.env.RUNS || 5)
const OUT = process.env.OUT_DIR || '/tmp/transport-walk/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

for (let run = 1; run <= RUNS; run++) {
  console.log(`\n=== COLD START ${run}/${RUNS} ===`)
  const profile = `/tmp/transport-walk-profile-${run}`
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const ctx = await chromium.launchPersistentContext(profile, {
    viewport: { width: 390, height: 844 },
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const page = ctx.pages()[0] || (await ctx.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  // Track "any audio element is actually sounding" from inside the page.
  // SimplePlayer keeps a silent keepalive clip for the pause phase — that
  // still counts as engine-active, which is exactly what the invariant wants.
  await page.addInitScript(() => {
    window.__sounding = new Set()
    const origPlay = HTMLAudioElement.prototype.play
    const origPause = HTMLAudioElement.prototype.pause
    HTMLAudioElement.prototype.play = function (...a) {
      window.__sounding.add(this)
      this.addEventListener('ended', () => window.__sounding.delete(this), { once: true })
      return origPlay.apply(this, a)
    }
    HTMLAudioElement.prototype.pause = function (...a) {
      window.__sounding.delete(this)
      return origPause.apply(this, a)
    }
  })

  await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)

  // Start playback via the real transport control (guest flow).
  let clicked = false
  for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
    const btn = page.locator(sel).first()
    if (await btn.count()) {
      try { await btn.click({ timeout: 8000 }); clicked = true; break } catch { /* next */ }
    }
  }
  check(`[${run}] play control clicked`, clicked)

  // Poll the first ~40s (cold start + welcome + first cycles).
  const obs = {
    sawStopWhileSounding: false,
    sawFillProgress: false,
    sawTargetText: false,
    violations: 0,
    firstViolation: '',
    polls: 0,
  }
  const t0 = Date.now()
  while (Date.now() - t0 < 40_000) {
    const snap = await page.evaluate(() => {
      const btn = document.querySelector('.center-btn')
      const fill = document.querySelector('.phase-segment-fill')
      const heroTarget = document.querySelector('.hero-target')
      const tiles = document.querySelector('.lego-assembly, .lego-block')
      const sounding = window.__sounding
        ? [...window.__sounding].some((a) => !a.paused && !a.ended)
        : false
      return {
        sounding,
        isStop: !!btn?.classList.contains('is-stop'),
        isReturn: !!btn?.classList.contains('is-return'),
        btnExists: !!btn,
        fillWidth: fill ? parseFloat(fill.style.width || '0') : 0,
        targetText: (heroTarget?.textContent || '').trim().length > 0 || !!tiles,
      }
    }).catch(() => null)
    if (snap) {
      obs.polls++
      if (snap.sounding && snap.isStop) obs.sawStopWhileSounding = true
      if (snap.fillWidth > 0) obs.sawFillProgress = true
      if (snap.targetText) obs.sawTargetText = true
      // The invariant: audio sounding but the transport does not read stop.
      // is-return means we're off the player screen (nav overlay) — not a
      // play-button state, excluded.
      if (snap.sounding && snap.btnExists && !snap.isStop && !snap.isReturn) {
        obs.violations++
        if (!obs.firstViolation) obs.firstViolation = `${Date.now() - t0}ms into run`
      }
    }
    await page.waitForTimeout(150)
  }
  await page.screenshot({ path: `${OUT}run-${run}.png` })

  check(`[${run}] stop button shown while audio sounding`, obs.sawStopWhileSounding, `${obs.polls} polls`)
  check(`[${run}] speak-gap progress bar ran`, obs.sawFillProgress)
  check(`[${run}] target text appeared (voice-2)`, obs.sawTargetText)
  check(
    `[${run}] INVARIANT: never play-button while audio sounding`,
    obs.violations === 0,
    obs.violations ? `${obs.violations} violating polls, first at ${obs.firstViolation}` : 'clean',
  )
  const errReal = errors.filter((e) => !/favicon|manifest/.test(e))
  check(`[${run}] zero page errors`, errReal.length === 0, errReal.slice(0, 2).join(' | '))

  await ctx.close()
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
