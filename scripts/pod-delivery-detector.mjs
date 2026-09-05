#!/usr/bin/env node
/**
 * pod-delivery-detector.mjs — is anybody actually RECEIVING listening pods?
 *
 * Born from the Beuno report (Aran → Tom, 2026-09-05): a real learner did a
 * month of German with zero listening exercises, and every dashboard read as a
 * working course. The defect class this detector exists for fails silently in
 * the direction that LOOKS healthy: a held pod, a parked slug, a cadence that
 * a slow-position learner never crosses, a scheduler that quietly composed
 * nothing — all of them produce the same observable, which is nothing at all.
 *
 * So this measures DELIVERY, not intent: rows in player_events, never code
 * paths. Per live course, over a trailing window, for REAL learners only
 * (demo/internal/e2e excluded):
 *
 *   owed      — laps of listening work earned: floor(roundsCompleted/interval)
 *               per learner, summed. Rounds COMPLETED is deliberate: replays,
 *               easy-mode rounds and short sessions all count. That is the
 *               measure of work done; round POSITION is the proxy that hid
 *               Beuno (his position crawled 10→14 in a month of real work).
 *   delivered — pod_lap_start events with payload.isLayer1 === false. The
 *               flag exists since 2026-08-31 because L1 seed cups ride the
 *               same event name; an unflagged event proves NOTHING about pod
 *               dialogue (that ambiguity fooled a reading on 2026-08-31), so
 *               unflagged events are counted separately and never credited.
 *   servable  — does the course have a LIVE row in listening_pods at all?
 *               A course whose every pod is held/parked cannot deliver, ever,
 *               and must be loud about it even when the hold is deliberate.
 *
 * Verdicts (per course with active real learners):
 *   RED   no-servable-pod — learners active, no live pod row. Nothing can fire.
 *   RED   zero-delivery   — ≥1 lap owed across the course, zero delivered.
 *   AMBER under-delivery  — ≥2 owed, delivered under half of owed.
 *   GREEN otherwise.
 *
 * Exit 1 on any RED (CI/red-notice semantics), 0 otherwise. READ-ONLY: this
 * script never writes to the database.
 *
 * Run:      node scripts/pod-delivery-detector.mjs [--days 7] [--notice]
 * Needs:    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env, or in ./.env
 *           (node --env-file=.env also works). Service key because RLS hides
 *           other learners' rows from any lesser key — this is a fleet census.
 * --notice: on RED, post one plain-English notice into this repo's project
 *           channel on the command surface (same delivery path as the
 *           audio-gap nightly). Default: print + exit code only.
 */

import { readFileSync } from 'node:fs'

// ── Pure verdict logic (unit-tested in pod-delivery-detector.test.ts) ────────

export const FIRE_INTERVAL_ROUNDS = 5

/**
 * @param {{ activeLearners: number, lapsOwed: number, delivered: number,
 *           servedPodStatus: 'live'|'held-only'|'none' }} c
 * @returns {'RED no-servable-pod'|'RED zero-delivery'|'AMBER under-delivery'|'GREEN'}
 */
export function classifyCourse(c) {
  if (c.activeLearners > 0 && c.servedPodStatus !== 'live') return 'RED no-servable-pod'
  if (c.lapsOwed >= 1 && c.delivered === 0) return 'RED zero-delivery'
  if (c.lapsOwed >= 2 && c.delivered < c.lapsOwed / 2) return 'AMBER under-delivery'
  return 'GREEN'
}

/** Laps of listening work a learner has earned in the window. */
export function lapsOwedFor(roundsCompleted, interval = FIRE_INTERVAL_ROUNDS) {
  return Math.floor(Math.max(0, roundsCompleted) / Math.max(1, interval))
}

/** Real-learner filter — mirrors the census convention: demo, internal and
 *  name-marked test accounts are not delivery evidence. */
export function isTestLearner(l) {
  return !l || l.is_demo || l.is_internal || /e2e-|test|probe|audit/i.test(l.display_name || '')
}

// ── Census runner ────────────────────────────────────────────────────────────

const argAfter = (flag, dflt) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

function loadEnv() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Best-effort .env parse so the nightly needs no wrapper. Never throws —
    // the missing-credential error below is the one that names the fix.
    try {
      for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
        const m = line.match(/^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=(.+)$/)
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
      }
    } catch { /* fall through to the named error */ }
  }
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('pod-delivery-detector: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (env or repo-root .env)')
    process.exit(2) // could-not-run, never a silent green
  }
  return { url, key }
}

