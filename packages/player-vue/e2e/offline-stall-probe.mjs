// OFFLINE STALL PROBE — founder stall report (2026-07-31, field report #2):
// bulk download froze at 91% and sat there silently forever. Root cause: no
// per-fetch timeout anywhere in the download path — one wedged connection
// never settles, its batch's Promise.all never resolves, and the hung promise
// stays in AudioCache's in-flight de-dupe map so every retry reuses it.
//
// Scenario (against a real deployment): guest plays → toggles Offline mode
// (smallest depth) while this probe WEDGES one clip's byte-fetches — the
// route is simply never answered for the first two attempts (a true hang,
// not an error), then works. Asserts:
//   • the display flips to the honest "Stalled at N% — retrying" copy while
//     progress is frozen (liveness rule: silently-stuck is forbidden),
//   • the 30s fetch timeout unsticks the run — progress resumes,
//   • the download still ends READY and offline persists.
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/offline-stall-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/offline-stall/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
// serviceWorkers: 'block' so EVERY audio fetch is interceptable by ctx.route.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
const page = await ctx.newPage()

// ── sabotage: wedge ONE victim's byte-fetches (hang, not error) ─────────────
let victimId = null
const urlToId = new Map()   // presigned URL → victim id (refreshed URLs included)
let wedgeHits = 0           // fetch attempts we left hanging
const WEDGE_ATTEMPTS = 2    // first two attempts hang; third works

await ctx.route('**/api/audio/batch-urls', async (route) => {
  const response = await route.fetch()
  let body
  try { body = await response.json() } catch { return route.fulfill({ response }) }
  const ids = Object.keys(body?.urls || {})
  if (!victimId && ids.length > 30) {
    victimId = ids[10]
    console.log('victim chosen:', victimId)
  }
  for (const [id, url] of Object.entries(body?.urls || {})) {
    if (id === victimId) urlToId.set(url, id)
  }
  await route.fulfill({ response, json: body })
})

await ctx.route('**/*', async (route) => {
  const url = route.request().url()
  const proxyMatch = url.match(/\/api\/audio\/([^/?]+)$/)
  const isVictim = urlToId.has(url) || (proxyMatch && decodeURIComponent(proxyMatch[1]) === victimId)
  if (!isVictim) return route.fallback()
  wedgeHits++
  if (wedgeHits <= WEDGE_ATTEMPTS) {
    console.log(`wedging victim fetch attempt ${wedgeHits} (hangs until client timeout)`)
    return // never answered — a wedged connection. The client's 30s timeout must save the run.
  }
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
for (const sel of ['.offline-depth-download', 'button:has-text("Download")']) {
  const btn = page.locator(sel).first()
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) { await btn.click().catch(() => {}); break }
}

// ── watch the tray copy through the wedge ───────────────────────────────────
// Expected timeline once the victim's batch is reached: sibling clips land,
// then progress freezes on the hung fetch → "Stalled at N%" within 20s →
// 30s fetch timeout fires → retry (also wedged) → stalled again → third
// attempt passes → progress resumes → READY.
const trayDesc = async () => {
  if (!(await page.locator('.mode-tray').isVisible().catch(() => false))) {
    await page.locator('.mode-trigger').click({ timeout: 5000 }).catch(() => {})
  }
  return (await page.locator('.tray-item', { hasText: /offline/i }).first().textContent().catch(() => '')) || ''
}
let sawStalled = false
let stalledDetail = ''
let desc = ''
let ready = false
for (let i = 0; i < 300 && !ready; i++) {   // up to ~600s: download + two 30s wedges + straggler backoff
  await page.waitForTimeout(2000)
  desc = await trayDesc()
  if (/Stalled at \d+%/i.test(desc)) { sawStalled = true; stalledDetail = desc.replace(/\s+/g, ' ').trim().slice(0, 120) }
  ready = /Ready offline|Ready to play offline/i.test(desc)
  if (i % 15 === 0) console.log(`t+${i * 2}s tray: ${desc.replace(/\s+/g, ' ').trim().slice(0, 120)}`)
}
await page.screenshot({ path: `${OUT}1-final-tray.png` })

check('victim fetches were wedged (the stall actually happened)', wedgeHits >= WEDGE_ATTEMPTS, `${wedgeHits} wedged attempts`)
check('liveness: display flipped to "Stalled at N% — retrying" while frozen', sawStalled, stalledDetail)
check('fetch timeout unsticks the run — download ends READY', ready, desc.trim().slice(0, 160))
check('no dead-end copy', !/needs better signal/i.test(desc), desc.trim().slice(0, 160))

const persisted = await page.evaluate(() =>
  Object.keys(localStorage).some((k) => k.startsWith('ssi-offline-mode-') && localStorage.getItem(k) === '1'),
).catch(() => false)
check('offline mode ON + selection persisted', persisted)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
