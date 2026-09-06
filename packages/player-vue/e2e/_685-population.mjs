import { readFileSync } from 'node:fs'
const env = readFileSync('/home/tomcassidy/ssi-learning-app/.env', 'utf8')
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)', 'm')) || [])[1]?.trim()
const URL_ = g('SUPABASE_URL'), KEY = g('SUPABASE_SERVICE_ROLE_KEY')
const h = { apikey: KEY, Authorization: 'Bearer ' + KEY }
const q = (path) => fetch(URL_ + '/rest/v1/' + path, { headers: h }).then((r) => r.json())
const CEILING = 19  // PREMIUM_PREVIEW_MAX_SEED — Yellow Belt

// --- who is entitled to more than the preview -------------------------------
const [subs, ents, learners, courses] = await Promise.all([
  q('subscriptions?select=learner_id,status,current_period_end,plan_name'),
  q('user_entitlements?select=learner_id,access_type,granted_courses,expires_at'),
  q('learners?select=id,user_id,display_name,platform_role,educational_role,is_demo,is_internal'),
  q('courses?select=course_code,pricing_tier,is_community,display_name'),
])
const now = new Date()
const premium = new Set(courses.filter((c) => !c.is_community && c.pricing_tier !== 'free' && c.pricing_tier !== 'community').map((c) => c.course_code))
const byLearner = new Map(learners.map((l) => [l.id, l]))

const entitledWhy = new Map() // learnerId -> {reason, courses:Set|'*'}
const add = (id, reason, courseSet) => {
  if (!id) return
  const cur = entitledWhy.get(id)
  if (!cur) return entitledWhy.set(id, { reasons: [reason], courses: courseSet })
  cur.reasons.push(reason)
  if (cur.courses !== '*' && courseSet === '*') cur.courses = '*'
  else if (cur.courses !== '*' && courseSet) courseSet.forEach((c) => cur.courses.add(c))
}
for (const s of subs) {
  const active = s.status === 'active' && (!s.current_period_end || new Date(s.current_period_end) > now)
  if (active) add(s.learner_id, 'subscription(' + (s.plan_name || s.status) + ')', '*')
}
for (const e of ents) {
  if (e.expires_at && new Date(e.expires_at) <= now) continue
  if (e.access_type === 'full') add(e.learner_id, 'entitlement(full)', '*')
  else if (e.access_type === 'courses' && e.granted_courses?.length) add(e.learner_id, 'entitlement(courses)', new Set(e.granted_courses))
}
for (const l of learners) {
  if (l.platform_role === 'ssi_admin' || l.platform_role === 'tester' || l.educational_role === 'god') {
    add(l.id, 'role(' + (l.platform_role || l.educational_role) + ')', '*')
  }
}
// cascade (group → school → class), the same RPC the server calls
let cascadeCount = 0
for (const l of learners) {
  if (!l.user_id) continue
  try {
    const r = await fetch(URL_ + '/rest/v1/rpc/get_cascade_courses', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_user_id: l.user_id }) }).then((x) => x.json())
    if (Array.isArray(r) && r.length) { add(l.id, 'cascade(school/group/class)', new Set(r.map((x) => (typeof x === 'string' ? x : x.course_code ?? x)))); cascadeCount++ }
  } catch {}
}
console.log(`learners: ${learners.length} | premium courses: ${premium.size} | entitled beyond preview: ${entitledWhy.size} (of which ${cascadeCount} via school/group/class cascade)`)

// --- their premium enrollments, and where they actually are -----------------
const ids = [...entitledWhy.keys()]
const enr = []
for (let i = 0; i < ids.length; i += 60) {
  const batch = ids.slice(i, i + 60)
  enr.push(...await q('course_enrollments?select=learner_id,course_id,highest_completed_lego_id,last_completed_lego_id,highest_completed_seed,last_practiced_at,total_practice_minutes,enrolled_at&learner_id=in.(' + batch.join(',') + ')'))
}
const seedOf = (legoId) => { const m = /^S(\d+)/.exec(String(legoId || '')); return m ? parseInt(m[1], 10) : null }
const rows = []
for (const e of enr) {
  if (!premium.has(e.course_id)) continue
  const w = entitledWhy.get(e.learner_id)
  if (w.courses !== '*' && !w.courses.has(e.course_id)) continue
  const furthest = Math.max(e.highest_completed_seed ?? 0, seedOf(e.highest_completed_lego_id) ?? 0, seedOf(e.last_completed_lego_id) ?? 0)
  const l = byLearner.get(e.learner_id) || {}
  rows.push({ learner: e.learner_id, name: l.display_name, demo: !!l.is_demo, internal: !!l.is_internal,
    course: e.course_id, furthest, played: e.last_practiced_at, mins: e.total_practice_minutes ?? 0,
    enrolled: e.enrolled_at, why: w.reasons.join('+') })
}
const stuck = rows.filter((r) => r.furthest <= CEILING)
const past = rows.filter((r) => r.furthest > CEILING)
console.log(`entitled premium enrollments: ${rows.length} | past the ceiling (definitely not poisoned): ${past.length} | at/below the ${CEILING}-seed ceiling: ${stuck.length}`)
const everPlayed = stuck.filter((r) => r.played)
const neverPlayed = stuck.filter((r) => !r.played)
console.log(`  of the stuck: ${everPlayed.length} have played at least once, ${neverPlayed.length} never played at all (indistinguishable from "not started")`)
console.log('\n--- entitled, played, and stuck at or below the preview ceiling (the candidate population) ---')
everPlayed.sort((a, b) => String(b.played).localeCompare(String(a.played)))
for (const r of everPlayed) console.log(`  ${String(r.name || '(no name)').padEnd(22)} ${r.course.padEnd(16)} furthest seed ${String(r.furthest).padStart(3)} | last played ${String(r.played).slice(0, 10)} | ${r.why}${r.demo ? ' [demo]' : ''}${r.internal ? ' [internal]' : ''}`)
console.log('\n--- past the ceiling: cleared, cannot be poisoned ---')
past.sort((a, b) => b.furthest - a.furthest)
for (const r of past.slice(0, 25)) console.log(`  ${String(r.name || '(no name)').padEnd(22)} ${r.course.padEnd(16)} seed ${String(r.furthest).padStart(4)} | ${String(r.played).slice(0, 10)} | ${r.why}`)

// --- the discriminating cut -------------------------------------------------
// A learner who opened a course once and stopped looks identical to a poisoned
// one. What does NOT look identical: real time spent, still stuck under the
// ceiling. 19 seeds is well under an hour of play.
const suspicious = everPlayed.filter((r) => r.mins >= 20)
console.log(`\n--- entitled, stuck at/below seed ${CEILING}, AND >=20 minutes of recorded practice (${suspicious.length}) ---`)
suspicious.sort((a, b) => b.mins - a.mins)
for (const r of suspicious) console.log(`  ${String(r.name || '(no name)').padEnd(22)} ${r.course.padEnd(16)} seed ${String(r.furthest).padStart(3)} | ${String(r.mins).padStart(4)} min | last ${String(r.played).slice(0,10)} | ${r.why}`)
const tasted = everPlayed.filter((r) => r.mins < 20)
console.log(`\n(the other ${tasted.length} played for under 20 minutes total — a tasting, indistinguishable from poison)`)
