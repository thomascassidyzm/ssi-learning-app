// AUDIO-REF STAMP PROBE (returning learner) — proves that on the RETURNING-
// LEARNER path, revised German clips reach the player as versioned refs
// (<uuid>.vN) and that the stamping is done CLIENT-SIDE by the fix, not by the
// server /cycles route that was already stamping before it.
//
// Context: docs/audio-ref-bypass-audit-2026-08-06.md; fix 51fca851 / a89f982a /
// 126cdec9 (providers/revisedAudioRefs.ts + generateLearningScript.ts).
//
// WHY A SECOND PROBE. audio-ref-stamp-probe.mjs shows stamped refs post-reload,
// but stamped refs alone do NOT prove the fix: /api/courses/:code/cycles has
// always stamped. The discriminator is WHERE the stamp came from. This probe
// watches three signals at once after the reload:
//
//   1. the fix's own network fingerprint — the client-side Supabase query
//      course_audio?select=id,audio_revision&audio_revision=gt.1 , which only
//      revisedAudioRefs.fetchRevisedAudioRefs() issues;
//   2. whether /cycles or /infplay-cycles were fetched at all (if not, no
//      server route could have stamped anything in this session);
//   3. the actual /api/audio/<ref> requests, counted stamped vs bare.
//
// Fingerprint present + /cycles absent + stamped refs present == the client-side
// walk stamped them. That is the fix, observed live.
//
// Usage:
//   BASE_URL=https://staging.saysomethingin.app node e2e/audio-ref-stamp-returning-probe.mjs

import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const PLAY_SELECTORS = [
  'button:has-text("Ready when you are")',
  '.play-button',
  'button[aria-label*="lay"]',
  '.player-start',
  'text=Ready when you are',
]

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

let phase = 'first-visit'
const seen = { 'first-visit': newBucket(), returning: newBucket() }
function newBucket() {
  return { audio: [], revisionQueries: [], cyclesFetches: [], console: [], errors: [] }
}

page.on('pageerror', (e) => seen[phase].errors.push(String(e).slice(0, 150)))
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('[InstantPlayback]')) seen[phase].console.push(t.slice(0, 200))
})
page.on('request', (req) => {
  const url = req.url()
  const b = seen[phase]
  const audio = url.match(/\/api\/audio\/([0-9a-f-]+(?:\.v\d+)?)/i)
  if (audio) b.audio.push(audio[1])
  // The fix's fingerprint: only fetchRevisedAudioRefs issues this shape.
  if (/course_audio/.test(url) && /audio_revision/.test(url)) b.revisionQueries.push(url)
  if (/\/api\/courses\/[^/]+\/(infplay-)?cycles/.test(url)) b.cyclesFetches.push(url.split('?')[0])
})

async function startPlayback() {
  for (const sel of PLAY_SELECTORS) {
    const el = page.locator(sel).first()
    if (await el.count()) {
      await el.click({ timeout: 3000 }).catch(() => {})
      return
    }
  }
}

console.log(`BASE = ${BASE}`)

// ---- FIRST VISIT: pick German, play, populate the script cache -------------
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(4000)

