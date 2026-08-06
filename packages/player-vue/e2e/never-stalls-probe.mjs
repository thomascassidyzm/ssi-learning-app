// NEVER-STALLS PROBE — verifies f30f9d39/269d2d19 (Tom's ruling, 2026-08-06):
// "the player plays what it has — no single item can stall a session." Field
// report was Aran: German, item "with you", hard stop, only skip-FORWARD
// recovered, all practice for the item lost.
//
// This probe ACTIVELY INDUCES the exact class of failure the fix targets: it
// intercepts /api/audio/<id> in a real browser, picks a victim clip id (the
// 3rd distinct id the running session requests) and 404s every request for
// it forever — the closest live-network reproduction of "this one clip's
// resolve never comes good". Evidence bar:
//   - the victim id was actually requested and actually failed (probe is meaningful)
//   - /api/audio/<id> requests for OTHER (non-victim) ids continue AFTER the
//     victim's first failure — the session did not halt on it
//   - the on-screen known-text pane keeps changing (visible progression)
//   - the phase class on .hero-text-pane keeps cycling (prompt/speak/voice_1/voice_2)
//   - zero uncaught JS errors
//
//   PROBE_URL=https://staging.saysomethingin.app/ node e2e/never-stalls-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.PROBE_URL || 'https://staging.saysomethingin.app/'
const OUT = process.env.OUT_DIR || '/tmp/never-stalls-probe/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))

// ── sabotage: pick the 3rd distinct clip id requested and 404 it forever ────
const orderSeen = []
let victimId = null
const victimAttempts = []      // timestamps (ms since start) of failed victim requests
const nonVictimAfterFailure = [] // ids of OTHER clips requested after the first victim failure
const t0 = Date.now()

await ctx.route('**/api/audio/**', async (route) => {
  const url = route.request().url()
  const m = url.match(/\/api\/audio\/([^/?]+)/)
  const id = m ? decodeURIComponent(m[1]) : url

  if (!orderSeen.includes(id)) {
    orderSeen.push(id)
    if (orderSeen.length === 3 && !victimId) {
      victimId = id
      console.log('victim chosen (3rd distinct clip requested):', victimId)
    }
  }

  if (id === victimId) {
    victimAttempts.push(Date.now() - t0)
    console.log(`killing victim request #${victimAttempts.length} :: ${id}`)
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found (probe sabotage)' })
  }

  if (victimId && victimAttempts.length > 0) {
    nonVictimAfterFailure.push(id)
  }
  return route.fallback()
})

// ── go live, start playback ──────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
await page.waitForTimeout(3000)
let started = false
for (const sel of [
  'button:has-text("Ready when you are")',
  '.player-resting-state button',
  '.resting-cta',
  '.center-btn',
  '.bottom-nav .center-btn',
  'button:has-text("Start")',
]) {
  const el = page.locator(sel).first()
  if (await el.count()) {
    try { await el.click({ timeout: 5000 }); started = true; break } catch { /* try next */ }
  }
}
check('playback started', started)

// ── watch the session run through and past the sabotage ─────────────────
const knownTexts = new Set()
const phasesSeen = new Set()
for (let i = 0; i < 90; i++) {   // ~90s
  await page.waitForTimeout(1000)
  const txt = (await page.locator('.known-text').first().textContent().catch(() => '') || '').trim()
  if (txt) knownTexts.add(txt)
  const cls = (await page.locator('.hero-text-pane').first().getAttribute('class').catch(() => '') || '')
  for (const p of ['prompt', 'speak', 'voice_1', 'voice_2']) if (cls.includes(p)) phasesSeen.add(p)
  // stop early once we have strong evidence on both sides of the sabotage
  if (victimAttempts.length >= 2 && nonVictimAfterFailure.length >= 3 && knownTexts.size >= 3) break
}
await page.screenshot({ path: `${OUT}1-after-sabotage.png` })

check('a clip actually played before sabotage (session is real)', orderSeen.length >= 3, `ids seen: ${orderSeen.length}`)
check('victim id was chosen', !!victimId, victimId || '')
check('victim requests were actually killed (404)', victimAttempts.length >= 1, `${victimAttempts.length} kills`)
check(
  'session kept requesting OTHER clips after the victim failed (did not halt)',
  new Set(nonVictimAfterFailure).size >= 2,
  `${new Set(nonVictimAfterFailure).size} distinct non-victim ids after failure: ${[...new Set(nonVictimAfterFailure)].slice(0, 5).join(', ')}`,
)
check('on-screen known-text advanced (visible progression)', knownTexts.size >= 2, `${knownTexts.size} distinct texts seen`)
check('phase cycled through prompt/speak/voice_1/voice_2', phasesSeen.size >= 2, `phases seen: ${[...phasesSeen].join(', ')}`)
check('no uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
