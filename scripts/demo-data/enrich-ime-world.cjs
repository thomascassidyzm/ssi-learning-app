#!/usr/bin/env node
/**
 * IME DEMO WORLD ENRICHMENT  (founder-ruled 2026-07-20)
 * =====================================================
 * "More classes, more students, more courses they are taking, more schools,
 * more school types — this would really make all those learner insights pop."
 *
 * Extends the IME Demo Programme into a rich two-segment demo world:
 *
 *  SEGMENT 1 — EXISTING state/public schools (Pilot + Coastal regions),
 *  learning ENGLISH: grown to 3-4 classes / ~20 learners each, with varied
 *  REAL English-for-X courses (eng_for_hin / mar / kan / tam / tel / guj —
 *  all verified against the courses table at runtime; the script ABORTS on
 *  any code that doesn't exist). Green Valley Jaipur (previously an empty
 *  shell school) becomes the STAR school (high seed bands); Harbour View
 *  Visakhapatnam stays the struggling one (low bands).
 *
 *  SEGMENT 2 — NEW "Metro International Schools" region under the same
 *  programme: 3 international schools (taught in English) whose learners take
 *  X-for-English courses (fra/spa/deu/zho_for_eng) + ONE small Welsh Club
 *  (cym_n_for_eng — the founder's wink). SOME learners belong to TWO classes
 *  (two courses, two enrollments) so per-course vs all-courses views differ —
 *  the refresh engine generates telemetry per (learner, class) pair since
 *  cb032707.
 *
 * SCALE CEILING: the whole programme stays under 400 demo learners — the
 * script counts the plan up front AND re-counts live after writing, aborting
 * if either exceeds the cap.
 *
 * IDEMPOTENT:
 *  - Metro region: scoped REPLACE (same idiom as generate-coastal-region.cjs)
 *    — re-running deletes the Metro subtree + its '+demo.ime.metro.' auth
 *    users, then regenerates. Never stacks.
 *  - State enrichment: new classes keyed by (school, class_name, course) —
 *    skipped if present; top-ups only add up to the per-class target.
 *  - Also cuts one piece of debris: the empty duplicate 'Grade 7A' at Sunrise
 *    Pune (0 students, seed 1) — only if it still has 0 students.
 *
 * DEMO-FLAGGED ONLY: every group/school/learner written carries is_demo=true;
 * staff auth users use '+demo.ime.' emails so generate-ime-demo.cjs's
 * programme-wide reset sweeps them too. Entitlements ride the STANDARD school
 * trial machinery (platform_status='trial'); multi-course schools get
 * trial_course_code=NULL which the app already reads as "no course lock"
 * (TeacherDashboard.schoolAvailableCourses). No bypasses, no schema changes.
 *
 * NO session/seed/lego rows are written here — run 'Refresh demo activity' on
 * the IME Demo Programme node afterwards; it regenerates all student
 * telemetry (now per learner×class pair) up to the minute.
 *
 *   node scripts/demo-data/enrich-ime-world.cjs               # enrich
 *   node scripts/demo-data/enrich-ime-world.cjs --reset-metro # remove Metro region only
 */
const fs = require('fs')
const path = require('path')

