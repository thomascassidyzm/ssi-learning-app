#!/usr/bin/env node
/**
 * Deploy Sentinel — stage 1: post-deploy fallout watcher for saysomethingin.app.
 *
 * Runs on watson-1 via cron every 3 minutes (see README.md for the crontab line).
 * Each tick:
 *   1. Polls `git ls-remote origin main`. A new SHA opens a ~2h deploy-watch window.
 *   2. During a window, three legs run:
 *      (a) deploy-live: /version.json buildNumber must reach the new SHA's short form,
 *          cross-checked against GitHub's Vercel Production deployment status (a Vercel
 *          usage-cap block or build failure shows up there as failure/error, or as no
 *          Production deployment at all).
 *      (b) telemetry: player_events (env=production) volume in the window vs a
 *          same-clock-window baseline over the 4 prior weeks. Needs a service-role
 *          key (see README); without one the leg reports "unavailable", plainly.
 *      (c) probes: cheap GETs against load-bearing prod endpoints.
 *   3. Outcomes: fallout posts a loud needs-you card (which pushes to Tom's devices),
 *      once per failure class per window; a clean window closes with ONE quiet
 *      all-clear on the done board.
 *
 * State lives in state.json next to this file (gitignored). Logs append to
 * sentinel.log (gitignored). Read-only against production; zero writes anywhere.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const STATE_FILE = join(HERE, 'state.json')
const LOG_FILE = join(HERE, 'sentinel.log')

const PROD = 'https://saysomethingin.app'
const SURFACE = 'http://localhost:4317'
// Project chat this sentinel reports under (deploy-sentinel channel on the command surface).
const CONV_ID = '31029bc7-a18f-4cf0-9878-283e29e769f8'
const GH_REPO = 'thomascassidyzm/ssi-learning-app'

const WINDOW_MS = 2 * 60 * 60 * 1000 // 2h watch window
const DEPLOY_GRACE_MS = 20 * 60 * 1000 // deploy not live after 20 min => fallout
const TELEMETRY_EVERY_MS = 15 * 60 * 1000
const TELEMETRY_MIN_ELAPSED_MS = 60 * 60 * 1000 // no volume verdict before 1h of window
const CRATER_RATIO = 0.35 // window volume < 35% of baseline median => crater
const BASELINE_FLOOR = 50 // baseline median below this => too quiet to judge, say so
const PROBE_FAIL_STREAK = 2 // consecutive tick failures before a probe alerts

// Supabase (telemetry leg). Service-role key is looked up from the environment,
// then from ~/.ssi-sentinel.env (KEY=value lines). Anon cannot read player_events
// (by design); if no service key is found the leg reports unavailable.
const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  try {
    const txt = readFileSync(join(process.env.HOME, '.ssi-sentinel.env'), 'utf8')
    const m = txt.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* no creds file */ }
  return null
}

// Known-good audio id for the proxy probe (verified live 2026-07-29, 37 KB mp3).
const PROBES = [
  { name: 'app shell', url: `${PROD}/`, expectBody: '<div id="app"' },
  { name: 'sw-config', url: `${PROD}/api/sw-config`, expectBody: 'killSwitch' },
  { name: 'courses list', url: `${PROD}/api/courses/available` },
  { name: 'audio proxy', url: `${PROD}/api/audio/b2d004e0-4cdf-45bf-b074-265ccc88aae0` },
  { name: 'player-events reachability', url: `${PROD}/api/player-events`, method: 'OPTIONS' },
]

const now = () => Date.now()
const iso = (t) => new Date(t).toISOString()
const log = (msg) => {
  const line = `${iso(now())} ${msg}`
  console.log(line)
  try { appendFileSync(LOG_FILE, line + '\n') } catch { /* logging is best-effort */ }
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n') }

async function fetchText(url, opts = {}, timeoutMs = 20000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal })
    const body = opts.method === 'OPTIONS' || opts.head ? '' : await r.text()
    return { status: r.status, body }
  } catch (e) {
    return { status: 0, body: '', error: String(e && e.cause ? e.cause : e) }
  } finally { clearTimeout(t) }
}

