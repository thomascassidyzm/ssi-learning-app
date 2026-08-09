// AUDIO-REF STAMP PROBE — verifies the returning-learner cache fast path
// serves REVISED German audio as versioned refs (<uuid>.vN), not bare uuids.
//
// Context: docs/audio-ref-bypass-audit-2026-08-06.md. Fix on dev
// (51fca851 / a89f982a / 126cdec9): generateLearningScript now stamps
// revised-clip ids via providers/revisedAudioRefs.ts before they land in the
// script cache. The bug this guards against: a returning learner's
// LearningPlayer "CACHE FAST PATH" hydrates SimplePlayer straight from the
// localStorage script cache, bypassing /cycles (the only route that stamped
// refs before this fix) entirely — so pre-repair bytes played forever.
//
// deu_for_eng has 1096 revised clips (audio_revision=2) starting as early as
// seed 5 lego 1 (confirmed live via Supabase, 2026-08-06) — a guest playing a
// handful of early rounds is expected to touch several.
//
// Usage:
//   BASE_URL=https://staging.saysomethingin.app node e2e/audio-ref-stamp-probe.mjs
//
// Prints one JSON line: { ok, bareRevisedHits, stampedHits, sampleUrls, ... }

import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'

// Revised (audio_revision > 1) course_audio ids for deu_for_eng, pulled live
// via service-role query 2026-08-06 — includes early seeds 5-18 so a short
// guest session should hit several. Bare id below means "this id IS revised;
// any /api/audio/<id> request for it must carry a .vN suffix."
const REVISED_IDS = new Set([
  'b037722e-60cb-4961-bfbe-6aac67ced699',
  '412dfe24-32ca-44a1-aa58-6921e74301b5',
  '0efd0360-3864-48ba-9681-52015d891e68',
  '4babe427-b035-4ac4-9aa8-4b834da6dadb',
  'e89b56a9-b001-4559-ba93-98bd3e725205',
])

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const consoleLines = []
page.on('console', (msg) => {
  const t = msg.text()
  if (t.includes('[InstantPlayback]')) consoleLines.push(t.slice(0, 250))
})

const audioRequests = []
page.on('request', (req) => {
  const url = req.url()
  const m = url.match(/\/api\/audio\/([0-9a-f-]+(?:\.v\d+)?)/i)
  if (m) audioRequests.push({ url, ref: m[1] })
})

console.log(`BASE = ${BASE}`)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(4000)

// Pick the German course as a guest, if not already on it.
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
const courseNow = (await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || ''
console.log(`course after selection: "${courseNow.trim()}"`)

// Start playback and let several rounds run so the script cache populates
// past the early-seed revised clips.
for (const sel of ['button:has-text("Ready when you are")', '.play-button', 'button[aria-label*="lay"]', '.player-start', 'text=Ready when you are']) {
  const el = page.locator(sel).first()
  if (await el.count()) { await el.click({ timeout: 3000 }).catch(() => {}); break }
}
await page.waitForTimeout(90000)

const preReloadAudioCount = audioRequests.length
console.log(`pre-reload audio requests: ${preReloadAudioCount}`)

// RELOAD — this is the returning-learner path: the cache fast path should
// hydrate SimplePlayer straight from the localStorage script cache.
consoleLines.length = 0
audioRequests.length = 0
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(4000)
for (const sel of ['button:has-text("Ready when you are")', '.play-button', 'button[aria-label*="lay"]', '.player-start', 'text=Ready when you are']) {
  const el = page.locator(sel).first()
  if (await el.count()) { await el.click({ timeout: 3000 }).catch(() => {}); break }
}
await page.waitForTimeout(60000)

console.log('\n[InstantPlayback] console lines after reload:')
consoleLines.forEach((l) => console.log('  ' + l))
const usedCacheFastPath = consoleLines.some((l) => l.includes('Cache fast-path'))
const usedBootstrap = consoleLines.some((l) => l.includes('Bootstrap ready'))
console.log(`\ncache fast-path fired: ${usedCacheFastPath}`)
console.log(`bootstrap fired: ${usedBootstrap}`)

console.log(`\npost-reload audio requests: ${audioRequests.length}`)
for (const r of audioRequests) console.log(`  ${r.ref}`)

const bareRevisedHits = audioRequests.filter((r) => REVISED_IDS.has(r.ref))
const stampedHits = audioRequests.filter((r) => {
  const base = r.ref.split('.v')[0]
  return REVISED_IDS.has(base) && r.ref.includes('.v')
})
// Any request whose bare id is in REVISED_IDS but arrived WITHOUT .vN is the bug.
const anyRevisedIdSeen = audioRequests.filter((r) => REVISED_IDS.has(r.ref.split('.v')[0]))

console.log(`\nrevised-clip requests seen: ${anyRevisedIdSeen.length}`)
console.log(`  stamped (.vN): ${stampedHits.length}`)
console.log(`  BARE (bug if >0 and cache fast-path fired): ${bareRevisedHits.length}`)

const ok = usedCacheFastPath && anyRevisedIdSeen.length > 0 && bareRevisedHits.length === 0

console.log('\n' + JSON.stringify({
  ok,
  usedCacheFastPath,
  usedBootstrap,
  revisedClipRequestsSeen: anyRevisedIdSeen.length,
  stampedHits: stampedHits.length,
  bareRevisedHits: bareRevisedHits.length,
  sampleUrls: audioRequests.slice(0, 20).map((r) => r.url),
}))

await browser.close()
process.exit(ok ? 0 : 1)
