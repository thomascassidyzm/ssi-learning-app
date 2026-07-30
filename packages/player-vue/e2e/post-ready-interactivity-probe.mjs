// POST-READY INTERACTIVITY PROBE (founder ruling 2026-07-30: READY must mean
// INTERACTIVE, not painted).
//
// After the course-switch READY round (5272b81c), the deferred whole-course
// generateScript walk fires the instant READY paints — this probe measures
// whether that burst leaves the UI unresponsive right after READY, against a
// DEPLOYED build:
//
//   1. LONG TASKS: PerformanceObserver('longtask') — every main-thread task
//      >50ms in the 5s window after READY paints, per switch. Total blocked
//      time + max single task are the headline numbers.
//   2. RAPID-TAP PLAY: the instant READY paints (in-page rAF watcher →
//      exposed binding), a REAL input event (CDP Input.dispatchMouseEvent —
//      goes through the browser input queue, so a busy main thread delays it
//      exactly like a real finger) taps the play button. Input latency =
//      dispatch → capture-phase listener fires. The founder test: tap play
//      the INSTANT it looks ready and it must fire.
//   3. RAPID-TAP DROPDOWN: same, tapping the course name — measures
//      dispatch → click processed AND → course chooser actually open.
//
// CPU is throttled 4x (CDP) to emulate a mid-range phone — the dead zone is
// main-thread work, so an unthrottled desktop hides it.
//
// Usage: BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//        node e2e/post-ready-interactivity-probe.mjs
// Env: CPU=4 (throttle rate), THROTTLE=1 (adds 150ms-RTT network emulation)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/post-ready-interactivity/'
const CPU_RATE = Number(process.env.CPU || 4)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE })
console.log(`[probe] CPU throttled ${CPU_RATE}x`)
if (process.env.THROTTLE) {
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150,
    downloadThroughput: 8 * 1024 * 1024 / 8,
    uploadThroughput: 2 * 1024 * 1024 / 8,
  })
  console.log('[probe] network throttled: 150ms RTT, 8/2 Mbps')
}

// Return-user stamp (300ms splash floor — the founder's real conditions) +
// in-page instrumentation: long-task observer and a capture-phase click
// listener that timestamps when input is actually PROCESSED.
await page.addInitScript(() => {
  try { localStorage.setItem('ssi-has-played', 'true') } catch {}
  const probe = { longTasks: [], clicks: [], readyAt: null }
  ;window.__probe = probe
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) probe.longTasks.push({ start: e.startTime, dur: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  } catch { /* longtask unsupported — totals will read 0 */ }
  document.addEventListener('click', () => { probe.clicks.push(performance.now()) }, { capture: true })
})

