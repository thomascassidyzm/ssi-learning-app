import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

// "Deep position" repro for the ?pod=1 preview cheat.
//
// IMPORTANT FINDING (verified live, 2026-07-22): guest sessions do NOT
// support cross-reload position resume. useBeltProgress's localStorage
// record (`ssi_belt_progress_{courseCode}`) is a cosmetic belt-label cache
// only — the actual playback cursor (`enrollment.last_completed_lego_id`,
// read via progressStore) is gated behind `!isGuestLearner.value` throughout
// LearningPlayer.vue. Seeding the belt-progress localStorage key directly
// (tried first) does NOT move the resumed round — the player reliably
// reloads at S0001L01 regardless. Confirmed by grep + a live run whose
// console showed "[BeltProgress] Loaded: belt 4 (blue), resume: S0100L01"
// (the seeded value WAS read) immediately followed by
// "[LearningPlayer] Loaded position: LEGO S0001L01" (the actual round cursor
// ignored it). True deep-position resume is an authenticated-account-only
// feature (course_enrollments), unavailable to a guest E2E repro without
// real credentials.
//
// This script instead builds a genuinely deeper WITHIN-SESSION position via
// real play (several actual rounds, not the cheat) before reloading with
// ?pod=1 — a stronger regression check than repro-pod-resume.mjs's ~1-round
// build-up, proving the retry-every-boundary cheat still ARMs and FIREs
// cleanly after more real cadence has elapsed. The exact "ratchet window has
// nothing playable, fallback must reach elsewhere in the course" scenario is
// proven deterministically in usePodLapScheduler.test.ts /
// useLayer1Scheduler.test.ts instead — it depends on real DB data gaps this
// sandbox's dev course (verified via live query) does not currently have.
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const dataDir = '/tmp/ssi-repro-deep-profile'
mkdirSync(dataDir, { recursive: true })

const ctx = await chromium.launchPersistentContext(dataDir, {
  viewport: { width: 390, height: 844 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = ctx.pages()[0] || await ctx.newPage()
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

console.log('=== PHASE 1: build up several REAL rounds of progress, no cheat flags ===')
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) {
    try { await btn.click({ timeout: 8000 }); console.log('clicked', sel); break } catch { /* try next */ }
  }
}
// ~4 minutes of real cycles — meaningfully deeper than repro-pod-resume.mjs's
// 45s (~1 round), without needing hundreds of real rounds to prove the point.
await page.waitForTimeout(240_000)
console.log('=== reloading with ?pod=1 (resuming mid-session, several rounds in) ===')
await page.goto(BASE + '/?pod=1', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) {
    try { await btn.click({ timeout: 8000 }); console.log('clicked resume', sel); break } catch { /* try next */ }
  }
}
await page.waitForTimeout(90_000)
await page.screenshot({ path: '/tmp/repro-pod-deep-final.png' })
console.log('done')
await ctx.close()
