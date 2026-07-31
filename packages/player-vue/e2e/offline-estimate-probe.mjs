// OFFLINE ESTIMATE PROBE — founder ruling (2026-07-31): the Take-it-offline
// dialog must price the TRUE download (new slice + automatic catch-up incl.
// the whole-course listening bundle, minus already-cached), not just the
// slider's slice. The 2% pick read "≈48 MB" while the real download was
// 9,742 files.
//
// Guest opens the picker; asserts the size caption settles to the split/true
// form: "≈ X MB new + Y MB catch-up" (fresh guest: aux bundle missing → the
// catch-up side MUST be present), never a bare slice-only number once the
// truth pass lands.
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/offline-estimate-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/offline-estimate/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)
let started = false
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); started = true; break } catch { /* next */ } }
}
check('lesson started', started)
await page.waitForTimeout(5000)

// Open mode tray → Offline row → picker
await page.locator('.mode-trigger').click({ timeout: 10000 }).catch(() => {})
const offlineRow = page.locator('.tray-item', { hasText: /offline/i }).first()
check('offline row visible', await offlineRow.isVisible({ timeout: 8000 }).catch(() => false))
await offlineRow.click().catch(() => {})

const sizeEl = page.locator('.offline-depth-size-mb').first()
check('picker size caption visible', await sizeEl.isVisible({ timeout: 8000 }).catch(() => false))

// Let the truth pass land (script expansion + aux enumerate), then read.
let caption = ''
let settled = false
for (let i = 0; i < 30 && !settled; i++) {
  await page.waitForTimeout(2000)
  caption = ((await sizeEl.textContent().catch(() => '')) || '').trim()
  // Fresh guest: the aux/listening bundle is uncached, so once the truth pass
  // lands the caption MUST carry a catch-up side.
  settled = /catch-up/i.test(caption)
  if (i % 5 === 0) console.log(`t+${i * 2}s caption: ${caption}`)
}
await page.screenshot({ path: `${OUT}1-picker.png` })
check('caption prices the true manifest (has catch-up side)', settled, caption)
check('caption is not empty/working placeholder', !!caption && !/working out/i.test(caption), caption)

// The catch-up side must be material for a fresh guest (aux bundle ≈ 100+ MB),
// i.e. not a sub-10 MB token amount. Parse the LAST size before "catch-up".
const m = caption.match(/([\d.]+)\s*(MB|GB)\s*catch-up/i)
const catchupMb = m ? parseFloat(m[1]) * (m[2].toUpperCase() === 'GB' ? 1000 : 1) : 0
check('catch-up side is material (≥ 30 MB — the aux listening bundle alone)', catchupMb >= 30, caption)

await browser.close()
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
