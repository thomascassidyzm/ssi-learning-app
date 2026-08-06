#!/usr/bin/env node
/**
 * IME DEMO PROGRAMME — VAD TOP-UP (additive, idempotent)
 * ======================================================
 * The India Market Entry demo world (381 students, 8 schools, 3 regions, 11
 * courses) was built by three separate scripts over a week in July — BEFORE the
 * 2026-08-06 VAD-mix ruling — so it carries ZERO VAD data. This script closes
 * that gap WITHOUT regenerating anything: it reads the learners who are already
 * there, coin-flips VAD uptake per class, and INSERTS the two VAD-fed tables for
 * the winners.
 *
 *   node scripts/demo-data/topup-ime-vad.cjs --dry-run   # read-only, reports the split
 *   node scripts/demo-data/topup-ime-vad.cjs             # writes
 *
 * WHY TOP-UP, NOT REGENERATE: regenerating IME would destroy the July world —
 * three regions, 11 courses, the dual-enrolment showcase, the unclaimed-school
 * scenario and the join codes. Those took three passes and are not reproducible
 * from one script.
 *
 * ADDITIVE ONLY. This script issues exactly two kinds of statement, both INSERT:
 *   - public.learner_lego_metrics   (per-LEGO mastery / difficulty series)
 *   - public.player_events          (event_type='cycle_prosody' only)
 * It never deletes, never updates, and never touches schools, groups, classes,
 * courses, enrolments, join codes or learner identities.
 *
 * IDEMPOTENT, AT CLASS GRANULARITY. A class in which ANY learner already carries
 * VAD data has already been topped up, so the whole class is skipped — including
 * the deliberately VAD-less half of it. That is the guard that matters: a
 * per-learner-only guard would stop double-writing but would still re-flip the
 * no-VAD half on every run, walking coverage from 48% to 74% to 87%. The empty
 * half is part of the data, not an absence to be filled in. A second run writes
 * nothing.
 *
 * THE PAYLOADS ARE THE PROVEN ONES. Everything VAD-shaped comes from the shared
 * ./demoTelemetry.cjs — the same difficulty series (@ssi/core makeLatencySeries)
 * and the same real envelope extractor (@ssi/core extractEnvelopeMetadata) the
 * schools-suite regeneration used on 2026-08-06.
 *
 * BUILD DEPENDENCY: pnpm --filter @ssi/core build (we require the CJS dist).
 */
const fs = require('fs')
const path = require('path')

