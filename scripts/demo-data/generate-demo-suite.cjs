#!/usr/bin/env node
/**
 * SSi DEMO DATA SUITE GENERATOR
 * =============================
 * Builds realistic, RLS-correct school demo scenarios (Irish / Japanese /
 * Welsh) and is fully idempotent: every run RESETS all is_demo data first,
 * then regenerates. Sack-and-rebuild any which way, any time.
 *
 *   node scripts/demo-data/generate-demo-suite.cjs            # reset + generate
 *   node scripts/demo-data/generate-demo-suite.cjs --reset-only
 *
 * DONE PROPERLY (vs the old 2026-02 demo data):
 *  - Staff (admins/teachers) are REAL Supabase auth users -> dashboards
 *    populate through the real RLS policies, and you can log in live as the
 *    demo teacher/admin (email OTP to the + addresses below, or password
 *    via API). Students get uuid-shaped synthetic identities (no auth user
 *    needed — they never log in; visibility maps via learners.user_id).
 *  - Progress lives in BOTH models consistently: the live cursor
 *    (course_enrollments) AND the count tables dashboards read
 *    (seed_progress / lego_progress).
 *  - Everything carries is_demo=true -> excluded from every global
 *    aggregate (daily_contributions trigger, weekly_leaderboard,
 *    get_community_contribution) per migration 20260610_feat_17.
 *  - Engagement follows the Russell-2024 shape: ~20% high / 50% mid / 30%
 *    low, with activity recency to match (sparklines look real).
 *  - TELEMETRY (added 2026-06-14): per-(learner, LEGO) difficulty SERIES in
 *    learner_lego_metrics.recent_latency_samples + a bounded set of
 *    player_events, so the curvature engine (@ssi/core assessLocalDifficulty)
 *    and the difficulty-turns Insight board have REAL demo learners to show.
 *    Each student is given a difficulty archetype per recent LEGO
 *    (struggling / easing / steady) whose normalized-latency series is shaped
 *    to trip the sensor under its DEFAULT options (window 7, threshold 2 σ) —
 *    the resolver (insight/data/difficultyTurns.ts) calls the sensor with no
 *    options, so the shapes are calibrated against those defaults. The shapes
 *    are the CANONICAL, TESTED makeLatencySeries from @ssi/core
 *    (packages/core/src/learning/syntheticSeries.ts), not magic numbers here.
 *  - VAD COVERAGE (added 2026-08-06, founder ruling): only ~50% of learners
 *    carry VAD data — "not everyone in a class will end up getting their own
 *    account". Per-class uptake is drawn in 40-60% and flipped per learner, so
 *    it reads like a real roster rather than every-other. VAD learners get
 *    learner_lego_metrics rows AND cycle_prosody events (real envelope
 *    extractor, @ssi/core extractEnvelopeMetadata); the rest get NO row at all
 *    in those tables — no zeros, no empty-but-present rows — which is exactly
 *    how a real no-mic learner presents and exercises the UI's empty states.
 *
 * BUILD DEPENDENCY (telemetry step): this script requires the built @ssi/core
 * CJS dist, so run `pnpm --filter @ssi/core build` before generating. (There is
 * no @ssi/core symlink in the repo-root node_modules; we resolve dist by path.)
 *
 * MIGRATION DEPENDENCY: the telemetry step needs columns + RPC that only exist
 * after Tom applies migrations 20260613_metrics_a3_learner_lego_state.sql,
 * 20260613_metrics_lego_latency_series.sql and
 * 20260614_analytics_difficulty_turns.sql. The script PRE-FLIGHTS for the
 * recent_latency_samples column; if absent it WARNS and skips telemetry only
 * (the rest of the suite still generates), so it is safe to run pre-migration.
 *
 * Credentials are written to ~/Desktop/SSi-demo-credentials-<date>.md
 * (never committed).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

// ---------- env ----------
function loadEnv(p){const o={};try{for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch{}return o}
const env = {
  ...loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env'),
  ...loadEnv(path.join(__dirname, '../../.env')),
  ...loadEnv(path.join(__dirname, '../../.env.local')),
  ...loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql'),
}
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const SVC = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
const DATABASE_URL = env.DATABASE_URL
const { Client } = require(fs.existsSync(path.join(__dirname,'../../node_modules/pg')) ? 'pg' : '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg')

const STAFF_PASSWORD = 'SSiDemo2026!'
const EMAIL_BASE = 'thomas.cassidy'   // gmail plus-addressing: OTP codes land in Tom's inbox
const emailFor = (scenario, role) => `${EMAIL_BASE}+demo.${scenario}.${role}@gmail.com`

// ---------- seeded PRNG (reproducible suites) ----------
let seed = 20260610
function rnd(){ seed|=0; seed=(seed+0x6D2B79F5)|0; let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296 }
const pick=a=>a[Math.floor(rnd()*a.length)]
const between=(lo,hi)=>lo+Math.floor(rnd()*(hi-lo+1))
const uuid=()=>{const h='0123456789abcdef';let s='';for(let i=0;i<36;i++){if(i===8||i===13||i===18||i===23)s+='-';else if(i===14)s+='4';else if(i===19)s+=h[8+Math.floor(rnd()*4)];else s+=h[Math.floor(rnd()*16)]}return s}

// ---------- difficulty telemetry (curvature-engine demo fuel) ----------
// The series SHAPES are NOT defined here any more — they are the canonical,
// TESTED calibration in @ssi/core (`packages/core/src/learning/syntheticSeries.ts`,
// guarded by `syntheticSeries.test.ts` which asserts they classify correctly
// through the REAL sensor under its DEFAULT options). We import `makeLatencySeries`
// and feed it THIS generator's seeded `rnd` so per-student determinism is
// preserved. Do NOT re-inline the magic numbers — change them in one place
// (syntheticSeries.ts) where the regression test will keep them honest.
//
// REQUIRES @ssi/core TO BE BUILT FIRST:  pnpm --filter @ssi/core build
//   (we require the built CJS dist; there is no workspace symlink for @ssi/core
//    in the repo-root node_modules, so we resolve it by relative path.)
let makeLatencySeries, extractEnvelopeMetadata, ENVELOPE_EXTRACTOR_CONSTANTS
try {
  ({ makeLatencySeries, extractEnvelopeMetadata, ENVELOPE_EXTRACTOR_CONSTANTS } = require('../../packages/core/dist/index.js'))
} catch (e) {
  console.error('✗ Could not load @ssi/core from packages/core/dist — build it first: pnpm --filter @ssi/core build')
  throw e
}
// Build one normalized-latency series for the given archetype, driven by the
// generator's seeded PRNG (so suites stay reproducible).
const difficultySeries = archetype => makeLatencySeries(archetype, { rng: rnd })
const MASTERY_BY_ARCHETYPE = {
  struggling: ['acquisition','consolidating'],
  easing:     ['consolidating','confident'],
  steady:     ['confident','mastered'],
}
const DEVICE_CLASS = ['class_play','homework']  // demo schools = class-led + homework
const DEVICE_TYPE  = ['mobile','tablet','desktop']

// ---------- VAD coverage (founder ruling, 2026-08-06) ----------
// "the fake demo data generator function should generate VAD data for around
// 50% of learners in schools - reflecting that not everyone in a class will
// end up getting their own account."
//
// So VAD data is a PER-LEARNER coin flip, not every-other: each class draws
// its own uptake rate around the 50% mark (some classes got more devices /
// more parental consents than others), then each learner in it flips against
// that rate. A learner WITHOUT VAD gets NO rows at all in the VAD-fed tables
// — no learner_lego_metrics, no cycle_prosody — because that is exactly how a
// real no-VAD learner presents: the write path is `recordCycle`, which only
// ever fires on a VAD latency (LearningPlayer.vue ~line 11826), so there are
// no zero rows and no empty-but-present rows to find. That way the UI's real
// empty states get exercised by half the demo roster.
const VAD_RATE_RANGE = [0.40, 0.60]
const classVadRate = () => VAD_RATE_RANGE[0] + rnd()*(VAD_RATE_RANGE[1]-VAD_RATE_RANGE[0])

// ---------- prosody telemetry (cycle_prosody demo fuel) ----------
// The envelope numbers are NOT hand-written here. We synthesise the plausible
// rAF-rate {t, db} energy trace that the live VAD hands its extractor, then
// run the REAL `extractEnvelopeMetadata` from @ssi/core — so demo rows carry
// the same field set, the same 0–100 contour encoding, the same weighting
// rules and the same `extractorVersion` a real learner's mic produces. Same
// principle as makeLatencySeries above: no magic numbers in this script.
function prosodyEnvelope(durationMs){
  const syllables = Math.max(1, Math.round(durationMs/260))
  const samples = []
  for(let t=0;t<durationMs;t+=16){         // ~60fps, the VAD's rAF cadence
    const lobe = Math.abs(Math.sin((t/durationMs)*syllables*Math.PI))  // one energy lobe per syllable
    const arc  = Math.sin(Math.PI*Math.min(1,t/durationMs))            // utterance-level rise/fall
    samples.push({ t, db: -58 + 34*lobe*arc + (rnd()-0.5)*3 })
  }
  return extractEnvelopeMetadata(samples, durationMs)
}

// One cycle_prosody payload for a voiced speaking cycle on `legoId`, shaped
// exactly like LearningPlayer.vue's logEvent('cycle_prosody', …) call.
function prosodyPayload(legoId){
  const learnerDurationMs = between(700,2600)
  const target1DurationMs = between(1100,2400)
  const env = prosodyEnvelope(learnerDurationMs)
  const responseLatencyMs = between(-350,1400)      // negative = started during the prompt
  const speechStartMs = Math.max(0, responseLatencyMs)
  return {
    cycleId: uuid(),
    cycleType: pick(['build','use','debut','spaced_rep']),
    legoId,
    seedId: legoId.slice(0,5),
    audioId: uuid(),
    responseLatencyMs,
    learnerDurationMs,
    durationDeltaMs: learnerDurationMs - target1DurationMs,
    speechStartMs,
    speechEndMs: speechStartMs + learnerDurationMs,
    startedDuringPrompt: responseLatencyMs < 0,
    stillSpeakingAtVoice1: rnd() < 0.18,
    peakEnergyDb: Math.round((-24 + rnd()*8)*10)/10,
    averageEnergyDb: Math.round((-38 + rnd()*8)*10)/10,
    envelope: {
      durationMs: env.durationMs,
      peakCount: env.peakCount,
      peakToMeanRatio: Math.round(env.peakToMeanRatio*1000)/1000,
      meanPeakWidthMs: Math.round(env.meanPeakWidthMs*10)/10,
      sampleCount: env.sampleCount,
      weight: Math.round(env.weight*1000)/1000,
      contour: env.contour ?? null,
      contourGridMs: env.contourGridMs ?? null,
    },
    extractorVersion: ENVELOPE_EXTRACTOR_CONSTANTS.version,
    playbackSpeed: 1.0,
  }
}

// ---------- scenarios ----------
const IRISH_FIRST=['Aoife','Cian','Saoirse','Oisín','Niamh','Fionn','Caoimhe','Darragh','Róisín','Tadhg','Clodagh','Eoin','Aisling','Cathal','Méabh','Rónán','Sadhbh','Donncha','Laoise','Páidí','Gráinne','Lorcán','Bláthnaid','Séamus','Éabha','Colm']
const IRISH_LAST=['Ní Bhriain','Ó Sé','Ní Cheallaigh','Ó Murchú','Ní Dhomhnaill','Ó Conaill','Ní Mháille','Ó Riain','Ní Ghallchóir','Ó Flaithearta','Nic Gearailt','Ó Dálaigh']
const JP_STUDENT_FIRST=['Oliver','Sophie','Harry','Isla','Jack','Emily','Noah','Ava','Leo','Mia','Ethan','Grace','Lucas','Chloe','Max','Lily','Daniel','Zoe','Ben','Ella','Sam','Ruby','Alex','Freya']
const JP_STUDENT_LAST=['Bennett','Clarke','Davies','Foster','Greene','Harper','Knight','Lawson','Mercer','Norris','Palmer','Quinn']
const WELSH_FIRST=['Gwen','Rhys','Cerys','Dylan','Ffion','Owain','Seren','Ieuan','Lowri','Macsen','Nia','Tomos','Elin','Gethin','Mali','Osian','Catrin','Llŷr','Beca','Iolo','Anwen','Deio','Heledd','Gruff']
const WELSH_LAST=['Williams','Jones','Evans','Davies','Thomas','Roberts','Hughes','Morgan','Owen','Price','Rees','Griffiths']

const SCENARIOS=[
  {
    key:'irish', courseCode:'gle_for_eng',
    group:{ name:'Gaelscoileanna Píolótach' },
    school:{ name:'Gaelscoil na Mara', region:'ireland' },
    admin:{ name:'Síle Ní Bhriain' },
    teachers:[{ name:'Aoife Ní Cheallaigh' },{ name:'Pádraig Ó Sé' }],
    classes:[
      { name:'Rang a Trí',     teacher:0, students:24, classSeed:14 },
      { name:'Rang a Ceathair',teacher:1, students:23, classSeed:9  },
      { name:'Rang a Cúig',    teacher:0, students:25, classSeed:21 },
    ],
    names:[IRISH_FIRST, IRISH_LAST],
  },
  {
    key:'japanese', courseCode:'jpn_for_eng',
    group:null,
    school:{ name:'Sakura International School', region:'japan' },
    admin:{ name:'Yuki Tanaka' },
    teachers:[{ name:'Kenji Sato' },{ name:'Hana Yamamoto' }],
    classes:[
      { name:'Year 7 Blue', teacher:0, students:22, classSeed:11 },
      { name:'Year 8 Red',  teacher:1, students:24, classSeed:17 },
    ],
    names:[JP_STUDENT_FIRST, JP_STUDENT_LAST],
  },
  {
    key:'welsh', courseCode:'cym_n_for_eng',
    group:null,
    school:{ name:'Ysgol Gynradd y Garn', region:'wales' },
    admin:{ name:'Eleri Williams' },
    teachers:[{ name:'Gareth Jones' },{ name:'Mari Evans' }],
    classes:[
      { name:'Blwyddyn 5', teacher:0, students:26, classSeed:13 },
      { name:'Blwyddyn 6', teacher:1, students:24, classSeed:19 },
    ],
    names:[WELSH_FIRST, WELSH_LAST],
  },
]

// engagement distribution (Russell 2024: engagement > aptitude; majority modest)
function studentStage(classSeed){
  const r=rnd()
  if(r<0.20) return { seeds: between(Math.max(classSeed,8), classSeed+18), sessions: between(18,36), recencyDays: between(0,2)  }  // high
  if(r<0.70) return { seeds: between(Math.max(3,classSeed-6), classSeed+3), sessions: between(7,17),  recencyDays: between(1,6)  }  // mid
  return        { seeds: between(1, Math.max(2,Math.floor(classSeed/2))),   sessions: between(2,6),   recencyDays: between(7,21) }  // low
}

// ---------- auth admin helpers ----------
async function authReq(method, p, body){
  const r=await fetch(SUPABASE_URL+p,{method,headers:{apikey:SVC,Authorization:`Bearer ${SVC}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
  let j=null;try{j=await r.json()}catch{}
  return {status:r.status, body:j}
}
async function ensureAuthUser(email){
  const cu=await authReq('POST','/auth/v1/admin/users',{email,password:STAFF_PASSWORD,email_confirm:true})
  if(cu.body?.id) return cu.body.id
  // exists -> find it
  const ls=await authReq('GET','/auth/v1/admin/users?page=1&per_page=1000')
  const u=(ls.body?.users||[]).find(x=>x.email===email)
  if(!u) throw new Error(`auth user neither created nor found: ${email} (${cu.status})`)
  return u.id
}
// SCOPED (2026-08-06): only THIS suite's scenario personas. It used to match every
// '+demo.' address, which also deleted the IME programme's login personas
// ('+demo.ime.*', '+demo.ime.metro.*') that generate-ime-demo.cjs owns and
// documents as safe from this script.
async function deleteDemoAuthUsers(){
  const prefixes=SCENARIOS.map(s=>`+demo.${s.key}.`)
  const ls=await authReq('GET','/auth/v1/admin/users?page=1&per_page=1000')
  const demos=(ls.body?.users||[]).filter(u=>u.email&&prefixes.some(p=>u.email.includes(p)))
  for(const u of demos) await authReq('DELETE',`/auth/v1/admin/users/${u.id}`)
  return demos.length
}

// ---------- main ----------
;(async()=>{
  if(!SUPABASE_URL||!SVC||!DATABASE_URL){ console.error('missing env (SUPABASE_URL / service key / DATABASE_URL)'); process.exit(1) }
  const resetOnly=process.argv.includes('--reset-only')
  const db=new Client({connectionString:DATABASE_URL}); await db.connect()
  const q=(sql,params)=>db.query(sql,params)

  // ---- pre-flight: does the telemetry schema exist yet? (migrations 20260613/14) ----
  // The series column gates BOTH generation and reset of telemetry; if absent we
  // run everything EXCEPT telemetry, so the suite is safe pre-migration.
  const colChk=await q(`select 1 from information_schema.columns
                        where table_schema='public' and table_name='learner_lego_metrics'
                          and column_name='recent_latency_samples'`)
  const TELEMETRY=colChk.rowCount>0
  if(!TELEMETRY) console.warn('⚠ telemetry schema absent (learner_lego_metrics.recent_latency_samples) — apply migrations 20260613_*/20260614_* to get difficulty curves. Skipping telemetry generation; rest of suite proceeds.')

  // ---- RESET: wipe this suite's OWN scenarios, then its own demo auth users ----
  // SCOPED (2026-08-06), was a blanket `where is_demo`. The blanket form predated
  // the sibling demo worlds that now also carry is_demo — the IME Demo Programme
  // (generate-ime-demo.cjs), Coastal (generate-coastal-region.cjs) and Metro
  // (enrich-ime-world.cjs) trees, plus the org/workplace demo nodes. Those have
  // their own scoped generators and this script cannot rebuild them, so a blanket
  // reset here destroyed data it could not restore. It also FK-failed outright
  // once govt_admins started pointing at demo groups. Scope = exactly what this
  // script creates: the three scenario schools (by name), their group, their
  // classes/learners, and its own 'demo-suite'-tagged rows.
  console.log('— RESET this suite\'s demo scenarios —')
  const SCENARIO_SCHOOL_NAMES=SCENARIOS.map(s=>s.school.name)
  const SCENARIO_GROUP_NAMES=SCENARIOS.filter(s=>s.group).map(s=>s.group.name)
  await q('begin')
  const schoolIds=(await q(`select id, admin_user_id from public.schools where is_demo and school_name = any($1::text[])`,[SCENARIO_SCHOOL_NAMES])).rows
  const sIds=schoolIds.map(r=>r.id)
  const classRows=sIds.length?(await q(`select id, teacher_user_id from public.classes where school_id = any($1::uuid[])`,[sIds])).rows:[]
  const cIds=classRows.map(r=>r.id)
  const groupIds=(await q(`select id from public.groups where is_demo and name = any($1::text[])`,[SCENARIO_GROUP_NAMES])).rows.map(r=>r.id)
  // learner identities in scope: scenario staff (school admin + class teachers)
  // plus students, which are exactly this script's own 'demo-suite' class tags.
  const staffUids=[...new Set([...schoolIds.map(r=>r.admin_user_id),...classRows.map(r=>r.teacher_user_id)].filter(Boolean))]
  const studentUids=cIds.length?(await q(
    `select user_id from public.user_tags where added_by='demo-suite' and tag_type='class' and tag_value = any($1::text[])`,
    [cIds.map(id=>`CLASS:${id}`)])).rows.map(r=>r.user_id):[]
  const ownUids=[...new Set([...staffUids,...studentUids])]
  const ownLearnerIds=ownUids.length?(await q(`select id from public.learners where is_demo and user_id = any($1::text[])`,[ownUids])).rows.map(r=>r.id):[]

  const r1=await q(`delete from public.user_tags where added_by='demo-suite'`)
  // telemetry first: player_events keys on the learner PK (NOT auth uid — see CLAUDE.md);
  // learner_lego_metrics cascades when learners go, but we delete explicitly for clarity.
  let rPE={rowCount:0}, rLLM={rowCount:0}
  if(TELEMETRY && ownLearnerIds.length){
    rPE =await q(`delete from public.player_events where user_id = any($1::uuid[])`,[ownLearnerIds])
    rLLM=await q(`delete from public.learner_lego_metrics where learner_id = any($1::uuid[])`,[ownLearnerIds])
  }
  // invite_codes point at classes/schools by FK — clear them before their targets.
  if(cIds.length) await q(`delete from public.invite_codes where grants_class_id = any($1::uuid[])`,[cIds])
  if(sIds.length) await q(`delete from public.invite_codes where grants_school_id = any($1::uuid[])`,[sIds])
  if(groupIds.length) await q(`delete from public.invite_codes where grants_group_id = any($1::uuid[])`,[groupIds])
  const r2=cIds.length?await q(`delete from public.classes where id = any($1::uuid[])`,[cIds]):{rowCount:0}
  // The schools and groups rows themselves SURVIVE and are reused below. They are
  // durable ORG IDENTITY, not per-run content: the group tree hangs off them
  // (groups.parent_id, schools.node_group_id — the school-node rows created by the
  // org-hierarchy work), govt_admins point at them, and this script knows nothing
  // about node linkage, so deleting them destroyed a tree it could not rebuild
  // (and FK-failed on both groups_parent_id_fkey and govt_admins_group_id_fkey).
  const r5=ownLearnerIds.length?await q(`delete from public.learners where id = any($1::uuid[])`,[ownLearnerIds]):{rowCount:0}
  await q('commit')
  const nAuth=await deleteDemoAuthUsers()
  console.log(`  tags:${r1.rowCount} playerEvents:${rPE.rowCount} legoMetrics:${rLLM.rowCount} classes:${r2.rowCount} learners:${r5.rowCount} (schools/groups reused: ${sIds.length}/${groupIds.length}) authUsers:${nAuth}`)
  if(resetOnly){ await db.end(); console.log('reset-only done'); return }

  const creds=[`# SSi demo suite credentials — generated ${new Date().toISOString().slice(0,10)}`,
               `Password for ALL staff (API/password login): ${STAFF_PASSWORD}`,
               `App login: email OTP — codes arrive at ${EMAIL_BASE}@gmail.com via + addressing.`,'']
  let totals={students:0,sessions:0,seedRows:0,legoRows:0,classSessions:0,legoMetrics:0,playerEvents:0,struggling:0,easing:0,steady:0,vadLearners:0,noVadLearners:0,prosodyEvents:0}

  for(const sc of SCENARIOS){
    console.log(`\n— SCENARIO: ${sc.key} (${sc.courseCode}) —`)
    // staff auth users (trigger auto-creates learners rows)
    const adminEmail=emailFor(sc.key,'admin')
    const adminUid=await ensureAuthUser(adminEmail)
    const teacherUids=[]
    for(let i=0;i<sc.teachers.length;i++){
      teacherUids.push(await ensureAuthUser(emailFor(sc.key,`teacher${i+1}`)))
    }
    creds.push(`## ${sc.school.name} (${sc.courseCode})`,
               `- school admin: ${sc.admin.name} — ${adminEmail}`,
               ...sc.teachers.map((t,i)=>`- teacher: ${t.name} — ${emailFor(sc.key,`teacher${i+1}`)}`),'')

    await q('begin')
    // upgrade the trigger-created staff learners rows
    await q(`update public.learners set display_name=$1, educational_role='school_admin', is_demo=true where user_id=$2`,[sc.admin.name,adminUid])
    for(let i=0;i<teacherUids.length;i++)
      await q(`update public.learners set display_name=$1, educational_role='teacher', is_demo=true where user_id=$2`,[sc.teachers[i].name,teacherUids[i]])

    // org — REUSE the surviving group/school rows (see the reset note): they carry
    // org identity the reset deliberately preserves, so re-inserting would both
    // stack duplicates and orphan the node tree that points at the old ids.
    let groupId=null
    if(sc.group){
      const ex=await q(`select id from public.groups where is_demo and name=$1 limit 1`,[sc.group.name])
      if(ex.rowCount){ groupId=ex.rows[0].id }
      else {
        groupId=uuid()
        // name_confirmed=true: a deliberately-chosen demo name, not a leader's
        // placeholder guess — see generate-ime-demo.cjs for the same fix.
        await q(`insert into public.groups (id, name, is_demo, is_test, name_confirmed) values ($1,$2,true,true,true)`,[groupId,sc.group.name])
      }
    }
    const tCode=`DEMO-${sc.key.toUpperCase().slice(0,2)}-T`, aCode=`DEMO-${sc.key.toUpperCase().slice(0,2)}-A`
    const exS=await q(`select id from public.schools where is_demo and school_name=$1 limit 1`,[sc.school.name])
    let schoolId
    if(exS.rowCount){
      schoolId=exS.rows[0].id
      // staff auth users are recreated each run, so the admin_user_id must be
      // repointed; group_id is coalesced so an existing region link is kept.
      await q(`update public.schools set admin_user_id=$2, region_code=$3, teacher_join_code=$4, admin_join_code=$5,
               group_id=coalesce(group_id,$6), is_demo=true, is_test=true where id=$1`,
        [schoolId, adminUid, sc.school.region, tCode, aCode, groupId])
    } else {
      schoolId=uuid()
      await q(`insert into public.schools (id, school_name, admin_user_id, region_code, teacher_join_code, admin_join_code, group_id, is_demo, is_test)
               values ($1,$2,$3,$4,$5,$6,$7,true,true)`,
        [schoolId, sc.school.name, adminUid, sc.school.region, tCode, aCode, groupId])
    }
    await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'admin','demo-suite')`,
      [adminUid,`SCHOOL:${schoolId}`])
    for(const t of teacherUids)
      await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'teacher','demo-suite')`,
        [t,`SCHOOL:${schoolId}`])

    const now=Date.now(), DAY=86400000
    const termStart=new Date('2026-04-20T08:00:00Z').getTime()
    // Per-scenario archetype budget: guarantee a legible handful of clearly
    // struggling / easing students per scenario (the rest default to steady, so
    // the board has signal without being all-red). Only students with recent
    // activity (last_seen within 30d) qualify for an actionable archetype.
    let strugglersLeft=between(5,7), easersLeft=between(5,7)

    for(let ci=0;ci<sc.classes.length;ci++){
      const cls=sc.classes[ci]
      const classId=uuid()
      const teacherUid=teacherUids[cls.teacher]
      const classLego=`S${String(cls.classSeed).padStart(4,'0')}L0${between(1,3)}`
      await q(`insert into public.classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, last_lego_id, is_active)
               values ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [classId,schoolId,teacherUid,cls.name,sc.courseCode,`DEMO-${sc.key.toUpperCase().slice(0,2)}-${ci+3}`,cls.classSeed,classLego])
      // Register the student join code in invite_codes — without this the
      // class's /redeem link is dead (same fix as generate-ime-demo.cjs).
      await q(
        `insert into public.invite_codes (code, code_type, created_by, grants_class_id, is_active)
         values ($1,'student',$2,$3,true)
         on conflict (code) do nothing`,
        [`DEMO-${sc.key.toUpperCase().slice(0,2)}-${ci+3}`,adminUid,classId],
      )

      // This class's own VAD uptake rate (see VAD_RATE_RANGE) — drawn once
      // per class, flipped per learner below.
      const vadRate=classVadRate()

      // class-play history: teacher-led sessions over the past month
      const nCs=between(6,14)
      for(let k=0;k<nCs;k++){
        const st=new Date(now-between(0,30)*DAY-between(0,6)*3600000)
        const dur=between(900,2100)
        await q(`insert into public.class_sessions (class_id, teacher_user_id, start_lego_id, end_lego_id, started_at, ended_at, cycles_completed, duration_seconds)
                 values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [classId,teacherUid,`S${String(Math.max(1,cls.classSeed-2)).padStart(4,'0')}L01`,classLego,st.toISOString(),new Date(st.getTime()+dur*1000).toISOString(),Math.floor(dur/11),dur])
        totals.classSessions++
      }

      // students
      for(let si=0;si<cls.students;si++){
        const name=`${pick(sc.names[0])} ${pick(sc.names[1])}`
        const lid=uuid(), suid=uuid()
        const stage=studentStage(cls.classSeed)
        const lastPracticed=new Date(now-stage.recencyDays*DAY-between(0,8)*3600000)
        // Did this learner ever get their own account/mic? Drives ALL
        // VAD-fed data below; false means the VAD tables simply have no row
        // for them, which is how a real no-VAD learner presents.
        const hasVad=rnd()<vadRate
        if(hasVad)totals.vadLearners++; else totals.noVadLearners++
        await q(`insert into public.learners (id, user_id, display_name, educational_role, is_demo, created_at)
                 values ($1,$2,$3,'student',true,$4)`,
          [lid,suid,name,new Date(termStart).toISOString()])
        await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'class',$2,'student','demo-suite')`,
          [suid,`CLASS:${classId}`])

        // cursor model (the LIVE progress the player uses)
        const seeds=stage.seeds
        const lastLego=`S${String(seeds).padStart(4,'0')}L0${between(1,4)}`
        const minutes=Math.round(seeds*between(9,15))
        await q(`insert into public.course_enrollments
                 (learner_id, course_id, enrolled_at, last_practiced_at, total_practice_minutes,
                  last_completed_lego_id, highest_completed_lego_id, highest_completed_seed,
                  last_completed_round_index, highest_completed_round_index, current_cycle_index, welcome_played)
                 values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$8,0,true)`,
          [lid,sc.courseCode,new Date(termStart+between(0,3)*DAY).toISOString(),lastPracticed.toISOString(),minutes,lastLego,seeds,seeds*3])

        // count model (what schools dashboards COUNT)
        const seedRows=[], legoRows=[]
        for(let s=1;s<=seeds;s++){
          const sid=`S${String(s).padStart(4,'0')}`
          const introducedAt=new Date(termStart+((lastPracticed.getTime()-termStart)*(s/seeds))).toISOString()
          seedRows.push([lid,sid,sc.courseCode,(s%3)+1,true,introducedAt])
          const nLegos=between(3,4)
          for(let g=1;g<=nLegos;g++)
            legoRows.push([lid,`${sid}L${String(g).padStart(2,'0')}`,sc.courseCode,(s%3)+1,between(2,8),between(1,13),between(2,12),s<seeds-4,introducedAt])
        }
        for(let i=0;i<seedRows.length;i+=200){
          const chunk=seedRows.slice(i,i+200)
          const vals=chunk.map((_,j)=>`($${j*6+1},$${j*6+2},$${j*6+3},$${j*6+4},$${j*6+5},$${j*6+6})`).join(',')
          await q(`insert into public.seed_progress (learner_id, seed_id, course_id, thread_id, is_introduced, introduced_at) values ${vals}`,chunk.flat())
        }
        for(let i=0;i<legoRows.length;i+=150){
          const chunk=legoRows.slice(i,i+150)
          const vals=chunk.map((_,j)=>`($${j*9+1},$${j*9+2},$${j*9+3},$${j*9+4},$${j*9+5},$${j*9+6},$${j*9+7},$${j*9+8},$${j*9+9})`).join(',')
          await q(`insert into public.lego_progress (learner_id, lego_id, course_id, thread_id, fibonacci_position, skip_number, reps_completed, is_retired, last_practiced_at) values ${vals}`,chunk.flat())
        }
        totals.seedRows+=seedRows.length; totals.legoRows+=legoRows.length

        // session history (is_demo -> daily_contributions trigger skips these)
        const span=Math.max(1,lastPracticed.getTime()-termStart)
        const sessionWindows=[]   // {start, end} kept for scattering player_events
        for(let k=0;k<stage.sessions;k++){
          const st=new Date(termStart+rnd()*span)
          const dur=between(480,1500)
          const items=Math.floor(dur/60*between(4,6))
          await q(`insert into public.sessions (learner_id, course_id, started_at, ended_at, duration_seconds, items_practiced, points_earned)
                   values ($1,$2,$3,$4,$5,$6,$6)`,
            [lid,sc.courseCode,st.toISOString(),new Date(st.getTime()+dur*1000).toISOString(),dur,items])
          sessionWindows.push({start:st.getTime(), end:st.getTime()+dur*1000})
        }
        totals.sessions+=stage.sessions; totals.students++

        // ---- difficulty telemetry: latency series + bounded player_events ----
        // Recent-enough learners feed the 30d curvature board; ancient low-engagers
        // are skipped (they wouldn't pass the RPC's last_seen window anyway).
        if(TELEMETRY && stage.recencyDays<=28 && legoRows.length>0){
          // the most recent ~6–12 legos this student practiced (highest seeds = newest)
          const recent=legoRows.slice(-between(6,12))
          // VAD-fed tables (learner_lego_metrics) — half the roster only. The
          // archetype budget is drawn down inside the branch too: a no-VAD
          // learner can't carry a difficulty archetype (nothing measures one),
          // so spending a struggling/easing slot on them would silently thin
          // the board.
          if(hasVad){
            // assign this student a primary archetype, drawing down the scenario budget
            let primary='steady'
            if(strugglersLeft>0 && rnd()<0.6){ primary='struggling'; strugglersLeft-- }
            else if(easersLeft>0 && rnd()<0.6){ primary='easing'; easersLeft-- }
            const llmRows=[]
            for(let li=0;li<recent.length;li++){
              const legoId=recent[li][1]
              // the student's most-recent lego carries the primary signal; the rest
              // are mostly steady with the odd echo, so each named student reads cleanly.
              const archetype = li===recent.length-1 ? primary
                : (primary!=='steady' && rnd()<0.25 ? primary : 'steady')
              const series=difficultySeries(archetype)
              const mean=series.reduce((a,b)=>a+b,0)/series.length
              const ms=pick(MASTERY_BY_ARCHETYPE[archetype])
              const dclass=pick(DEVICE_CLASS)
              // last_seen scattered within the student's recent activity (<=30d), per lego
              const seenMs=Math.min(now-3600000, lastPracticed.getTime()-between(0,4)*DAY-between(0,12)*3600000)
              const nextDue=new Date(now+between(1,9)*DAY).toISOString()
              llmRows.push([
                lid, legoId, sc.courseCode, ms,
                archetype==='steady'?between(2,5):0,            // consecutive_smooth
                archetype==='steady'?between(1,4):0,            // consecutive_fast
                series.length,                                  // n_samples
                new Date(seenMs).toISOString(),                 // last_seen_at
                Math.round(mean*100)/100,                       // mean_latency_ms (normalized ms/char)
                Math.round((archetype==='struggling'?0.45:archetype==='easing'?0.7:0.82)*100)/100, // mean_exec_score
                archetype==='struggling'?between(1,4):between(0,1), // skip_back_count
                archetype==='easing'?between(1,3):between(0,1),     // skip_forward_count
                nextDue,
                JSON.stringify({[dclass]:series.length}),       // device_class_mix
                JSON.stringify(series),                         // recent_latency_samples
              ])
              if(archetype==='struggling')totals.struggling++; else if(archetype==='easing')totals.easing++; else totals.steady++
            }
            for(let i=0;i<llmRows.length;i+=50){
              const chunk=llmRows.slice(i,i+50)
              const vals=chunk.map((_,j)=>{const b=j*15;return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14}::jsonb,$${b+15}::jsonb)`}).join(',')
              await q(`insert into public.learner_lego_metrics
                       (learner_id, lego_id, course_code, mastery_state, consecutive_smooth, consecutive_fast,
                        n_samples, last_seen_at, mean_latency_ms, mean_exec_score, skip_back_count, skip_forward_count,
                        next_due_at, device_class_mix, recent_latency_samples) values ${vals}`,chunk.flat())
            }
            totals.legoMetrics+=llmRows.length
          }

          // bounded player_events: a handful of audio_play + phase_skip + tap_skip
          // per session window, plus one session_complete — these are NOT
          // VAD-derived (they log for every learner, mic or no mic), so every
          // student in this block gets them. cycle_prosody, which IS the VAD
          // corpus, is added per session below for VAD learners only.
          const peRows=[], prosRows=[]
          for(const w of sessionWindows){
            const sessionId=uuid()
            const dev=pick(DEVICE_TYPE)
            const at=()=> new Date(w.start+rnd()*(w.end-w.start)).toISOString()
            const someLego=()=> recent.length?recent[Math.floor(rnd()*recent.length)][1]:lastLego
            const nPlays=between(2,4)
            for(let p=0;p<nPlays;p++)
              peRows.push([lid,sc.courseCode,sessionId,'audio_play',JSON.stringify({legoId:someLego(),role:pick(['prompt','target1','target2']),playbackSpeed:1}),dev,at()])
            if(rnd()<0.6)
              peRows.push([lid,sc.courseCode,sessionId,'phase_skip',JSON.stringify({direction:pick(['back','forward']),legoId:someLego(),role:'pause'}),dev,at()])
            if(rnd()<0.3)
              peRows.push([lid,sc.courseCode,sessionId,'tap_skip',JSON.stringify({legoId:someLego()}),dev,at()])
            peRows.push([lid,sc.courseCode,sessionId,'session_complete',JSON.stringify({cyclesCompleted:between(20,80)}),dev,new Date(w.end).toISOString()])
            // VAD corpus: one cycle_prosody row per voiced speaking cycle in
            // the real player, sampled down to a handful per session here so
            // the demo stays bounded. VAD learners only — absent entirely for
            // the rest, which is what the no-mic learner really looks like.
            if(hasVad && prosRows.length<14){
              const nPros=between(2,5)
              for(let p=0;p<nPros;p++)
                prosRows.push([lid,sc.courseCode,sessionId,'cycle_prosody',JSON.stringify(prosodyPayload(someLego())),dev,at()])
            }
            if(peRows.length>=22) break   // hard cap ~25 events/student to stay bounded
          }
          // Prosody rows are capped on their own budget, so a VAD learner's
          // ordinary events aren't crowded out of the 22 and the two halves of
          // the roster stay comparable on everything except VAD.
          peRows.push(...prosRows)
          totals.prosodyEvents+=prosRows.length
          for(let i=0;i<peRows.length;i+=50){
            const chunk=peRows.slice(i,i+50)
            const vals=chunk.map((_,j)=>{const b=j*7;return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5}::jsonb,$${b+6},$${b+7})`}).join(',')
            await q(`insert into public.player_events
                     (user_id, course_code, session_id, event_type, payload, device_type, occurred_at) values ${vals}`,chunk.flat())
          }
          totals.playerEvents+=peRows.length
        }
      }
      console.log(`  class ${cls.name}: ${cls.students} students`)
    }
    await q('commit')
  }
  await db.end()

  // ~/Desktop only exists on Tom's Mac; on the Linux boxes the run used to die
  // here AFTER every DB write had committed. Create the dir rather than fail.
  const credPath=path.join(os.homedir(),'Desktop',`SSi-demo-credentials-${new Date().toISOString().slice(0,10)}.md`)
  fs.mkdirSync(path.dirname(credPath),{recursive:true})
  fs.writeFileSync(credPath,creds.join('\n'))
  console.log(`\nDONE: ${totals.students} students, ${totals.sessions} sessions, ${totals.seedRows} seed rows, ${totals.legoRows} lego rows, ${totals.classSessions} class sessions`)
  if(TELEMETRY){
    console.log(`TELEMETRY: ${totals.legoMetrics} learner_lego_metrics rows (${totals.struggling} struggling / ${totals.easing} easing / ${totals.steady} steady series), ${totals.playerEvents} player_events`)
    const vadPct=totals.students?Math.round(100*totals.vadLearners/totals.students):0
    console.log(`VAD: ${totals.vadLearners}/${totals.students} learners (${vadPct}%) carry VAD data — ${totals.prosodyEvents} cycle_prosody events; ${totals.noVadLearners} learners have NO rows in any VAD-fed table (real empty state)`)
  } else {
    console.log('TELEMETRY: skipped (recent_latency_samples column absent — apply migrations 20260613_*/20260614_*)')
  }
  console.log(`credentials -> ${credPath}`)
})().catch(e=>{ console.error('FATAL:',e.message); process.exit(1) })
