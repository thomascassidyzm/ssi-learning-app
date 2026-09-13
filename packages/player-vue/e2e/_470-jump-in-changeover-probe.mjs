// Job #470: timing trace of pod dialogue changeovers in Immersion on a deployed
// or locally served build. Signs in by injecting a minted Supabase session,
// pins the course, opens Listening Mode → Dialogues → the requested scene of
// the requested pod group in Immersion, plays from the top, and records every
// HTMLMediaElement play/playing/ended event with performance.now() stamps.
// Then measures each changeover: gap = next clip's 'playing' − previous clip's
// 'ended' (negative = overlap), tagged with whether the next line is a jump-in
// (SCENE_JSON: [{n, speaker, jumpIn, text}] in playback order).
//
// Env: PROBE_URL, SESSION_JSON, SCENE_JSON, COURSE, SCENE, GROUP, OUT, TAG,
// CHROME_BIN, LISTEN_MS.
import { chromium } from '@playwright/test'
import fs from 'fs'

const URL = process.env.PROBE_URL || 'https://staging.saysomethingin.app/'
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const sceneRows = JSON.parse(fs.readFileSync(process.env.SCENE_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const COURSE = process.env.COURSE || 'ita_for_eng'
const SCENE = Number(process.env.SCENE || '1')
const GROUP = process.env.GROUP || 'Method'
const OUT = process.env.OUT || 'probe-470.json'
const TAG = process.env.TAG || 'probe'
const LISTEN_MS = Number(process.env.LISTEN_MS || '75000')

const ANALYSE = process.env.ANALYSE || ''
let out = { url: URL, course: COURSE, scene: SCENE, group: GROUP }
if (ANALYSE) {
  out = JSON.parse(fs.readFileSync(ANALYSE, 'utf8'))
} else {
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(({ ref, sess, course }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess))
  localStorage.setItem('ssi-last-course', course)
  localStorage.setItem('ssi-last-course-origin', 'chosen')
  localStorage.setItem('ssi-listening-mode', 'immersion')
  // Instrument every media element: which element, which event, when, what.
  window.__trace = []
  const ids = new WeakMap()
  let n = 0
  const rowText = () => document.querySelector('.listening-overlay .phrase-row.current .phrase-target')?.textContent.trim().slice(0, 60) ?? null
  const stamp = (el, ev) => window.__trace.push({
    el: ids.get(el), ev, t: performance.now(), silence: (el.src || '').startsWith('data:'),
    src: (el.src || '').replace(/^data:.*$/, 'data:').slice(0, 80), ct: el.currentTime, dur: el.duration, rate: el.playbackRate, row: rowText(),
  })
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (!ids.has(this)) {
      ids.set(this, ++n)
      for (const ev of ['playing', 'ended', 'pause', 'error']) this.addEventListener(ev, () => stamp(this, ev))
    }
    stamp(this, 'play')
    return origPlay.apply(this, arguments)
  }
}, { ref: REF, sess: session, course: COURSE })
const page = await ctx.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
const warns = []
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text().slice(0, 160)) })
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
const trig = page.locator('.mode-trigger').first()
out.modeTriggerFound = await trig.count()
if (out.modeTriggerFound) {
  await trig.click({ timeout: 5000 }).catch((e) => (out.trigError = String(e).slice(0, 150)))
  await page.waitForTimeout(1500)
  const listen = page.locator('.tray-item').filter({ hasText: /listen/i }).first()
  if (await listen.count()) await listen.click({ timeout: 5000 }).catch((e) => (out.listenError = String(e).slice(0, 150)))
  await page.locator('.scene-card, .scene-empty, .scene-list-wrap .error').first()
    .waitFor({ state: 'visible', timeout: 90000 }).catch((e) => (out.listWaitError = String(e).slice(0, 120)))
  await page.waitForTimeout(1000)
  // Since job #428 the Dialogues tab opens on one POD CARD per slot; tap the
  // requested pod's card to reach its scene list.
  const podCard = page.locator('.scene-card.pod-card').filter({ hasText: GROUP }).first()
  out.podCardFound = await podCard.count()
  if (out.podCardFound) {
    await podCard.click({ timeout: 5000 }).catch((e) => (out.podCardError = String(e).slice(0, 150)))
    await page.locator('.scene-card:not(.pod-card)').first().waitFor({ state: 'visible', timeout: 30000 }).catch((e) => (out.sceneWaitError = String(e).slice(0, 120)))
    await page.waitForTimeout(600)
  }
  out.groupHeadings = await page.locator('.scene-group-heading').allInnerTexts().catch(() => [])
  out.sceneCardFound = await page.evaluate(({ group, scene }) => {
    const card0 = document.querySelector('.scene-card:not(.pod-card)')
    const kids = [...(card0?.parentElement?.children || [])]
    let inGroup = !group
    for (const el of kids) {
      if (el.classList.contains('scene-group-heading')) { inGroup = el.textContent.includes(group); continue }
      if (inGroup && el.classList.contains('scene-card') && el.querySelector('.scene-card-num')?.textContent.trim() === String(scene)) {
        el.scrollIntoView(); el.click(); return 1
      }
    }
    return 0
  }, { group: GROUP, scene: SCENE })
  if (out.sceneCardFound) {
    await page.locator('.listening-overlay .phrase-row').first().waitFor({ state: 'visible', timeout: 30000 }).catch((e) => (out.rowsWaitError = String(e).slice(0, 120)))
    await page.waitForTimeout(800)
    out.rowCount = await page.locator('.listening-overlay .phrase-row').count()
    const immersionBtn = page.locator('.listening-overlay button', { hasText: /^Immersion$/ }).first()
    if (await immersionBtn.count()) await immersionBtn.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)
    // Play from the top: tap the first row.
    await page.locator('.listening-overlay .phrase-row').first().click({ timeout: 5000 }).catch((e) => (out.rowError = String(e).slice(0, 150)))
    await page.waitForTimeout(LISTEN_MS)
    await page.screenshot({ path: `${TAG}-end.png` }).catch(() => {})
    out.trace = await page.evaluate(() => window.__trace)
  }
}
out.jsErrors = jsErrors
out.warns = warns.slice(0, 20)
await browser.close()
}

