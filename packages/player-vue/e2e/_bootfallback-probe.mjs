// BOOT-FALLBACK REPRODUCTION PROBE (2026-08-30)
// Verifies the reworked boot fallback against the built artifact served locally
// with /api/* proxied to production, on CDP Fast 3G.
//
// MODES:
//   fresh     — first-time visitor, empty everything. No fallback for any course
//               => the no-fallback wait must engage.
//   uncached  — returning learner (catalogue mirror + zho script cached) who opens
//               ?course=<other>. Global cache exists, per-course cache does not
//               => the no-fallback wait must STILL engage. (Tom's example.)
//   cached    — returning learner opening the course they have cached, network
//               dead => must fall back at ~2500ms, NOT wait 18s.
//   hang      — fresh visitor, courses request delayed past the long wait
//               => slow-connection notice, then automatic recovery when it lands.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { chromium } from '@playwright/test'

const LIB_PATHS = [`${homedir()}/.ssi-sentinel-libs`, `${homedir()}/.pwlibs/root/usr/lib/x86_64-linux-gnu`, `${homedir()}/cslibs/root/usr/lib/x86_64-linux-gnu`]
const lib = LIB_PATHS.find((p) => existsSync(p))
if (lib) process.env.LD_LIBRARY_PATH = `${lib}:${process.env.LD_LIBRARY_PATH || ''}`
const CHROME = process.env.CHROME_BIN || execSync(`ls ${homedir()}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -1`).toString().trim()

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const MODE = process.env.MODE || 'fresh'
const RUNS = Number(process.env.RUNS || 3)
const OUT = process.env.OUT_DIR || '/tmp/cs-d9af28e6-a221-4294-bd3b-ee71451a9dfe/bootfallback/'
const OTHER_COURSE = process.env.OTHER_COURSE || 'spa_for_eng'
mkdirSync(OUT, { recursive: true })

const FAST3G = { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 }
const DEAD  = { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 }

const AUDIO_HOOK = `
window.__ssiAudible = null
;(function () {
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    this.addEventListener('timeupdate', function h() {
      if (this.currentTime > 0.05 && !/silent|keepalive|data:audio/.test(this.src || '')) {
        if (window.__ssiAudible === null) window.__ssiAudible = performance.now()
        this.removeEventListener('timeupdate', h)
      }
    })
    return origPlay.apply(this, arguments)
  }
})()`

const LAUNCH = { executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }
const PERSIST = MODE === 'uncached' || MODE === 'cached'
const PROFILE = `${OUT}profile-${MODE}`
// storageState() carries localStorage and cookies but NOT IndexedDB, and the
// per-course script cache IS IndexedDB — so the returning-learner cohorts need
// a real persistent profile or they silently test the wrong thing.
const browser = PERSIST ? null : await chromium.launch(LAUNCH)
const persistentCtx = PERSIST ? await chromium.launchPersistentContext(PROFILE, LAUNCH) : null

// One warm run, unthrottled, to populate the caches the returning-learner modes need.
async function warmStorage(courseCode) {
  const ctx = persistentCtx
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?course=${courseCode}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.resting-state', { timeout: 60000 })
  // Tap play so the script cache for this course is actually written.
  await page.waitForTimeout(2000)
  try { await page.click('.center-btn', { timeout: 10000 }) } catch { /* may already be ready */ }
  await page.waitForTimeout(25000)
  const idb = await page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name)
    const scripts = await new Promise((res) => {
      const req = indexedDB.open('ssi-script-cache')
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('scripts')) return res(['<no scripts store>'])
        const all = db.transaction('scripts').objectStore('scripts').getAllKeys()
        all.onsuccess = () => res(all.result)
        all.onerror = () => res(['<err>'])
      }
      req.onerror = () => res(['<open err>'])
    })
    return { names, scripts, lastCourse: localStorage.getItem('ssi-last-course'), catalogue: (JSON.parse(localStorage.getItem('ssi-courses-catalogue-v1') || '[]')).length }
  })
  await page.close()
  return { idb }
}

const results = []
let warm = null
if (MODE === 'uncached' || MODE === 'cached') {
  console.error('warming caches for zho_for_eng (unthrottled)…')
  warm = await warmStorage('zho_for_eng')
  console.error('WARM STATE:', JSON.stringify(warm.idb))
}

