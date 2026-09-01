// OFFLINE SCRIPT-TOGGLE PROBE — Tom, on a flight, 2026-09-01:
//
//   "Chinese scripts disappeared from the modal option and are defaulted to
//    off. So I only got the romanised script for Chinese in offline mode."
//
// Two symptoms, one flag. `hasRomanizedText` used to be set ONLY from a live
// Supabase count of course_legos carrying target_text_roman. Offline that
// query cannot land, so the flag stayed false — which both hid the mode
// tray's pronunciation-guide row (ModeTray renders it `v-if="hasRomanizedText"`)
// and dropped every native-render path in the player back to the roman text.
//
// This probe asserts BOTH halves, because either one alone passing is a lie:
//   (1) the pronunciation-guide row is PRESENT in the mode tray, offline;
//   (2) native CJK glyphs are actually ON SCREEN in the target pane, offline;
//   (3) the online run and the offline run agree — same row, same glyphs.
//
// GENUINE OFFLINE, not a mock: context.setOffline(true) is Chromium's CDP
// Network.emulateNetworkConditions(offline:true) — a real network-layer
// disconnection. The app's shell, its IndexedDB script cache and its cached
// audio still serve from disk, exactly as on a phone in airplane mode.
//
// zho_for_eng is public + released and has 602 romanised LEGOs (verified
// against the live DB, 2026-09-01). It is a paid Big-10 course, so a GUEST
// browser session is gated at the free-preview boundary (Yellow belt, seed
// 19) — irrelevant here: this probe never navigates past the first rounds.
//
// Run against a local production build (a real service worker is needed for
// the offline reload to serve the shell):
//   pnpm --filter @ssi/core build && pnpm --filter player-vue build
//   pnpm --filter player-vue preview --port 4174 --host &
//   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs \
//   BASE_URL=http://localhost:4174 node e2e/offline-script-toggle-probe.mjs
//
// Or against the deployed dev alias:
//   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs \
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//   node e2e/offline-script-toggle-probe.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:4174'
const COURSE = process.env.COURSE_CODE || 'zho_for_eng'
const OUT = process.env.OUT_DIR || `${process.env.CS_SCRATCH || '/tmp'}/offline-script-toggle/`
const WARM_MS = Number(process.env.WARM_MS || 60_000)

mkdirSync(OUT, { recursive: true })
console.log(`[probe] BASE=${BASE} COURSE=${COURSE} OUT=${OUT} WARM_MS=${WARM_MS}`)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// CJK Unified Ideographs (+ Ext A) — the hanzi Tom did not get. Deliberately
// NOT a "is it non-Latin" test: pinyin carries tone-marked Latin vowels and
// would pass that.
const HAS_HANZI = /[㐀-䶿一-鿿]/

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
await ctx.addInitScript((course) => {
  try { localStorage.setItem('ssi-last-course', course) } catch { /* ignore */ }
}, COURSE)

const page = await ctx.newPage()

/** Open the mode tray, report what the pronunciation row looks like, close it. */
async function readTray(tag) {
  const trigger = page.locator('.mode-trigger').first()
  if (!(await trigger.count().catch(() => 0))) return { triggerFound: false, rowPresent: false }
  await trigger.click({ timeout: 8_000 }).catch(() => {})
  await page.waitForTimeout(700)
  const state = await page.evaluate(() => {
    const tray = document.querySelector('.mode-tray')
    const icon = tray?.querySelector('.script-icon')
    const row = icon?.closest('.tray-item') || null
    return {
      trayOpen: !!tray,
      rowPresent: !!row,
      rowText: row ? (row.textContent || '').replace(/\s+/g, ' ').trim() : null,
      // `active` == romanisation shown (the toggle is on)
      guideOn: row ? row.classList.contains('active') : null,
      itemCount: tray ? tray.querySelectorAll('.tray-item').length : 0,
    }
  }).catch(() => ({ trayOpen: false, rowPresent: false }))
  await page.screenshot({ path: `${OUT}tray-${tag}.png` }).catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await trigger.click({ timeout: 3_000 }).catch(() => {})
  await page.waitForTimeout(400)
  return { triggerFound: true, ...state }
}

/** Everything the target side is currently rendering, native or not.
 *  LegoAssembly owns the target side (LearningPlayer's own target <p> was
 *  removed — "duplicated by LEGO tiles below"): `.block-text` / `.comp` carry
 *  the primary glyphs, `.tile-ruby` carries the romanisation above them. */
