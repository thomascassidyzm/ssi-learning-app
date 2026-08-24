#!/usr/bin/env node
/**
 * DEMO RECENCY TOP-UP — speaking-opportunity rollups + fresh-dated VAD
 * ====================================================================
 * Written 2026-08-19 after the founder clicked "Refresh demo activity" on the
 * IME Demo Programme and reported: "none of the VAD stuff updated - and in the
 * display for the Kavya Chandra student I can see nothing in the last 7 days".
 *
 * BOTH complaints trace to the same gap: the refresh verb
 * (api/_utils/demoNodeRefresh.ts) regenerates `sessions`, `seed_progress`,
 * `lego_progress` and `class_sessions` — and NOTHING else. In particular it
 * never writes:
 *
 *   1. learner_speaking_opportunities — the per-(learner, course, day) rollup
 *      that EVERY "Last 7 days" panel actually reads. AdminUserDetail.vue's
 *      last7dPracticeSeconds is derived from useAdminUserDetail.ts's
 *      learner_speaking_opportunities query, NOT from `sessions` (that table is
 *      documented there as stale). So the refresh could write a thousand fresh
 *      sessions and the learner's page would still read zero.
 *   2. learner_lego_metrics / player_events(event_type='cycle_prosody') — the
 *      two VAD-fed tables. They have only ever been written by the one-off
 *      demo scripts, so their timestamps stay pinned to whenever those ran
 *      (Kavya Chandra's newest was 2026-07-26 — 24 days before the refresh).
 *
 * This script closes both, additively, against the learners who are already
 * there. It is the DATA half of the fix; the code half (making the refresh verb
 * write rollups itself, every click) lives in demoNodeRefresh.ts.
 *
 *   node scripts/demo-data/topup-vad-recency.cjs --dry-run   # read-only report
 *   node scripts/demo-data/topup-vad-recency.cjs             # writes
 *   node scripts/demo-data/topup-vad-recency.cjs --group=<uuid>
 *
 * ADDITIVE ONLY — three INSERT statements, nothing else. Every one carries an
 * ON CONFLICT DO NOTHING or targets a key that provably does not exist yet. It
 * never deletes, never updates, and never touches identities, schools, groups,
 * classes, courses, enrolments or join codes.
 *
 * THE COVERAGE SPLIT IS PRESERVED, DELIBERATELY. Roughly half the demo learners
 * carry no VAD row at all, and insight/data/vadUptake.ts treats that absence as
 * the insight ("UPTAKE IS THE INSIGHT, NOT MISSING DATA") with a stated
 * denominator under every aggregate. So the VAD half of this script uses the
 * INVERSE of topup-ime-vad.cjs's guard: it only ever tops up a learner who
 * ALREADY carries VAD data. A learner with none stays with none, forever, no
 * matter how many times this runs. Filling the empty half in would destroy the
 * demo's whole point.
 *
 * IDEMPOTENT. A learner whose newest VAD row is already inside the freshness
 * window is skipped; rollup rows collide on their primary key and are dropped.
 * A second run minutes later writes nothing.
 *
 * PAYLOADS ARE THE PROVEN ONES — everything VAD-shaped comes from the shared
 * ./demoTelemetry.cjs (@ssi/core makeLatencySeries + the real
 * extractEnvelopeMetadata), exactly as topup-ime-vad.cjs and
 * generate-demo-suite.cjs use it. No second definition of what demo telemetry
 * looks like.
 *
 * BUILD DEPENDENCY:  pnpm --filter @ssi/core build   (we require the CJS dist)
 * MODULE DEPENDENCY: `pg` is not installed in this repo; run with
 *   NODE_PATH=../ssi-dashboard-v7-clean/node_modules node scripts/...
 */
const fs = require('fs')
const path = require('path')

