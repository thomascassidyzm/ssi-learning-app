// The two spine outputs: (1) the active-learner population, (2) the full
// player_events event-type census. READ-ONLY, works off the cache files.
import fs from 'node:fs'
const d = new URL('.', import.meta.url).pathname
const J = n => JSON.parse(fs.readFileSync(d + n))
const L = J('_cache-learners.json')
const S = J('_cache-sessions.json')
const NOW = new Date('2026-08-19T00:00:00Z')
const CUT90 = new Date(NOW - 90 * 864e5).toISOString()

// ---- demo/test exclusion --------------------------------------------------
// is_demo: the generator's own flag. is_class_entity: a class placeholder row,
// not a person. is_internal: SSi staff accounts. Guests never get a learners row.
const real = L.filter(l => !l.is_demo && !l.is_class_entity)
const realNoStaff = real.filter(l => !l.is_internal && l.platform_role !== 'ssi_admin' && l.platform_role !== 'tester')

// ---- play time and recency ------------------------------------------------
const play = new Map(), lastSess = new Map(), sessCount = new Map(), coursesByLearner = new Map()
for (const s of S) {
  const secs = s.duration_seconds || 0
  play.set(s.learner_id, (play.get(s.learner_id) || 0) + secs)
  const t = s.started_at || ''
  if (t > (lastSess.get(s.learner_id) || '')) lastSess.set(s.learner_id, t)
  if (secs > 0 || s.items_practiced > 0) sessCount.set(s.learner_id, (sessCount.get(s.learner_id) || 0) + 1)
  if (s.course_id) {
    const set = coursesByLearner.get(s.learner_id) || new Set()
    set.add(s.course_id); coursesByLearner.set(s.learner_id, set)
  }
}

const hours = id => (play.get(id) || 0) / 3600
const activeOf = pool => pool.filter(l =>
  (sessCount.get(l.id) || 0) > 0 && hours(l.id) >= 2 && (lastSess.get(l.id) || '') >= CUT90)
const activeLoose = pool => pool.filter(l =>
  (sessCount.get(l.id) || 0) > 0 && hours(l.id) >= 0.5 && (lastSess.get(l.id) || '') >= CUT90)

const ACTIVE = activeOf(realNoStaff)
const out = {
  generated_for: NOW.toISOString(), window90_from: CUT90,
  learners_total: L.length,
  excluded: { is_demo: L.filter(l => l.is_demo).length, is_class_entity: L.filter(l => l.is_class_entity).length,
              is_internal: L.filter(l => l.is_internal).length,
              staff_role: L.filter(l => l.platform_role === 'ssi_admin' || l.platform_role === 'tester').length },
  real_learners: real.length,
  real_excl_staff: realNoStaff.length,
  ever_played_a_session: realNoStaff.filter(l => (sessCount.get(l.id) || 0) > 0).length,
  active_strict_2h_90d: ACTIVE.length,
  active_incl_staff_2h_90d: activeOf(real).length,
  active_loose_30min_90d: activeLoose(realNoStaff).length,
  active_any_session_90d: realNoStaff.filter(l => (sessCount.get(l.id) || 0) > 0 && (lastSess.get(l.id) || '') >= CUT90).length,
  hours_percentiles: (() => {
    const v = ACTIVE.map(l => hours(l.id)).sort((a, b) => a - b)
    const p = q => v.length ? +v[Math.floor(q * (v.length - 1))].toFixed(1) : null
    return { min: p(0), p25: p(0.25), median: p(0.5), p75: p(0.75), max: p(1) }
  })(),
}
fs.writeFileSync(d + '_out-population.json', JSON.stringify({ ...out, active_ids: ACTIVE.map(l => l.id), loose_ids: activeLoose(realNoStaff).map(l => l.id) }, null, 1))
console.log(JSON.stringify(out, null, 1))

// ---- event-type census ----------------------------------------------------
const activeSet = new Set(ACTIVE.map(l => l.id))
const acc = new Map()
const bump = (t, key, learner) => {
  let e = acc.get(t)
  if (!e) { e = { all: 0, allL: new Set(), d90: 0, d90L: new Set(), act: 0, actL: new Set(), act90: 0, act90L: new Set() }; acc.set(t, e) }
  e[key]++
  if (learner) e[key + 'L'].add(learner)
}
let rows = 0
for (const line of fs.readFileSync(d + '_cache-events.jsonl', 'utf8').split('\n')) {
  if (!line) continue
  rows++
  const e = JSON.parse(line)
  const t = e.event_type || '(null)'
  const l = e.learner_id || e.user_id || null
  bump(t, 'all', l)
  const recent = e.occurred_at >= CUT90
  if (recent) bump(t, 'd90', l)
  if (l && activeSet.has(l)) { bump(t, 'act', l); if (recent) bump(t, 'act90', l) }
}
const census = [...acc.entries()].map(([event_type, e]) => ({
  event_type,
  all_events: e.all, all_learners: e.allL.size,
  d90_events: e.d90, d90_learners: e.d90L.size,
  active_events: e.act, active_learners: e.actL.size,
  active_d90_events: e.act90, active_d90_learners: e.act90L.size,
})).sort((a, b) => b.all_events - a.all_events)
fs.writeFileSync(d + '_out-census.json', JSON.stringify({ rows, census }, null, 1))
console.log('\nrows scanned', rows, '| distinct event types', census.length)
console.table(census)
