// RETURNING LEARNER — first-audio latency, three cache states (2026-08-30).
//
// Tom's belief under test: a returning learner plays from cache and never
// waits. True in DESIGN. This probe measures whether it's true in FACT, for
// a REAL signed-in tester with real mid-course progress (never a fresh
// guest), across three cache states:
//
//   (a) WARM  — same browser process, tab reloaded moments later. Everything
//       resident: IndexedDB audio cache, SW Cache Storage, in-memory JS heap,
//       warm HTTP connections.
//   (b) COLD  — browser process restarted (new launchPersistentContext on
//       the SAME on-disk profile). Disk-backed caches (IndexedDB, SW Cache
//       Storage, HTTP disk cache) survive; nothing in-memory does.
//   (c) EVICTED — the case Tom hasn't considered. Browser process restarted
//       AND IndexedDB (ssi-audio-cache-v2, ssi-script-cache) + all
//       CacheStorage entries are wiped before the measured run, exactly as
//       a real OS/browser storage-pressure eviction would do after days/
//       weeks away. localStorage (auth session, identity) is left intact —
//       that asymmetry (identity + server progress survive, audio cache
//       does not) is the whole point of the case. Per LearningPlayer.vue
//       ~13838-13925, a returning user (startingSeed > 0) always takes its
//       OWN generateScript() load centred on the resume position — it can
//       never use the round-1 eager preload a first-time visitor gets.
//
// Detection: HTMLMediaElement.prototype.play is patched and every audio
// element is watched for `timeupdate` with currentTime > 0.05s — i.e. audio
// GENUINELY AUDIBLE, not merely a resolved play() promise. Same method as
// cold-start-readiness-probe.mjs. The brand welcome chime is excluded by URL
// pattern so it can't flatter the "lesson audio" number.
//
// Auth: real signed-in tester via service-role generateLink (magiclink),
// verified with the anon client, session injected into localStorage before
// the app boots — same pattern as course-switch-signedin-probe.mjs. NEVER
// Tom's primary account.
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//   RUNS=5 THROTTLE=slow4g OUT_DIR=$CS_SCRATCH/returning-learner/ \
//   node e2e/returning-learner-latency-probe.mjs
//
// Scratch note: this repo's e2e/ dir is shared across concurrent probe
// workers on this box — this file's name and its OUT_DIR (must be under
// $CS_SCRATCH, never bare /tmp) are chosen not to collide with any of them.

import { mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || `${process.env.CS_SCRATCH || '/tmp'}/returning-learner/`
const RUNS = Number(process.env.RUNS || 5)
const THROTTLE = process.env.THROTTLE || 'slow4g'
const BUDGET_MS = Number(process.env.BUDGET_MS || 90000)
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const COURSE_HINT = process.env.COURSE_HINT || 'Italian' // course-name fragment shown post-boot, for the log only

mkdirSync(OUT, { recursive: true })

// Chrome DevTools' own presets — stated here so the exact CDP params are on
// the record, per Tom's instruction.
const PROFILES = {
  none: null,
  fast3g: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  slow4g: { downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8, latency: 80 },
}
const prof = PROFILES[THROTTLE]

// ── mint a real session for the tester, no email sent ───────────────────────
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg' // public, from the deployed bundle
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const svc = createClient(SB_URL, serviceKey)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: TESTER })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const session = v.session
const projectRef = new URL(SB_URL).hostname.split('.')[0]
console.log(`minted session for ${TESTER}`)

const injectSession = ([key, sess]) => {
  try {
    localStorage.setItem('ssi-has-played', 'true')
    localStorage.setItem(key, JSON.stringify(sess))
  } catch {}
}

