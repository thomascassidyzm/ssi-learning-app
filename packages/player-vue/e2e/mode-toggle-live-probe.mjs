// LIVE VERIFICATION PROBE (2026-08-09) — read-only, against the deployed dev build.
// Records an ordered play log by hooking HTMLMediaElement.play() from outside the
// app (the dev bundle strips console.*), stamping each play with the on-screen
// known/target text at that instant.
//
//   SCENARIO=fast|easy|toggle node mode-live-probe.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const SCENARIO = process.env.SCENARIO || 'fast'
const OUT = `/home/tomcassidy/.tmpbig/modeprobe/${SCENARIO}/`
const SECONDS = Number(process.env.SECONDS || 300)
mkdirSync(OUT, { recursive: true })

const startMode = SCENARIO === 'fast' ? 'fast' : 'easy'

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))

await page.addInitScript((mode) => {
  try {
    localStorage.setItem('ssi-learning-mode', mode)
    localStorage.setItem('ssi-last-course', 'spa_for_eng')
  } catch { /* blocked */ }
  window.__plays = []
  window.__marks = []
  const txt = (sel) => {
    const el = document.querySelector(sel)
    return el ? (el.textContent || '').trim().slice(0, 120) : ''
  }
  const orig = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    try {
      window.__plays.push({
        t: Date.now(),
        src: this.src || this.currentSrc || '(nosrc)',
        rate: this.playbackRate,
        known: txt('.known-text') || txt('.hero-known'),
        target: txt('.target-text') || txt('.hero-target'),
      })
    } catch { /* never break playback */ }
    return orig.apply(this, a)
  }

  // The app logs an audio_play player_event carrying cycleType/cycleId/role.
  // Intercepting the outbound write gives an unambiguous typed play log that
  // does not depend on the stripped console channel.
  window.__events = []
  const grab = (url, body) => {
    try {
      if (typeof body !== 'string' || body.indexOf('audio_play') === -1) return
      window.__events.push({ t: Date.now(), url: String(url).slice(0, 120), body: body.slice(0, 40000) })
    } catch { /* ignore */ }
  }
  const of = window.fetch
  window.fetch = function (input, init) {
    try { grab(typeof input === 'string' ? input : input?.url, init?.body) } catch { /* ignore */ }
    return of.apply(this, arguments)
  }
  const os = XMLHttpRequest.prototype.send
  const oo = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function (b) { grab(this.__u, b); return os.apply(this, arguments) }

  // 200ms text sampler — an independent timeline of what the learner SEES,
  // so a text/audio desync would show as a mismatch against the play log.
  window.__text = []
  setInterval(() => {
    try {
      const k = txt('.known-text') || txt('.hero-known')
      const g = txt('.target-text') || txt('.hero-target') || txt('.pane-text-target')
      const last = window.__text[window.__text.length - 1]
      if (!last || last.k !== k || last.g !== g) window.__text.push({ t: Date.now(), k, g })
    } catch { /* ignore */ }
  }, 200)

  // Reach the Vue component that exposes setLearningMode, so the mid-round flip
  // is the real app call — no reload, no pause, no regeneration trigger.
  window.__findMode = () => {
    const root = document.querySelector('#app')?.__vue_app__?._instance
    const seen = new Set()
    let found = null
    const walkC = (inst) => {
      if (!inst || seen.has(inst) || found) return
      seen.add(inst)
      const ex = inst.exposed
      if (ex && typeof ex.setLearningMode === 'function') { found = inst; return }
      walkV(inst.subTree)
    }
    const walkV = (v) => {
      if (!v || found) return
      if (Array.isArray(v)) { v.forEach(walkV); return }
      if (v.component) walkC(v.component)
      if (v.suspense) walkV(v.suspense.activeBranch)
      if (Array.isArray(v.children)) v.children.forEach(walkV)
    }
    walkC(root)
    return found
  }
  window.__setMode = (m) => {
    const inst = window.__findMode()
    if (!inst) return { ok: false, reason: 'no exposed setLearningMode found' }
    inst.exposed.setLearningMode(m)
    window.__marks.push({ t: Date.now(), mode: m, playIndex: window.__plays.length })
    return { ok: true, playIndex: window.__plays.length, stored: localStorage.getItem('ssi-learning-mode') }
  }
}, startMode)

