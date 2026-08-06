// GERMAN STALE-AUDIO PROBE — live diagnosis, production.
//
// The server chain is already PROVEN correct (bundle returns 366 `<uuid>.vN`
// refs; /api/audio/<uuid>.v2 and /api/audio/<bare-uuid> both serve the
// repaired bytes). So if Tom hears old German audio, a CLIENT path must be
// building a BARE `<uuid>` URL from a source that bypassed the revision map,
// and that bare id is hitting either a pre-repair IndexedDB AudioCache row or
// the browser HTTP cache (max-age=31536000, immutable).
//
// This probe gets the decisive evidence from a real browser against prod:
//
//   PASS A — clean profile, into German, play. Record EVERY /api/audio/ ref
//            and EVERY IndexedDB read of the audio store (key + hit/miss).
//   PASS B — reload the SAME context (caches now warm — Tom's device state).
//            Same recording. Does the reload still ask for versioned refs, and
//            is any revised clip served from IndexedDB under a BARE uuid?
//
// Output: /tmp/german-stale-audio/refs.json — every ref, per pass, per source
// (network / idb / audio-element), for classification against
// course_audio.audio_revision.
//
// Usage: BASE_URL=https://saysomethingin.app node e2e/german-stale-audio-probe.mjs
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'https://saysomethingin.app'
const OUT = process.env.OUT_DIR || '/tmp/german-stale-audio/'
const PLAY_MS = Number(process.env.PLAY_MS || 90_000)
mkdirSync(OUT, { recursive: true })

// This machine's default headless shell (1208) is missing libnspr4; the 1234
// build carries its own deps. Same override the offline probes use.
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

// Return-user stamp so the splash floor is 300ms, not 2800ms.
await page.addInitScript(() => {
  try { localStorage.setItem('ssi-has-played', 'true') } catch {}
})

// ── in-page instrumentation ────────────────────────────────────────────────
// 1. IndexedDB reads of the audio cache store, with hit/miss.
// 2. Every src assigned to an <audio> element (catches blob: playback).
await page.addInitScript(() => {
  window.__idbAudioReads = []
  window.__audioSrcs = []

  const origGet = IDBObjectStore.prototype.get
  IDBObjectStore.prototype.get = function (key) {
    const req = origGet.apply(this, arguments)
    try {
      if (this.name === 'audio' && this.transaction?.db?.name === 'ssi-audio-cache-v2') {
        const entry = { key: String(key), hit: null, t: Math.round(performance.now()) }
        window.__idbAudioReads.push(entry)
        req.addEventListener('success', () => { entry.hit = !!req.result })
      }
    } catch { /* never break the app */ }
    return req
  }

  // Audio element src — covers both proxy URLs and blob: URLs from the cache.
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
  if (desc?.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...desc,
      set(v) { try { window.__audioSrcs.push({ src: String(v).slice(0, 300), t: Math.round(performance.now()) }) } catch {} return desc.set.call(this, v) },
    })
  }
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    try { window.__audioSrcs.push({ src: 'PLAY:' + String(this.src || this.currentSrc || '(none)').slice(0, 300), t: Math.round(performance.now()) }) } catch {}
    return origPlay.apply(this, a)
  }
})

// ── network recorder ───────────────────────────────────────────────────────
let netAudio = []
const otherApi = []
page.on('response', async (res) => {
  const url = res.url()
  if (url.includes('/api/audio/')) {
    const ref = decodeURIComponent(url.split('/api/audio/')[1].split('?')[0])
    netAudio.push({
      ref,
      status: res.status(),
      fromCache: res.request().timing?.().responseEnd === undefined ? null : null,
      len: res.headers()['content-length'] || null,
      etag: res.headers()['etag'] || null,
    })
  } else if (/\/api\/courses\/[^/]+\/(bundle|cycles|infplay-cycles)/.test(url)) {
    otherApi.push({ url: url.slice(0, 200), status: res.status() })
  }
})

const consoleLines = []
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') consoleLines.push(`[${m.type()}] ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => consoleLines.push('[pageerror] ' + e.message.slice(0, 300)))

const courseNameText = async () =>
  ((await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || '').trim()

const pickGerman = async () => {
  // Selector may already be open on first run; otherwise tap the course name.
  if (!(await page.locator('.course-row').count())) {
    await page.locator('.course-name--tappable').first().click({ timeout: 15000 })
    await page.waitForSelector('.course-row', { timeout: 15000 })
  }
  const row = page.locator('.course-row:has-text("German")').first()
  if (!(await row.count())) throw new Error('GAP: no German course row in the selector')
  const hasVariants = await row.evaluate((el) => el.classList.contains('has-variants')).catch(() => false)
  await row.click()
  if (hasVariants) {
    await page.waitForSelector('.course-row.variant', { timeout: 8000 })
    await page.locator('.course-row.variant').first().click()
  }
  await page.waitForSelector('.belt-badge', { timeout: 60000, state: 'visible' })
}

const startPlaying = async () => {
  for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
    const btn = page.locator(sel).first()
    if (await btn.count()) { try { await btn.click({ timeout: 8000 }); return true } catch { /* next */ } }
  }
  return false
}

