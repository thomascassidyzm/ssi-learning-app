/**
 * #401 — THE SUBSTITUTE PROOF for "regular play works offline" under the
 * remote-shell posture.
 *
 * WHAT IT IS AND WHY IT IS NOT AN EMULATOR RUN. watson-1 has no /dev/kvm, no
 * vmx/svm flags and no configured AVD, so an Android emulator cannot boot on
 * this box — job #689 established that and I re-confirmed it. This is the
 * decided fallback: headless Chromium against LIVE staging, holding the
 * conditions the WebView holds, driving the app the way a learner does.
 *
 * WHAT IT PROVES, and the mechanism of each:
 *   1. The service worker installs and precaches the shell on the deployment.
 *   2. With the network genuinely cut — Playwright's context.setOffline, which
 *      is Chromium's CDP Network.emulateNetworkConditions(offline:true), a
 *      network-layer disconnection rather than a request-routing shim — a COLD
 *      NAVIGATION still boots. That is the precache serving the shell.
 *   3. Audio still PLAYS offline. Not a play() call: the 'playing' event on
 *      the element, which only fires when sound genuinely starts. The clips
 *      come from IndexedDB `ssi-audio-cache-v2`, warmed by playing online
 *      first — the service worker has not served audio since 2026-05-24.
 *
 * A cold-open-then-immediately-offline test would prove the shell boots and
 * nothing at all about play, which is why phase 1 plays online for a while
 * before the network is cut.
 *
 * THE SHELL'S OWN CONDITIONS: the user agent carries `SSiShell/android`, the
 * marker Capacitor appends, so the app takes the WebView branch of the
 * platform seam exactly as it will on the handset.
 *
 * Run:
 *   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs \
 *   BASE_URL=https://staging.saysomethingin.app node e2e/_401-remote-shell-offline.mjs
 */
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const COURSE = process.env.COURSE_CODE || 'pol_for_eng' // free tier — a guest gets the whole course
const OUT = process.env.OUT_DIR || `${process.env.CS_SCRATCH || '/tmp'}/401-remote-shell-offline/`
const WARM_MS = Number(process.env.WARM_MS || 90_000)
const OFFLINE_WATCH_MS = Number(process.env.OFFLINE_WATCH_MS || 90_000)
const SHELL_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 SSiShell/android'

mkdirSync(OUT, { recursive: true })
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// Truth, not attempts. SimplePlayer builds detached Audio elements, so a
// document-level listener never sees their events; wrap the constructor.
const INSTALL_HOOKS = () => {
  const w = window
  w.__playing = []
  w.__errors = []
  const OrigAudio = window.Audio
  function PatchedAudio(...args) {
    const el = new OrigAudio(...args)
    el.addEventListener('playing', () => w.__playing.push({ src: el.src || el.currentSrc || '', at: Date.now() }))
    el.addEventListener('error', () => w.__errors.push({ code: el.error?.code ?? null, at: Date.now() }))
    return el
  }
  PatchedAudio.prototype = OrigAudio.prototype
  window.Audio = PatchedAudio
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: SHELL_UA,
})
await ctx.addInitScript(INSTALL_HOOKS)
await ctx.addInitScript((course) => {
  try { localStorage.setItem('ssi-last-course', course) } catch { /* ignore */ }
}, COURSE)

const page = await ctx.newPage()
const playing = () => page.evaluate(() => window.__playing || []).catch(() => [])
const swState = () => page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { supported: false }
  const regs = await navigator.serviceWorker.getRegistrations()
  const keys = 'caches' in window ? await caches.keys() : []
  let precached = 0
  for (const k of keys) {
    try { precached += (await (await caches.open(k)).keys()).length } catch { /* ignore */ }
  }
  return {
    supported: true,
    registrations: regs.length,
    scriptURLs: regs.map((r) => r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || null),
    cacheNames: keys,
    cachedResponses: precached,
  }
}).catch(() => ({ supported: false }))
const audioCacheCount = () => page.evaluate(async () => {
  try {
    return await new Promise((resolve) => {
      const req = indexedDB.open('ssi-audio-cache-v2')
      req.onerror = () => resolve(0)
      req.onsuccess = () => {
        const db = req.result
        const store = [...db.objectStoreNames].find((s) => /audio|clip|blob/i.test(s)) || db.objectStoreNames[0]
        if (!store) return resolve(0)
        const kr = db.transaction(store, 'readonly').objectStore(store).getAllKeys()
        kr.onsuccess = () => resolve(kr.result.length)
        kr.onerror = () => resolve(0)
      }
    })
  } catch { return 0 }
}).catch(() => 0)

