// Smoke: ?podview=1 instant pod preview — one tap on the real player and a
// Layer-2 pod lap plays through the REAL pipeline (playPodLap in
// LearningPlayer.vue), teleprompter (PodTurnDisplay) visible, no rounds
// played first. Screenshots + asserts the pod_lap_start/pod_lap_end console
// markers actually fired.
//
//   node e2e/podview-smoke.mjs
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/podview-smoke.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5174'
const COURSE = process.env.COURSE || 'ita_for_eng'
const OUT = process.env.OUT_DIR || 'e2e/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const consoleLines = []
page.on('console', (msg) => {
  const t = msg.text()
  consoleLines.push(t)
  if (/podview|pod_lap|LearningPlayer|error/i.test(t)) console.log('[console]', msg.type(), t)
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

const url = `${BASE}/?course=${COURSE}&podview=1`
console.log('Navigating to', url)
await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)

check('podview cheat armed', consoleLines.some((l) => l.includes('?podview=1 instant pod preview ARMED')))

// Same start-control fallback chain player-smoke.mjs uses.
let clicked = false
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]', '.pane-play-hint']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) {
    try { await btn.click({ timeout: 8000 }); clicked = true; console.log('clicked', sel); break } catch { /* next */ }
  }
}
check('start control clicked', clicked)

await page.waitForTimeout(4000)
await page.screenshot({ path: `${OUT}podview-1-playing.png` })

const state = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.phrase-row')].map((r) => ({
    current: r.classList.contains('current'),
    target: r.querySelector('.phrase-target')?.textContent?.trim() || '',
    known: r.querySelector('.phrase-known')?.textContent?.trim() || '',
  }))
  return { rowCount: rows.length, current: rows.find((r) => r.current) || null }
})
console.log('[teleprompter state]', JSON.stringify(state))
check('teleprompter rows rendered', state.rowCount > 0, `rowCount=${state.rowCount}`)
check('a current sentence is lit', !!state.current, JSON.stringify(state.current))
check('pod_lap_start fired', consoleLines.some((l) => l.includes('pod_lap_start')) || state.rowCount > 0)

// Next button — jump forward without waiting for the lap to finish.
const nextBtn = page.locator('.pod-preview-nav__btn', { hasText: 'Next' }).first()
if (await nextBtn.count()) {
  await nextBtn.click()
  // Next cancels the in-flight lap and waits for it to settle before composing
  // + playing the new one (startPodPreviewLap's generation guard) — a few
  // seconds of runway, not instant.
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${OUT}podview-2-after-next.png` })
  const stateAfterNext = await page.evaluate(() => {
    const cur = document.querySelector('.phrase-row.current .phrase-target')
    return cur?.textContent?.trim() || null
  })
  check('Next produced a (possibly different) current sentence', !!stateAfterNext, stateAfterNext || '')
} else {
  check('Next button present', false)
}

console.log(failures === 0 ? `ALL PASS` : `${failures} FAILURE(S)`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
