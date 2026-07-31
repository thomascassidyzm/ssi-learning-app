// OFFLINE STRAGGLER PROBE — founder invariant (2026-07-31): a 99.9%-cached
// course is READY, never a red dead-end. Live repro was 9,732/9,742 files →
// UI rounded to 100% → then "Download incomplete — needs better signal" on
// strong signal.
//
// Scenario (against a real deployment): guest plays → toggles Offline mode
// (smallest depth) while this probe sabotages a handful of audio fetches —
// some transiently (fail twice, then work: must be healed by straggler retry
// rounds), some permanently (must NOT block readiness). Asserts:
//   • straggler retry rounds fire (the sabotaged ids get re-requested),
//   • offline mode ends up ON and persisted,
//   • the tray shows a green Ready state, never the dead-end/signal copy.
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/offline-straggler-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/offline-straggler/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
// serviceWorkers: 'block' so EVERY audio fetch is interceptable by ctx.route
// (the SW's CacheFirst layer would otherwise bypass routing). The download
// path itself never needs the SW.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
await page.addInitScript(() => {
  window.__audioPlays = []
  const orig = Audio.prototype.play
  Audio.prototype.play = function (...a) { window.__audioPlays.push(this.src || '(nosrc)'); return orig.apply(this, a) }
})
const playCount = () => page.evaluate(() => window.__audioPlays?.length || 0).catch(() => 0)

// ── sabotage: pick victims from the first batch-urls response ───────────────
const TRANSIENT_N = 4   // fail twice, then succeed — straggler rounds must heal these
const PERMANENT_N = 2   // fail always — must not block readiness
const transientIds = new Set()
const permanentIds = new Set()
const urlToId = new Map()          // presigned URL → audio id (refreshed URLs included)
const transientHits = new Map()    // id → sabotaged fetch count
let batchCallsWithVictims = 0      // batch-urls requests re-asking for a victim id

await ctx.route('**/api/audio/batch-urls', async (route) => {
  const req = route.request()
  const askedIds = (() => { try { return JSON.parse(req.postData() || '{}').audioIds || [] } catch { return [] } })()
  const response = await route.fetch()
  let body
  try { body = await response.json() } catch { return route.fulfill({ response }) }
  const ids = Object.keys(body?.urls || {})
  if (transientIds.size === 0 && ids.length > TRANSIENT_N + PERMANENT_N) {
    ids.slice(0, TRANSIENT_N).forEach((id) => transientIds.add(id))
    ids.slice(TRANSIENT_N, TRANSIENT_N + PERMANENT_N).forEach((id) => permanentIds.add(id))
    console.log('victims chosen — transient:', [...transientIds], 'permanent:', [...permanentIds])
  }
  for (const [id, url] of Object.entries(body?.urls || {})) {
    if (transientIds.has(id) || permanentIds.has(id)) urlToId.set(url, id)
  }
  if (askedIds.some((id) => transientIds.has(id) || permanentIds.has(id)) && transientIds.size > 0) batchCallsWithVictims++
  await route.fulfill({ response, json: body })
})

// Sabotage the actual byte fetches: presigned S3 URLs for victims, and the
// per-clip proxy fallback so a victim can't sneak in the back door.
await ctx.route('**/*', async (route) => {
  const url = route.request().url()
  const proxyMatch = url.match(/\/api\/audio\/([^/?]+)$/)
  const victimId = urlToId.get(url) || (proxyMatch && (transientIds.has(decodeURIComponent(proxyMatch[1])) || permanentIds.has(decodeURIComponent(proxyMatch[1]))) ? decodeURIComponent(proxyMatch[1]) : null)
  if (!victimId) return route.fallback()
  if (permanentIds.has(victimId)) return route.abort('failed')
  const hits = (transientHits.get(victimId) || 0) + 1
  transientHits.set(victimId, hits)
  if (hits <= 2) return route.abort('timedout')
  return route.fallback()
})