const readTargetText = () => page.evaluate(() => {
  const asm = document.querySelector('.lego-assembly')
  if (!asm) return { targetText: null, rubyText: null, rubyCount: 0 }
  const txt = (nodes) => [...nodes].map((n) => (n.textContent || '').trim()).filter(Boolean).join(' ')
  const rubies = asm.querySelectorAll('.tile-ruby')
  return {
    // Primary glyph row(s) only — deliberately EXCLUDES .tile-ruby, so a
    // romanisation-only render cannot masquerade as native text.
    targetText: txt(asm.querySelectorAll('.block-text, .comp, .carriage-cell')).slice(0, 300)
      || (asm.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    rubyText: txt(rubies).slice(0, 200),
    rubyCount: rubies.length,
  }
}).catch(() => ({ targetText: null, rubyText: null, rubyCount: 0 }))

/** Does the cached script itself carry the native glyphs? (the data question) */
const readCachedScriptNative = (course) => page.evaluate(async (code) => {
  const names = await (indexedDB.databases ? indexedDB.databases() : Promise.resolve([]))
  const dbName = 'ssi-script-cache'
  if (names.length && !names.some((d) => d.name === dbName)) return { found: false, reason: 'no script-cache db' }
  return await new Promise((resolve) => {
    const req = indexedDB.open(dbName)
    req.onerror = () => resolve({ found: false, reason: 'open failed' })
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('scripts')) return resolve({ found: false, reason: 'no scripts store' })
      const tx = db.transaction('scripts', 'readonly')
      const all = tx.objectStore('scripts').getAll()
      all.onerror = () => resolve({ found: false, reason: 'getAll failed' })
      all.onsuccess = () => {
        const entry = all.result.find((s) => s?.courseCode === code)
        if (!entry) return resolve({ found: false, reason: `no cached entry for ${code}` })
        let cyclesWithNative = 0, cyclesTotal = 0, sample = null
        for (const round of entry.rounds || []) {
          for (const c of round.cycles || []) {
            cyclesTotal++
            if (c?.target?.textNative) {
              cyclesWithNative++
              if (!sample) sample = { roman: c.target.text, native: c.target.textNative }
            }
          }
        }
        resolve({ found: true, rounds: (entry.rounds || []).length, cyclesTotal, cyclesWithNative, sample })
      }
    }
  })
}, course).catch((e) => ({ found: false, reason: String(e) }))

async function startPlayback() {
  const btn = page.locator('.center-btn').first()
  if (!(await btn.count().catch(() => 0))) return false
  await btn.click({ timeout: 8_000 }).catch(() => {})
  return true
}

/** Poll the target pane until hanzi shows up (or we run out of patience). */
async function waitForTargetText(ms) {
  const deadline = Date.now() + ms
  let last = { targetText: null, rubyText: null, rubyCount: 0 }
  while (Date.now() < deadline) {
    const now = await readTargetText()
    if (now.targetText) last = now
    if (HAS_HANZI.test(now.targetText || '')) return { ...now, sawHanzi: true }
    await page.waitForTimeout(2_000)
  }
  return { ...last, sawHanzi: HAS_HANZI.test(last.targetText || '') }
}

const report = {}