const drain = async (label) => {
  const idb = await page.evaluate(() => window.__idbAudioReads || [])
  const srcs = await page.evaluate(() => window.__audioSrcs || [])
  const net = netAudio
  netAudio = []
  await page.evaluate(() => { window.__idbAudioReads = []; window.__audioSrcs = [] })
  console.log(`\n===== ${label} =====`)
  console.log(`  network /api/audio/ requests : ${net.length} (${new Set(net.map((r) => r.ref)).size} distinct refs)`)
  console.log(`    versioned (.vN) : ${net.filter((r) => /\.v\d+$/.test(r.ref)).length}`)
  console.log(`    bare uuid       : ${net.filter((r) => !/\.v\d+$/.test(r.ref)).length}`)
  console.log(`  IndexedDB audio-store reads  : ${idb.length} (${idb.filter((r) => r.hit).length} hits)`)
  console.log(`    versioned keys  : ${idb.filter((r) => /\.v\d+$/.test(r.key)).length}`)
  console.log(`    bare uuid keys  : ${idb.filter((r) => !/\.v\d+$/.test(r.key)).length}`)
  console.log(`  audio element srcs           : ${srcs.length} (blob: ${srcs.filter((s) => s.src.includes('blob:')).length})`)
  return { label, net, idb, srcs, course: await courseNameText() }
}

const results = { base: BASE, passes: [], apiCalls: otherApi, console: consoleLines, gaps: [] }

// ── PASS A: clean profile ──────────────────────────────────────────────────
console.log(`BASE = ${BASE}\nPASS A — clean profile, cold caches`)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
try {
  await pickGerman()
} catch (e) {
  results.gaps.push('PASS A course selection: ' + e.message)
  console.log('GAP: ' + e.message)
  await page.screenshot({ path: `${OUT}A-gap.png` })
}
console.log(`  course = "${await courseNameText()}"`)
await page.waitForTimeout(2000)
netAudio = [] // discard anything from before German was selected
await page.evaluate(() => { window.__idbAudioReads = []; window.__audioSrcs = [] })
const startedA = await startPlaying()
console.log(`  started playing: ${startedA}`)
await page.waitForTimeout(PLAY_MS)
await page.screenshot({ path: `${OUT}A-playing.png` })
results.passes.push(await drain('PASS A — cold, playing German'))

// Snapshot the cache state Tom's device would now be in.
results.cacheState = await page.evaluate(async () => {
  const out = { idbRows: null, localStorage: {}, caches: {} }
  try {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('ssi-audio-cache-v2'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const keys = await new Promise((res) => { const r = db.transaction('audio').objectStore('audio').getAllKeys(); r.onsuccess = () => res(r.result) })
    out.idbRows = { total: keys.length, versioned: keys.filter((k) => /\.v\d+$/.test(String(k))).length, sample: keys.slice(0, 5).map(String) }
    out.allKeys = keys.map(String)
  } catch (e) { out.idbRows = 'ERR ' + e }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.includes('audio-stamp') || k.includes('content-version') || k.includes('content-stamp'))) out.localStorage[k] = localStorage.getItem(k)
    }
  } catch {}
  try { for (const k of await caches.keys()) out.caches[k] = (await (await caches.open(k)).keys()).filter((r) => r.url.includes('/api/audio/')).length } catch {}
  return out
})
console.log('  cache after A:', JSON.stringify({ ...results.cacheState, allKeys: undefined }).slice(0, 600))

// ── PASS B: reload the SAME context — warm caches, Tom's device state ──────
console.log(`\nPASS B — reload with warm caches (simulates Tom's returning device)`)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
console.log(`  course after reload = "${await courseNameText()}"`)
await page.waitForSelector('.belt-badge', { timeout: 60000, state: 'visible' }).catch(() => results.gaps.push('PASS B: belt-badge never appeared'))
netAudio = []
await page.evaluate(() => { window.__idbAudioReads = []; window.__audioSrcs = [] })
const startedB = await startPlaying()
console.log(`  started playing: ${startedB}`)
await page.waitForTimeout(PLAY_MS)
await page.screenshot({ path: `${OUT}B-playing.png` })
results.passes.push(await drain('PASS B — warm reload, playing German'))

results.cacheStateB = await page.evaluate(async () => {
  const out = { localStorage: {} }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.includes('audio-stamp') || k.includes('content-version') || k.includes('content-stamp'))) out.localStorage[k] = localStorage.getItem(k)
    }
  } catch {}
  return out
})

results.apiCalls = otherApi
results.console = consoleLines
writeFileSync(OUT + 'refs.json', JSON.stringify(results, null, 2))
console.log(`\nwrote ${OUT}refs.json`)
console.log('course-data API calls seen:', JSON.stringify(otherApi.slice(0, 20), null, 1))
if (consoleLines.length) { console.log('\nconsole warn/error:'); consoleLines.slice(0, 40).forEach((l) => console.log('  ' + l)) }
if (results.gaps.length) { console.log('\nGAPS:'); results.gaps.forEach((g) => console.log('  ' + g)) }

await browser.close()
