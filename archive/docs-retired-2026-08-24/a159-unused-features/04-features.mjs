// Per-feature adoption among the active population. READ-ONLY.
// Reads the cache files from 01/02 plus three small live pulls (offline_leases,
// user_entitlements, and the audio_play playbackSpeed slice, which is too big
// to have been cached in 01).
import fs from 'node:fs'
import { rest } from './_db.mjs'
const d = new URL('.', import.meta.url).pathname
const J = n => JSON.parse(fs.readFileSync(d + n))

const pop = J('_out-population.json')
const ACT = new Set(pop.active_ids)
const N = ACT.size
const L = J('_cache-learners.json')
const S = J('_cache-sessions.json')
const E = J('_cache-enrollments.json')
const M = J('_cache-metrics.json')

const pct = n => `${((n / N) * 100).toFixed(0)}%`
const rows = []
const add = (feature, n, basis) => rows.push({ feature, active_learners: n, pct: pct(n), basis })

// ---- event-derived signals ------------------------------------------------
const byType = new Map()   // event_type -> Set(active learner ids)
const speedLearners = new Set()
for (const line of fs.readFileSync(d + '_cache-events.jsonl', 'utf8').split('\n')) {
  if (!line) continue
  const e = JSON.parse(line)
  const l = e.learner_id || e.user_id
  if (!l || !ACT.has(l)) continue
  let s = byType.get(e.event_type); if (!s) { s = new Set(); byType.set(e.event_type, s) }
  s.add(l)
}
const ev = t => (byType.get(t) || new Set())
const union = (...ts) => new Set(ts.flatMap(t => [...ev(t)]))

// playback speed: the whole non-1 slice, keyset paginated on id
{
  let last = 0
  for (;;) {
    const { rows: r } = await rest(`player_events?select=id,learner_id&event_type=eq.audio_play&payload->>playbackSpeed=neq.1&order=id.asc&limit=20000&id=gt.${last}`)
    if (!r.length) break
    for (const x of r) if (x.learner_id && ACT.has(x.learner_id)) speedLearners.add(x.learner_id)
    last = r[r.length - 1].id
    if (r.length < 20000) break
  }
}

// ---- table-derived signals ------------------------------------------------
const micMetrics = new Set(M.filter(m => ACT.has(m.learner_id)).map(m => m.learner_id))
const leases = (await rest('offline_leases?select=learner_id,is_trial,revoked_at')).rows
const ents = (await rest('user_entitlements?select=learner_id,redeemed_at')).rows

const courseBySess = new Map()
for (const s of S) { if (!ACT.has(s.learner_id) || !s.course_id) continue
  const set = courseBySess.get(s.learner_id) || new Set(); set.add(s.course_id); courseBySess.set(s.learner_id, set) }
const enrByLearner = new Map()
for (const e of E) { if (!ACT.has(e.learner_id)) continue
  const set = enrByLearner.get(e.learner_id) || new Set(); set.add(e.course_id); enrByLearner.set(e.learner_id, set) }

const prefOf = k => new Set(L.filter(l => ACT.has(l.id) && l.preferences && l.preferences[k] !== undefined && l.preferences[k] !== null).map(l => l.id))
const prefTrue = k => new Set(L.filter(l => ACT.has(l.id) && l.preferences && l.preferences[k] === true).map(l => l.id))

// ---- the table ------------------------------------------------------------
add('Personalised pacing / VAD — mic consent granted (metrics proxy)', micMetrics.size,
  'learner_lego_metrics rows exist; LearningPlayer.vue only calls recordCycle when VAD produced a latency, so any row proves consent')
add('Personalised pacing / VAD — prosody captured', ev('cycle_prosody').size, "player_events event_type='cycle_prosody'")
add('Adaptation plan actually computed for them', ev('adaptation_plan').size, "player_events event_type='adaptation_plan'")
add('Listening mode / pronunciation mode — mode chosen or toggled',
  union('learning_mode_selection', 'learning_mode_toggle').size,
  "player_events 'learning_mode_selection' ∪ 'learning_mode_toggle'")