async function main() {
  // ── Phase 1: ONLINE — establish the baseline and warm the cache ─────────
  console.log('\n=== Phase 1: online boot + warm the script/audio cache ===')
  await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  const shellUp = await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)
  check('shell booted online', shellUp)
  await page.waitForTimeout(3_000)
  check('lesson started online', await startPlayback())

  const onlineTarget = await waitForTargetText(WARM_MS)
  report.onlineTarget = onlineTarget
  check('ONLINE: target pane is rendering something', !!onlineTarget.targetText,
    JSON.stringify(onlineTarget).slice(0, 240))

  // The ONLINE run is the BASELINE, not an assertion: whatever the app does
  // with a working network is by definition correct, and the whole point of
  // the fix is that the offline run must match it.
  const onlineTray = await readTray('online')
  report.onlineTray = onlineTray
  console.log(`[probe] online baseline :: tray row=${onlineTray.rowPresent} guideOn=${onlineTray.guideOn} hanzi=${onlineTarget.sawHanzi}`)

  // Let the script cache settle before we cut the wire.
  await page.waitForTimeout(15_000)
  const cached = await readCachedScriptNative(COURSE)
  report.cachedScript = cached
  check('CACHE: a script was cached for this course', !!cached.found, JSON.stringify(cached).slice(0, 300))
  // A Latin-script course legitimately has no native variant. Everything below
  // is then asserted the OTHER way round: no row, no hanzi, and — the point —
  // still no DIFFERENCE between online and offline.
  const expectRomanized = onlineTray.rowPresent
  report.expectRomanized = expectRomanized
  console.log(`[probe] ${COURSE} is ${expectRomanized ? 'ROMANISED — expecting the toggle and native glyphs' : 'LATIN-SCRIPT — expecting NO toggle and no native glyphs'} offline`)
  if (expectRomanized) {
    check('CACHE: the cached script carries native glyphs (target.textNative)',
      cached.cyclesWithNative > 0, JSON.stringify(cached).slice(0, 300))
  } else {
    check('CACHE: no native glyphs cached, as expected for a Latin-script course',
      cached.cyclesWithNative === 0, JSON.stringify(cached).slice(0, 300))
  }

  // The service worker registers on the FIRST load but does not control that
  // page — a client only gets a controller on a subsequent navigation. Without
  // this online reload the offline boot has no SW to serve the shell and the
  // app never paints, which looks like a fix failure and is not one. (Tom's
  // phone is a long-installed PWA; it is always controlled.)
  console.log('\n=== Phase 1b: online reload so the service worker takes control ===')
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {})
  const controlled = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    for (let i = 0; i < 30; i++) {
      if (navigator.serviceWorker.controller) return true
      await new Promise((r) => setTimeout(r, 1_000))
    }
    return !!navigator.serviceWorker.controller
  }).catch(() => false)
  check('service worker is controlling the page (offline boot is possible)', controlled)
  await page.waitForTimeout(5_000)

  // ── Phase 2: OFFLINE — the flight ───────────────────────────────────────
  console.log('\n=== Phase 2: offline reload (airplane mode) ===')
  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  const shellOffline = await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)
  check('shell booted OFFLINE from cache', shellOffline)
  await page.waitForTimeout(4_000)
  check('lesson started offline', await startPlayback())

  const offlineTarget = await waitForTargetText(WARM_MS)
  report.offlineTarget = offlineTarget
  // THE SECOND HALF. A tray row with no hanzi behind it is the failure mode
  // this probe exists to catch.
  check(expectRomanized
    ? 'OFFLINE: native hanzi rendered in the target pane (not romanisation only)'
    : 'OFFLINE: target pane renders normally (no native variant expected)',
    expectRomanized ? offlineTarget.sawHanzi : !!offlineTarget.targetText,
    JSON.stringify(offlineTarget).slice(0, 240))

  const offlineTray = await readTray('offline')
  report.offlineTray = offlineTray
  // THE FIRST HALF — Tom's "disappeared from the modal option".
  check(expectRomanized
    ? 'OFFLINE: pronunciation-guide row present in the mode tray'
    : 'OFFLINE: pronunciation-guide row correctly ABSENT (Latin-script course)',
    offlineTray.rowPresent === expectRomanized, JSON.stringify(offlineTray).slice(0, 240))

  // ── Phase 3: the two runs must agree ────────────────────────────────────
  check('offline tray matches online tray (row present in both, or in neither)',
    onlineTray.rowPresent === offlineTray.rowPresent,
    `online=${onlineTray.rowPresent} offline=${offlineTray.rowPresent}`)
  check('offline native rendering matches online',
    onlineTarget.sawHanzi === offlineTarget.sawHanzi,
    `online=${onlineTarget.sawHanzi} offline=${offlineTarget.sawHanzi}`)
  check('offline toggle state matches online (no preference silently flipped)',
    onlineTray.guideOn === offlineTray.guideOn,
    `online=${onlineTray.guideOn} offline=${offlineTray.guideOn}`)
}

try {
  await main()
} catch (e) {
  check('probe ran to completion', false, String(e))
} finally {
  writeFileSync(`${OUT}report.json`, JSON.stringify(report, null, 2))
  await browser.close().catch(() => {})
  console.log(`\n[probe] artefacts in ${OUT}`)
  console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures} check(s) failed)`)
  process.exit(failures === 0 ? 0 : 1)
}
