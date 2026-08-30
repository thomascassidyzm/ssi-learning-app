// first-play-wait-probe — what a learner actually waits for before they can play.
//
// Written 2026-08-29 for the bundle prefetch-on-intent brief. It measures the
// thing a learner feels, which is NOT the same as time-to-first-audio:
//
//   pressableAtMs  — when the play control stops being disabled. The button is
//                    `is-disabled` (pulsing red, taps ignored) until the player
//                    reports ready, so THIS is the wait.
//   pressToAudioMs — press to the first real course clip actually calling
//                    play(). Measured by hooking HTMLMediaElement.prototype.play
//                    in an init script, so it is the sound, not the request.
//   bundleReqs     — when the course bundle fetch STARTS and finishes, which is
//                    what tells you whether prefetch-on-intent is working.
//
// Usage (needs @playwright/test + @supabase/supabase-js on the resolution path;
// run it from a checkout that has them installed):
//
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
//   SPEC_FILE=./specs.json TAG=before OUT_DIR=/tmp/out node first-play-wait-probe.mjs
//
// SPEC_FILE is a JSON array of runs:
//   [{"name":"spa-url","path":"/?course=spa_for_eng","signedIn":true,
//     "throttle":"4g"|"fast3g"|null,"dwellMs":0}]
//
// Findings from the first run are in docs/first-play-wait-measured-2026-08-29.md.
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT_DIR = process.env.OUT_DIR
const TAG = process.env.TAG || 'run'
mkdirSync(OUT_DIR, { recursive: true })

const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const ADMIN = 'thomas.cassidy+admin001@gmail.com'
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const svc = createClient(SB_URL, serviceKey)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link } = await svc.auth.admin.generateLink({ type: 'magiclink', email: ADMIN })
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const session = v.session
const authKey = `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`
console.error('minted entitled session')

const LIB_PATHS = [`${homedir()}/.ssi-sentinel-libs`, `${homedir()}/.pwlibs/root/usr/lib/x86_64-linux-gnu`, `${homedir()}/cslibs/root/usr/lib/x86_64-linux-gnu`]
const existingLib = LIB_PATHS.find((p) => existsSync(p))
if (existingLib) process.env.LD_LIBRARY_PATH = `${existingLib}:${process.env.LD_LIBRARY_PATH || ''}`
const chromePath = execSync(`ls ${homedir()}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -1`).toString().trim()
const browser = await chromium.launch({ executablePath: chromePath || undefined, args: ['--autoplay-policy=no-user-gesture-required'] })

const THROTTLE = {
  '4g': { downloadThroughput: 9 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8, latency: 60, offline: false },
  'fast3g': { downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 150, offline: false },
}

// Hook Audio.play + fetch so the page itself timestamps what happens.
const INSTRUMENT = () => {
  window.__probe = { plays: [], marks: [] }
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    try {
      const src = this.currentSrc || this.src || ''
      window.__probe.plays.push({ t: performance.now(), src: String(src).slice(0, 160) })
    } catch {}
    return origPlay.apply(this, a)
  }
  window.__mark = (name) => window.__probe.marks.push({ name, t: performance.now() })
}

// Course audio: proxied /api/audio/<id>, S3, or a blob from the IndexedDB cache.
// Excludes the brand welcome placeholder and the silent-WAV data URIs.
const COURSE_AUDIO = /\/api\/audio\/|amazonaws|^blob:/

const START_SELECTORS = [
  '.bottom-nav .center-btn', '.center-btn',
  'button:has-text("Ready when you are")', '.player-resting-state button', '.resting-cta',
]

