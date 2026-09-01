// UPFRONT-DOWNLOAD BUDGET PROBE (2026-09-01).
//
// THE QUESTION: for a BRAND-NEW learner on a phone — fresh device, no service
// worker, no IndexedDB, no offline mirror, never signed in, never opted into
// Offline Mode — how much audio does the app pull down before and shortly
// after the first cycle plays?
//
// WHY IT EXISTS: until 2026-09-01 the automatic rolling filler spliced
// collectAllListeningAudioIds() into its very first warm, which fires on
// rounds-loaded, BEFORE a single cycle has played. That is the whole listening
// corpus — ~2,401 clips / ~100 MB on spa_for_eng — fetched upfront to every
// learner. Tom's phone showed "92 MB downloaded for offline" in Settings for a
// scenario that should have been a handful of MB. Commit 43f89cf0 removed the
// corpus collector from the automatic path and put a required
// `offlineModeOptIn` gate in front of the bulk downloader.
//
// TWO INDEPENDENT MEASUREMENTS, both reported, neither an estimate:
//
//   (1) WIRE BYTES — CDP Network.loadingFinished.encodedDataLength summed per
//       response, over a fresh profile with the HTTP cache cleared. This is
//       the actual number of bytes that crossed the network, not a
//       Content-Length guess and not a count of files multiplied by an assumed
//       clip size. Split into: audio bytes at the moment the first lesson
//       cycle became audible, and audio bytes at T+WINDOW_MS of play.
//
//   (2) THE SETTINGS NUMBER — SettingsScreen.vue:2365 renders
//       "{{ downloadedMb }} MB downloaded for offline" from
//       getAudioCache().stats().persistent.bytes. This probe reads the SAME
//       source directly out of IndexedDB ('ssi-audio-cache-v2' → store 'audio',
//       summing row.size where lifecycle === 'persistent'), so the figure is
//       the one a learner would literally see on that screen — reached without
//       having to drive the overlay open. The ephemeral tier is reported
//       alongside it so nothing is hidden by the tier split.
//
// FIRST-AUDIBLE DETECTION is the same trustworthy hook the first-play latency
// probe uses: HTMLMediaElement.prototype.play is patched at document-start and
// a timeupdate listener fires only once currentTime genuinely advances past
// 0.05s. A resolved play() promise is NOT accepted as proof of sound.
//
// Usage:
//   BASE_URL=https://staging.saysomethingin.app COURSE=spa_for_eng \
//   WINDOW_MS=60000 node e2e/upfront-download-budget-probe.mjs

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { chromium } from '@playwright/test'

const LIB_PATHS = [
  `${homedir()}/.ssi-sentinel-libs`,
  `${homedir()}/.pwlibs/root/usr/lib/x86_64-linux-gnu`,
  `${homedir()}/cslibs/root/usr/lib/x86_64-linux-gnu`,
]
const existingLib = LIB_PATHS.find((p) => existsSync(p))
if (existingLib) process.env.LD_LIBRARY_PATH = `${existingLib}:${process.env.LD_LIBRARY_PATH || ''}`
const CHROME_PATH = process.env.CHROME_BIN || execSync(
  `ls ${homedir()}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -1`
).toString().trim()

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const COURSE = process.env.COURSE || 'spa_for_eng'
const WINDOW_MS = Number(process.env.WINDOW_MS || 60000)
const BUDGET_MS = Number(process.env.BUDGET_MS || 120000)
const OUT = process.env.OUT_DIR || `${process.env.CS_SCRATCH || '/tmp'}/upfront-budget/`
mkdirSync(OUT, { recursive: true })

// iPhone 13 — a real mobile device profile (UA, viewport, DPR, touch).
const IPHONE = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

const instrument = () => {
  window.__t0 = performance.now()
  window.__audio = { firstLessonAudible: null, firstLessonSrc: null, srcs: [] }
  const isLesson = (src) => !!src && !/welcome|brand|placeholder|silent|keepalive|data:/i.test(src)
  const watch = (el) => {
    if (el.__ssiWatched) return
    el.__ssiWatched = true
    el.addEventListener('timeupdate', () => {
      const src = String(el.src || el.currentSrc || '')
      if (el.currentTime <= 0.05) return
      if (isLesson(src) && window.__audio.firstLessonAudible === null) {
        window.__audio.firstLessonAudible = performance.now()
        window.__audio.firstLessonSrc = src.slice(0, 200)
      }
    })
  }
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    window.__audio.srcs.push({ t: Math.round(performance.now()), src: String(this.src || this.currentSrc || '(nosrc)').slice(0, 160) })
    watch(this)
    return origPlay.apply(this, args)
  }
}

