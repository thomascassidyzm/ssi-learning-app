// Verify: ?podview=1 (ita_for_eng, scene 1) plays the REGENERATED come-stai
// audio ids — not the retired English-/kʌm/ take (WORKLIST 07-23, re-verified
// 07-24). Intercepts every Audio.play() src and classifies the ids seen.
//
// IndexedDB is disabled in the page so the AudioCache always misses and every
// play streams via /api/audio/{id} — cached plays surface as opaque blob:
// URLs that hide the audio id (that made the first version of this check
// inconclusive).
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/verify-comestai-ids.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5174'
const COURSE = 'ita_for_eng'
const WATCH_MS = Number(process.env.WATCH_MS || 60_000)

// Ground truth from listening_pod_sentences ita_for_eng:pod-0:SC01-S002 (2026-07-24)
const NEW_TAKE = 'eadddadf-d661-4a5e-9502-b2115395b658' // full "Buongiorno. Come stai?"
const NEW_SLICE = '333929bc-7479-47c8-a7cd-bcb5c36ca0dc' // "Come stai?" slice
const NEW_SLICE_1 = 'd6502b3d-7f69-44e5-b8df-1d21a9dc8c7d' // "Buongiorno." slice
const OLD_BAD = ['5a9b2052', '3cbde8d2'] // retired English-/kʌm/ take+slice

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(() => {
  Object.defineProperty(window, 'indexedDB', { get() { return undefined } })
  window.__audioPlays = []
  const orig = Audio.prototype.play
  Audio.prototype.play = function (...args) {
    window.__audioPlays.push({ src: this.src || '(nosrc)', t: Date.now() })
    return orig.apply(this, args)
  }
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

const url = `${BASE}/?course=${COURSE}&podview=1`
console.log('Navigating to', url)
await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)

for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]', '.pane-play-hint']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); console.log('clicked', sel); break } catch { /* next */ } }
}

const deadline = Date.now() + WATCH_MS
let sawComestai = false
while (Date.now() < deadline && !sawComestai) {
  await page.waitForTimeout(2000)
  const plays = await page.evaluate(() => window.__audioPlays).catch(() => [])
  sawComestai = plays.some((p) => p.src.includes(NEW_TAKE) || p.src.includes(NEW_SLICE)
    || OLD_BAD.some((b) => p.src.includes(b)))
}

const plays = await page.evaluate(() => window.__audioPlays).catch(() => [])
console.log(`\n${plays.length} Audio.play() calls observed:`)
for (const p of plays) {
  const id = (p.src.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [p.src.slice(-40)])[0]
  let tag = ''
  if (p.src.includes(NEW_TAKE)) tag = '  <-- NEW take (Buongiorno. Come stai?)'
  if (p.src.includes(NEW_SLICE)) tag = '  <-- NEW slice (Come stai?)'
  if (p.src.includes(NEW_SLICE_1)) tag = '  <-- NEW slice (Buongiorno.)'
  if (OLD_BAD.some((b) => p.src.includes(b))) tag = '  ***** OLD BAD ENGLISH TAKE *****'
  console.log(' ', id, tag)
}
const playedOld = plays.some((p) => OLD_BAD.some((b) => p.src.includes(b)))
const playedNew = plays.some((p) => p.src.includes(NEW_TAKE) || p.src.includes(NEW_SLICE))
console.log(`\n${playedOld ? 'FAIL — old English take still plays' : playedNew ? 'PASS — regenerated Italian ids play, old take absent' : 'INCONCLUSIVE — come-stai sentence not reached in window'}`)
await page.screenshot({ path: '/tmp/verify-comestai.png' })
await browser.close()
process.exit(playedOld ? 1 : playedNew ? 0 : 2)