function postBoard(path, payload) {
  // Fire the surface post synchronously-ish; failures are logged, never fatal.
  return fetchText(`${SURFACE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: CONV_ID, ...payload }),
  }).then((r) => {
    log(`board POST ${path} -> ${r.status} :: ${payload.text}`)
    return r.status >= 200 && r.status < 300
  })
}

function remoteMainSha() {
  const out = execFileSync('git', ['-C', REPO, 'ls-remote', 'origin', 'main'], {
    encoding: 'utf8', timeout: 60000,
  })
  const sha = out.split(/\s/)[0]
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error(`bad ls-remote output: ${out.slice(0, 80)}`)
  return sha
}

// GitHub deployments API via authed gh CLI: Vercel's Production deploy record +
// latest status for a sha. Distinguishes "Vercel never built it / blocked" from
// "built but version not live yet".
function githubDeployState(sha) {
  try {
    const deps = JSON.parse(execFileSync('gh', [
      'api', `repos/${GH_REPO}/deployments?environment=Production&per_page=10`,
    ], { encoding: 'utf8', timeout: 30000 }))
    const dep = deps.find((d) => d.sha === sha)
    if (!dep) return { found: false }
    const statuses = JSON.parse(execFileSync('gh', [
      'api', `repos/${GH_REPO}/deployments/${dep.id}/statuses?per_page=1`,
    ], { encoding: 'utf8', timeout: 30000 }))
    return { found: true, state: statuses[0]?.state || 'pending' }
  } catch (e) {
    return { found: null, error: String(e).slice(0, 200) }
  }
}

async function liveBuildNumber() {
  const r = await fetchText(`${PROD}/version.json?sentinel=${now()}`, {}, 15000)
  if (r.status !== 200) return null
  try { return JSON.parse(r.body).buildNumber } catch { return null }
}

// --- telemetry leg ---------------------------------------------------------

async function countEvents(key, fromMs, toMs) {
  const url = `${SUPABASE_URL}/rest/v1/player_events?select=id&env=eq.production` +
    `&event_type=neq.sentinel_synthetic_probe` +
    `&occurred_at=gte.${iso(fromMs)}&occurred_at=lt.${iso(toMs)}&limit=1`
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 20000)
  try {
    const r = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
      signal: ctl.signal,
    })
    if (r.status !== 200 && r.status !== 206) return { error: `HTTP ${r.status}` }
    const range = r.headers.get('content-range') || ''
    const total = Number(range.split('/')[1])
    return Number.isFinite(total) ? { count: total } : { error: `bad content-range: ${range}` }
  } catch (e) {
    return { error: String(e).slice(0, 200) }
  } finally { clearTimeout(t) }
}

async function telemetryVerdict(win) {
  const key = serviceKey()
  if (!key) return { available: false, note: 'no service-role key on this VM — telemetry leg inactive' }
  const from = win.openedAt
  const to = now()
  const cur = await countEvents(key, from, to)
  if (cur.error) return { available: false, note: `player_events query failed: ${cur.error}` }
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const baseline = []
  for (let w = 1; w <= 4; w++) {
    const b = await countEvents(key, from - w * weekMs, to - w * weekMs)
    if (!b.error) baseline.push(b.count)
  }
  if (baseline.length < 2) return { available: false, note: 'baseline query failures — no verdict' }
  // Reference = second-SMALLEST baseline week, not the median. Late-night windows
  // have huge week-to-week variance (real 2026-08-01 false alarm: prior Fridays
  // [0, 3, 177, 688] — median 177 said "crater", but half the baseline weeks were
  // as quiet as the window being judged). If even one other quiet-but-normal week
  // exists, the hour is naturally craterable and volume can't be judged.
  const sorted = baseline.sort((a, b) => a - b)
  const ref = sorted[1]
  const elapsed = to - from
  const result = { available: true, window: cur.count, baselineRef: ref, baseline: sorted, elapsedMin: Math.round(elapsed / 60000) }
  if (elapsed < TELEMETRY_MIN_ELAPSED_MS) return { ...result, verdict: 'too-early' }
  if (ref < BASELINE_FLOOR) return { ...result, verdict: 'too-quiet' }
  return { ...result, verdict: cur.count < ref * CRATER_RATIO ? 'crater' : 'ok' }
}

// --- probes ----------------------------------------------------------------

async function runProbes() {
  const results = []
  for (const p of PROBES) {
    const r = await fetchText(p.url, p.method ? { method: p.method } : {}, 20000)
    const ok = r.status === 200 && (!p.expectBody || r.body.includes(p.expectBody))
    results.push({ name: p.name, status: r.status, ok, error: r.error })
  }
  return results
}

// --- main tick -------------------------------------------------------------

async function tick() {
  const state = loadState()
  let sha
  try {
    sha = remoteMainSha()
  } catch (e) {
    log(`WARN ls-remote failed: ${String(e).slice(0, 150)}`)
    return
  }

  if (!state.lastMainSha) {
    // First ever run: adopt current main without opening a window.
    state.lastMainSha = sha
    saveState(state)
    log(`initialized, main at ${sha.slice(0, 7)}`)
    return
  }

  if (sha !== state.lastMainSha) {
    if (state.window && !state.window.closedAt) {
      log(`new push ${sha.slice(0, 7)} supersedes open window for ${state.window.sha.slice(0, 7)}`)
    }
    state.lastMainSha = sha
    state.window = {
      sha, openedAt: now(), deployLiveAt: null, closedAt: null,
      alerted: {}, probeFails: {}, lastTelemetryAt: 0, notes: [],
    }
    saveState(state)
    log(`WINDOW OPEN for main push ${sha.slice(0, 7)}`)
  }

  const win = state.window
  if (!win || win.closedAt) return
  const short = win.sha.slice(0, 7)
  const alertOnce = async (cls, text, detail) => {
    if (win.alerted[cls]) return
    win.alerted[cls] = iso(now())
    await postBoard('/api/needs-you', {
      text, url: PROD,
    })
    win.notes.push({ at: iso(now()), cls, text, detail })
    log(`ALERT [${cls}] ${text} :: ${detail || ''}`)
  }

  // (a) deploy-live
  if (!win.deployLiveAt) {
    const live = await liveBuildNumber()
    if (live === short) {
      win.deployLiveAt = now()
      log(`deploy ${short} confirmed live via version.json`)
      if (win.alerted['deploy']) {
        await postBoard('/api/done', {
          text: `Recovery: deploy ${short} is now live on production (was late/blocked)`,
        })
      }
    } else if (now() - win.openedAt > DEPLOY_GRACE_MS) {
      const gh = githubDeployState(win.sha)
      const ghNote = gh.found === false
        ? 'no Vercel Production deployment exists for this sha (likely Vercel usage block)'
        : gh.found === true
          ? `Vercel Production deployment state: ${gh.state}`
          : `GitHub deploy-state check errored (${gh.error})`
      if (gh.found === true && (gh.state === 'pending' || gh.state === 'in_progress' || gh.state === 'queued')) {
        log(`deploy ${short} still building (${gh.state}), holding alert`)
      } else {
        await alertOnce('deploy',
          `DEPLOY FALLOUT: main push ${short} never went live on saysomethingin.app — deploy never went live (likely Vercel block/build failure). ${ghNote}. Live build: ${live || 'unreadable'}`,
          ghNote)
      }
    }
  }

  // (c) probes — every tick, alert after PROBE_FAIL_STREAK consecutive failures
  const probes = await runProbes()
  for (const p of probes) {
    if (p.ok) { win.probeFails[p.name] = 0; continue }
    win.probeFails[p.name] = (win.probeFails[p.name] || 0) + 1
    log(`probe FAIL ${p.name}: HTTP ${p.status} ${p.error || ''} (streak ${win.probeFails[p.name]})`)
    if (win.probeFails[p.name] >= PROBE_FAIL_STREAK) {
      await alertOnce(`probe:${p.name}`,
        `DEPLOY FALLOUT after ${short}: endpoint probe failing — ${p.name} returned HTTP ${p.status}${p.error ? ` (${p.error})` : ''}, ${win.probeFails[p.name]} consecutive checks`)
    }
  }

  // (b) telemetry — every ~15 min
  let tele = win.lastTelemetry || null
  if (now() - (win.lastTelemetryAt || 0) >= TELEMETRY_EVERY_MS) {
    win.lastTelemetryAt = now()
    tele = await telemetryVerdict(win)
    win.lastTelemetry = tele
    log(`telemetry: ${JSON.stringify(tele)}`)
    if (tele.verdict === 'crater') {
      await alertOnce('telemetry',
        `Possible fallout from tonight's deploy (${short}): learner activity on the live app has almost stopped — only ${tele.window} events in the ${tele.elapsedMin} min since the deploy, when even the QUIETEST recent week at this hour had ${tele.baselineRef}. This can mean learners can't load or play. Worth a quick look at saysomethingin.app.`)
    }
  }

  // window close
  if (now() - win.openedAt >= WINDOW_MS) {
    win.closedAt = now()
    const failures = Object.keys(win.alerted)
    if (failures.length === 0) {
      const teleLine = !tele ? 'telemetry: not checked'
        : !tele.available ? `telemetry: ${tele.note}`
          : tele.verdict === 'too-quiet'
            ? `telemetry: this hour is naturally quiet in prior weeks (${tele.baseline?.join('/')}) — volume not judged`
            : `telemetry: ${tele.window} events vs quietest-recent-week ${tele.baselineRef} — healthy`
      const probeLine = `probes: ${probes.filter((p) => p.ok).length}/${probes.length} green`
      const deployLine = win.deployLiveAt
        ? `deploy ${short} live at ${iso(win.deployLiveAt)}`
        : `deploy ${short} NEVER confirmed live` // unreachable without an alert, but honest
      await postBoard('/api/done', {
        text: `Deploy ${short} to production: 2h watch clean — no fallout`,
        detail: `${deployLine}; ${probeLine}; ${teleLine}`,
        url: PROD,
      })
      log(`WINDOW CLOSED clean for ${short}`)
    } else {
      log(`WINDOW CLOSED for ${short} with alerts: ${failures.join(', ')} (already surfaced)`)
    }
  }

  saveState(state)
}

tick().catch((e) => { log(`FATAL tick error: ${e.stack || e}`); process.exit(1) })
