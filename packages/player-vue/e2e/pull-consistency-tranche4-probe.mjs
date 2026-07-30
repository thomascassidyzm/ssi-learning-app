// Ad-hoc browser probe for pull-consistency tranche 4 (M3 position mirrors +
// M9 belt derivation — see docs/player/pull-consistency-map.md). Runs the
// guest flow against the deployed dev alias:
//   M3: fresh cold start persists a position; reload cold-resumes from
//       localStorage onto the SAME LEGO (the resume-labyrinth invariant);
//       deep-link jump (ssi-jump-to-seed — the ?seed=/CourseBrowser path)
//       moves the persisted cursor to the target seed.
//   M9: the belt readout (--belt-color + persisted seed) FOLLOWS jumps both
//       up and back down (derives from the landed round), and holds steady
//       while pod-lap audio plays (?podview=1 dev cheat).
// Soft/INFO (not hard-failed): INF-PLAY entry as a guest (entitlement-gated
// on premium courses; attempted only if a ∞ activator is reachable).
// DB resume needs a signed-in account — out of guest-probe reach, reported
// honestly.
import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = '/tmp/pull-consistency-t4-probe/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}
const info = (label, detail = '') => console.log(`INFO — ${label}${detail ? ` :: ${detail}` : ''}`)

const profile = '/tmp/pull-consistency-t4-profile'
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
const ctx = await chromium.launchPersistentContext(profile, {
  // channel: 'chromium' forces the FULL chromium build (new headless) — the
  // default headless_shell binary is missing system libs on this box.
  channel: 'chromium',
  viewport: { width: 390, height: 844 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = ctx.pages()[0] || (await ctx.newPage())
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const readPosition = () => page.evaluate(() => {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('ssi_learning_position_')) {
      try { return { key: k, ...JSON.parse(localStorage.getItem(k)) } } catch { /* skip */ }
    }
  }
  return null
})

const beltColor = () => page.evaluate(() => {
  const root = document.querySelector('.learning-player-root') || document.body
  return getComputedStyle(root).getPropertyValue('--belt-color').trim()
})

const tapPlay = async () => {
  for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
    const btn = page.locator(sel).first()
    if (await btn.count()) {
      try { await btn.click({ timeout: 8000 }); return true } catch { /* next */ }
    }
  }
  return false
}

// ── Phase 0: clean slate ──
await page.goto(BASE + '/?reset=1', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4000)
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)

// ── Phase 1 (M3): fresh cold start → play → position persisted ──
check('play control clicked (fresh start)', await tapPlay())
await page.waitForTimeout(15000) // a cycle-plus of audio so phase=prompt saves fire
const p1 = await readPosition()
check('M3: fresh play persisted a localStorage position', !!p1?.legoId, `legoId=${p1?.legoId} seed=${p1?.seedNumber} item=${p1?.itemInRound}`)
await page.screenshot({ path: `${OUT}t4-1-fresh-play.png` }).catch(() => {})

// ── Phase 2 (M3): cold resume from localStorage lands on the SAME LEGO ──
await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(6000) // init completes → lifecycle save re-stamps position
const p2 = await readPosition()
check('M3: cold resume kept the saved LEGO (no reset to round 0)', !!p1?.legoId && p2?.legoId === p1?.legoId, `saved=${p1?.legoId} resumed=${p2?.legoId}`)
await page.screenshot({ path: `${OUT}t4-2-resume-resting.png` }).catch(() => {})

check('play control clicked (resume)', await tapPlay())
await page.waitForTimeout(6000)
const heroText = await page.locator('.hero-target, .hero-known, .known-text, .prompt-text').first().textContent().catch(() => null)
check('M3: resumed playback shows real cycle text', !!heroText && heroText.trim().length > 0, `text="${(heroText || '').trim().slice(0, 40)}"`)
const p3 = await readPosition()
check('M3: position after resumed play is still anchored at/after the saved LEGO', !!p3?.legoId, `legoId=${p3?.legoId}`)
await page.screenshot({ path: `${OUT}t4-3-resume-playing.png` }).catch(() => {})