// ---------- env ----------
function loadEnv(p) { const o = {}; try { for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {} return o }
const env = {
  ...loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env'),
  ...loadEnv(path.join(__dirname, '../../.env')),
  ...loadEnv(path.join(__dirname, '../../.env.local')),
  ...loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql'),
}
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const SVC = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
const DATABASE_URL = env.DATABASE_URL
const { Client } = require(fs.existsSync(path.join(__dirname, '../../node_modules/pg')) ? 'pg' : '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg')

const STAFF_PASSWORD = 'SSiDemo2026!'
const EMAIL_BASE = 'thomas.cassidy'
const PROGRAMME_NAME = 'IME Demo Programme'
const METRO_REGION_NAME = 'Metro International Schools'
const LEARNER_CAP = 400
const ADDED_BY = 'ime-enrich-suite'

// ---------- seeded PRNG (reproducible) ----------
let seed = 20260720
function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const uuid = () => { const h = '0123456789abcdef'; let s = ''; for (let i = 0; i < 36; i++) { if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'; else if (i === 14) s += '4'; else if (i === 19) s += h[8 + Math.floor(rnd() * 4)]; else s += h[Math.floor(rnd() * 16)] } return s }

// ---------- name pools ----------
const IN_FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Reyansh', 'Ishaan', 'Shaurya', 'Atharv', 'Advik', 'Kabir',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra', 'Pari', 'Anika', 'Navya', 'Riya',
  'Rohan', 'Karan', 'Dev', 'Yash', 'Arnav', 'Ayaan', 'Krishna', 'Ved', 'Shreya', 'Ishita',
  'Tanvi', 'Prisha', 'Aarohi', 'Avni', 'Meera', 'Nisha', 'Pooja', 'Sanya', 'Tara', 'Zara']
const IN_LAST = ['Sharma', 'Verma', 'Patel', 'Gupta', 'Singh', 'Kumar', 'Joshi', 'Desai', 'Mehta', 'Shah',
  'Agarwal', 'Bansal', 'Chopra', 'Malhotra', 'Kapoor', 'Nair', 'Menon', 'Iyer', 'Reddy', 'Rao',
  'Kulkarni', 'Deshpande', 'Patil', 'Bhat', 'Pillai', 'Das', 'Sen', 'Bose', 'Choudhury', 'Mishra']
// International-school pools lean cosmopolitan (expat + Indian mix)
const INTL_FIRST = ['Aarav', 'Zoe', 'Liam', 'Ananya', 'Noah', 'Mia', 'Kabir', 'Emma', 'Lucas', 'Ishita',
  'Sophia', 'Ethan', 'Aisha', 'Oliver', 'Maya', 'Daniel', 'Sara', 'Ryan', 'Leila', 'Marco',
  'Hana', 'Felix', 'Priya', 'Oscar', 'Nina', 'Dev', 'Chloe', 'Arjun', 'Isabelle', 'Kenji']
const INTL_LAST = ['Mehta', 'Fernandes', 'Kapoor', "D'Souza", 'Rao', 'Tanaka', 'Muller', 'Shah', 'Costa', 'Nair',
  'Petersen', 'Iyer', 'Van Dijk', 'Chopra', 'Rossi', 'Menon', 'Dubois', 'Reddy', 'Kim', 'Almeida']

// ============================================================
// THE PLAN
// ============================================================
// Segment 1: state schools (existing) — top-up + new classes. Bands express
// the star/struggling shape; the refresh engine's personas do the rest.
const STATE_PLAN = [
  {
    school: 'Sunrise Public School, Pune', topUpTo: 20,
    newClasses: [{ name: 'Grade 8A', course: 'eng_for_mar', seedBand: [18, 26], students: 20 }],
  },
  {
    school: "St. Mary's Academy, Kochi", topUpTo: 20,
    newClasses: [{ name: 'Grade 7A', course: 'eng_for_kan', seedBand: [12, 18], students: 20 }],
  },
  {
    // The STAR school — previously an empty shell (no staff, no classes).
    school: 'Green Valley International, Jaipur', topUpTo: 20,
    createStaff: { slug: 'greenvalley', admin: 'Meera Sharma', teachers: ['Rajesh Kumar', 'Pooja Agarwal', 'Vikram Singh'] },
    newClasses: [
      { name: 'Grade 6A', course: 'eng_for_hin', seedBand: [30, 38], students: 20 },
      { name: 'Grade 7B', course: 'eng_for_guj', seedBand: [26, 34], students: 20 },
      { name: 'Grade 8A', course: 'eng_for_hin', seedBand: [36, 44], students: 20 },
    ],
  },
  {
    school: 'Seaside Model School, Chennai', topUpTo: 20,
    newClasses: [{ name: 'Grade 7A', course: 'eng_for_tam', seedBand: [4, 8], students: 20 }],
  },
  {
    // The STRUGGLING school — stays in the low band.
    school: 'Harbour View School, Visakhapatnam', topUpTo: 20,
    newClasses: [{ name: 'Grade 6B', course: 'eng_for_tel', seedBand: [3, 6], students: 20 }],
  },
]

// Segment 2: Metro International Schools — X-for-English. `dual` moves N
// students of the FROM class into this class too (two tags, two enrollments).
const METRO_PLAN = [
  {
    key: 'oakridge', name: 'Oakridge International School, Bengaluru',
    admin: 'Sunita Krishnamurthy', teachers: ['Claire Dubois', 'Miguel Alvarez'],
    classes: [
      { name: '7A French', course: 'fra_for_eng', seedBand: [15, 22], students: 13 },
      { name: '7B Spanish', course: 'spa_for_eng', seedBand: [10, 16], students: 8, dual: { from: '7A French', n: 4 } },
    ],
  },
  {
    // French runs at TWO classes here so it is Global Edge's DEFAULT course
    // (rate-compare defaults to the busiest course, ties alphabetical — deu
    // would win a 1-1-1 tie and has no peer school, landing the school's
    // insights on the honest k-floor empty state). French electives are
    // dual-populated from the German/Mandarin rosters — realistic, and it
    // multiplies the two-course learners the founder asked for.
    key: 'globaledge', name: 'Global Edge Academy, Mumbai',
    admin: 'Farhan Merchant', teachers: ['Anke Weber', 'Li Wen', 'Claire Fontaine'],
    classes: [
      { name: 'Grade 8 German', course: 'deu_for_eng', seedBand: [12, 20], students: 13 },
      { name: 'Grade 9 Mandarin', course: 'zho_for_eng', seedBand: [8, 14], students: 12 },
      { name: '8A French', course: 'fra_for_eng', seedBand: [10, 16], students: 2, dual: { from: 'Grade 8 German', n: 6 } },
      { name: '9A French', course: 'fra_for_eng', seedBand: [12, 18], students: 2, dual: { from: 'Grade 9 Mandarin', n: 6 } },
    ],
  },
  {
    // Spanish at TWO classes so it is the default course (a 1-1-1 tie would
    // alphabetically pick cym — the Welsh Club — which has no peer school).
    key: 'lotusvalley', name: 'Lotus Valley International, Delhi',
    admin: 'Kavita Bhatnagar', teachers: ['Elena Garcia', 'Gareth Llewelyn'],
    classes: [
      { name: 'Year 6 Spanish', course: 'spa_for_eng', seedBand: [18, 25], students: 14 },
      { name: 'Year 7 Spanish', course: 'spa_for_eng', seedBand: [14, 20], students: 12 },
      // The founder's wink: one small Welsh class, mostly Year 6 kids doubling up.
      { name: 'Welsh Club', course: 'cym_n_for_eng', seedBand: [3, 7], students: 3, dual: { from: 'Year 6 Spanish', n: 5 } },
    ],
  },
]

// Empty duplicate class debris at Sunrise Pune (verified 0 students, seed 1).
const DUP_CLASS_ID = '80f34724-88a2-4e2a-b172-f596e792f189'

const emailFor = (slug) => `${EMAIL_BASE}+demo.ime.metro.${slug}@gmail.com`
const emailForState = (slug) => `${EMAIL_BASE}+demo.ime.enrich.${slug}@gmail.com`

// engagement stage anchor relative to a class seed (Russell 2024 20/50/30 —
// anchors only; refresh draws its own personas on top)
function studentStage(classSeed) {
  const r = rnd()
  if (r < 0.20) return between(Math.max(classSeed, 3), classSeed + 3)
  if (r < 0.70) return between(Math.max(2, classSeed - 4), classSeed + 1)
  return between(1, Math.max(2, Math.floor(classSeed / 2)))
}

// ---------- auth admin helpers ----------
async function authReq(method, p, body) {
  const r = await fetch(SUPABASE_URL + p, { method, headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j }
}
async function ensureAuthUser(email) {
  const cu = await authReq('POST', '/auth/v1/admin/users', { email, password: STAFF_PASSWORD, email_confirm: true })
  if (cu.body?.id) return cu.body.id
  const ls = await authReq('GET', '/auth/v1/admin/users?page=1&per_page=1000')
  const u = (ls.body?.users || []).find(x => x.email === email)
  if (!u) throw new Error(`auth user neither created nor found: ${email} (${cu.status})`)
  return u.id
}
async function deleteMetroAuthUsers() {
  const ls = await authReq('GET', '/auth/v1/admin/users?page=1&per_page=1000')
  const demos = (ls.body?.users || []).filter(u => u.email && u.email.includes('+demo.ime.metro.'))
  for (const u of demos) await authReq('DELETE', `/auth/v1/admin/users/${u.id}`)
  return demos.length
}

async function registerJoinCodes(q, schoolId, createdBy) {
  const { rows } = await q(`select teacher_join_code, admin_join_code from public.schools where id=$1`, [schoolId])
  const school = rows[0]
  if (!school) return
  const codes = [[school.teacher_join_code, 'teacher'], [school.admin_join_code, 'school_admin_join']].filter(([c]) => !!c)
  for (const [code, codeType] of codes) {
    await q(`insert into public.invite_codes (code, code_type, created_by, grants_school_id, is_active)
             values ($1,$2,$3,$4,true) on conflict (code) do nothing`, [code, codeType, createdBy, schoolId])
  }
}

async function insertStudent(q, { classId, courseId, classSeed, namePool, createdAtMs }) {
  const name = `${pick(namePool.first)} ${pick(namePool.last)}`
  const lid = uuid(), suid = uuid()
  const seeds = Math.max(1, studentStage(classSeed))
  const lastLego = `S${String(seeds).padStart(4, '0')}L0${between(1, 4)}`
  await q(`insert into public.learners (id, user_id, display_name, educational_role, is_demo, created_at)
           values ($1,$2,$3,'student',true,$4)`, [lid, suid, name, new Date(createdAtMs).toISOString()])
  await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
           values ($1,'class',$2,'student',$3)`, [suid, `CLASS:${classId}`, ADDED_BY])
  await q(`insert into public.course_enrollments
           (learner_id, course_id, enrolled_at, last_practiced_at, total_practice_minutes,
            last_completed_lego_id, highest_completed_lego_id, highest_completed_seed,
            last_completed_round_index, highest_completed_round_index, current_cycle_index, welcome_played)
           values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$8,0,true)`,
    [lid, courseId, new Date(createdAtMs + between(0, 5) * 86400000).toISOString(), new Date(Date.now() - between(0, 6) * 86400000).toISOString(),
      Math.round(seeds * between(9, 15)), lastLego, seeds, seeds * 3])
  return { lid, suid, name }
}

async function dualEnroll(q, { suid, classId, courseId, classSeed }) {
  // second class tag + second course enrollment for an EXISTING student
  await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
           values ($1,'class',$2,'student',$3)`, [suid, `CLASS:${classId}`, ADDED_BY])
  const seeds = Math.max(1, Math.min(studentStage(classSeed), classSeed + 3))
  const lastLego = `S${String(seeds).padStart(4, '0')}L0${between(1, 4)}`
  await q(`insert into public.course_enrollments
           (learner_id, course_id, enrolled_at, last_practiced_at, total_practice_minutes,
            last_completed_lego_id, highest_completed_lego_id, highest_completed_seed,
            last_completed_round_index, highest_completed_round_index, current_cycle_index, welcome_played)
           select l.id, $2, now() - interval '20 days', now() - interval '2 days', $3, $4, $4, $5, $6, $6, 0, true
           from public.learners l where l.user_id=$1 and l.is_demo=true
           on conflict do nothing`,
    [suid, courseId, Math.round(seeds * between(9, 15)), lastLego, seeds, seeds * 3])
}

// ============================================================
;(async () => {
  if (!SUPABASE_URL || !SVC || !DATABASE_URL) { console.error('missing env (SUPABASE_URL / service key / DATABASE_URL)'); process.exit(1) }
  const resetMetroOnly = process.argv.includes('--reset-metro')
  const db = new Client({ connectionString: DATABASE_URL }); await db.connect()
  const q = (sql, params) => db.query(sql, params)
  const now = Date.now(), DAY = 86400000

  const prog = await q(`select id from public.groups where name=$1 and is_demo=true limit 1`, [PROGRAMME_NAME])
  if (prog.rowCount === 0) { console.error(`programme "${PROGRAMME_NAME}" not found`); process.exit(1) }
  const programmeId = prog.rows[0].id

  // ---- verify EVERY course code actually exists (never invent codes) ----
  const allCourses = [...new Set([
    ...STATE_PLAN.flatMap(s => s.newClasses.map(c => c.course)),
    ...METRO_PLAN.flatMap(s => s.classes.map(c => c.course)),
  ])]
  const found = await q(`select course_code from public.courses where course_code = any($1)`, [allCourses])
  const missing = allCourses.filter(c => !found.rows.some(r => r.course_code === c))
  if (missing.length) { console.error(`ABORT: course codes not in courses table: ${missing.join(', ')}`); process.exit(1) }
  console.log(`courses verified: ${allCourses.join(', ')}`)

  // ---- SCOPED RESET: Metro region subtree + its auth users ----
  console.log('— RESET Metro region (scoped, replace-idiom) —')
  await q('begin')
  const reg = await q(`select id from public.groups where name=$1 and parent_id=$2 and is_demo=true limit 1`, [METRO_REGION_NAME, programmeId])
  if (reg.rowCount > 0) {
    const regionId = reg.rows[0].id
    const subGroupIds = (await q(`select id from public.groups where id=$1 or parent_id=$1`, [regionId])).rows.map(r => r.id)
    const schoolIds = (await q(`select id from public.schools where group_id = any($1::uuid[]) or node_group_id = any($1::uuid[])`, [subGroupIds])).rows.map(r => r.id)
    const classIds = schoolIds.length ? (await q(`select id from public.classes where school_id = any($1::uuid[])`, [schoolIds])).rows.map(r => r.id) : []
    const studentUserIds = classIds.length
      ? (await q(`select distinct user_id from public.user_tags where tag_type='class' and tag_value = any($1)`, [classIds.map(c => `CLASS:${c}`)])).rows.map(r => r.user_id) : []
    const staffUserIds = schoolIds.length
      ? (await q(`select distinct user_id from public.user_tags where tag_type='school' and tag_value = any($1)`, [schoolIds.map(s => `SCHOOL:${s}`)])).rows.map(r => r.user_id) : []
    const learnerUserIds = [...studentUserIds, ...staffUserIds]
    const learnerIds = learnerUserIds.length
      ? (await q(`select id from public.learners where user_id = any($1::text[]) and is_demo=true`, [learnerUserIds])).rows.map(r => r.id) : []
    if (classIds.length) await q(`delete from public.class_sessions where class_id = any($1::uuid[])`, [classIds])
    if (learnerIds.length) {
      await q(`delete from public.sessions where learner_id = any($1::uuid[])`, [learnerIds])
      await q(`delete from public.course_enrollments where learner_id = any($1::uuid[])`, [learnerIds])
      await q(`delete from public.seed_progress where learner_id = any($1::uuid[])`, [learnerIds])
      await q(`delete from public.lego_progress where learner_id = any($1::uuid[])`, [learnerIds])
    }
    if (classIds.length) await q(`delete from public.user_tags where tag_type='class' and tag_value = any($1)`, [classIds.map(c => `CLASS:${c}`)])
    if (schoolIds.length) await q(`delete from public.user_tags where tag_type='school' and tag_value = any($1)`, [schoolIds.map(s => `SCHOOL:${s}`)])
    if (classIds.length) await q(`delete from public.classes where id = any($1::uuid[])`, [classIds])
    if (schoolIds.length) await q(`delete from public.invite_codes where grants_school_id = any($1::uuid[])`, [schoolIds])
    if (schoolIds.length) await q(`delete from public.schools where id = any($1::uuid[])`, [schoolIds])
    if (learnerUserIds.length) await q(`delete from public.learners where user_id = any($1::text[]) and is_demo=true`, [learnerUserIds])
    await q(`delete from public.groups where id = any($1::uuid[])`, [subGroupIds])
    console.log(`  removed prior Metro region subtree (${schoolIds.length} schools, ${classIds.length} classes, ${learnerIds.length} learners)`)
  } else console.log('  no prior Metro region')
  await q('commit')
  const nAuth = await deleteMetroAuthUsers()
  if (nAuth) console.log(`  removed ${nAuth} metro auth users`)
  if (resetMetroOnly) { await db.end(); console.log('reset-metro done'); return }

  // ---- CAP CHECK (plan-level, before any writes) ----
  const cur = await q(`
    with recursive t as (select id from public.groups where id=$1
      union all select g.id from public.groups g join t on g.parent_id=t.id)
    select count(distinct l.id)::int n from public.learners l
     join public.user_tags ut on ut.user_id=l.user_id and ut.tag_value like 'CLASS:%' and ut.removed_at is null
     join public.classes cl on cl.id::text = substring(ut.tag_value from 7)
     join public.schools s on s.id=cl.school_id
     where l.is_demo=true and (s.node_group_id in (select id from t) or s.group_id in (select id from t))`, [programmeId])
  const currentLearners = cur.rows[0].n
  // plan additions: GENUINELY-new state classes (already-existing ones are
  // skipped in the build loop, so they must not count here either — the
  // re-run cap check was aborting on classes it would never create) +
  // ACTUAL top-up deficits + metro distinct
  let planned = 0
  for (const sp of STATE_PLAN) {
    for (const nc of sp.newClasses) {
      const ex = await q(`select 1 from public.classes cl join public.schools s on s.id=cl.school_id
                          where s.school_name=$1 and s.is_demo=true and cl.class_name=$2 and cl.course_code=$3`,
        [sp.school, nc.name, nc.course])
      if (ex.rowCount === 0) planned += nc.students
    }
  }
  let topUpNeed = 0
  for (const sp of STATE_PLAN) {
    const defs = await q(`
      select greatest(0, $2 - count(l.id) filter (where l.is_demo=true))::int deficit
      from public.classes cl
      left join public.user_tags ut on ut.tag_value = 'CLASS:' || cl.id and ut.role_in_context='student' and ut.removed_at is null
      left join public.learners l on l.user_id = ut.user_id
      where cl.school_id = (select id from public.schools where school_name=$1 and is_demo=true)
      group by cl.id`, [sp.school, sp.topUpTo || 20])
    topUpNeed += defs.rows.reduce((a, r) => a + r.deficit, 0)
  }
  const metroDistinct = METRO_PLAN.flatMap(s => s.classes).reduce((a, c) => a + c.students, 0)
  const projected = currentLearners + planned + topUpNeed + metroDistinct
  if (projected > LEARNER_CAP) {
    console.error(`ABORT: plan exceeds cap (${currentLearners} current + ${planned} new-class + ${topUpNeed} top-up + ${metroDistinct} metro = ${projected} > ${LEARNER_CAP})`)
    process.exit(1)
  }
  console.log(`cap check: ${currentLearners} current + ${planned + topUpNeed + metroDistinct} planned = ${projected} ≤ ${LEARNER_CAP}`)

  const ssiAdminRow = await q(`select user_id from public.learners where platform_role='ssi_admin' limit 1`)
  const ssiAdminUid = ssiAdminRow.rows[0]?.user_id
  const creds = [`# IME demo-world enrichment credentials — ${new Date().toISOString().slice(0, 10)}`,
    `Password for ALL staff: ${STAFF_PASSWORD}`, `OTP codes arrive at ${EMAIL_BASE}@gmail.com via + addressing.`, '']
  const totals = { newStudents: 0, dualEnrollments: 0, newClasses: 0, newSchools: 0, topUps: 0 }

  // ============================================================
  // SEGMENT 1 — state schools
  // ============================================================
  console.log('\n===== SEGMENT 1: state schools =====')

  // debris: the empty duplicate Grade 7A at Sunrise (only if still 0 students)
  const dupStudents = await q(`select count(*)::int n from public.user_tags where tag_value=$1 and role_in_context='student' and removed_at is null`, [`CLASS:${DUP_CLASS_ID}`])
  if (dupStudents.rows[0].n === 0) {
    await q(`delete from public.class_sessions where class_id=$1`, [DUP_CLASS_ID])
    const del = await q(`delete from public.classes where id=$1 and current_seed=1`, [DUP_CLASS_ID])
    if (del.rowCount) console.log('cut debris: empty duplicate Grade 7A at Sunrise Pune')
  }

  for (const sp of STATE_PLAN) {
    const sRow = await q(`select id, node_group_id, teacher_join_code from public.schools where school_name=$1 and is_demo=true`, [sp.school])
    if (sRow.rowCount === 0) { console.error(`  SKIP (not found): ${sp.school}`); continue }
    const school = sRow.rows[0]
    console.log(`\n— ${sp.school} —`)
    await q('begin')

    // staff (Green Valley shell): create if the school has none
    let teacherUids = (await q(`select user_id from public.user_tags where tag_value=$1 and role_in_context='teacher' and removed_at is null`, [`SCHOOL:${school.id}`])).rows.map(r => r.user_id)
    if (!teacherUids.length && sp.createStaff) {
      const st = sp.createStaff
      const adminUid = await ensureAuthUser(emailForState(`${st.slug}.admin`))
      await q(`update public.learners set display_name=$1, educational_role='school_admin', is_demo=true where user_id=$2`, [st.admin, adminUid])
      await q(`update public.schools set admin_user_id=$1 where id=$2`, [adminUid, school.id])
      await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'admin',$3)`, [adminUid, `SCHOOL:${school.id}`, ADDED_BY])
      creds.push(`## ${sp.school}`, `- school admin: ${st.admin} — ${emailForState(`${st.slug}.admin`)}`)
      for (let i = 0; i < st.teachers.length; i++) {
        const tUid = await ensureAuthUser(emailForState(`${st.slug}.teacher${i + 1}`))
        await q(`update public.learners set display_name=$1, educational_role='teacher', is_demo=true where user_id=$2`, [st.teachers[i], tUid])
        await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'teacher',$3)`, [tUid, `SCHOOL:${school.id}`, ADDED_BY])
        creds.push(`- teacher: ${st.teachers[i]} — ${emailForState(`${st.slug}.teacher${i + 1}`)}`)
        teacherUids.push(tUid)
      }
      creds.push('')
      await registerJoinCodes(q, school.id, adminUid)
    }

    // top up existing classes to target
    const existing = await q(`select id, class_name, course_code, current_seed from public.classes where school_id=$1`, [school.id])
    for (const cls of existing.rows) {
      const n = (await q(`select count(*)::int n from public.user_tags ut join public.learners l on l.user_id=ut.user_id and l.is_demo=true
                          where ut.tag_value=$1 and ut.role_in_context='student' and ut.removed_at is null`, [`CLASS:${cls.id}`])).rows[0].n
      const want = (sp.topUpTo || 20) - n
      for (let i = 0; i < want; i++) {
        await insertStudent(q, { classId: cls.id, courseId: cls.course_code, classSeed: cls.current_seed || 5, namePool: { first: IN_FIRST, last: IN_LAST }, createdAtMs: now - between(20, 50) * DAY })
        totals.newStudents++; totals.topUps++
      }
      if (want > 0) console.log(`  top-up ${cls.class_name} (${cls.course_code}): +${want} → ${sp.topUpTo}`)
    }

    // new classes (skip if same name+course already present)
    for (const nc of sp.newClasses) {
      const dup = existing.rows.find(r => r.class_name === nc.name && r.course_code === nc.course)
      if (dup) { console.log(`  exists, skip: ${nc.name} (${nc.course})`); continue }
      if (!teacherUids.length) { console.error(`  no teachers at ${sp.school} — cannot create ${nc.name}`); continue }
      const classId = uuid()
      const classSeed = between(...nc.seedBand)
      await q(`insert into public.classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, last_lego_id, group_id, is_active)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
        [classId, school.id, teacherUids[between(0, teacherUids.length - 1)], nc.name, nc.course,
          `DEMO-ENR-${classId.slice(0, 6)}`, classSeed, `S${String(classSeed).padStart(4, '0')}L0${between(1, 3)}`, school.node_group_id])
      for (let i = 0; i < nc.students; i++) {
        await insertStudent(q, { classId, courseId: nc.course, classSeed, namePool: { first: IN_FIRST, last: IN_LAST }, createdAtMs: now - between(20, 50) * DAY })
        totals.newStudents++
      }
      totals.newClasses++
      console.log(`  new class ${nc.name} (${nc.course}): ${nc.students} students, seed=${classSeed}`)
    }

    // multi-course school → standard trial with no course lock
    await q(`update public.schools set trial_course_code=null where id=$1 and platform_status='trial'`, [school.id])
    await q('commit')
  }

  // ============================================================
  // SEGMENT 2 — Metro International Schools region
  // ============================================================
  console.log('\n===== SEGMENT 2: Metro International Schools =====')
  const regionId = uuid()
  await q(`insert into public.groups (id, name, type, is_demo, is_test, name_confirmed, parent_id)
           values ($1,$2,'region',true,true,true,$3)`, [regionId, METRO_REGION_NAME, programmeId])

  for (let sIdx = 0; sIdx < METRO_PLAN.length; sIdx++) {
    const sch = METRO_PLAN[sIdx]
    console.log(`\n— ${sch.name} —`)
    const nodeGroupId = uuid()
    await q(`insert into public.groups (id, name, type, is_demo, is_test, name_confirmed, parent_id)
             values ($1,$2,'school',true,true,true,$3)`, [nodeGroupId, sch.name, regionId])

    const adminUid = await ensureAuthUser(emailFor(`${sch.key}.admin`))
    const teacherUids = []
    for (let i = 0; i < sch.teachers.length; i++) teacherUids.push(await ensureAuthUser(emailFor(`${sch.key}.teacher${i + 1}`)))
    creds.push(`## ${sch.name}`, `- school admin: ${sch.admin} — ${emailFor(`${sch.key}.admin`)}`,
      ...sch.teachers.map((t, i) => `- teacher: ${t} — ${emailFor(`${sch.key}.teacher${i + 1}`)}`), '')

    await q('begin')
    await q(`update public.learners set display_name=$1, educational_role='school_admin', is_demo=true where user_id=$2`, [sch.admin, adminUid])
    for (let i = 0; i < teacherUids.length; i++)
      await q(`update public.learners set display_name=$1, educational_role='teacher', is_demo=true where user_id=$2`, [sch.teachers[i], teacherUids[i]])

    const schoolId = uuid()
    const codePrefix = `DEMO-METRO${sIdx}`
    // multi-course international school → standard trial, NO course lock
    await q(`insert into public.schools
             (id, school_name, admin_user_id, teacher_join_code, admin_join_code, group_id, node_group_id, is_demo, is_test,
              platform_status, trial_kind, trial_course_code, platform_expires_at, name_confirmed)
             values ($1,$2,$3,$4,$5,$6,$7,true,true,'trial','free_1yr',null,$8,true)`,
      [schoolId, sch.name, adminUid, `${codePrefix}-T`, `${codePrefix}-A`, regionId, nodeGroupId, new Date(now + 365 * DAY).toISOString()])
    await registerJoinCodes(q, schoolId, adminUid)
    await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'admin',$3)`, [adminUid, `SCHOOL:${schoolId}`, ADDED_BY])
    for (const t of teacherUids)
      await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'teacher',$3)`, [t, `SCHOOL:${schoolId}`, ADDED_BY])

    const rosterByClass = {}
    for (let ci = 0; ci < sch.classes.length; ci++) {
      const nc = sch.classes[ci]
      const classId = uuid()
      const classSeed = between(...nc.seedBand)
      await q(`insert into public.classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, last_lego_id, group_id, is_active)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
        [classId, schoolId, teacherUids[ci % teacherUids.length], nc.name, nc.course,
          `${codePrefix}-${ci + 1}`, classSeed, `S${String(classSeed).padStart(4, '0')}L0${between(1, 3)}`, nodeGroupId])
      totals.newClasses++
      const roster = []
      for (let i = 0; i < nc.students; i++) {
        const s = await insertStudent(q, { classId, courseId: nc.course, classSeed, namePool: { first: INTL_FIRST, last: INTL_LAST }, createdAtMs: now - between(15, 45) * DAY })
        roster.push(s); totals.newStudents++
      }
      // dual-course learners: pull N from the sibling class into this one too
      if (nc.dual) {
        const fromRoster = rosterByClass[nc.dual.from] || []
        const picked = fromRoster.slice(0, nc.dual.n)
        for (const s of picked) {
          await dualEnroll(q, { suid: s.suid, classId, courseId: nc.course, classSeed })
          totals.dualEnrollments++
        }
        console.log(`  class ${nc.name} (${nc.course}): ${nc.students} new + ${picked.length} dual, seed=${classSeed}`)
      } else {
        console.log(`  class ${nc.name} (${nc.course}): ${nc.students} students, seed=${classSeed}`)
      }
      rosterByClass[nc.name] = roster
    }
    await q('commit')
    totals.newSchools++
  }

  // ---- POST-COUNT: live cap re-check ----
  const post = await q(`
    with recursive t as (select id from public.groups where id=$1
      union all select g.id from public.groups g join t on g.parent_id=t.id)
    select count(distinct l.id)::int n from public.learners l
     join public.user_tags ut on ut.user_id=l.user_id and ut.tag_value like 'CLASS:%' and ut.removed_at is null
     join public.classes cl on cl.id::text = substring(ut.tag_value from 7)
     join public.schools s on s.id=cl.school_id
     where l.is_demo=true and (s.node_group_id in (select id from t) or s.group_id in (select id from t))`, [programmeId])
  const finalCount = post.rows[0].n
  await db.end()

  const credPath = `/Users/tomcassidy/Desktop/SSi-ime-enrich-credentials-${new Date().toISOString().slice(0, 10)}.md`
  fs.writeFileSync(credPath, creds.join('\n'))

  console.log(`\nDONE: +${totals.newSchools} schools, +${totals.newClasses} classes, +${totals.newStudents} students (${totals.topUps} via top-up), ${totals.dualEnrollments} dual enrollments`)
  console.log(`IME programme learner count: ${finalCount} (cap ${LEARNER_CAP}) ${finalCount <= LEARNER_CAP ? 'OK' : '*** OVER CAP ***'}`)
  console.log(`credentials -> ${credPath}`)
  console.log(`NEXT: run 'Refresh demo activity' on the IME Demo Programme node.`)
  if (finalCount > LEARNER_CAP) process.exit(2)
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