// ---------- env ----------
function loadEnv(p){const o={};try{for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch{}return o}
const env = {
  ...loadEnv(path.join(__dirname, '../../.env')),
  ...loadEnv(path.join(__dirname, '../../.env.local')),
}
const DATABASE_URL = env.DATABASE_URL
const { Client } = require('pg')

// ---------- seeded PRNG (a re-run plans the same split) ----------
let seed = 20260806
function rnd(){ seed|=0; seed=(seed+0x6D2B79F5)|0; let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296 }
const pick=a=>a[Math.floor(rnd()*a.length)]
const between=(lo,hi)=>lo+Math.floor(rnd()*(hi-lo+1))
const uuid=()=>{const h='0123456789abcdef';let s='';for(let i=0;i<36;i++){if(i===8||i===13||i===18||i===23)s+='-';else if(i===14)s+='4';else if(i===19)s+=h[8+Math.floor(rnd()*4)];else s+=h[Math.floor(rnd()*16)]}return s}

const { createDemoTelemetry, MASTERY_BY_ARCHETYPE, DEVICE_CLASS, DEVICE_TYPE } = require('./demoTelemetry.cjs')
const { classVadRate, difficultySeries, prosodyPayload } = createDemoTelemetry(rnd)

// The IME Demo Programme's root group. Everything below it — the three regions
// and their eight schools — is in scope; nothing outside it is touched.
const IME_GROUP_ID = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a'
const DAY = 86400000
const PROSODY_CAP = 14        // cycle_prosody rows per VAD learner (bounded demo corpus)

;(async()=>{
  if(!DATABASE_URL){ console.error('missing env (DATABASE_URL)'); process.exit(1) }
  const DRY = process.argv.includes('--dry-run')
  const db = new Client({ connectionString: DATABASE_URL }); await db.connect()
  const q = (sql, params) => db.query(sql, params)

  // ---- pre-flight: the telemetry schema (migrations 20260613_*/20260614_*) ----
  const colChk = await q(`select 1 from information_schema.columns
                          where table_schema='public' and table_name='learner_lego_metrics'
                            and column_name='recent_latency_samples'`)
  if(colChk.rowCount===0){ console.error('✗ learner_lego_metrics.recent_latency_samples absent — apply migrations 20260613_*/20260614_* first'); process.exit(1) }

  console.log(DRY ? '— DRY RUN (read-only, nothing will be written) —' : '— IME VAD TOP-UP (writing) —')

  // ---- who is in IME: every class under the programme, with its students ----
  // Ordered deterministically so a re-run plans the same split.
  const roster = await q(`
    with recursive tree as (
      select id from public.groups where id=$1
      union all select g.id from public.groups g join tree t on g.parent_id=t.id
    )
    select s.school_name, c.id as class_id, c.class_name, c.course_code as class_course,
           l.id as learner_id, l.display_name
    from public.schools s
    join public.classes c on c.school_id=s.id
    join public.user_tags ut on ut.tag_type='class' and ut.tag_value='CLASS:'||c.id::text
    join public.learners l on l.user_id=ut.user_id and l.educational_role='student'
    where s.group_id in (select id from tree)
    order by s.school_name, c.class_name, l.display_name, l.id`, [IME_GROUP_ID])

  // ---- who already has VAD data (idempotency guard) ----
  const already = await q(`
    with recursive tree as (
      select id from public.groups where id=$1
      union all select g.id from public.groups g join tree t on g.parent_id=t.id
    ), ls as (
      select distinct l.id from public.schools s
      join public.classes c on c.school_id=s.id
      join public.user_tags ut on ut.tag_type='class' and ut.tag_value='CLASS:'||c.id::text
      join public.learners l on l.user_id=ut.user_id and l.educational_role='student'
      where s.group_id in (select id from tree)
    )
    select ls.id from ls
    where exists (select 1 from public.learner_lego_metrics m where m.learner_id=ls.id)
       or exists (select 1 from public.player_events pe where pe.user_id=ls.id and pe.event_type='cycle_prosody')`,
    [IME_GROUP_ID])
  const alreadyDone = new Set(already.rows.map(r=>r.id))

  // A class counts as already topped up if ANY of its members carries VAD data.
  const doneClasses = new Set(roster.rows.filter(r=>alreadyDone.has(r.learner_id)).map(r=>r.class_id))
  if(alreadyDone.size) console.log(`idempotency: ${alreadyDone.size} IME learners already carry VAD data, across ${doneClasses.size} already-topped-up classes — those classes are skipped whole`)

  // ---- plan the split: coin-flip per class at that class's own uptake rate ----
  // A dual-enrolled learner is decided ONCE, by the first class we meet them in
  // (a learner either has a mic and an account or they don't — the decision is
  // per person, not per class).
  const decision = new Map()   // learner_id -> {hasVad, school, className, name, course}
  let currentClass = null, vadRate = 0
  for(const r of roster.rows){
    if(r.class_id !== currentClass){ currentClass = r.class_id; vadRate = classVadRate() }
    if(doneClasses.has(r.class_id) || alreadyDone.has(r.learner_id) || decision.has(r.learner_id)) continue
    decision.set(r.learner_id, {
      hasVad: rnd() < vadRate,
      school: r.school_name, className: r.class_name, name: r.display_name, course: r.class_course,
    })
  }

  const perSchool = new Map()
  for(const d of decision.values()){
    const s = perSchool.get(d.school) || { total:0, vad:0 }
    s.total++; if(d.hasVad) s.vad++
    perSchool.set(d.school, s)
  }
  const vadIds = [...decision.entries()].filter(([,d])=>d.hasVad).map(([id])=>id)
  const totalStudents = new Set(roster.rows.map(r=>r.learner_id)).size
  console.log(`\nPLANNED SPLIT — ${vadIds.length} of ${decision.size} not-yet-topped-up learners get VAD (${totalStudents} IME students in total)`)
  for(const [school,s] of [...perSchool].sort()) console.log(`  ${school}: ${s.vad}/${s.total} (${Math.round(100*s.vad/s.total)}%)`)

  // ---- per-learner source material: their real course, cursor and history ----
  const ids = [...decision.keys()]
  const enrol = await q(`select learner_id, course_id, last_practiced_at
                         from public.course_enrollments where learner_id = any($1::uuid[])
                         order by learner_id, last_practiced_at desc nulls last`, [ids])
  const primaryCourse = new Map()   // learner -> {course, lastPracticed}
  for(const e of enrol.rows) if(!primaryCourse.has(e.learner_id))
    primaryCourse.set(e.learner_id, { course: e.course_id, lastPracticed: e.last_practiced_at ? new Date(e.last_practiced_at).getTime() : Date.now()-14*DAY })

  if(vadIds.length===0){ console.log('\nnothing to do.'); await db.end(); return }

  // The most recently practiced LEGOs per learner (highest ids = newest), on the
  // learner's primary course only — these are the LEGOs the metrics attach to.
  const legoRows = await q(`
    select learner_id, lego_id, course_id from (
      select lp.learner_id, lp.lego_id, lp.course_id,
             row_number() over (partition by lp.learner_id order by lp.lego_id desc) rn
      from public.lego_progress lp where lp.learner_id = any($1::uuid[])
    ) t where rn <= 12 order by learner_id, lego_id`, [vadIds])
  const legosByLearner = new Map()
  for(const r of legoRows.rows){
    const cur = primaryCourse.get(r.learner_id)
    if(cur && r.course_id !== cur.course) continue      // stay on the primary course
    if(!legosByLearner.has(r.learner_id)) legosByLearner.set(r.learner_id, [])
    legosByLearner.get(r.learner_id).push(r.lego_id)
  }

  // Their real session windows — cycle_prosody events are scattered inside real
  // sessions rather than invented ones, so the timeline stays coherent.
  const sess = await q(`
    select learner_id, started_at, ended_at from (
      select s.learner_id, s.started_at, s.ended_at,
             row_number() over (partition by s.learner_id order by s.started_at desc) rn
      from public.sessions s where s.learner_id = any($1::uuid[])
    ) t where rn <= 4 order by learner_id, started_at`, [vadIds])
  const sessByLearner = new Map()
  for(const r of sess.rows){
    if(!sessByLearner.has(r.learner_id)) sessByLearner.set(r.learner_id, [])
    sessByLearner.get(r.learner_id).push({ start:new Date(r.started_at).getTime(), end:new Date(r.ended_at||r.started_at).getTime() })
  }

  // ---- generate ----
  // Per-SCHOOL archetype budget: a legible handful of clearly struggling /
  // easing learners per school, the rest steady, so the difficulty board has
  // signal without reading as all-red.
  const budgets = new Map()
  const budgetFor = school => {
    if(!budgets.has(school)) budgets.set(school, { strugglersLeft: between(5,7), easersLeft: between(5,7) })
    return budgets.get(school)
  }
  const now = Date.now()
  const totals = { learners:0, legoMetrics:0, prosodyEvents:0, struggling:0, easing:0, steady:0, skippedNoLegos:0 }

  if(!DRY) await q('begin')
  for(const lid of vadIds){
    const d = decision.get(lid)
    const legos = legosByLearner.get(lid) || []
    if(legos.length===0){ totals.skippedNoLegos++; continue }   // no practice history to attach to
    const course = primaryCourse.get(lid)?.course || d.course
    const lastPracticed = primaryCourse.get(lid)?.lastPracticed || (now-14*DAY)
    const recent = legos.slice(-between(6,12))
    const budget = budgetFor(d.school)

    // this learner's primary archetype, drawing down the school budget
    let primary = 'steady'
    if(budget.strugglersLeft>0 && rnd()<0.6){ primary='struggling'; budget.strugglersLeft-- }
    else if(budget.easersLeft>0 && rnd()<0.6){ primary='easing'; budget.easersLeft-- }

    const llmRows = []
    for(let li=0; li<recent.length; li++){
      const legoId = recent[li]
      // the learner's most-recent LEGO carries the primary signal; the rest are
      // mostly steady with the odd echo, so each named student reads cleanly.
      const archetype = li===recent.length-1 ? primary
        : (primary!=='steady' && rnd()<0.25 ? primary : 'steady')
      const series = difficultySeries(archetype)
      const mean = series.reduce((a,b)=>a+b,0)/series.length
      const ms = pick(MASTERY_BY_ARCHETYPE[archetype])
      const dclass = pick(DEVICE_CLASS)
      // last_seen scattered inside the learner's OWN recent activity — never in
      // the future, never later than they actually practised.
      const seenMs = Math.min(now-3600000, lastPracticed - between(0,3)*DAY - between(0,12)*3600000)
      llmRows.push([
        lid, legoId, course, ms,
        archetype==='steady'?between(2,5):0,                  // consecutive_smooth
        archetype==='steady'?between(1,4):0,                  // consecutive_fast
        series.length,                                        // n_samples
        new Date(seenMs).toISOString(),                       // last_seen_at
        Math.round(mean*100)/100,                             // mean_latency_ms (normalized ms/char)
        Math.round((archetype==='struggling'?0.45:archetype==='easing'?0.7:0.82)*100)/100,  // mean_exec_score
        archetype==='struggling'?between(1,4):between(0,1),   // skip_back_count
        archetype==='easing'?between(1,3):between(0,1),       // skip_forward_count
        new Date(now+between(1,9)*DAY).toISOString(),         // next_due_at
        JSON.stringify({[dclass]:series.length}),             // device_class_mix
        JSON.stringify(series),                               // recent_latency_samples
      ])
      if(archetype==='struggling')totals.struggling++; else if(archetype==='easing')totals.easing++; else totals.steady++
    }

    // cycle_prosody: one row per voiced speaking cycle in the real player,
    // sampled down to a handful per session so the demo corpus stays bounded.
    const windows = sessByLearner.get(lid) || [{ start: lastPracticed-1800000, end: lastPracticed }]
    const prosRows = []
    for(const w of windows){
      if(prosRows.length>=PROSODY_CAP) break
      const sessionId = uuid()
      const dev = pick(DEVICE_TYPE)
      const span = Math.max(1, w.end-w.start)
      const nPros = between(2,5)
      for(let p=0;p<nPros && prosRows.length<PROSODY_CAP;p++)
        prosRows.push([lid, course, sessionId, 'cycle_prosody',
          JSON.stringify(prosodyPayload(pick(recent))), dev,
          new Date(w.start + rnd()*span).toISOString()])
    }

    if(!DRY){
      for(let i=0;i<llmRows.length;i+=50){
        const chunk=llmRows.slice(i,i+50)
        const vals=chunk.map((_,j)=>{const b=j*15;return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14}::jsonb,$${b+15}::jsonb)`}).join(',')
        await q(`insert into public.learner_lego_metrics
                 (learner_id, lego_id, course_code, mastery_state, consecutive_smooth, consecutive_fast,
                  n_samples, last_seen_at, mean_latency_ms, mean_exec_score, skip_back_count, skip_forward_count,
                  next_due_at, device_class_mix, recent_latency_samples) values ${vals}
                 on conflict (learner_id, lego_id) do nothing`, chunk.flat())
      }
      for(let i=0;i<prosRows.length;i+=50){
        const chunk=prosRows.slice(i,i+50)
        const vals=chunk.map((_,j)=>{const b=j*7;return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5}::jsonb,$${b+6},$${b+7})`}).join(',')
        await q(`insert into public.player_events
                 (user_id, course_code, session_id, event_type, payload, device_type, occurred_at) values ${vals}`, chunk.flat())
      }
    }
    totals.learners++; totals.legoMetrics+=llmRows.length; totals.prosodyEvents+=prosRows.length
  }
  if(!DRY) await q('commit')

  const vadAfter = totals.learners + alreadyDone.size
  const noVad = totalStudents - vadAfter
  console.log(`\n${DRY?'WOULD WRITE':'WROTE'}: ${totals.legoMetrics} learner_lego_metrics rows (${totals.struggling} struggling / ${totals.easing} easing / ${totals.steady} steady series) and ${totals.prosodyEvents} cycle_prosody events across ${totals.learners} learners`)
  if(totals.skippedNoLegos) console.log(`  (${totals.skippedNoLegos} VAD-flipped learners had no lego_progress on their primary course — nothing to attach metrics to, skipped)`)
  console.log(`VAD coverage after this run: ${vadAfter}/${totalStudents} IME students (${Math.round(100*vadAfter/totalStudents)}%); ${noVad} have NO row in any VAD-fed table (the real empty state)`)
  await db.end()
})().catch(e=>{ console.error(e); process.exit(1) })