for (let i = 1; i <= RUNS; i++) {
  const ctx = PERSIST ? persistentCtx : await browser.newContext()
  const page = await ctx.newPage()
  await page.addInitScript(AUDIO_HOOK)

  const logs = []
  page.on('console', (m) => logs.push({ t: Date.now(), type: m.type(), text: m.text() }))

  if (MODE === 'hang' || MODE === 'uncached' || MODE === 'cached') {
    // Delay the courses select past the long wait, then let it through.
    await page.route('**/rest/v1/courses*', async (route) => {
      await new Promise((r) => setTimeout(r, MODE === 'hang' ? 25000 : 30000))
      await route.continue()
    })
  }

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', FAST3G)

  const url = MODE === 'uncached' ? `${BASE}/?course=${OTHER_COURSE}` : `${BASE}/`
  const t0 = Date.now()
  const timeline = []
  const seen = { spinnerFirst: null, restingState: null, slowNotice: null, retryBtn: false, audible: null }

  await page.goto(url, { waitUntil: 'commit' }).catch(() => {})

  // Poll the DOM for the cue / mount / notice, once per 250ms for 45s.
  const deadline = t0 + 45000
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => ({
      spinner: !!document.querySelector('.center-btn-spinner'),
      bootLoader: !!document.querySelector('#app.app-loading, .app-boot-loading'),
      disabledPlay: !!document.querySelector('.center-btn.is-disabled'),
      resting: !!document.querySelector('.resting-state'),
      notice: !!document.querySelector('.slow-connection'),
      retry: !!document.querySelector('.slow-connection-retry'),
      audible: window.__ssiAudible,
    })).catch(() => null)
    if (!s) { await new Promise((r) => setTimeout(r, 250)); continue }
    timeline.push({ ms: Date.now() - t0, boot: s.bootLoader, spin: s.spinner, dis: s.disabledPlay, rest: s.resting, note: s.notice })
    if (s.spinner && seen.spinnerFirst === null) seen.spinnerFirst = Date.now() - t0
    if (s.resting && seen.restingState === null) seen.restingState = Date.now() - t0
    if (s.notice && seen.slowNotice === null) { seen.slowNotice = Date.now() - t0; seen.retryBtn = s.retry }
    if (s.audible && seen.audible === null) seen.audible = Math.round(s.audible)
    // Stop early once mounted AND (for hang mode) the notice has been and gone.
    if (seen.restingState !== null && MODE !== 'hang' && Date.now() - t0 > (seen.restingState + 6000)) break
    if (MODE === 'hang' && seen.slowNotice !== null && seen.restingState !== null) break
    if (MODE === 'hang') { if (s.notice) seen.noticeLastMs = Date.now() - t0 }
    await new Promise((r) => setTimeout(r, 250))
  }

  // Criterion (b): does it actually PLAY, not just mount?
  if (seen.restingState !== null) {
    try {
      await page.waitForSelector('.center-btn:not(.is-disabled)', { timeout: 30000 })
      await page.click('.center-btn')
      await page.waitForFunction(() => window.__ssiAudible !== null, { timeout: 45000 })
      seen.audible = Math.round(await page.evaluate(() => window.__ssiAudible))
    } catch (e) { seen.audible = 'NOT-HEARD: ' + String(e).slice(0, 60) }
  }

  // Spinner continuity: was a cue on screen for the whole pre-mount window?
  const cueGaps = await page.evaluate(() => window.__ssiCueGaps || null)

  const noFallbackWarn = logs.find((l) => l.text.includes('no cached fallback exists for this course'))
  const mirrorLog = logs.find((l) => l.text.includes('hydrated from offline mirror'))
  const budgetWarn = logs.find((l) => l.text.includes('exceeded its budget — falling back'))
  const recoverLog = logs.find((l) => l.text.includes('landed behind the notice'))
  const courseLog = logs.find((l) => l.text.startsWith('[App] Course:'))

  results.push({
    run: i, mode: MODE,
    firstCueMs: seen.spinnerFirst,
    mountedMs: seen.restingState,
    firstAudibleMs: seen.audible,
    slowNoticeMs: seen.slowNotice,
    retryButtonPresent: seen.retryBtn,
    longWaitEngaged: !!noFallbackWarn,
    longWaitAtMs: noFallbackWarn ? noFallbackWarn.t - t0 : null,
    fellBackToMirror: !!mirrorLog,
    mirrorAtMs: mirrorLog ? mirrorLog.t - t0 : null,
    budgetTimeoutLogged: !!budgetWarn,
    budgetTimeoutAtMs: budgetWarn ? budgetWarn.t - t0 : null,
    recoveredBehindNotice: !!recoverLog,
    recoveredAtMs: recoverLog ? recoverLog.t - t0 : null,
    courseResolved: courseLog ? courseLog.text : null,
    cueGaps,
    // Any poll where NOTHING on screen said "working": no inline boot loader,
    // no spinner in the transport — before the player mounted.
    cueGapMs: timeline.filter((r) => !r.boot && !r.spin && !r.rest).map((r) => r.ms),
    timelineFirsts: {
      bootLoaderLastMs: Math.max(-1, ...timeline.filter((r) => r.boot).map((r) => r.ms)),
      spinnerFirstMs: Math.min(Infinity, ...timeline.filter((r) => r.spin).map((r) => r.ms)),
      disabledPlayFirstMs: Math.min(Infinity, ...timeline.filter((r) => r.dis).map((r) => r.ms)),
    },
  })
  console.error(JSON.stringify(results[results.length - 1]))
  await page.screenshot({ path: `${OUT}${MODE}-run${i}.png` }).catch(() => {})
  if (PERSIST) await page.close(); else await ctx.close()
}

writeFileSync(`${OUT}${MODE}.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
if (PERSIST) await persistentCtx.close(); else await browser.close()