const instrument = () => {
  window.__t0 = performance.now()
  window.__audio = { firstPlayCall: null, firstAudible: null, firstLessonAudible: null, firstLessonPlayCall: null, firstLessonSrc: null, srcs: [] }
  window.__rejections = []
  addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason).slice(0, 200)))
  const isLesson = (src) => !!src && !/welcome-brand|placeholder|silent/i.test(src)
  const watch = (el) => {
    if (el.__ssiWatched) return
    el.__ssiWatched = true
    el.addEventListener('timeupdate', () => {
      const src = String(el.src || el.currentSrc || '')
      if (el.currentTime <= 0.05) return
      if (window.__audio.firstAudible === null) window.__audio.firstAudible = performance.now()
      if (isLesson(src) && window.__audio.firstLessonAudible === null) {
        window.__audio.firstLessonAudible = performance.now()
        window.__audio.firstLessonSrc = src.slice(0, 140)
      }
    })
  }
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    const src = String(this.src || this.currentSrc || '(nosrc)')
    if (window.__audio.firstPlayCall === null) window.__audio.firstPlayCall = performance.now()
    if (isLesson(src) && window.__audio.firstLessonPlayCall === null) window.__audio.firstLessonPlayCall = performance.now()
    window.__audio.srcs.push({ t: Math.round(performance.now()), src: src.slice(0, 120) })
    watch(this)
    return origPlay.apply(this, args)
  }
}

const sampleFn = () => {
  const visible = (el) => {
    if (!el) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const has = (sel) => visible(document.querySelector(sel))
  const centre = document.querySelector('.center-btn')
  return {
    t: Math.round(performance.now() - (window.__t0 || 0)),
    looksReady: visible(centre) && !centre.classList.contains('is-disabled'),
    beltBadge: has('.belt-badge'),
    courseName: (document.querySelector('.course-name--tappable')?.textContent || '').trim(),
    audio: window.__audio,
    rejections: (window.__rejections || []).slice(0, 5),
  }
}

// ── waterfall recorder (network requests, tagged relative to nav t0) ────────
function attachWaterfall(page, navAtRef) {
  const rows = []
  page.on('request', (req) => {
    const url = req.url()
    if (url.startsWith('data:')) return
    rows.push({ url, start: Date.now() - navAtRef.t0, end: null, status: null })
  })
  page.on('requestfinished', async (req) => {
    const row = rows.find((r) => r.url === req.url() && r.end === null)
    if (row) { row.end = Date.now() - navAtRef.t0; try { row.status = (await req.response())?.status() ?? null } catch {} }
  })
  page.on('requestfailed', (req) => {
    const row = rows.find((r) => r.url === req.url() && r.end === null)
    if (row) { row.end = Date.now() - navAtRef.t0; row.status = 'FAILED' }
  })
  return rows
}

const short = (url) => {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 70 ? u.pathname.slice(0, 67) + '…' : u.pathname
    return u.host.replace('.vercel.app', '').replace('.supabase.co', '[supabase]') + path
  } catch { return url.slice(0, 90) }
}

// ── run a single measured navigation on an already-open page ────────────────
// caseLabel is one of 'warm' | 'cold' | 'evicted'. Presses the play button as
// soon as the resting screen looks ready (same gesture Tom actually makes),
// then waits for genuinely audible lesson audio.
async function measureOnce(page, caseLabel, runIndex) {
  const navAtRef = { t0: Date.now() }
  const waterfall = attachWaterfall(page, navAtRef)
  const consoleLines = []
  page.on('console', (m) => {
    const line = `${Date.now() - navAtRef.t0} [${m.type()}] ${m.text().slice(0, 200)}`
    consoleLines.push(line)
  })

  await page.addInitScript(instrument)
  const emptinessBefore = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      const dbs = (await indexedDB.databases?.()) || []
      return { swCount: regs.length, dbs: dbs.map((d) => d.name), localStorageKeys: Object.keys(localStorage).length }
    } catch (e) { return { error: String(e) } }
  }).catch(() => ({ error: 'unavailable' }))

  navAtRef.t0 = Date.now()
  await page.goto(BASE + '/', { waitUntil: 'commit' })

  const emptinessAtCommit = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      const dbs = (await indexedDB.databases?.()) || []
      return { swCount: regs.length, dbs: dbs.map((d) => d.name) }
    } catch (e) { return { error: String(e) } }
  }).catch(() => ({ error: 'unavailable' }))

  const samples = []
  let tReady = null
  let tPress = null
  let pressed = false
  const deadline = Date.now() + BUDGET_MS

  while (Date.now() < deadline) {
    let s
    try { s = await page.evaluate(sampleFn) } catch { await page.waitForTimeout(100); continue }
    samples.push(s)
    if (tReady === null && s.looksReady) tReady = s.t
    if (tReady !== null && !pressed) {
      pressed = true
      const target = page.locator('.center-btn').first()
      try { await target.click({ timeout: 4000, force: true }) } catch {}
      tPress = await page.evaluate(() => Math.round(performance.now() - window.__t0))
    }
    if (s.audio?.firstLessonAudible) break
    await page.waitForTimeout(80)
  }

  const last = samples[samples.length - 1] || {}
  const t0abs = await page.evaluate(() => window.__t0).catch(() => 0)
  const audio = last.audio || {}
  await page.screenshot({ path: `${OUT}${caseLabel}-${runIndex}-final.png` }).catch(() => {})

  const result = {
    case: caseLabel, run: runIndex, base: BASE, throttle: THROTTLE, throttleParams: prof,
    tester: TESTER, courseNameAtEnd: last.courseName || null,
    emptinessBefore, emptinessAtCommit,
    t_ready_ms: tReady,
    t_press_ms: tPress,
    t_firstPlayCall_ms: audio.firstPlayCall ? Math.round(audio.firstPlayCall - t0abs) : null,
    t_firstAnyAudible_ms: audio.firstAudible ? Math.round(audio.firstAudible - t0abs) : null,
    t_firstLessonAudible_ms: audio.firstLessonAudible ? Math.round(audio.firstLessonAudible - t0abs) : null,
    firstLessonSrc: audio.firstLessonSrc || null,
    reachedAudible: !!audio.firstLessonAudible,
    rejections: last.rejections || [],
    waterfall: waterfall.sort((a, b) => a.start - b.start),
    consoleTail: consoleLines.slice(-40),
  }
  writeFileSync(`${OUT}run-${caseLabel}-${runIndex}.json`, JSON.stringify(result, null, 2))
  return result
}

