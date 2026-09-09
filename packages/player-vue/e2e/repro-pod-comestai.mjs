// Repro: ita_for_eng pod teleprompter — what does the known-gloss line show
// while "Come stai?" (SC01-S002) is the current sentence? Uses the ?pod=1
// boundary cheat to force a Layer-2 pod lap, then samples teleprompter rows
// (.phrase-target / .phrase-known) every second and screenshots any state
// whose current row contains 'come'.
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const QS = process.env.QS || '?course=ita_for_eng&pod=1'
const WATCH_MS = Number(process.env.WATCH_MS || 300_000)

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (msg) => {
  const t = msg.text()
  if (/TileCoverage|decomposePhrase|pod|Pod|POD|come/i.test(t)) console.log('[console]', msg.type(), t)
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.addInitScript(() => {
  localStorage.setItem('ssi-last-course', 'ita_for_eng')
  localStorage.setItem('ssi_learning_position_ita_for_eng', JSON.stringify({
    legoId: 'S0002L01', seedId: 'S0002', seedNumber: 2, cycleId: null,
    itemInRound: 0, lastUpdated: Date.now(), courseCode: 'ita_for_eng',
  }))
})

console.log('Navigating to', BASE + '/' + QS)
await page.goto(BASE + '/' + QS, { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)

let clicked = false
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) {
    try { await btn.click({ timeout: 8000 }); clicked = true; console.log('clicked', sel); break } catch { /* next */ }
  }
}
console.log('start clicked:', clicked)

const seen = new Set()
let shots = 0
const deadline = Date.now() + WATCH_MS
while (Date.now() < deadline) {
  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.phrase-row')].map(r => ({
      current: r.classList.contains('current'),
      speaker: r.querySelector('.phrase-speaker')?.textContent?.trim() || '',
      target: r.querySelector('.phrase-target')?.textContent?.trim() || '',
      known: r.querySelector('.phrase-known')?.textContent?.trim() || '',
    }))
    return rows.length ? rows.filter(r => r.current || r.known) : null
  }).catch(() => null)
  if (state && state.length) {
    const key = JSON.stringify(state)
    if (!seen.has(key)) {
      seen.add(key)
      console.log('[teleprompter]', key)
      const cur = state.find(r => r.current)
      if (cur && /\bcome\b/i.test(cur.target + ' ' + cur.known) && shots < 10) {
        shots++
        await page.screenshot({ path: `/tmp/pod-comestai-${shots}.png` })
        console.log(`[shot] /tmp/pod-comestai-${shots}.png`)
      }
    }
  }
  await page.waitForTimeout(800)
}
await page.screenshot({ path: '/tmp/pod-comestai-final.png' })
console.log('done')
await browser.close()