add('Listening mode — actually played (ticks)', ev('listening_tick').size, "player_events 'listening_tick'")
add('Learning mode persisted on the learner row', prefOf('learning_mode').size, 'learners.preferences.learning_mode present')
add('Turbo mode — toggled', ev('turbo_toggle').size, "player_events 'turbo_toggle'")
add('Turbo mode — enabled on the learner row', prefTrue('turbo_mode_enabled').size, 'learners.preferences.turbo_mode_enabled === true')
add('Playback speed changed away from 1x', speedLearners.size, "audio_play payload->>playbackSpeed != 1")
add('Offline download — listening pack started', union('listening_pack_start', 'tap_listening_download').size,
  "player_events 'listening_pack_start' ∪ 'tap_listening_download'")
add('Offline download — lease taken', new Set(leases.filter(l => ACT.has(l.learner_id)).map(l => l.learner_id)).size, 'offline_leases rows')
add('Two or more courses — by sessions', [...courseBySess.values()].filter(s => s.size >= 2).length, 'sessions grouped by course_id')
add('Two or more courses — by enrolments', [...enrByLearner.values()].filter(s => s.size >= 2).length, 'course_enrollments grouped by course_id')
add('Redeem / entitlement code redeemed', new Set(ents.filter(e => ACT.has(e.learner_id)).map(e => e.learner_id)).size, 'user_entitlements.redeemed_at')
add('Arrived via an invite code', L.filter(l => ACT.has(l.id) && l.invite_code_id).length, 'learners.invite_code_id not null')
add('Pod used (lap started)', ev('pod_lap_start').size, "player_events 'pod_lap_start'")
add('Meta-commentary heard', ev('commentary_start').size, "player_events 'commentary_start'")
add('Encouragements setting present on row', prefOf('encouragements_enabled').size, 'learners.preferences.encouragements_enabled (written for everyone — a default, not a choice)')
add('Session-length setting present on row', prefOf('session_duration_minutes').size, 'learners.preferences.session_duration_minutes (same caveat)')
add('Last-course-code remembered on row', prefOf('last_course_code').size, 'learners.preferences.last_course_code')
add('Learner-facing insights surface opened', 0, 'NO SIGNAL — /me is deliberately unlinked from every nav (router/index.ts:475) and emits no event')
add('Script view toggled on', 0, "NO SIGNAL — localStorage 'ssi-show-view-script' only, never written to the DB")
add('PWA installed', 0, "NO SIGNAL — localStorage 'ssi-install-dismissed' only; /install is a static guide with no event")
add('Walkthrough / How This Works opened', 0, 'NO SIGNAL — HowThisWorks.vue lives under components/admin and /methodology is admin-facing; no learner route, no event')

console.table(rows)
fs.writeFileSync(d + '_out-features.json', JSON.stringify({ active_population: N, rows }, null, 1))

// extra detail for the write-up
const detail = {
  active_population: N,
  hours: pop.hours_percentiles,
  metrics_rows_active: M.filter(m => ACT.has(m.learner_id)).length,
  metrics_rows_total: M.length,
  metrics_distinct_learners_total: new Set(M.map(m => m.learner_id)).size,
  prosody_learners_all_time: null,
  offline_leases_total: leases.length,
  offline_leases_active_pop: leases.filter(l => ACT.has(l.learner_id)).length,
  offline_leases_trial: leases.filter(l => l.is_trial).length,
  user_entitlements_total: ents.length,
  courses_per_learner_active: Object.entries([...courseBySess.values()].reduce((a, s) => (a[s.size] = (a[s.size] || 0) + 1, a), {})),
  enrolments_per_learner_active: Object.entries([...enrByLearner.values()].reduce((a, s) => (a[s.size] = (a[s.size] || 0) + 1, a), {})),
}
fs.writeFileSync(d + '_out-detail.json', JSON.stringify(detail, null, 1))
console.log(JSON.stringify(detail, null, 1))
