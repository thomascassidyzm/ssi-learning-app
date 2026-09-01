// SHARED HARNESS LIBRARY for the six learner-journey baselines (2026-09-01).
//
// Why this exists: four separate beliefs about this app were wrong when
// finally measured. This library is the measuring instrument — one place
// where "what a learner actually experiences" is defined, so every journey
// number is produced the same way and a re-run months later is comparable.
//
// The two things it refuses to fake:
//   1. AUDIBLE is not play(). A resolved play() promise proves nothing —
//      an autoplay-suspended or buffering-stalled element resolves it and
//      never makes a sound. We hook HTMLMediaElement.prototype.play at
//      document-start and wait for a `timeupdate` with currentTime > 0.05s,
//      i.e. the output device genuinely advanced through real samples.
//   2. PAINTED is not "the DOM changed". We take a rAF after the mutation
//      settles, so the number is when pixels could have hit the screen.
//
// Everything here is derived from the probes that already proved themselves
// in this repo (first-play-latency-probe.mjs, returning-learner-latency-probe.mjs,
// course-switch-waterfall-probe.mjs) — this is those three made one.

import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// ── Chrome on this box ──────────────────────────────────────────────────────
// The headless_shell Playwright picks by default is missing libnspr4 here;
// the full chrome-linux64 build plus one of these lib dirs is the pattern
// every working probe in this repo uses.
const LIB_PATHS = [
  `${homedir()}/.ssi-sentinel-libs`,
  `${homedir()}/.pwlibs/root/usr/lib/x86_64-linux-gnu`,
  `${homedir()}/cslibs/root/usr/lib/x86_64-linux-gnu`,
]
const lib = LIB_PATHS.find((p) => existsSync(p))
if (lib) process.env.LD_LIBRARY_PATH = `${lib}:${process.env.LD_LIBRARY_PATH || ''}`
export const CHROME_PATH = process.env.CHROME_BIN || execSync(
  `ls ${homedir()}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -1`
).toString().trim()

// ── Network conditions ──────────────────────────────────────────────────────
// Chrome DevTools' own presets where they exist, so the exact CDP params are
// on the record and anyone can reproduce them.
export const NET = {
  // A good connection. Not "unthrottled" — unthrottled on a datacentre box
  // flatters the app in a way no phone ever will. This is a decent 4G.
  good:        { downloadThroughput: (12 * 1024 * 1024) / 8, uploadThroughput: (4 * 1024 * 1024) / 8, latency: 40 },
  // DevTools "Slow 3G".
  slow3g:      { downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8, latency: 400 },
  // DevTools "Fast 3G".
  fast3g:      { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  // Bandwidth is fine, the round trip is awful — satellite, congested cell,
  // a train. Separated from slow3g deliberately: they fail differently.
  highlatency: { downloadThroughput: (8 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8, latency: 900 },
  // Intermittent is not a profile, it is a schedule — see cycleOffline().
  intermittent:{ downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8, latency: 200 },
  none: null,
}

export const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
export const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg' // public; lifted from the deployed bundle
const serviceKey = () => readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()

export const svc = () => createClient(SB_URL, serviceKey())
export const projectRef = new URL(SB_URL).hostname.split('.')[0]
export const sessionKey = `sb-${projectRef}-auth-token`

// Mint a real signed-in session without sending an email. Used for every
// journey that needs an actual learner rather than a guest.
export async function mintSession(email) {
  const s = svc()
  const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: link, error: lerr } = await s.auth.admin.generateLink({ type: 'magiclink', email })
  if (lerr) throw lerr
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
  if (verr) throw verr
  return v.session
}

// A genuinely brand-new account, for the "never used the app" journey. The
// caller is expected to delete it afterwards (deleteUser below) so the
// baseline doesn't litter the live user table.
export async function createFreshUser(prefix = 'baseline') {
  const email = `${prefix}+${Date.now()}${Math.floor(Math.random() * 1e4)}@ssi-baseline.invalid`
  const s = svc()
  const { data, error } = await s.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw error
  return { email, id: data.user.id }
}
export async function deleteUser(id) {
  try { await svc().auth.admin.deleteUser(id) } catch { /* best effort */ }
}

// ── The document-start instrument ───────────────────────────────────────────
// Runs before any app JS. This is what makes the audio hook trustworthy
// rather than a race against app boot.
export const instrument = () => {
  window.__t0 = performance.now()
  window.__mark = (name) => { (window.__marks ||= []).push({ name, t: performance.now() }) }
  window.__audio = {
    firstPlayCall: null, firstAnyAudible: null,
    firstLessonAudible: null, firstLessonSrc: null, srcs: [],
  }
  window.__rejections = []
  addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason).slice(0, 200)))

  // Anything that is not the actual lesson prompt/target audio: a brand
  // welcome chime, a placeholder tone, or the pause-phase silent keepalive.
  // Excluded so a chime can never flatter the "first word heard" number.
  const isLesson = (src) => !!src && !/welcome|brand|placeholder|silent|keepalive|data:audio/i.test(src)

  const watch = (el) => {
    if (el.__ssiWatched) return
    el.__ssiWatched = true
    el.addEventListener('timeupdate', () => {
      const src = String(el.src || el.currentSrc || '')
      if (el.currentTime <= 0.05) return // play() resolved is not sound
      if (window.__audio.firstAnyAudible === null) window.__audio.firstAnyAudible = performance.now()
      if (isLesson(src) && window.__audio.firstLessonAudible === null) {
        window.__audio.firstLessonAudible = performance.now()
        window.__audio.firstLessonSrc = src.slice(0, 200)
      }
    })
  }
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    const src = String(this.src || this.currentSrc || '(nosrc)')
    if (window.__audio.firstPlayCall === null) window.__audio.firstPlayCall = performance.now()
    window.__audio.srcs.push({ t: Math.round(performance.now()), src: src.slice(0, 160) })
    watch(this)
    return origPlay.apply(this, args)
  }

  // ── Screen-switch instrument (journey 5) ──────────────────────────────
  // __navProbe(): call immediately before a tap. Resolves with the ms to
  // FIRST PAINT after the DOM actually changed — a MutationObserver for the
  // change, then a double rAF so the number is when pixels could land, not
  // when the vDOM patched.
  window.__navProbe = () => new Promise((resolve) => {
    const t0 = performance.now()
    let done = false
    const finish = (kind) => {
      if (done) return
      done = true
      obs.disconnect()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve({ kind, paintedMs: Math.round(performance.now() - t0) })
      }))
    }
    const obs = new MutationObserver((muts) => {
      // Ignore trivial text ticks (a clock, a progress %); wait for real
      // structural change, which is what a screen switch is.
      for (const m of muts) {
        if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && n.getBoundingClientRect && n.getBoundingClientRect().height > 40) return finish('structural')
          }
        }
      }
    })
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    setTimeout(() => finish('timeout'), 8000)
  })

  // Long tasks block the main thread — this is what "tap felt laggy" is
  // made of. Recorded so the paint number has a cause underneath it.
  window.__longTasks = []
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__longTasks.push({ t: Math.round(e.startTime), dur: Math.round(e.duration) })
    }).observe({ entryTypes: ['longtask'] })
  } catch { /* not supported — reported as a gap, never as zero */ }
}

