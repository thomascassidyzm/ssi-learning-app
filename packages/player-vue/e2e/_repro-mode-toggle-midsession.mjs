// THROWAWAY repro probe (2026-08-09) — Tom's live report.
// Start a course in EASY, confirm the doubling, flip the toggle to FAST
// mid-session (no reload, no course switch), and measure whether the doubling
// actually stops. Records every HTMLMediaElement.play() src.
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/_repro-mode-toggle-midsession.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/home/tomcassidy/.modetoggle-tmp/run/'
const PHASE_S = Number(process.env.PHASE_SECONDS || 100)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))

await page.addInitScript(() => {
  try { localStorage.setItem('ssi-learning-mode', 'easy') } catch { /* blocked */ }
  // The observable: every audio play, STAMPED with the known text on screen at
  // that moment. Audio srcs are blob:/data: under cache-play so they carry no
  // phrase identity, and sampling the text alone cannot see a doubled cycle
  // (the same string simply renders twice). Stamping plays with the text gives
  // run lengths: one cycle = known + voice1 + voice2 = 3 plays of one text; a
  // DOUBLED cycle = 6.
  window.__plays = []
  const orig = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    const el = document.querySelector('.known-text')
    window.__plays.push({ t: Date.now(), src: ((el && el.textContent) || '').trim() })
    return orig.apply(this, a)
  }
})

await page.goto(BASE + '/?reset=1', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.screenshot({ path: OUT + '1-home.png' })

let clicked = null
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', 'button:has-text("Begin")']) {
  const b = page.locator(sel).first()
  if (await b.count()) { try { await b.click({ timeout: 8000 }); clicked = sel; break } catch { /* next */ } }
}
console.log('CLICKED', clicked)

const wait = async (s, label) => {
  const t0 = Date.now()
  while ((Date.now() - t0) / 1000 < s) {
    await page.waitForTimeout(5000)
    const n = await page.evaluate(() => window.__plays.length)
    process.stdout.write(`\r  ${label} plays=${n} t=${Math.round((Date.now() - t0) / 1000)}s   `)
  }
  console.log('')
}

await wait(PHASE_S, 'EASY')
const easyPlays = await page.evaluate(() => window.__plays.splice(0))
await page.screenshot({ path: OUT + '2-easy.png' })

// ── The toggle. It lives on the resting state, so pause first if needed. ────
const flip = async () => {
  const fast = page.locator('button:has-text("Fast")').first()
  if (await fast.count() && await fast.isVisible()) { await fast.click({ timeout: 5000 }); return 'direct' }
  return null
}
let how = null
try { how = await flip() } catch (e) { console.log('flip attempt failed:', String(e).slice(0, 120)) }
if (!how) {
  // Reveal the resting state (pause), then flip.
  try { await page.locator('.center-btn').first().click({ timeout: 5000 }) } catch { /* ignore */ }
  await page.waitForTimeout(1500)
  await page.screenshot({ path: OUT + '3-resting.png' })
  try {
    await page.locator('button:has-text("Fast")').first().click({ timeout: 5000 })
    how = 'via-resting'
    await page.locator('.center-btn').first().click({ timeout: 5000 })  // resume
  } catch (e) { console.log('resting flip failed:', String(e).slice(0, 150)) }
}
console.log('FLIPPED', how)
await page.screenshot({ path: OUT + '4-after-flip.png' })

await wait(PHASE_S, 'FAST')
const fastPlays = await page.evaluate(() => window.__plays.splice(0))
await page.screenshot({ path: OUT + '5-fast.png' })

// Compress the stamped plays into runs of one phrase. A single cycle is ~3
// plays of one text; a doubled cycle is ~6. So the doubling question is simply:
// how many runs are >= 5 plays long?
const doubleRate = (plays) => {
  const runs = []
  for (const p of plays) {
    const text = p.src
    if (!text || /\u2588|\u258C|Getting|Ready when/.test(text)) continue  // loading chrome
    const last = runs[runs.length - 1]
    if (last && last.text === text) last.n++
    else runs.push({ text, n: 1 })
  }
  const doubled = runs.filter(r => r.n >= 5).length
  const single = runs.filter(r => r.n >= 2 && r.n <= 4).length
  return { runs, doubledRuns: doubled, singleRuns: single, n: plays.length }
}
const easyStat = doubleRate(easyPlays)
const fastStat = doubleRate(fastPlays)
const brief = (s) => ({ plays: s.n, doubledRuns: s.doubledRuns, singleRuns: s.singleRuns, runs: s.runs.map(r => `${r.n}x ${r.text.slice(0, 24)}`) })
console.log('EASY  ', JSON.stringify(brief(easyStat)))
console.log('FAST  ', JSON.stringify(brief(fastStat)))
writeFileSync(OUT + 'plays.json', JSON.stringify({ base: BASE, easy: easyStat, fast: fastStat }, null, 2))
await browser.close()