async function startPlayback() {
  const btn = page.locator('.center-btn').first()
  if (!(await btn.count().catch(() => 0))) return false
  await btn.click({ timeout: 10_000 }).catch(() => {})
  return true
}

// ── Phase 0: online boot, shell UA ────────────────────────────────────────
console.log(`\n=== Phase 0: online boot at ${BASE} as the shell ===`)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
const shellUp = await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)
check('app booted online', shellUp)
const seenUa = await page.evaluate(() => navigator.userAgent)
check('the page sees the shell user-agent marker', seenUa.includes('SSiShell/android'), seenUa.slice(-40))

// ── Phase 1: warm — play online, service worker installs, audio lands ────
console.log(`\n=== Phase 1: playing online for ${WARM_MS / 1000}s to warm both caches ===`)
check('lesson started online', await startPlayback())
const warmUntil = Date.now() + WARM_MS
let onlinePlays = 0
while (Date.now() < warmUntil) {
  onlinePlays = (await playing()).length
  await page.waitForTimeout(3_000)
}
const sw = await swState()
const clips = await audioCacheCount()
console.log(`  service worker: ${JSON.stringify(sw)}`)
console.log(`  audio cache: ${clips} clips; online 'playing' events: ${onlinePlays}`)
await page.screenshot({ path: `${OUT}1-online.png` })
check('service worker registered on the deployment', sw.supported && sw.registrations > 0, JSON.stringify(sw.scriptURLs))
check('shell precached by the service worker', (sw.cachedResponses || 0) > 0, `${sw.cachedResponses} cached responses`)
check('audio genuinely played online', onlinePlays > 0, `${onlinePlays} playing events`)
check('audio landed in IndexedDB', clips > 0, `${clips} clips`)

// ── Phase 2: cut the network for real, then COLD NAVIGATE ────────────────
console.log('\n=== Phase 2: context.setOffline(true), then reload from nothing ===')
await ctx.setOffline(true)
const netDead = await page.evaluate(() => fetch('/version.json', { cache: 'no-store' }).then(() => 'reachable').catch(() => 'dead'))
check('the network really is cut', netDead === 'dead', netDead)

await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
const bootedOffline = await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)
await page.screenshot({ path: `${OUT}2-offline-boot.png` })
check('COLD BOOT WITH NO NETWORK — the precache served the shell', bootedOffline)

// ── Phase 3: play offline ────────────────────────────────────────────────
console.log(`\n=== Phase 3: play with the network down, watching for ${OFFLINE_WATCH_MS / 1000}s ===`)
await page.waitForTimeout(3_000)
await startPlayback()
let offlinePlays = 0
const watchUntil = Date.now() + OFFLINE_WATCH_MS
while (Date.now() < watchUntil && offlinePlays < 3) {
  offlinePlays = (await playing()).length
  await page.waitForTimeout(3_000)
}
await page.screenshot({ path: `${OUT}3-offline-play.png` })
const errs = await page.evaluate(() => window.__errors || []).catch(() => [])
console.log(`  offline 'playing' events: ${offlinePlays}; audio errors: ${errs.length}`)
check('AUDIO PLAYED WITH THE NETWORK DOWN', offlinePlays > 0, `${offlinePlays} playing events after the cut`)

console.log(`\nscreenshots in ${OUT}`)
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