// ── profile lifecycle ────────────────────────────────────────────────────────
const SEED_PROFILE = `${OUT}profile-seed`

async function openContext(profileDir) {
  return chromium.launchPersistentContext(profileDir, {
    executablePath: process.env.CHROME_BIN,
    viewport: { width: 390, height: 844 },
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
  })
}

async function primeSeedProfile() {
  rmSync(SEED_PROFILE, { recursive: true, force: true })
  const ctx = await openContext(SEED_PROFILE)
  const page = await ctx.newPage()
  await page.addInitScript(injectSession, [`sb-${projectRef}-auth-token`, session])
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  if (prof) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof })
  console.log('[seed] navigating, signed in as tester, priming real caches...')
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.belt-badge', { timeout: 60000, state: 'visible' }).catch((e) => console.log('[seed] belt-badge wait failed', e.message))
  const name = (await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || ''
  console.log(`[seed] boot ready, course="${name.trim()}"`)
  // Tap play once and let a little real audio + preloading happen so the
  // IndexedDB audio cache and SW Cache Storage are genuinely populated —
  // not just a boot-time skeleton.
  try {
    await page.locator('.center-btn').first().click({ timeout: 4000, force: true })
    await page.waitForTimeout(8000)
  } catch (e) { console.log('[seed] play/prime step failed (non-fatal):', e.message) }
  const dbState = await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) || []
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => [])
    let cacheEntries = 0
    try { for (const k of await caches.keys()) cacheEntries += (await (await caches.open(k)).keys()).length } catch {}
    return { dbs: dbs.map((d) => d.name), swCount: regs.length, cacheEntries }
  }).catch(() => ({ error: 'unavailable' }))
  console.log('[seed] primed state:', JSON.stringify(dbState))
  await page.screenshot({ path: `${OUT}seed-primed.png` }).catch(() => {})
  await ctx.close()
  return dbState
}

function cloneProfile(label, i) {
  const dst = `${OUT}profile-${label}-${i}`
  rmSync(dst, { recursive: true, force: true })
  cpSync(SEED_PROFILE, dst, { recursive: true })
  return dst
}

// evicted: wipe IndexedDB (audio cache, script cache) + all CacheStorage
// entries on a live page against the profile, THEN close and relaunch fresh
// so the measured run is a genuine new process — same shape as the cold
// case but with disk caches gone. localStorage (auth token, identity) is
// left completely untouched, matching the asymmetry Tom described.
async function evictProfile(profileDir) {
  const ctx = await openContext(profileDir)
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.belt-badge', { timeout: 60000, state: 'visible' }).catch(() => {})
  await page.waitForTimeout(1500) // let any in-flight SW/IDB writes settle before wiping
  const wiped = await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) || []
    for (const d of dbs) { if (d.name) await new Promise((res) => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = res }) }
    let cacheNames = []
    try { cacheNames = await caches.keys(); for (const k of cacheNames) await caches.delete(k) } catch {}
    return { deletedDbs: dbs.map((d) => d.name), deletedCaches: cacheNames, localStorageKeysKept: Object.keys(localStorage) }
  })
  console.log('[evict] wiped:', JSON.stringify(wiped))
  await ctx.close()
  return wiped
}