async function main() {
  const { url, key } = loadEnv()
  const days = Number(argAfter('--days', '7'))
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const get = async (path) => {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
    return r.json()
  }
  const getAll = async (path) => {
    const all = []
    for (let off = 0; ; off += 1000) {
      const rows = await get(`${path}&limit=1000&offset=${off}`)
      all.push(...rows)
      if (rows.length < 1000) break
    }
    return all
  }

  const [learnerRows, pods, rounds, laps] = await Promise.all([
    getAll('learners?select=id,display_name,is_demo,is_internal'),
    getAll('listening_pods?select=course_code,slug,visibility'),
    getAll(`player_events?select=user_id,course_code,payload&event_type=eq.round_complete&occurred_at=gte.${since}`),
    getAll(`player_events?select=user_id,course_code,payload&event_type=eq.pod_lap_start&occurred_at=gte.${since}`),
  ])

  const learners = new Map(learnerRows.map((l) => [l.id, l]))
  const real = (id) => !isTestLearner(learners.get(id))

  // Course → served-pod status. 'live' iff any visibility='live' row exists.
  const podStatus = new Map()
  for (const p of pods) {
    const cur = podStatus.get(p.course_code)
    if (p.visibility === 'live') podStatus.set(p.course_code, 'live')
    else if (cur !== 'live') podStatus.set(p.course_code, 'held-only')
  }

  // Per course/learner rounds completed.
  const roundsBy = new Map() // course → Map(learner → count)
  for (const e of rounds) {
    if (!real(e.user_id)) continue
    const m = roundsBy.get(e.course_code) ?? new Map()
    m.set(e.user_id, (m.get(e.user_id) ?? 0) + 1)
    roundsBy.set(e.course_code, m)
  }

  // Per course delivered pod dialogues (flagged) + unflagged (old clients).
  const lapsBy = new Map() // course → { delivered, unflagged, learners:Set }
  for (const e of laps) {
    if (!real(e.user_id)) continue
    const isL1 = e.payload?.isLayer1
    if (isL1 === true) continue // seed cup, not a pod dialogue
    const a = lapsBy.get(e.course_code) ?? { delivered: 0, unflagged: 0, learners: new Set() }
    if (isL1 === false) { a.delivered++; a.learners.add(e.user_id) } else a.unflagged++
    lapsBy.set(e.course_code, a)
  }

  const results = []
  for (const [course, byLearner] of [...roundsBy.entries()].sort()) {
    const activeLearners = byLearner.size
    let lapsOwed = 0
    for (const n of byLearner.values()) lapsOwed += lapsOwedFor(n)
    const lp = lapsBy.get(course) ?? { delivered: 0, unflagged: 0, learners: new Set() }
    const servedPodStatus = podStatus.get(course) ?? 'none'
    const verdict = classifyCourse({ activeLearners, lapsOwed, delivered: lp.delivered, servedPodStatus })
    results.push({ course, activeLearners, lapsOwed, delivered: lp.delivered, unflagged: lp.unflagged, servedPodStatus, verdict })
  }

  const reds = results.filter((r) => r.verdict.startsWith('RED'))
  const ambers = results.filter((r) => r.verdict.startsWith('AMBER'))

  console.log(`pod-delivery-detector — window: last ${days} day(s), real learners only`)
  console.log('course | learners | lapsOwed | podDialoguesDelivered | unflaggedLaps(old client) | servedPod | verdict')
  for (const r of results) {
    console.log(`${r.course} | ${r.activeLearners} | ${r.lapsOwed} | ${r.delivered} | ${r.unflagged} | ${r.servedPodStatus} | ${r.verdict}`)
  }
  console.log(`\n${reds.length} RED, ${ambers.length} AMBER, ${results.length - reds.length - ambers.length} GREEN of ${results.length} active courses`)

  if (reds.length && process.argv.includes('--notice')) {
    await postNotice(reds, ambers, days).catch((e) => console.error(`notice FAILED: ${e.message}`))
  }
  process.exit(reds.length ? 1 : 0)
}

/** One plain-English notice into this repo's project channel — the same
 *  delivery path the audio-gap nightly uses. A detector talking to nobody is
 *  not a detector. */
async function postNotice(reds, ambers, days) {
  const SURFACE = process.env.CS_SURFACE || 'http://localhost:4317'
  const api = async (method, route, body) => {
    const r = await fetch(SURFACE + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const t = await r.text()
    if (!r.ok) throw new Error(`${method} ${route} → ${r.status} ${t.slice(0, 200)}`)
    try { return JSON.parse(t) } catch { return t }
  }
  const chans = await api('GET', '/api/channels')
  const ch = (chans.channels || []).find((c) => /ssi-learning-app/.test(c.cwd || ''))
  if (!ch) { console.error('no project channel for ssi-learning-app — notice NOT delivered'); return }
  const lines = [
    `Listening pods are NOT reaching learners on ${reds.length} course(s) (last ${days} days, real learners only):`,
    ...reds.map((r) => `• ${r.course} — ${r.activeLearners} learner(s) did ${r.lapsOwed} lap(s) worth of work, got ${r.delivered} pod dialogue(s)${r.servedPodStatus !== 'live' ? ` — no live pod to serve (${r.servedPodStatus})` : ''}`),
    ambers.length ? `Under-delivering: ${ambers.map((r) => r.course).join(', ')}` : '',
    'Detector: scripts/pod-delivery-detector.mjs (ssi-learning-app).',
  ].filter(Boolean)
  await api('POST', '/api/reply', { jobId: ch.convId, automated: true, text: lines.join('\n') })
  console.log('notice posted to the ssi-learning-app channel')
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => { console.error(e); process.exit(2) })
}
