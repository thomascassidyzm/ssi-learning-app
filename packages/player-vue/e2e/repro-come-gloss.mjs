// Repro: ita_for_eng 'come stai' — does the UI gloss Italian 'come' (how)
// as English 'come' (to come)? Seeds the local cursor at S0003L01 so the
// player resumes straight into the 'come' round, then samples every
// known-gloss node in the DOM each second and screenshots when a gloss
// containing 'come' appears.
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const QS = process.env.QS || '?course=ita_for_eng'
const LEGO = process.env.LEGO || 'S0003L01'
const SEED_NUM = Number(process.env.SEED_NUM || 3)
const WATCH_MS = Number(process.env.WATCH_MS || 180_000)

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (msg) => {
  const t = msg.text()
  if (/TileCoverage|decomposePhrase|Position|resume|gloss|come/i.test(t)) console.log('[console]', msg.type(), t)
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.addInitScript(([lego, seedNum]) => {
  localStorage.setItem('ssi-last-course', 'ita_for_eng')
  localStorage.setItem('ssi_learning_position_ita_for_eng', JSON.stringify({
    legoId: lego,
    seedId: lego.slice(0, 5),
    seedNumber: seedNum,
    cycleId: null,
    itemInRound: 0,
    lastUpdated: Date.now(),
    courseCode: 'ita_for_eng',
  }))
}, [LEGO, SEED_NUM])

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
const deadline = Date.now() + WATCH_MS
let shots = 0
while (Date.now() < deadline) {
  const state = await page.evaluate(() => {
    const grab = (sel) => [...document.querySelectorAll(sel)].map(n => n.textContent.trim()).filter(Boolean)
    return {
      tiles: grab('.block-target, .tile-target, [class*="target"]').slice(0, 20),
      knowns: grab('.block-known, .tile-known-comp, .carriage-known-comp, [class*="known"]').slice(0, 20),
    }
  }).catch(() => null)
  if (state) {
    const key = JSON.stringify(state)
    if (!seen.has(key)) {
      seen.add(key)
      console.log('[dom]', key)
      const hasCome = [...state.tiles, ...state.knowns].some(t => /\bcome\b/i.test(t))
      if (hasCome && shots < 12) {
        shots++
        await page.screenshot({ path: `/tmp/come-gloss-${shots}.png` })
        console.log(`[shot] /tmp/come-gloss-${shots}.png`)
      }
    }
  }
  await page.waitForTimeout(1000)
}
await page.screenshot({ path: '/tmp/come-gloss-final.png' })
console.log('done; final screenshot /tmp/come-gloss-final.png')
await browser.close()