// ── main ──────────────────────────────────────────────────────────────────
const allResults = { warm: [], cold: [], evicted: [] }
const evictionLog = []

console.log(`BASE=${BASE} THROTTLE=${THROTTLE} params=${JSON.stringify(prof)} RUNS=${RUNS}`)
await primeSeedProfile()

for (let i = 1; i <= RUNS; i++) {
  console.log(`\n=== pair ${i}/${RUNS}: cold then warm (same profile copy, same process for warm) ===`)
  const profileDir = cloneProfile('coldwarm', i)
  const ctx = await openContext(profileDir)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  if (prof) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof })

  const cold = await measureOnce(page, 'cold', i)
  allResults.cold.push(cold)
  console.log(`  cold: t_ready=${cold.t_ready_ms}ms t_press=${cold.t_press_ms}ms t_firstLessonAudible=${cold.t_firstLessonAudible_ms}ms`)

  await page.waitForTimeout(1500)
  // same open context/process, same tab — a plain reload, exactly what
  // "returning soon after a session" looks like if the OS didn't kill the
  // app process in between.
  const warm = await measureOnce(page, 'warm', i)
  allResults.warm.push(warm)
  console.log(`  warm: t_ready=${warm.t_ready_ms}ms t_press=${warm.t_press_ms}ms t_firstLessonAudible=${warm.t_firstLessonAudible_ms}ms`)

  await ctx.close()
  rmSync(profileDir, { recursive: true, force: true })
}

for (let i = 1; i <= RUNS; i++) {
  console.log(`\n=== evicted run ${i}/${RUNS} ===`)
  const profileDir = cloneProfile('evicted', i)
  const wiped = await evictProfile(profileDir)
  evictionLog.push(wiped)

  const ctx = await openContext(profileDir)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  if (prof) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof })

  const evicted = await measureOnce(page, 'evicted', i)
  allResults.evicted.push(evicted)
  console.log(`  evicted: t_ready=${evicted.t_ready_ms}ms t_press=${evicted.t_press_ms}ms t_firstLessonAudible=${evicted.t_firstLessonAudible_ms}ms`)

  await ctx.close()
  rmSync(profileDir, { recursive: true, force: true })
}

rmSync(SEED_PROFILE, { recursive: true, force: true })

// ── stats ─────────────────────────────────────────────────────────────────
const stat = (arr, key) => {
  const v = arr.map((r) => r[key]).filter((x) => typeof x === 'number')
  if (!v.length) return { n: 0, median: null, min: null, max: null, missing: arr.length }
  const sorted = v.slice().sort((a, b) => a - b)
  return { n: v.length, median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1], missing: arr.length - v.length }
}

const summary = {
  base: BASE, throttle: THROTTLE, throttleParams: prof, tester: TESTER, runs: RUNS,
  warm: { t_ready_ms: stat(allResults.warm, 't_ready_ms'), t_press_ms: stat(allResults.warm, 't_press_ms'), t_firstLessonAudible_ms: stat(allResults.warm, 't_firstLessonAudible_ms') },
  cold: { t_ready_ms: stat(allResults.cold, 't_ready_ms'), t_press_ms: stat(allResults.cold, 't_press_ms'), t_firstLessonAudible_ms: stat(allResults.cold, 't_firstLessonAudible_ms') },
  evicted: { t_ready_ms: stat(allResults.evicted, 't_ready_ms'), t_press_ms: stat(allResults.evicted, 't_press_ms'), t_firstLessonAudible_ms: stat(allResults.evicted, 't_firstLessonAudible_ms') },
  evictionLog,
}
writeFileSync(`${OUT}summary.json`, JSON.stringify(summary, null, 2))
writeFileSync(`${OUT}all-results.json`, JSON.stringify(allResults, null, 2))
console.log('\n\n===== SUMMARY =====')
console.log(JSON.stringify(summary, null, 2))