// ---------- env ----------
// DATABASE_URL is not in this repo's .env; it lives in ~/.secrets/ssi-dashboard.env
// alongside the other live-DB credentials. Repo files still win if present.
function loadEnv(p){const o={};try{for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch{}return o}
const env = {
  ...loadEnv(path.join(process.env.HOME || '', '.secrets/ssi-dashboard.env')),
  ...loadEnv(path.join(__dirname, '../../.env')),
  ...loadEnv(path.join(__dirname, '../../.env.local')),
}
const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL
const { Client } = require('pg')

// ---------- seeded PRNG (a re-run plans the same draws) ----------
let seed = 20260819
function rnd(){ seed|=0; seed=(seed+0x6D2B79F5)|0; let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296 }
const pick=a=>a[Math.floor(rnd()*a.length)]
const between=(lo,hi)=>lo+Math.floor(rnd()*(hi-lo+1))
const uuid=()=>{const h='0123456789abcdef';let s='';for(let i=0;i<36;i++){if(i===8||i===13||i===18||i===23)s+='-';else if(i===14)s+='4';else if(i===19)s+=h[8+Math.floor(rnd()*4)];else s+=h[Math.floor(rnd()*16)]}return s}

const { createDemoTelemetry, MASTERY_BY_ARCHETYPE, DEVICE_CLASS, DEVICE_TYPE } = require('./demoTelemetry.cjs')
const { difficultySeries, prosodyPayload } = createDemoTelemetry(rnd)

const IME_GROUP_ID = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a'
const DAY = 86400000
const PROSODY_CAP = 14   // cycle_prosody rows per learner per run — the same bounded corpus topup-ime-vad.cjs uses
const FRESH_DAYS = 7     // "already fresh" window; also the window new rows land in
const ROLLUP_DAYS = 56   // matches demoNodeRefresh's WINDOW_DAYS — the span it regenerates sessions across

;(async () => {
  if (!DATABASE_URL) { console.error('missing env (DATABASE_URL — expected in ~/.secrets/ssi-dashboard.env)'); process.exit(1) }
  const DRY = process.argv.includes('--dry-run')
  const groupArg = process.argv.find(a => a.startsWith('--group='))
  const GROUP_ID = groupArg ? groupArg.slice('--group='.length) : IME_GROUP_ID

  const db = new Client({ connectionString: DATABASE_URL }); await db.connect()
  const q = (sql, params) => db.query(sql, params)

  console.log(DRY ? '— DRY RUN (read-only, nothing will be written) —' : '— DEMO RECENCY TOP-UP (writing) —')
  console.log(`group: ${GROUP_ID}\n`)

  // ---- SAFETY: every school in the subtree must be a demo/test school ----
  // Same posture as demoNodeRefresh: checked server-side against the live rows,
  // never trusted from an argument.
  const subtree = `
    with recursive tree as (
      select id from public.groups where id=$1
      union all select g.id from public.groups g join tree t on g.parent_id=t.id
    )`
  const schoolCheck = await q(`${subtree}
    select id, school_name, coalesce(is_test,false) as is_test, coalesce(is_demo,false) as is_demo
    from public.schools where group_id in (select id from tree)`, [GROUP_ID])
  if (schoolCheck.rowCount === 0) { console.error('✗ no schools under that group — refusing'); process.exit(1) }
  const nonDemo = schoolCheck.rows.filter(r => !r.is_test && !r.is_demo)
  if (nonDemo.length) {
    console.error(`✗ REFUSING: ${nonDemo.length} school(s) in this subtree are not demo/test:`, nonDemo.map(r => r.school_name).join(', '))
    process.exit(1)
  }
  console.log(`safety: all ${schoolCheck.rowCount} schools in the subtree are demo/test ✓`)

  // ---- roster: student learners under the group ----
  const roster = await q(`${subtree}
    select distinct l.id as learner_id, l.display_name
    from public.schools s
    join public.classes c on c.school_id=s.id
    join public.user_tags ut on ut.tag_type='class' and ut.tag_value='CLASS:'||c.id::text
       and ut.role_in_context='student' and ut.removed_at is null
    join public.learners l on l.user_id=ut.user_id and l.educational_role='student'
    where s.group_id in (select id from tree) and coalesce(l.is_demo,false)=true
    order by l.id`, [GROUP_ID])
  const learnerIds = roster.rows.map(r => r.learner_id)
  const nameById = new Map(roster.rows.map(r => [r.learner_id, r.display_name]))
  console.log(`roster: ${learnerIds.length} demo student learners`)
  if (!learnerIds.length) { await db.end(); return }

  const now = Date.now()
  const freshCut = new Date(now - FRESH_DAYS * DAY).toISOString()

  // ══════════════════════════════════════════════════════════════════════════
  // PART 1 — learner_speaking_opportunities rollups
  //
  // This is what the "Last 7 days" panels read. Roll the refresh's own
  // `sessions` rows up to (learner, course, day) and insert the days that do
  // not exist yet. `opportunities` mirrors items_practiced and `play_seconds`
  // mirrors duration_seconds — the same two numbers the session row carries, so
  // the rollup and the session list can never disagree.
  // ══════════════════════════════════════════════════════════════════════════
  const rollupSince = new Date(now - ROLLUP_DAYS * DAY).toISOString()
  const rollup = await q(`
    select s.learner_id,
           s.course_id                       as course_code,
           (s.started_at at time zone 'utc')::date as day,
           sum(coalesce(s.items_practiced,0))::int  as opportunities,
           sum(coalesce(s.duration_seconds,0))::int as play_seconds
    from public.sessions s
    where s.learner_id = any($1::uuid[]) and s.started_at >= $2 and s.course_id is not null
    group by 1,2,3
    order by 1,2,3`, [learnerIds, rollupSince])

  const existing = await q(`
    select learner_id, course_code, day from public.learner_speaking_opportunities
    where learner_id = any($1::uuid[]) and day >= $2::date`, [learnerIds, rollupSince])
  const seen = new Set(existing.rows.map(r => `${r.learner_id}|${r.course_code}|${r.day.toISOString().slice(0,10)}`))

  const rollupRows = []
  for (const r of rollup.rows) {
    const dayKey = r.day.toISOString().slice(0, 10)
    if (seen.has(`${r.learner_id}|${r.course_code}|${dayKey}`)) continue
    rollupRows.push([r.learner_id, r.course_code, dayKey, r.opportunities, r.play_seconds, r.opportunities])
  }
  const rollupIn7d = rollupRows.filter(r => r[2] >= freshCut.slice(0, 10)).length
  console.log(`\nPART 1 — speaking-opportunity rollups`)
  console.log(`  ${rollup.rowCount} (learner, course, day) buckets in the last ${ROLLUP_DAYS}d; ${seen.size} already present`)
  console.log(`  ${DRY ? 'would insert' : 'inserting'} ${rollupRows.length} new rollup rows — ${rollupIn7d} of them inside the last ${FRESH_DAYS} days`)

  // ══════════════════════════════════════════════════════════════════════════
  // PART 2 — fresh-dated VAD, for learners who ALREADY have it
  //
  // The inverse of topup-ime-vad.cjs's guard, and the reason this script can
  // never damage the coverage split: the candidate set is exactly "has at least
  // one row in a VAD-fed table". No learner is ever added to it.
  // ══════════════════════════════════════════════════════════════════════════
  const vadState = await q(`
    select l.id as learner_id,
           (select max(m.last_seen_at) from public.learner_lego_metrics m where m.learner_id=l.id) as newest_metric,
           (select max(pe.occurred_at) from public.player_events pe
             where pe.user_id=l.id and pe.event_type='cycle_prosody')                              as newest_prosody
    from public.learners l where l.id = any($1::uuid[])`, [learnerIds])

  const hasVad = vadState.rows.filter(r => r.newest_metric || r.newest_prosody)
  const stale  = hasVad.filter(r => {
    const newest = Math.max(
      r.newest_metric ? new Date(r.newest_metric).getTime() : 0,
      r.newest_prosody ? new Date(r.newest_prosody).getTime() : 0,
    )
    return newest < now - FRESH_DAYS * DAY
  })
  console.log(`\nPART 2 — VAD recency`)
  console.log(`  ${hasVad.length} of ${learnerIds.length} learners carry VAD data (the other ${learnerIds.length - hasVad.length} have none, and keep none)`)
  console.log(`  ${stale.length} of those are stale (newest VAD row older than ${FRESH_DAYS} days) — those get topped up`)

  const staleIds = stale.map(r => r.learner_id)
  const llmRows = [], prosRows = []

  if (staleIds.length) {
    // Primary course + the learner's most recent LEGOs, as topup-ime-vad.cjs does.
    const enrol = await q(`select learner_id, course_id, last_practiced_at
                           from public.course_enrollments where learner_id = any($1::uuid[])
                           order by learner_id, last_practiced_at desc nulls last`, [staleIds])
    const primaryCourse = new Map()
    for (const e of enrol.rows) if (!primaryCourse.has(e.learner_id))
      primaryCourse.set(e.learner_id, e.course_id)

    // Only LEGOs WITHOUT a metrics row — the unique key is (learner_id, lego_id),
    // so an existing row could only be updated, and this script does not update.
    const legoRows = await q(`
      select learner_id, lego_id, course_id from (
        select lp.learner_id, lp.lego_id, lp.course_id,
               row_number() over (partition by lp.learner_id order by lp.lego_id desc) rn
        from public.lego_progress lp
        where lp.learner_id = any($1::uuid[])
          and not exists (select 1 from public.learner_lego_metrics m
                           where m.learner_id=lp.learner_id and m.lego_id=lp.lego_id)
      ) t where rn <= 10 order by learner_id, lego_id`, [staleIds])
    const legosByLearner = new Map()
    for (const r of legoRows.rows) {
      if (r.course_id !== primaryCourse.get(r.learner_id)) continue
      if (!legosByLearner.has(r.learner_id)) legosByLearner.set(r.learner_id, [])
      legosByLearner.get(r.learner_id).push(r.lego_id)
    }

    // Their FRESH session windows — prosody is scattered inside sessions the
    // refresh just wrote, so the timeline stays coherent rather than inventing
    // activity on days the learner shows none.
    const sess = await q(`
      select learner_id, started_at, ended_at from (
        select s.learner_id, s.started_at, s.ended_at,
               row_number() over (partition by s.learner_id order by s.started_at desc) rn
        from public.sessions s
        where s.learner_id = any($1::uuid[]) and s.started_at >= $2
      ) t where rn <= 4 order by learner_id, started_at`, [staleIds, freshCut])
    const sessByLearner = new Map()
    for (const r of sess.rows) {
      if (!sessByLearner.has(r.learner_id)) sessByLearner.set(r.learner_id, [])
      sessByLearner.get(r.learner_id).push({ start: new Date(r.started_at).getTime(), end: new Date(r.ended_at || r.started_at).getTime() })
    }

    let noWindow = 0, noLegos = 0
    for (const lid of staleIds) {
      const course = primaryCourse.get(lid)
      const windows = sessByLearner.get(lid) || []
      if (!course) continue
      // No fresh session => the learner genuinely was not practising this week.
      // Inventing prosody for them would contradict their own timeline, so skip.
      if (!windows.length) { noWindow++; continue }

      // --- metrics for LEGOs that have none yet ---
      const legos = legosByLearner.get(lid) || []
      if (!legos.length) noLegos++
      const recent = legos.slice(-between(4, 8))
      for (const legoId of recent) {
        // A learner whose VAD is being refreshed is, by construction, one who
        // kept practising — so the fresh rows read steady/easing, not a sudden
        // collapse. The struggling archetype stays where it was earned, on the
        // rows the original top-up wrote.
        const archetype = rnd() < 0.75 ? 'steady' : 'easing'
        const series = difficultySeries(archetype)
        const mean = series.reduce((a, b) => a + b, 0) / series.length
        const dclass = pick(DEVICE_CLASS)
        // Inside the freshness window, never in the future.
        const seenMs = now - between(0, FRESH_DAYS - 1) * DAY - between(1, 20) * 3600000
        llmRows.push([
          lid, legoId, course, pick(MASTERY_BY_ARCHETYPE[archetype]),
          archetype === 'steady' ? between(2, 5) : 0,
          archetype === 'steady' ? between(1, 4) : 0,
          series.length,
          new Date(seenMs).toISOString(),
          Math.round(mean * 100) / 100,
          Math.round((archetype === 'easing' ? 0.7 : 0.82) * 100) / 100,
          between(0, 1),
          archetype === 'easing' ? between(1, 3) : between(0, 1),
          new Date(now + between(1, 9) * DAY).toISOString(),
          JSON.stringify({ [dclass]: series.length }),
          JSON.stringify(series),
        ])
      }

      // --- prosody inside those fresh sessions ---
      const legoPool = recent.length ? recent : ['S0001L01']
      let written = 0
      for (const w of windows) {
        if (written >= PROSODY_CAP) break
        const sessionId = uuid()
        const dev = pick(DEVICE_TYPE)
        const span = Math.max(1, w.end - w.start)
        const nPros = between(2, 5)
        for (let p = 0; p < nPros && written < PROSODY_CAP; p++, written++) {
          prosRows.push([lid, course, sessionId, 'cycle_prosody',
            JSON.stringify(prosodyPayload(pick(legoPool))), dev,
            new Date(w.start + rnd() * span).toISOString()])
        }
      }
    }
    console.log(`  ${DRY ? 'would write' : 'writing'} ${llmRows.length} learner_lego_metrics rows and ${prosRows.length} cycle_prosody events`)
    if (noWindow) console.log(`  (${noWindow} stale learners had no session in the last ${FRESH_DAYS} days — skipped, their own timeline says they were not practising)`)
    if (noLegos) console.log(`  (${noLegos} had no un-metriced LEGO left — prosody only)`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WRITE — one transaction, three inserts, all additive
  // ══════════════════════════════════════════════════════════════════════════
  if (DRY) {
    console.log('\n— dry run: nothing written —')
    await db.end(); return
  }

  await q('begin')
  for (let i = 0; i < rollupRows.length; i += 200) {
    const chunk = rollupRows.slice(i, i + 200)
    const vals = chunk.map((_, j) => { const b = j * 6; return `($${b+1},$${b+2},$${b+3}::date,$${b+4},$${b+5},$${b+6})` }).join(',')
    await q(`insert into public.learner_speaking_opportunities
             (learner_id, course_code, day, opportunities, play_seconds, phrases_spoken) values ${vals}
             on conflict (learner_id, course_code, day) do nothing`, chunk.flat())
  }
  for (let i = 0; i < llmRows.length; i += 50) {
    const chunk = llmRows.slice(i, i + 50)
    const vals = chunk.map((_, j) => { const b = j * 15; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14}::jsonb,$${b+15}::jsonb)` }).join(',')
    await q(`insert into public.learner_lego_metrics
             (learner_id, lego_id, course_code, mastery_state, consecutive_smooth, consecutive_fast,
              n_samples, last_seen_at, mean_latency_ms, mean_exec_score, skip_back_count, skip_forward_count,
              next_due_at, device_class_mix, recent_latency_samples) values ${vals}
             on conflict (learner_id, lego_id) do nothing`, chunk.flat())
  }
  for (let i = 0; i < prosRows.length; i += 50) {
    const chunk = prosRows.slice(i, i + 50)
    const vals = chunk.map((_, j) => { const b = j * 7; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5}::jsonb,$${b+6},$${b+7})` }).join(',')
    await q(`insert into public.player_events
             (user_id, course_code, session_id, event_type, payload, device_type, occurred_at) values ${vals}`, chunk.flat())
  }
  await q('commit')

  console.log(`\nWROTE: ${rollupRows.length} speaking-opportunity rollup rows, ${llmRows.length} learner_lego_metrics rows, ${prosRows.length} cycle_prosody events`)
  console.log(`coverage unchanged: ${hasVad.length}/${learnerIds.length} learners carry VAD; the other ${learnerIds.length - hasVad.length} still carry none.`)
  await db.end()
})().catch(e => { console.error(e); process.exit(1) })