if (await page.locator('.course-name--tappable').count()) {
  const name = (await page.locator('.course-name--tappable').first().innerText()).trim()
  if (!name.toLowerCase().includes('german')) {
    await page.locator('.course-name--tappable').first().click()
    await page.waitForSelector('.course-row', { timeout: 15000 })
    const row = page.locator('.course-row:has-text("German")').first()
    if (await row.count()) {
      const hasVariants = await row.evaluate((el) => el.classList.contains('has-variants'))
      if (hasVariants) {
        await row.click()
        await page.waitForSelector('.course-row.variant', { timeout: 5000 })
        await page.locator('.course-row.variant:has-text("English")').first().click()
      } else {
        await row.click()
      }
    }
  }
}
await page.waitForSelector('.belt-badge', { timeout: 60000, state: 'visible' }).catch(() => {})
const course = ((await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || '').trim()
console.log(`course: "${course}"`)

await startPlayback()
await page.waitForTimeout(90000)

// The walk runs on the FIRST visit — that is where the fix stamps, and where
// its fingerprint query fires. The returning visit reads the already-stamped
// script cache, so it is expected NOT to re-query.
const f = seen['first-visit']
const fStamped = f.audio.filter((ref) => /\.v\d+$/.test(ref))
console.log('\n--- FIRST VISIT ---')
console.log(`audio requests: ${f.audio.length}  (stamped .vN: ${fStamped.length})`)
console.log(`revision-map queries (the fix's fingerprint): ${f.revisionQueries.length}`)
f.revisionQueries.slice(0, 3).forEach((u) => console.log('  ' + decodeURIComponent(u)))
console.log(`/cycles fetches: ${f.cyclesFetches.length}`)
f.cyclesFetches.slice(0, 5).forEach((u) => console.log('  ' + u))

// ---- RETURNING LEARNER: reload, so the cache fast path serves the session --
phase = 'returning'
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(4000)
await startPlayback()
await page.waitForTimeout(60000)

const r = seen.returning
const stamped = r.audio.filter((ref) => /\.v\d+$/.test(ref))
const bare = r.audio.filter((ref) => !/\.v\d+$/.test(ref))
const fastPath = r.console.some((l) => l.includes('Cache fast-path'))
const bootstrap = r.console.some((l) => l.includes('Bootstrap ready'))

console.log('\n--- RETURNING VISIT ---')
console.log(`[InstantPlayback] lines: ${r.console.length}`)
r.console.forEach((l) => console.log('  ' + l))
console.log(`cache fast-path logged: ${fastPath}`)
console.log(`bootstrap logged:       ${bootstrap}`)
console.log(`\nrevision-map queries (the fix's fingerprint): ${r.revisionQueries.length}`)
r.revisionQueries.slice(0, 3).forEach((u) => console.log('  ' + decodeURIComponent(u)))
console.log(`\n/cycles or /infplay-cycles fetches: ${r.cyclesFetches.length}`)
r.cyclesFetches.slice(0, 5).forEach((u) => console.log('  ' + u))
console.log(`\naudio requests: ${r.audio.length}  (stamped .vN: ${stamped.length}, bare: ${bare.length})`)
r.audio.forEach((ref) => console.log(`  ${ref}`))
console.log(`\nJS errors: ${JSON.stringify(r.errors)}`)

// THE CLAIM, and how these signals prove it.
//
// The fix stamps AT THE WALK, on the first visit; its output is what the script
// cache stores. The returning visit hydrates from that cache and therefore does
// NOT re-query the revision map — so the fingerprint is expected on the first
// visit only. What makes it conclusive is the returning visit fetching ZERO
// /cycles: no server route was available to stamp anything, yet stamped refs
// still reached the player, so they can only have come from the cached walk.
//
// Note: production builds mark console.log as pure (vite.config.ts, esbuild
// `pure`), so the [InstantPlayback] fast-path line is NOT observable live.
// It is reported for information only and is not part of the verdict.
const walkStamped = f.revisionQueries.length > 0
const returningServedStamped = stamped.length > 0 && r.cyclesFetches.length === 0
const ok = walkStamped && returningServedStamped && r.errors.length === 0

console.log('\n' + JSON.stringify({
  ok,
  walkFetchedRevisionMap: walkStamped,
  returningPathServedStampedWithoutCycles: returningServedStamped,
  firstVisitRevisionMapQueries: f.revisionQueries.length,
  returningRevisionMapQueries: r.revisionQueries.length,
  cyclesFetches: r.cyclesFetches.length,
  audioRequests: r.audio.length,
  stampedRefs: stamped.length,
  bareRefs: bare.length,
  cacheFastPathLogged: fastPath,
  bootstrapLogged: bootstrap,
  jsErrors: r.errors.length,
  sampleStamped: stamped.slice(0, 6),
}))

await browser.close()
process.exit(ok ? 0 : 1)