// ── Network waterfall recorder ──────────────────────────────────────────────
export function attachWaterfall(page, ref) {
  const rows = []
  const legOf = (url) => {
    if (/\/api\/courses\/[^/]+\/bundle/.test(url)) return 'course-bundle'
    if (/\/round-map/.test(url)) return 'round-map'
    if (/\/cycles\?/.test(url)) return 'cycles'
    if (/rest\/v1\/courses\?/.test(url)) return 'courses-catalogue'
    if (/rest\/v1\/(course_legos|course_practice_phrases|algorithm_config|listening_pods|listening_pod_sentences|course_seeds)/.test(url)) return 'course-content'
    if (/rest\/v1\/(lego_progress|seed_progress|course_enrollments|learners|sessions)/.test(url)) return 'learner-progress'
    if (/\/api\/audio\//.test(url) || /\.mp3(\?|$)/i.test(url) || /amazonaws|cloudfront/i.test(url)) return 'audio'
    if (/\.(js|css)(\?|$)/i.test(url)) return 'app-code'
    return 'other'
  }
  const push = (req) => {
    const url = req.url()
    if (url.startsWith('data:') || url.includes('/api/player-events')) return
    rows.push({ leg: legOf(url), url: url.slice(0, 180), start: Date.now() - ref.t0, end: null, status: null, bytes: null })
  }
  page.on('request', push)
  page.on('requestfinished', async (req) => {
    const row = rows.find((r) => r.url === req.url().slice(0, 180) && r.end === null)
    if (!row) return
    row.end = Date.now() - ref.t0
    try {
      const res = await req.response()
      row.status = res?.status() ?? null
      const len = res?.headers()?.['content-length']
      if (len) row.bytes = Number(len)
    } catch { /* response gone */ }
  })
  page.on('requestfailed', (req) => {
    const row = rows.find((r) => r.url === req.url().slice(0, 180) && r.end === null)
    if (row) { row.end = Date.now() - ref.t0; row.status = 'FAILED' }
  })
  return rows
}

// Where did the time go? Sum of wall time in which at least one request of
// each leg was in flight, clipped to the measured window. Overlapping
// requests are unioned, not added — otherwise six parallel fetches "cost"
// six times the wall clock they actually took.
export function legBreakdown(rows, endMs) {
  const byLeg = {}
  for (const r of rows) {
    if (r.start > endMs) continue
    const s = Math.max(0, r.start), e = Math.min(r.end ?? endMs, endMs)
    if (e <= s) continue
    ;(byLeg[r.leg] ||= []).push([s, e])
  }
  const out = {}
  for (const [leg, spans] of Object.entries(byLeg)) {
    spans.sort((a, b) => a[0] - b[0])
    let total = 0, curS = spans[0][0], curE = spans[0][1]
    for (const [s, e] of spans.slice(1)) {
      if (s <= curE) curE = Math.max(curE, e)
      else { total += curE - curS; curS = s; curE = e }
    }
    total += curE - curS
    out[leg] = { busyMs: Math.round(total), requests: spans.length }
  }
  return out
}

// ── Browser launch ──────────────────────────────────────────────────────────
export async function launch(profileDir, { net = 'good', session = null, returnUser = true } = {}) {
  mkdirSync(profileDir, { recursive: true })
  const ctx = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROME_PATH || undefined,
    viewport: { width: 390, height: 844 },
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
  })
  const page = ctx.pages()[0] || (await ctx.newPage())
  await page.addInitScript(instrument)
  if (session) {
    await page.addInitScript(([k, sess, ru]) => {
      try {
        localStorage.setItem(k, JSON.stringify(sess))
        if (ru) localStorage.setItem('ssi-has-played', 'true')
      } catch { /* storage blocked */ }
    }, [sessionKey, session, returnUser])
  } else if (returnUser) {
    await page.addInitScript(() => { try { localStorage.setItem('ssi-has-played', 'true') } catch {} })
  }
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  const prof = NET[net]
  if (prof) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof })
  return { ctx, page, cdp }
}