async function oneRun(spec, runNum) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript(INSTRUMENT)
  if (spec.signedIn) await ctx.addInitScript(([k, s]) => { localStorage.setItem(k, JSON.stringify(s)) }, [authKey, session])
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  if (spec.throttle && THROTTLE[spec.throttle]) await cdp.send('Network.emulateNetworkConditions', THROTTLE[spec.throttle])

  const t0 = Date.now(); const rel = () => Date.now() - t0
  const net = {
    bundleReqs: [], bundleEnd: {}, roundMap: false, fallbacks: [], audioReqs: [],
    // Step 6 asks a second question of every run: did the session stop reading
    // the course out of Supabase? Counted per table, because the walk's
    // signature is one course_practice_phrases read per seed.
    supabase: {}, supabaseTotal: 0, producer: [],
  }
  page.on('console', (m) => {
    const t = m.text()
    if (/falling back to \/round-map|falling back to \/cycles|falling back to \/infplay-cycles|bundle not ready/i.test(t)) net.fallbacks.push(`t+${rel()}ms :: ${t.slice(0, 220)}`)
    if (/\[BundleScript\]|\[eagerScriptPreload\]|\[generateLearningScript\]|Skipped \d+ practice phrases/.test(t)) net.producer.push(`t+${rel()}ms :: ${t.slice(0, 200)}`)
  })
  page.on('request', (req) => {
    const u = req.url()
    const m = u.match(/\/api\/courses\/([^/]+)\/bundle/)
    if (m && !u.includes('head=1')) net.bundleReqs.push({ course: m[1], atMs: rel() })
    else if (/\/api\/courses\/[^/]+\/round-map/.test(u)) net.roundMap = true
    else if (u.includes('/api/audio/') && net.audioReqs.length < 12) net.audioReqs.push(rel())
    const rest = u.match(/\/rest\/v1\/([a-z_]+)/)
    if (rest) {
      net.supabase[rest[1]] = (net.supabase[rest[1]] || 0) + 1
      net.supabaseTotal++
    }
  })
  page.on('response', (res) => {
    const m = res.url().match(/\/api\/courses\/([^/]+)\/bundle/)
    if (m && !res.url().includes('head=1') && net.bundleEnd[m[1]] == null) net.bundleEnd[m[1]] = rel()
  })

  await page.goto(`${BASE}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => net.fallbacks.push(`GOTO :: ${e.message}`))

  // The play control is DISABLED (`is-disabled`, pulsing red) until the player
  // reports ready. That disabled window IS the wait a learner feels — measure it.
  const budget = spec.throttle === 'fast3g' ? 90000 : 45000
  let pressableAt = null
  const deadline = Date.now() + budget
  while (pressableAt == null && Date.now() < deadline) {
    pressableAt = await page.evaluate(() => {
      const b = document.querySelector('.center-btn')
      if (!b) return null
      if (b.classList.contains('is-disabled')) return null
      return performance.now()
    }).catch(() => null)
    if (pressableAt == null) await page.waitForTimeout(100)
  }
  if (pressableAt != null) {
    if (spec.dwellMs) await page.waitForTimeout(spec.dwellMs)
    await page.evaluate(() => window.__mark('click')).catch(() => {})
    await page.locator('.center-btn').first().click({ timeout: 8000, force: true }).catch((e) => net.fallbacks.push(`CLICK :: ${String(e.message).slice(0,120)}`))
  } else {
    net.fallbacks.push('NEVER_PRESSABLE within budget')
  }

  const settle = spec.throttle === 'fast3g' ? 45000 : 25000
  const audioDeadline = Date.now() + settle
  let plays = []
  while (Date.now() < audioDeadline) {
    plays = await page.evaluate(() => window.__probe?.plays ?? []).catch(() => [])
    const clickT = (await page.evaluate(() => window.__probe?.marks?.find(m => m.name === 'click')?.t ?? null).catch(() => null))
    if (clickT != null && plays.some(p => p.t > clickT && COURSE_AUDIO.test(p.src))) break
    await page.waitForTimeout(250)
  }
  const probe = await page.evaluate(() => window.__probe).catch(() => ({ plays: [], marks: [] }))
  await ctx.close()

  const clickT = probe.marks?.find(m => m.name === 'click')?.t ?? null
  const realPlays = (probe.plays || []).filter(p => p.src && COURSE_AUDIO.test(p.src))
  const firstAfterClick = clickT != null ? realPlays.find(p => p.t > clickT) : null
  return {
    tag: TAG, name: spec.name, runNum, throttle: spec.throttle || 'none', signedIn: !!spec.signedIn, dwellMs: spec.dwellMs || 0,
    pressableAtMs: pressableAt != null ? Math.round(pressableAt) : null,
    clickAtMs: clickT != null ? Math.round(clickT) : null,
    firstAudioAfterClickMs: firstAfterClick ? Math.round(firstAfterClick.t) : null,
    pressToAudioMs: (clickT != null && firstAfterClick) ? Math.round(firstAfterClick.t - clickT) : null,
    firstAudioSrc: firstAfterClick?.src ?? null,
    playsBeforeClick: realPlays.filter(p => clickT != null && p.t <= clickT).length,
    bundleReqs: net.bundleReqs, bundleEnd: net.bundleEnd, firstAudioReqMs: net.audioReqs[0] ?? null,
    roundMapRequested: net.roundMap, fallbacks: net.fallbacks,
    supabaseTotal: net.supabaseTotal, supabaseByTable: net.supabase, producer: net.producer,
  }
}

const SPECS = JSON.parse(readFileSync(process.env.SPEC_FILE, 'utf8'))
const results = []
let n = 0
for (const spec of SPECS) {
  n++
  console.error(`>>> [${n}/${SPECS.length}] ${spec.name} ${spec.throttle || 'none'}`)
  let r
  try { r = await oneRun(spec, n) } catch (e) { r = { tag: TAG, name: spec.name, error: String(e).slice(0, 300) } }
  console.error(JSON.stringify(r))
  results.push(r)
}
await browser.close()
writeFileSync(`${OUT_DIR}/${TAG}.json`, JSON.stringify(results, null, 2))
console.error(`DONE -> ${OUT_DIR}/${TAG}.json`)