// ── Changeovers ─────────────────────────────────────────────────────────
const trace = out.trace || []
// Real clips in the order they started sounding. Only the Listening overlay's
// elements count: the first real clip whose 'playing' fires after the first
// data: (silence / prime) play belongs to the overlay; anything before it is
// the main flow's element on boot.
// Overlay elements are the ones that ever play a data: clip (a silent gap or
// the jump-in element's prime); the main flow's element on boot never does.
const overlayEls = new Set(trace.filter((e) => e.ev === 'play' && e.silence).map((e) => e.el))
const clips = []
for (const e of trace) {
  if (!overlayEls.has(e.el)) continue
  if (e.ev === 'playing' && !e.silence) {
    const last = clips[clips.length - 1]
    // A 'playing' after a stall/seek on the same src+el is not a new clip.
    if (last && last.el === e.el && last.src === e.src && !last.ended) continue
    clips.push({ el: e.el, src: e.src, playingAt: e.t, row: e.row, dur: e.dur, rate: e.rate, ended: null, silenceAfter: 0 })
  } else if (e.ev === 'ended') {
    if (e.silence) { const last = clips[clips.length - 1]; if (last) last.silenceAfter++ ; continue }
    for (let i = clips.length - 1; i >= 0; i--) if (clips[i].el === e.el && clips[i].src === e.src && clips[i].ended === null) { clips[i].ended = e.t; break }
  }
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const byText = sceneRows.map((r) => ({ ...r, key: norm(r.text) }))
const findRow = (rowText) => {
  const k = norm(rowText)
  if (!k) return null
  return byText.find((r) => r.key === k) || byText.find((r) => r.key.startsWith(k.slice(0, 30)) || k.startsWith(r.key.slice(0, 30))) || null
}
// Immersion plays one target clip per row, top to bottom, so the k-th clip IS
// row k (the on-screen "current" row lags an early-started jump-in by design).
const rowOf = (i) => sceneRows[i] || null
const changeovers = []
for (let i = 1; i < clips.length; i++) {
  const prev = clips[i - 1], next = clips[i]
  const nextRow = rowOf(i)
  const prevRow = rowOf(i - 1)
  void findRow
  changeovers.push({
    from: prevRow ? `${prevRow.n} ${prevRow.speaker}` : prev.row,
    to: nextRow ? `${nextRow.n} ${nextRow.speaker}` : next.row,
    toText: (nextRow?.text || '').slice(0, 40),
    screenRowAtStart: (next.row || '').slice(0, 30),
    prevDurMs: prev.dur ? Math.round(prev.dur * 1000) : null,
    jumpIn: nextRow ? nextRow.jumpIn : null,
    speakerChange: prevRow && nextRow ? prevRow.speaker !== nextRow.speaker : null,
    gapMs: prev.ended != null ? Math.round(next.playingAt - prev.ended) : null,
    prevEl: prev.el, nextEl: next.el, silenceClipsBetween: prev.silenceAfter,
  })
}
out.clipCount = clips.length
out.changeovers = changeovers
const stats = (arr) => {
  const g = arr.map((c) => c.gapMs).filter((x) => x != null).sort((a, b) => a - b)
  if (!g.length) return null
  return { n: g.length, min: g[0], median: g[Math.floor(g.length / 2)], max: g[g.length - 1], mean: Math.round(g.reduce((a, b) => a + b, 0) / g.length) }
}
out.summary = {
  jumpIn: stats(changeovers.filter((c) => c.jumpIn === true)),
  turn: stats(changeovers.filter((c) => c.jumpIn === false)),
  unmatched: changeovers.filter((c) => c.jumpIn == null).length,
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log(JSON.stringify({ version: out.version, rows: out.rowCount, clips: out.clipCount, summary: out.summary, jsErrors: out.jsErrors, warns: (out.warns || []).slice(0, 6) }, null, 1))