// Clean state, then land on a normal load with the mode pre-set.
await page.goto(BASE + '/?reset=1', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.locator('.mode-switch').first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(1500)

// Set the mode through the real control before starting.
const wantBtn = page.locator('.mode-switch-btn', { hasText: new RegExp(`^${startMode}$`, 'i') }).first()
let pressed = null
if (await wantBtn.count()) {
  await wantBtn.click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(500)
  pressed = await wantBtn.getAttribute('aria-pressed').catch(() => null)
}
await page.screenshot({ path: OUT + '1-resting.png' })

let clicked = null
for (const sel of ['.center-btn', '.play-surface', 'button:has-text("Start")', 'button:has-text("Continue")']) {
  const b = page.locator(sel).first()
  if (await b.count()) { try { await b.click({ timeout: 8000 }); clicked = sel; break } catch { /* next */ } }
}
console.log(JSON.stringify({ scenario: SCENARIO, startMode, ariaPressed: pressed, clicked }))

const t0 = Date.now()
const flips = []
// THE REAL USER PATH. The Easy/Fast control lives on the RESTING screen, so a
// learner switching "mid-session" taps pause, switches, and resumes. Driving it
// that way tests the whole path Tom actually walks — including resume() — and
// needs no reach into Vue internals (the instance walk this probe used before
// could not find the exposed setLearningMode and silently flipped nothing).
const uiFlip = async (mode) => {
  const before = await page.evaluate(() => window.__plays.length)
  await page.locator('.center-btn').first().click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const btn = page.locator('.mode-switch-btn', { hasText: new RegExp(`^${mode}$`, 'i') }).first()
  const visible = await btn.isVisible().catch(() => false)
  let pressed = null
  if (visible) {
    await btn.click({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(400)
    pressed = await btn.getAttribute('aria-pressed').catch(() => null)
  }
  await page.screenshot({ path: OUT + `flip-${mode}.png` })
  await page.locator('.center-btn').first().click({ timeout: 8000 }).catch(() => {})
  const stored = await page.evaluate(() => { try { return localStorage.getItem('ssi-learning-mode') } catch { return null } })
  const rec = { mode, visible, pressed, stored, atPlays: before, tOffsetS: Math.round((Date.now() - t0) / 1000) }
  await page.evaluate((m) => window.__marks.push({ t: Date.now(), mode: m, playIndex: window.__plays.length }), mode)
  flips.push(rec)
  console.log('\nFLIP', JSON.stringify(rec))
}

const plan = SCENARIO === 'toggle'
  ? [{ atPlays: 20, mode: 'fast' }, { atPlays: 48, mode: 'easy' }]
  : []
let planIdx = 0

while ((Date.now() - t0) / 1000 < SECONDS) {
  await page.waitForTimeout(3000)
  const n = await page.evaluate(() => window.__plays.length)
  if (planIdx < plan.length && n >= plan[planIdx].atPlays) {
    await uiFlip(plan[planIdx].mode)
    planIdx++
  }
  process.stdout.write(`\r  plays=${n} t=${Math.round((Date.now() - t0) / 1000)}s   `)
}
console.log('')
await page.screenshot({ path: OUT + '2-playing.png' })

const plays = await page.evaluate(() => window.__plays)
const marks = await page.evaluate(() => window.__marks)
const events = await page.evaluate(() => window.__events)
const textTimeline = await page.evaluate(() => window.__text)
const storedMode = await page.evaluate(() => { try { return localStorage.getItem('ssi-learning-mode') } catch { return null } })

const idOf = (s) => {
  if (!s || s.startsWith('data:')) return '(silence)'
  const m = s.match(/\/api\/audio\/([^/?#]+)/) || s.match(/([0-9a-f-]{20,})/i)
  return m ? m[1].slice(0, 8) : s.slice(-24)
}
const log = plays.map((p, i) => ({
  i, dt: i === 0 ? 0 : p.t - plays[i - 1].t, id: idOf(p.src), rate: p.rate, known: p.known, target: p.target,
}))

writeFileSync(OUT + 'raw.json', JSON.stringify({ scenario: SCENARIO, base: BASE, startMode, storedMode, clicked, flips, marks, pageErrors, log, events, textTimeline }, null, 2))
console.log(JSON.stringify({ scenario: SCENARIO, totalPlays: plays.length, audioPlayEvents: events.length, flips, storedMode, pageErrors: pageErrors.slice(0, 3) }, null, 2))
await browser.close()