// In-page READY watcher: rAF-polls for belt-badge visibility (the same
// isPlayerReady signal the waterfall probe uses), stamps readyAt, calls the
// exposed binding so Node can fire the tap with minimal delay.
let onReadyResolve = null
await page.exposeFunction('__probeReadyFired', () => { onReadyResolve?.() })
// READY on a switch = badge visible AND the course name shows the NEW course
// (the old course's badge is still painted when the switch starts, so badge
// alone fires instantly — the name change is what marks the new mount ready).
const armReadyWatcher = (nameFragment) => page.evaluate((frag) => {
  ;window.__probe.readyAt = null
  const tick = () => {
    const badge = document.querySelector('.belt-badge')
    const name = (document.querySelector('.course-name--tappable')?.textContent || '').toLowerCase()
    if (badge && badge.offsetParent !== null && name.includes(frag.toLowerCase())) {
      ;window.__probe.readyAt = performance.now()
      ;window.__probeReadyFired()
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}, nameFragment)

const cdpTap = async (x, y) => {
  const t0 = Date.now()
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return t0
}

// Pull the probe data once the thread frees up. Correlates the tap with the
// in-page clock: clickProcessedAt (perf.now) - readyAt, plus Node-side
// wall-clock dispatch→observed-effect.
const readProbe = () => page.evaluate(() => {
  const p = window.__probe
  return { longTasks: p.longTasks.slice(), clicks: p.clicks.slice(), readyAt: p.readyAt }
})

const WINDOW_MS = 15000 // must cover the whole deferred burst (rIC ceiling 2s + walk)
const reportWindow = (label, probeData) => {
  const { readyAt, longTasks } = probeData
  const win = longTasks.filter((t) => t.start + t.dur > readyAt && t.start < readyAt + WINDOW_MS)
  const blocked = Math.round(win.reduce((s, t) => s + Math.min(t.start + t.dur, readyAt + WINDOW_MS) - Math.max(t.start, readyAt), 0))
  const maxTask = Math.round(win.reduce((m, t) => Math.max(m, t.dur), 0))
  console.log(`\n── ${label}: post-READY ${WINDOW_MS / 1000}s window ──`)
  console.log(`  long tasks: ${win.length} | total blocked: ${blocked}ms | max single task: ${maxTask}ms`)
  for (const t of win.sort((a, b) => a.start - b.start)) {
    console.log(`    +${String(Math.round(t.start - readyAt)).padStart(5)}ms after READY: ${Math.round(t.dur)}ms task`)
  }
  return { count: win.length, blocked, maxTask }
}

const pickCourse = async (rowText) => {
  await page.locator('.course-name--tappable').first().click()
  await page.waitForSelector('.course-row', { timeout: 15000 })
  const row = page.locator(`.course-row:has-text("${rowText}")`).first()
  const hasVariants = await row.evaluate((el) => el.classList.contains('has-variants'))
  if (hasVariants) {
    await row.click()
    await page.waitForSelector('.course-row.variant', { timeout: 5000 })
    return page.locator('.course-row.variant').first()
  }
  return row
}

// ── PHASE 0: fresh boot → READY, settle ─────────────────────────────────────
console.log(`BASE = ${BASE}`)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
if (await page.locator('.course-row').count()) {
  const row = page.locator('.course-row:has-text("Spanish")').first()
  const hasVariants = await row.evaluate((el) => el.classList.contains('has-variants')).catch(() => false)
  await row.click()
  if (hasVariants) {
    await page.waitForSelector('.course-row.variant', { timeout: 5000 })
    await page.locator('.course-row.variant').first().click()
  }
}
await page.waitForSelector('.belt-badge', { timeout: 60000, state: 'visible' })
console.log('PHASE 0: booted → READY')
// Pre-compute tap targets while idle (evaluate would block during the burst).
const playBox = await page.locator('.center-btn').boundingBox()
const nameBox = await page.locator('.course-name--tappable').first().boundingBox()
if (!playBox || !nameBox) throw new Error('could not resolve tap targets')
const playXY = { x: playBox.x + playBox.width / 2, y: playBox.y + playBox.height / 2 }
const nameXY = { x: nameBox.x + nameBox.width / 2, y: nameBox.y + nameBox.height / 2 }
await page.waitForTimeout(10000) // let phase-0 background work fully drain

// ── PHASE 1: switch → rapid-tap PLAY at READY paint ─────────────────────────
{
  const readyFired = new Promise((r) => { onReadyResolve = r })
  const row = await pickCourse('Italian')
  await armReadyWatcher('Italian')
  const switchT0 = Date.now()
  await row.click()
  await readyFired
  console.log(`\n[phase 1] switch click → READY paint: ${Date.now() - switchT0}ms`)
  const dispatchT0 = await cdpTap(playXY.x, playXY.y)
  // Wait for the tap's effect: play engages (stop-glyph state) — bounded 15s.
  let playEngagedMs = null
  try {
    await page.waitForSelector('.center-btn.is-stop', { timeout: 15000 })
    playEngagedMs = Date.now() - dispatchT0
  } catch { /* never engaged — reported below */ }
  await page.waitForTimeout(WINDOW_MS + 1000) // let the long-task window fill + thread free
  const data = await readProbe()
  const stats = reportWindow('PHASE 1 (switch→Italian, tap play at READY)', data)
  const tapProcessed = data.clicks.filter((c) => c > data.readyAt)
  const inputLatency = tapProcessed.length ? Math.round(tapProcessed[0] - data.readyAt) : null
  console.log(`  tap dispatched at READY paint → click PROCESSED after ${inputLatency}ms (in-page clock)`)
  console.log(`  tap → play actually ENGAGED (stop state): ${playEngagedMs}ms ${playEngagedMs == null ? '— NEVER FIRED (FAIL)' : ''}`)
  console.log(`  verdict: ${inputLatency != null && inputLatency < 200 && playEngagedMs != null && stats.maxTask < 250 ? 'PASS' : 'DEAD ZONE'}`)
  void stats
  await page.screenshot({ path: `${OUT}phase1-after-tap.png` })
  // Stop playback for the next phase.
  if (playEngagedMs != null) { await page.locator('.center-btn').click().catch(() => {}); await page.waitForTimeout(1500) }
}

// ── PHASE 2: switch back → rapid-tap COURSE DROPDOWN at READY paint ─────────
{
  await page.waitForTimeout(8000)
  const readyFired = new Promise((r) => { onReadyResolve = r })
  const row = await pickCourse('Spanish')
  await armReadyWatcher('Spanish')
  const switchT0 = Date.now()
  await row.click()
  await readyFired
  console.log(`\n[phase 2] switch click → READY paint: ${Date.now() - switchT0}ms`)
  const dispatchT0 = await cdpTap(nameXY.x, nameXY.y)
  let chooserOpenMs = null
  try {
    await page.waitForSelector('.course-row', { timeout: 15000 })
    chooserOpenMs = Date.now() - dispatchT0
  } catch { /* never opened */ }
  await page.waitForTimeout(WINDOW_MS + 1000)
  const data = await readProbe()
  const stats = reportWindow('PHASE 2 (switch→Spanish, tap dropdown at READY)', data)
  const tapProcessed = data.clicks.filter((c) => c > data.readyAt)
  const inputLatency = tapProcessed.length ? Math.round(tapProcessed[0] - data.readyAt) : null
  console.log(`  tap dispatched at READY paint → click PROCESSED after ${inputLatency}ms (in-page clock)`)
  console.log(`  tap → course chooser OPEN: ${chooserOpenMs}ms ${chooserOpenMs == null ? '— NEVER OPENED (FAIL)' : ''}`)
  console.log(`  verdict: ${inputLatency != null && inputLatency < 200 && chooserOpenMs != null && chooserOpenMs < 1000 && stats.maxTask < 250 ? 'PASS' : 'DEAD ZONE'}`)
  void stats
  await page.screenshot({ path: `${OUT}phase2-after-tap.png` })
}

console.log('\n[done]')
await browser.close()