// ── online: start a lesson ──────────────────────────────────────────────────
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)
let started = false
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); started = true; break } catch { /* next */ } }
}
check('lesson started online', started)
await page.waitForTimeout(6000)

// ── toggle Offline mode via the tray, smallest depth ────────────────────────
await page.locator('.mode-trigger').click({ timeout: 10000 }).catch(() => {})
const offlineRow = page.locator('.tray-item', { hasText: /offline/i }).first()
check('offline row visible in tray', await offlineRow.isVisible({ timeout: 8000 }).catch(() => false))
await offlineRow.click().catch(() => {})
// Depth picker (if it appears) — confirm with whatever download button exists;
// some flows start the download straight from the toggle.
for (const sel of ['.offline-depth-download', 'button:has-text("Download")']) {
  const btn = page.locator(sel).first()
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) { await btn.click().catch(() => {}); break }
}

// ── wait for the download to settle (straggler rounds add ~30s of backoff) ──
// Poll the tray's Offline row copy until it reads Ready (complete or partial).
const trayDesc = async () => {
  if (!(await page.locator('.mode-tray').isVisible().catch(() => false))) {
    await page.locator('.mode-trigger').click({ timeout: 5000 }).catch(() => {})
  }
  return (await page.locator('.tray-item', { hasText: /offline/i }).first().textContent().catch(() => '')) || ''
}
let desc = ''
let ready = false
let sawFinishing = false   // tail-pacing copy: straggler rounds must announce themselves
for (let i = 0; i < 240 && !ready; i++) {   // up to ~480s — a full-course download runs ~2.5-3min, straggler rounds add ~30s+
  await page.waitForTimeout(2000)
  desc = await trayDesc()
  if (/Finishing up/i.test(desc)) sawFinishing = true
  ready = /Ready offline|Ready to play offline/i.test(desc)
  if (i % 15 === 0) console.log(`t+${i * 2}s tray: ${desc.replace(/\s+/g, ' ').trim().slice(0, 120)}`)
}
await page.screenshot({ path: `${OUT}1-final-tray.png` })

check('download ends READY (complete or partial), sabotaged clips notwithstanding', ready, desc.trim().slice(0, 160))
check('no dead-end copy ("needs better signal"/incomplete-as-final)', !/needs better signal/i.test(desc), desc.trim().slice(0, 160))
check('straggler retry rounds fired (victim ids re-requested in a fresh batch)', batchCallsWithVictims >= 2, `${batchCallsWithVictims} batch-urls calls asked for victims`)
check('tail phase announced honestly ("Finishing up — checking the last N clips")', sawFinishing)
const transientRetried = [...transientIds].every((id) => (transientHits.get(id) || 0) >= 2)
check('transient victims were retried past their failures', transientIds.size > 0 && transientRetried,
  JSON.stringify([...transientHits.entries()]))

// Offline mode is ON and persisted — the invariant's ground truth.
const persisted = await page.evaluate(() =>
  Object.keys(localStorage).some((k) => k.startsWith('ssi-offline-mode-') && localStorage.getItem(k) === '1'),
).catch(() => false)
check('offline mode ON + selection persisted', persisted)

// Ring must not be red: the error class is only for genuinely-low coverage.
const isErrorState = await page.locator('.tray-desc.is-error').count().catch(() => 0)
check('tray state is not the red error state', isErrorState === 0)

// ── and it PLAYS: airplane mode mid-session, audio keeps flowing from cache.
// (Cold-start offline reload is covered by offline-mode-persist-probe /
// sw-offline-shell-probe — it needs the SW, which this probe blocks so the
// audio fetches stay interceptable.)
await page.locator('.tray-backdrop').click().catch(() => {})   // close the tray
await ctx.setOffline(true)
const before = await playCount()
await page.waitForTimeout(25000)
const after = await playCount()
check('playback continues offline despite the missing tail', after > before, `${before} → ${after} Audio.play() calls`)
await page.screenshot({ path: `${OUT}2-offline-playing.png` })

await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
