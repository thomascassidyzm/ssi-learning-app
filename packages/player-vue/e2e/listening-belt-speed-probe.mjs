// LIVE PROBE — the two 2026-08-06 playback fixes, measured on the deployed app.
//
// (1) INTERJECTION CARD: force an interjection (?fc=1) and capture what the
//     hero card actually renders — does .interjection-display exist, are the
//     wave bars painted a colour that CONTRASTS with the card, and does the
//     card have any visible content at all. Also screenshots it.
//
// (2) LISTENING SPEED: wraps HTMLMediaElement.play in the page and records the
//     playbackRate ACTUALLY SET on the element at the moment each clip starts,
//     together with its src. That is the ground truth for "targ lang clips
//     start at 0.8x" — it measures what the learner hears, not what the
//     scheduler intended.
//
//   PROBE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app/ \
//   CHROME_BIN=<chromium> node e2e/listening-belt-speed-probe.mjs
//
// Options:
//   PROBE_COURSE=fra_for_eng   course (default fra_for_eng)
//   PROBE_SECONDS=420          how long to listen (default 420)
//   PROBE_SHOT=/tmp/shot.png   where to write the interjection screenshot
//
// Prints one JSON blob. Exit 1 if either check fails.
import { chromium } from '@playwright/test'

const URL_BASE = process.env.PROBE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app/'
const COURSE = process.env.PROBE_COURSE || 'fra_for_eng'
const SECONDS = Number(process.env.PROBE_SECONDS || 420)
const SHOT = process.env.PROBE_SHOT || '/tmp/interjection-card.png'

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const context = await browser.newContext({ viewport: { width: 430, height: 900 } })
const page = await context.newPage()

const jsErrors = []
const commentaryLogs = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('Playing') && t.includes('commentary')) commentaryLogs.push(t.slice(0, 160))
  if (t.includes('[LearningPlayer] Playing instruction') || t.includes('[LearningPlayer] Playing encouragement')) {
    commentaryLogs.push(t.slice(0, 160))
  }
})

// Record the rate actually set on the element at play() time, before app code.
await page.addInitScript(() => {
  window.__rates = []
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    try {
      const src = this.currentSrc || this.src || ''
      if (src && !src.startsWith('data:audio/wav')) {
        window.__rates.push({ t: Date.now(), src, rate: this.playbackRate })
      }
    } catch { /* never break playback to measure it */ }
    return origPlay.apply(this, args)
  }
})

const go = async (params) => {
  const u = new global.URL(URL_BASE)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 })
  return u.toString()
}

// No ?reset=1 — a fresh Playwright context already has empty
// localStorage/IndexedDB, and the reset path tears down the service worker and
// reloads out from under the probe (observed: browser context closed).
// ?fc=1 = force an interjection at every round boundary.
const liveUrl = await go({ course: COURSE, fc: '1' })
// The app boots, resolves the course and renders the transport; under ~15s it
// genuinely isn't on screen yet and every selector misses silently.
await page.waitForSelector('.center-btn', { timeout: 60000 }).catch(() => {})
await page.waitForTimeout(3000)

const clicked = []
const tryClick = async (sel) => {
  const el = page.locator(sel).first()
  if (await el.count()) {
    await el.click({ timeout: 4000 }).catch(() => {})
    clicked.push(sel)
    return true
  }
  return false
}
// .center-btn is the real transport play button (live recon 2026-08-07);
// 'Ready when you are' is the hero card's text, not a button.
for (const sel of ['.center-btn', '.play-button', 'button[aria-label*="lay"]']) {
  if (await tryClick(sel)) break
}

// ── Watch for the interjection card ────────────────────────────────────────
let card = null
let died = null
const rateSnapshot = []
const deadline = Date.now() + SECONDS * 1000
// A browser killed by memory pressure must still yield what was measured,
// rather than throwing away the whole run.
try {
while (Date.now() < deadline && !card) {
  await page.waitForTimeout(1200)
  card = await page.evaluate(() => {
    const disp = document.querySelector('.interjection-display')
    if (!disp) return null
    const glass = document.querySelector('.hero-glass')
    const bar = document.querySelector('.interjection-wave .wbar')
    const cap = document.querySelector('.interjection-caption')
    const cs = (el) => (el ? getComputedStyle(el) : null)
    const rgb = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s || '')
      if (!m) return null
      const [r, g, b] = m[1].split(',').map((n) => parseFloat(n))
      return { r, g, b }
    }
    // Relative luminance, for a real contrast number against the card.
    const lum = (c) => {
      if (!c) return null
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const barBg = rgb(cs(bar)?.backgroundColor)
    const glassBg = rgb(cs(glass)?.backgroundColor)
    const lb = lum(barBg), lg = lum(glassBg)
    const contrast = (lb != null && lg != null)
      ? +(((Math.max(lb, lg) + 0.05) / (Math.min(lb, lg) + 0.05)).toFixed(2))
      : null
    return {
      classes: disp.className,
      bars: document.querySelectorAll('.interjection-wave .wbar').length,
      barBackground: cs(bar)?.backgroundColor || null,
      barWidthPx: bar ? bar.getBoundingClientRect().width : 0,
      barHeightPx: bar ? bar.getBoundingClientRect().height : 0,
      cardBackground: cs(glass)?.backgroundColor || null,
      barVsCardContrast: contrast,
      captionText: cap ? cap.textContent.trim() : null,
      captionColor: cap ? cs(cap).color : null,
      cardText: (document.querySelector('.hero-glass')?.innerText || '').trim(),
    }
  })
  if (card) {
    await page.locator('.hero-glass').first().screenshot({ path: SHOT }).catch(() => {})
  }
  const snap = await page.evaluate(() => window.__rates).catch(() => null)
  if (snap) { rateSnapshot.length = 0; rateSnapshot.push(...snap) }
}
} catch (e) { died = String(e).slice(0, 160) }

// ── Keep listening so a Layer-1 cup / pod lap lands ─────────────────────────
const listenUntil = Date.now() + Math.max(60_000, (SECONDS * 1000) / 2)
let last = 0
try {
  while (!died && Date.now() < listenUntil) {
    await page.waitForTimeout(10000)
    const snap = await page.evaluate(() => window.__rates)
    rateSnapshot.length = 0; rateSnapshot.push(...snap)
    if (snap.length === last) await tryClick('.center-btn')
    last = snap.length
  }
} catch (e) { died = died || String(e).slice(0, 160) }

const rates = rateSnapshot
await browser.close().catch(() => {})

const tally = {}
for (const r of rates) tally[r.rate] = (tally[r.rate] || 0) + 1

const cardOk = !!card && card.bars === 5 && (card.barVsCardContrast ?? 0) >= 1.6
const distinctRates = Object.keys(tally).map(Number).sort((a, b) => a - b)

console.log(JSON.stringify({
  url: liveUrl,
  course: COURSE,
  interjection: {
    ok: cardOk,
    seen: !!card,
    screenshot: card ? SHOT : null,
    ...card,
  },
  speed: {
    clipsPlayed: rates.length,
    ratesSeen: distinctRates,
    rateHistogram: tally,
    sample: rates.slice(0, 25).map((r) => ({
      rate: r.rate,
      clip: (() => { try { return new global.URL(r.src).pathname } catch { return r.src } })(),
    })),
  },
  browserDied: died,
  commentaryLogs: commentaryLogs.slice(0, 10),
  jsErrors: jsErrors.slice(0, 5),
  clicked,
}, null, 2))

process.exit(cardOk ? 0 : 1)