// The intermittent case: drop the connection and bring it back on a duty
// cycle, for as long as the caller keeps the handle alive. Returns a stop()
// and the log of every transition, so a stall can be lined up against the
// exact moment the signal went.
export function cycleOffline(cdp, { upMs = 4000, downMs = 4000, net = 'intermittent' } = {}) {
  const log = []
  let stopped = false
  const t0 = Date.now()
  const prof = NET[net]
  const loop = async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, upMs))
      if (stopped) break
      try { await cdp.send('Network.emulateNetworkConditions', { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 }) } catch { break }
      log.push({ t: Date.now() - t0, state: 'offline' })
      await new Promise((r) => setTimeout(r, downMs))
      if (stopped) break
      try { await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof }) } catch { break }
      log.push({ t: Date.now() - t0, state: 'online' })
    }
  }
  loop()
  return {
    log,
    stop: async () => {
      stopped = true
      try { await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof }) } catch {}
    },
  }
}

// ── Waiting helpers, all with an honest failure mode ────────────────────────
// Every one returns null on timeout rather than throwing, so a journey that
// never completes is recorded AS a journey that never completes — that is a
// finding, not an error.
export async function waitAudible(page, deadlineMs) {
  while (Date.now() < deadlineMs) {
    const a = await page.evaluate(() => window.__audio).catch(() => null)
    if (a?.firstLessonAudible) return a
    await page.waitForTimeout(100)
  }
  return null
}

export async function pressTransport(page, deadlineMs) {
  const centre = page.locator('.center-btn').first()
  try {
    await centre.waitFor({ state: 'visible', timeout: Math.max(500, deadlineMs - Date.now()) })
    while (Date.now() < deadlineMs) {
      const disabled = await centre.evaluate((el) => el.classList.contains('is-disabled')).catch(() => true)
      if (!disabled) break
      await page.waitForTimeout(100)
    }
    await centre.click({ timeout: 8000, force: true })
    return true
  } catch { return false }
}

export const courseName = async (page) =>
  ((await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || '').trim()

export async function openCoursePicker(page) {
  await page.locator('.course-name--tappable').first().click({ timeout: 15000 })
  await page.waitForSelector('.course-row', { timeout: 20000 })
}

// Resolve a course row, expanding a variant group if there is one. Returns
// the locator to click — the caller clicks it, so t0 is theirs to set.
export async function courseRow(page, text) {
  const row = page.locator(`.course-row:has-text("${text}")`).first()
  if (!(await row.count())) throw new Error(`no course row matching "${text}"`)
  const hasVariants = await row.evaluate((el) => el.classList.contains('has-variants')).catch(() => false)
  if (hasVariants) {
    await row.click()
    await page.waitForSelector('.course-row.variant', { timeout: 8000 })
    return page.locator('.course-row.variant').first()
  }
  return row
}

// READY = the player says it is playable: belt badge visible (v-if
// isPlayerReady) and the name shows the course we asked for.
export async function waitReady(page, nameFragment, deadlineMs) {
  while (Date.now() < deadlineMs) {
    const name = await courseName(page)
    const badge = await page.locator('.belt-badge').isVisible().catch(() => false)
    if (badge && (!nameFragment || name.toLowerCase().includes(nameFragment.toLowerCase()))) return name
    await page.waitForTimeout(50)
  }
  return null
}

// ── Stats ───────────────────────────────────────────────────────────────────
// Median + full spread. A single figure is exactly the kind of number this
// whole job exists to stop trusting.
export function stat(values) {
  const v = values.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return { n: 0, median: null, min: null, max: null, spread: null }
  const median = v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2)
  return {
    n: v.length,
    median: Math.round(median),
    min: v[0],
    max: v[v.length - 1],
    spread: v[0] > 0 ? Number((v[v.length - 1] / v[0]).toFixed(2)) : null,
    all: v,
  }
}
export const secs = (ms) => (ms == null ? null : Number((ms / 1000).toFixed(2)))
