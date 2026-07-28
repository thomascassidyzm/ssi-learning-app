// Ad-hoc browser probe for pull-consistency tranche 3 (7 mirrors migrated in
// commit range b242bd1b..8de10d18, see docs/player/pull-consistency-map.md).
// Covers what's reachable via the guest flow without admin/service-role auth:
//   M1 welcome -> first-cycle text handoff
//   M2 phase pill (is-active) + voice-2 text through a full round
//   M5 mode-tray toggle (script/pronunciation) roundtrip
//   M8 session timer ticks while audio is audible
// NOT covered here (need course-end reach / long soak): M4 INF-PLAY handoff,
// M9 belt across pod laps — logged as not-verified, not faked.
import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = '/tmp/pull-consistency-probe/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const profile = '/tmp/pull-consistency-profile'
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
const ctx = await chromium.launchPersistentContext(profile, {
  viewport: { width: 390, height: 844 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = ctx.pages()[0] || (await ctx.newPage())
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2000)

// ── M1: welcome text visible pre-play, then first-cycle text takes over ──
const welcomeVisible = await page.locator('text=/welcome|Welcome/i').first().isVisible().catch(() => false)
console.log(`INFO — welcome text visible pre-play: ${welcomeVisible}`)
await page.screenshot({ path: `${OUT}m1-pre-play.png` }).catch(() => {})

let clicked = false
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) {
    try { await btn.click({ timeout: 8000 }); clicked = true; break } catch { /* next */ }
  }
}
check('play control clicked', clicked)
await page.waitForTimeout(3000)
const heroTextAfterStart = await page.locator('.hero-target, .hero-known, .known-text, .prompt-text').first().textContent().catch(() => null)
check('M1: real cycle text appears after start (not stuck on welcome placeholder)', !!heroTextAfterStart && heroTextAfterStart.trim().length > 0, `text="${heroTextAfterStart}"`)
await page.screenshot({ path: `${OUT}m1-post-play.png` }).catch(() => {})

// ── M2: phase pill cycles through all 4 states + gap bar + voice-2 text, across a FULL round ──
const phaseSelectors = {
  prompt: '.phase-segment--prompt',
  pause: '.phase-segment--pause',
  voice1: '.phase-segment--voice1',
  voice2: '.phase-segment--voice2',
}
const seenActive = { prompt: false, pause: false, voice1: false, voice2: false }
let sawGapFill = false
let sawVoice2Text = false
const deadline = Date.now() + 45000
while (Date.now() < deadline && !(seenActive.prompt && seenActive.pause && seenActive.voice1 && seenActive.voice2 && sawGapFill && sawVoice2Text)) {
  for (const [name, sel] of Object.entries(phaseSelectors)) {
    const isActive = await page.locator(sel).evaluate((el) => el.classList.contains('is-active')).catch(() => false)
    if (isActive) seenActive[name] = true
  }
  const gapWidth = await page.locator('.phase-segment-fill').evaluate((el) => parseFloat(el.style.width) || 0).catch(() => 0)
  if (gapWidth > 5) sawGapFill = true
  const targetSnap = await page.evaluate(() => {
    const heroTarget = document.querySelector('.hero-target')
    const tiles = document.querySelector('.lego-assembly, .lego-block')
    return (heroTarget?.textContent || '').trim().length > 0 || !!tiles
  }).catch(() => false)
  if (targetSnap) sawVoice2Text = true
  await page.waitForTimeout(150)
}
check('M2: phase pill hit PROMPT is-active', seenActive.prompt)
check('M2: phase pill hit PAUSE/SPEAK is-active', seenActive.pause)
check('M2: phase pill hit VOICE_1 is-active', seenActive.voice1)
check('M2: phase pill hit VOICE_2 is-active', seenActive.voice2)
check('M2: speak-gap fill bar ran (>5%)', sawGapFill)
check('M2: voice-2 target text appeared', sawVoice2Text)
await page.screenshot({ path: `${OUT}m2-full-round.png` }).catch(() => {})

// ── M8: session timer (.belt-timer-label) ticks while audio plays ──
const timerText1 = await page.locator('.belt-timer-label').first().textContent().catch(() => null)
await page.waitForTimeout(4000)
const timerText2 = await page.locator('.belt-timer-label').first().textContent().catch(() => null)
check('M8: session timer label found', !!timerText1, `t1="${timerText1}"`)
if (timerText1 && timerText2) {
  check('M8: session timer advanced over 4s window', timerText1 !== timerText2, `t1="${timerText1}" t2="${timerText2}"`)
}

// ── M5: mode-tray toggle roundtrip (pronunciation/script guide) ──
const modeTrigger = page.locator('.mode-trigger').first()
const triggerCount = await modeTrigger.count()
check('M5: mode-tray trigger present', triggerCount > 0)
if (triggerCount) {
  await modeTrigger.click().catch(() => {})
  await page.waitForTimeout(400)
  const trayOpen = await page.locator('.mode-tray').isVisible().catch(() => false)
  check('M5: mode tray opens on trigger click', trayOpen)
  if (trayOpen) {
    const scriptItem = page.locator('.tray-item').first()
    const beforeActive = await scriptItem.evaluate((el) => el.classList.contains('active')).catch(() => null)
    await scriptItem.click().catch(() => {})
    await page.waitForTimeout(400)
    const afterActive = await scriptItem.evaluate((el) => el.classList.contains('active')).catch(() => null)
    check('M5: script/pronunciation toggle flips state (BottomNav-driven, no desync)', beforeActive !== afterActive, `before=${beforeActive} after=${afterActive}`)
    // close tray
    await modeTrigger.click().catch(() => {})
    await page.waitForTimeout(300)
  }
}

console.log('\nINFO — NOT verified in this probe (need course-end reach / long soak, out of scope for a guest-flow browser pass): M4 INF-PLAY queue handoff, M9 belt position across pod laps.')

await ctx.close()
console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