// Exactly what SettingsScreen renders: AudioCache.stats(), read from the DB.
const readCacheStats = async () => {
  return await new Promise((resolve) => {
    const req = indexedDB.open('ssi-audio-cache-v2')
    req.onerror = () => resolve({ error: 'open failed' })
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('audio')) return resolve({ persistentBytes: 0, persistentCount: 0, ephemeralBytes: 0, ephemeralCount: 0, note: 'no audio store' })
      const tx = db.transaction('audio', 'readonly')
      const out = { persistentBytes: 0, persistentCount: 0, ephemeralBytes: 0, ephemeralCount: 0 }
      const cur = tx.objectStore('audio').openCursor()
      cur.onsuccess = (e) => {
        const c = e.target.result
        if (!c) return resolve(out)
        const row = c.value
        if (row.lifecycle === 'persistent') { out.persistentCount++; out.persistentBytes += (row.size || 0) }
        else { out.ephemeralCount++; out.ephemeralBytes += (row.size || 0) }
        c.continue()
      }
      cur.onerror = () => resolve(out)
    }
  })
}

const isAudio = (u) => /\/api\/audio\//.test(u) || /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(u) || /audio/i.test(new URL(u, BASE).pathname)

async function main() {
  const profile = `${OUT}profile-${Date.now()}`
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_PATH || undefined,
    ...IPHONE,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
  })
  const page = ctx.pages()[0] || (await ctx.newPage())
  await page.addInitScript(instrument)

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.clearBrowserCache')

  // requestId → url, so loadingFinished's encodedDataLength can be attributed.
  const urlById = new Map()
  const responses = [] // { t, url, bytes, audio }
  let navAt = Date.now()
  cdp.on('Network.requestWillBeSent', (e) => urlById.set(e.requestId, e.request.url))
  cdp.on('Network.responseReceived', (e) => urlById.set(e.requestId, e.response.url))
  cdp.on('Network.loadingFinished', (e) => {
    const url = urlById.get(e.requestId)
    if (!url || !/^https?:/.test(url)) return
    let audio = false
    try { audio = isAudio(url) } catch { /* ignore */ }
    responses.push({ t: Date.now() - navAt, url: url.slice(0, 200), bytes: e.encodedDataLength || 0, audio })
  })

  const consoleLines = []
  page.on('console', (m) => consoleLines.push(`${Date.now() - navAt}ms [${m.type()}] ${m.text().slice(0, 200)}`))

  navAt = Date.now()
  await page.goto(`${BASE}/?course=${COURSE}`, { waitUntil: 'commit' })

  const emptiness = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => [])
    const dbs = (await indexedDB.databases?.().catch(() => [])) || []
    return { swCount: regs.length, dbs: dbs.map((d) => d.name), localStorageKeys: Object.keys(localStorage).length }
  }).catch(() => ({ error: 'unavailable' }))

  // Tap the transport — starting a lesson is a deliberate learner gesture.
  const centre = page.locator('.center-btn').first()
  const pressDeadline = Date.now() + BUDGET_MS
  let pressedAt = null
  let stallReason = null
  try {
    await centre.waitFor({ state: 'visible', timeout: Math.max(0, pressDeadline - Date.now()) })
    while (Date.now() < pressDeadline) {
      const disabled = await centre.evaluate((el) => el.classList.contains('is-disabled')).catch(() => true)
      if (!disabled) break
      await page.waitForTimeout(100)
    }
    await centre.click({ timeout: 8000, force: true })
    pressedAt = Date.now() - navAt
  } catch (e) {
    stallReason = `press-failed: ${String(e).slice(0, 200)}`
  }

  // Wait for genuine first audible.
  let firstAudibleAt = null
  const audibleDeadline = Date.now() + BUDGET_MS
  while (Date.now() < audibleDeadline) {
    const a = await page.evaluate(() => window.__audio).catch(() => null)
    if (a?.firstLessonAudible != null) { firstAudibleAt = Date.now() - navAt; break }
    await page.waitForTimeout(200)
  }
  const bytesAtFirstAudible = firstAudibleAt == null ? null : responses.filter((r) => r.t <= firstAudibleAt)
  const cacheAtFirstAudible = await page.evaluate(readCacheStats).catch(() => null)

  // Keep playing for the observation window.
  const windowEnd = (firstAudibleAt ?? (Date.now() - navAt)) + WINDOW_MS
  while (Date.now() - navAt < windowEnd) await page.waitForTimeout(500)
  const windowMark = Date.now() - navAt

  const cacheAtWindow = await page.evaluate(readCacheStats).catch(() => null)
  const audioState = await page.evaluate(() => window.__audio).catch(() => null)

  const sum = (rows, pred = () => true) => rows.filter(pred).reduce((a, r) => a + r.bytes, 0)
  const mb = (b) => Math.round((b / 1e6) * 100) / 100

  const report = {
    probe: 'upfront-download-budget',
    ranAt: new Date().toISOString(),
    base: BASE,
    course: COURSE,
    deviceProfile: 'iPhone 13 (UA/viewport/DPR/touch), Chromium',
    buildNumber: await page.evaluate(() => fetch('/version.json').then((r) => r.json()).then((j) => j.buildNumber).catch(() => null)),
    freshness: emptiness,
    stallReason,
    timeline: { pressedAtMs: pressedAt, firstAudibleAtMs: firstAudibleAt, windowEndMs: windowMark, observationWindowMs: WINDOW_MS },
    firstLessonSrc: audioState?.firstLessonSrc || null,
    lessonPlayCalls: audioState?.srcs?.length ?? null,
    wireBytes: {
      method: 'CDP Network.loadingFinished.encodedDataLength, fresh profile, HTTP cache cleared',
      atFirstAudible: bytesAtFirstAudible == null ? null : {
        audioMB: mb(sum(bytesAtFirstAudible, (r) => r.audio)),
        audioRequests: bytesAtFirstAudible.filter((r) => r.audio).length,
        totalMB: mb(sum(bytesAtFirstAudible)),
      },
      atWindowEnd: {
        audioMB: mb(sum(responses, (r) => r.audio)),
        audioRequests: responses.filter((r) => r.audio).length,
        totalMB: mb(sum(responses)),
      },
    },
    settingsNumber: {
      method: "IndexedDB 'ssi-audio-cache-v2'/'audio' summed by lifecycle — the same source as SettingsScreen's '{n} MB downloaded for offline'",
      atFirstAudible: cacheAtFirstAudible && {
        downloadedForOfflineMB: Math.round((cacheAtFirstAudible.persistentBytes || 0) / 1e6),
        persistentBytes: cacheAtFirstAudible.persistentBytes,
        persistentCount: cacheAtFirstAudible.persistentCount,
        ephemeralMB: mb(cacheAtFirstAudible.ephemeralBytes || 0),
        ephemeralCount: cacheAtFirstAudible.ephemeralCount,
      },
      atWindowEnd: cacheAtWindow && {
        downloadedForOfflineMB: Math.round((cacheAtWindow.persistentBytes || 0) / 1e6),
        persistentBytes: cacheAtWindow.persistentBytes,
        persistentCount: cacheAtWindow.persistentCount,
        ephemeralMB: mb(cacheAtWindow.ephemeralBytes || 0),
        ephemeralCount: cacheAtWindow.ephemeralCount,
      },
    },
    topAudioHosts: Object.entries(responses.filter((r) => r.audio).reduce((acc, r) => {
      const h = new URL(r.url).host; acc[h] = (acc[h] || 0) + r.bytes; return acc
    }, {})).map(([h, b]) => ({ host: h, mb: mb(b) })).sort((a, b) => b.mb - a.mb),
  }

  const stamp = Date.now()
  writeFileSync(`${OUT}report-${stamp}.json`, JSON.stringify(report, null, 2))
  writeFileSync(`${OUT}responses-${stamp}.json`, JSON.stringify(responses, null, 2))
  writeFileSync(`${OUT}console-${stamp}.log`, consoleLines.join('\n'))
  console.log(JSON.stringify(report, null, 2))
  console.error(`\nartifacts: ${OUT}report-${stamp}.json`)
  await ctx.close()
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1) })
