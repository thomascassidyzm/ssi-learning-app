// OFFLINE MODE PERSISTS — Tom's ruling (2026-07-31): once Offline mode is
// selected and content downloads, the app ALWAYS plays from the offline cache
// and NEVER lets connectivity guesswork put it back on the network.
//
// Scenario: guest plays → toggles Offline mode (smallest depth) → download
// completes → airplane mode → RELOAD (the step that used to silently drop the
// toggle) → the player must come back in offline mode and play from cache.
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/offline-mode-persist-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/offline-mode-persist/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(() => {
  window.__audioPlays = []
  const orig = Audio.prototype.play
  Audio.prototype.play = function (...a) { window.__audioPlays.push(this.src || '(nosrc)'); return orig.apply(this, a) }
})
const playCount = () => page.evaluate(() => window.__audioPlays.length).catch(() => 0)
const blobPlays = () => page.evaluate(() => window.__audioPlays.filter((s) => s.startsWith('blob:')).length).catch(() => 0)

// ── online: start a lesson ──────────────────────────────────────────────────
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)
let started = false
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); started = true; break } catch { /* next */ } }
}
check('lesson started online', started)
await page.waitForTimeout(8000)

// ── toggle Offline mode via the tray, smallest depth ────────────────────────
const trigger = page.locator('.mode-trigger')
await trigger.click({ timeout: 10000 }).catch(() => {})
const offlineRow = page.locator('.tray-item', { hasText: /offline/i }).first()
check('offline row visible in tray', await offlineRow.isVisible({ timeout: 8000 }).catch(() => false))
await offlineRow.click().catch(() => {})
// Depth picker → keep the default smallest notch → Download.
const dlBtn = page.locator('.offline-depth-download').first()
check('depth picker opened', await dlBtn.isVisible({ timeout: 8000 }).catch(() => false))
await dlBtn.click().catch(() => {})
await page.screenshot({ path: `${OUT}1-download-started.png` })

// Wait for the download to finish (persisted flag appears at completion).
let persisted = false
for (let i = 0; i < 60 && !persisted; i++) {
  await page.waitForTimeout(2000)
  persisted = await page.evaluate(() =>
    Object.keys(localStorage).some((k) => k.startsWith('ssi-offline-mode-') && localStorage.getItem(k) === '1'),
  ).catch(() => false)
}
check('download completed + selection persisted', persisted)
await page.screenshot({ path: `${OUT}2-downloaded.png` })

// ── airplane mode + reload: the step that used to drop the toggle ───────────
await ctx.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(6000)
const body1 = (await page.textContent('body').catch(() => '')) || ''
check('shell loads offline after reload', body1.length > 200 && !/ERR_|No internet/i.test(body1))
// Start playing again.
let restarted = false
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); restarted = true; break } catch { /* next */ } }
}
check('play control works offline', restarted)
const before = await playCount()
await page.waitForTimeout(20000)
const after = await playCount()
const blobs = await blobPlays()
check('audio plays offline after reload', after > before, `${before} → ${after}`)
check('offline plays come from cache (blob: URLs)', blobs > 0, `${blobs} blob plays`)
const modeRestored = await page.evaluate(() =>
  Object.keys(localStorage).some((k) => k.startsWith('ssi-offline-mode-') && localStorage.getItem(k) === '1'),
).catch(() => false)
check('offline-mode selection survived the reload', modeRestored)
await page.screenshot({ path: `${OUT}3-offline-playing.png` })

await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
