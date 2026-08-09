// Probe: a pod lap debuts ONE new sentence (two at the pod's cold start).
// Loads the DEPLOYED bundle with ?podview=1 (which composes a real intake
// cohort through nextLapPreviewFallback) and reads how many sentences the
// composed lap carries, from the pod_lap_start telemetry payload.
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app COURSE=fra_for_eng \
//     node e2e/pod-intake-size-probe.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5174'
const COURSE = process.env.COURSE || 'fra_for_eng'

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const lines = []
page.on('console', (m) => lines.push(m.text()))

await page.goto(`${BASE}/?course=${COURSE}&podview=1`, { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
check('podview cheat armed', lines.some((l) => l.includes('?podview=1 instant pod preview ARMED')))

for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); break } catch { /* next */ } }
}
await page.waitForTimeout(6000)

// The teleprompter renders one row per sentence in the composed lap.
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.phrase-row')].map((r) => r.querySelector('.phrase-target')?.textContent?.trim() || ''))
console.log('[lap sentences]', JSON.stringify(rows))
check('the cold-start lap is exactly two sentences', rows.length === 2, `rows=${rows.length}`)

const nextBtn = page.locator('.pod-preview-nav__btn', { hasText: 'Next' }).first()
if (await nextBtn.count()) {
  await nextBtn.click()
  await page.waitForTimeout(6000)
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('.phrase-row')].map((r) => r.querySelector('.phrase-target')?.textContent?.trim() || ''))
  console.log('[next cohort]', JSON.stringify(after))
  check('every later cohort is a single sentence', after.length === 1, `rows=${after.length}`)
} else {
  check('Next button present', false)
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