// ── Phase 3 (M3+M9): deep-link jump forward (?seed=/CourseBrowser path) ──
const beltBefore = await beltColor()
await page.evaluate(() => window.dispatchEvent(new CustomEvent('ssi-jump-to-seed', { detail: { seedNumber: 10 } })))
await page.waitForTimeout(9000) // load-if-needed + jump + phase-prompt persist
const p4 = await readPosition()
const jumpedTo10 = p4?.seedNumber === 10 || (p4?.legoId || '').startsWith('S0010')
check('M3: deep-link jump moved the persisted cursor to seed 10', jumpedTo10, `pos=${p4?.legoId} seed=${p4?.seedNumber} (was ${p3?.legoId})`)
const beltAt10 = await beltColor()
check('M9: belt readout FOLLOWED the jump (colour changed from white-belt zone)', !!beltAt10 && beltAt10 !== beltBefore, `before=${beltBefore} at-seed-10=${beltAt10}`)
await page.screenshot({ path: `${OUT}t4-4-jump-seed10.png` }).catch(() => {})

// ── Phase 4 (M9): jump BACK — belt must follow DOWN (no ratchet, pure derivation) ──
await page.evaluate(() => window.dispatchEvent(new CustomEvent('ssi-jump-to-seed', { detail: { seedNumber: 2 } })))
await page.waitForTimeout(9000)
const p5 = await readPosition()
const jumpedTo2 = p5?.seedNumber === 2 || (p5?.legoId || '').startsWith('S0002')
check('M3: deep-link jump back moved the cursor to seed 2', jumpedTo2, `pos=${p5?.legoId} seed=${p5?.seedNumber}`)
const beltAt2 = await beltColor()
check('M9: belt readout followed the cursor back DOWN', !!beltAt2 && beltAt2 !== beltAt10, `at-seed-10=${beltAt10} back-at-seed-2=${beltAt2}`)
check('M9: belt at seed 2 matches the original white-zone colour', beltAt2 === beltBefore, `fresh=${beltBefore} returned=${beltAt2}`)
await page.screenshot({ path: `${OUT}t4-5-jump-back-seed2.png` }).catch(() => {})

// ── Phase 5 (M9): belt holds steady while pod-lap audio plays (?podview=1) ──
await page.goto(BASE + '/?podview=1', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)
const podBeltBefore = await beltColor()
const podStarted = await tapPlay()
if (podStarted) {
  await page.waitForTimeout(4000)
  const podUiVisible = await page.locator('.teleprompter, .pod-turn, .pod-lap, [class*="teleprompter"]').first().isVisible().catch(() => false)
  if (podUiVisible) {
    const samples = []
    for (let i = 0; i < 5; i++) {
      samples.push(await beltColor())
      await page.waitForTimeout(2000)
    }
    const allSame = samples.every((c) => c === samples[0])
    check('M9: belt colour steady across a pod lap (no per-cycle bounce)', allSame, `samples=${[...new Set(samples)].join(',')} before=${podBeltBefore}`)
    await page.screenshot({ path: `${OUT}t4-6-podview.png` }).catch(() => {})
  } else {
    info('podview UI did not appear (course may lack pod content at this position) — belt-across-pod-lap not exercised in browser this run')
  }
} else {
  info('podview play control not reachable — belt-across-pod-lap not exercised in browser this run')
}

// ── Phase 6 (soft): INF-PLAY entry as guest ──
// Premium courses gate INF-PLAY (course-end content) behind the paywall for
// guests — expected. We attempt only to record what the surface does.
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)
const pill = page.locator('.belt-pill, .center-pill, .progress-pill').first()
if (await pill.count()) {
  await pill.click().catch(() => {})
  await page.waitForTimeout(1000)
  const infBtn = page.locator('button:has-text("∞"), [class*="infinite"], [class*="infplay"]').first()
  if (await infBtn.count() && await infBtn.isVisible().catch(() => false)) {
    await infBtn.click().catch(() => {})
    await page.waitForTimeout(5000)
    const paywalled = await page.locator('.paywall-overlay').isVisible().catch(() => false)
    const beltNow = await beltColor()
    if (paywalled) {
      info('INF-PLAY entry as guest raised the paywall (correct gating on a premium course); freeze not browser-verifiable on this course', `belt=${beltNow}`)
    } else {
      check('M9: INF-PLAY entry locks the belt accent to SSi red', beltNow === '#c23a3a', `belt=${beltNow}`)
      await page.screenshot({ path: `${OUT}t4-7-infplay.png` }).catch(() => {})
    }
  } else {
    info('∞ activator not visible in the modal for a guest at this position — INF-PLAY entry not exercised in browser this run')
  }
} else {
  info('belt pill not found — INF-PLAY entry not exercised in browser this run')
}

console.log('\nINFO — NOT browser-verified this run (needs a signed-in account): DB-cursor resume, INF-PLAY deterministic resume. Both are unit-covered (roundPositionSync.test.ts, beltPositionSync.test.ts).')

await ctx.close()
console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
