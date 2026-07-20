#!/usr/bin/env node
/**
 * COASTAL DISTRICTS REGION GENERATOR  (scoped ADD under IME Demo Programme)
 * =========================================================================
 * The IME demo tree was programme -> Pilot Districts Region -> schools ->
 * classes. With ONLY ONE region, the region-level Insight view (THE LENS,
 * api/groups/:id/rate-compare.ts) shows the k-floor empty state — a region's
 * compare cohort is its PEER SCHOOLS within the programme, and every school
 * lived inside the single region, so there were zero peers. This script fixes
 * that with DATA: a SECOND demo region ('Coastal Districts Region') under the
 * same programme, with 2 demo schools / classes / synthetic learners, so both
 * regions now have peer schools to compare against.
 *
 * Deliberately an EARLIER-STAGE / slower region (low class current_seed) so
 * the compare is interesting: Coastal reads meaningfully below the more
 * advanced Pilot region on rate-of-progress, both directions.
 *
 * Mirrors the CANONICAL tree linkage exactly (verified live against the Pilot
 * region rows):
 *   - region  = groups row (type 'region', parent = programme); path is
 *     trigger-computed (trg_compute_group_path).
 *   - school  = groups row (type 'school', parent = region)  -> node_group_id
 *               + schools row: node_group_id = school node, group_id = REGION
 *               (matches Pilot's schools, which point group_id at the region).
 *   - class   = classes row: school_id = schools.id, group_id = node_group_id
 *               (the school NODE), teacher_user_id = a real auth teacher.
 *   - student = learners (synthetic uuid, is_demo) + user_tags CLASS:<id>
 *               student + a course_enrollments cursor (the refresh engine
 *               anchors regenerated telemetry to highest_completed_seed).
 *
 * NO session/seed/lego rows are written here — 'Refresh demo activity'
 * (api/_utils/demoNodeRefresh.ts) regenerates all student telemetry up to the
 * minute AFTER this runs (and would delete any we pre-wrote). This script only
 * lays the durable structure + enrollment anchors.
 *
 * DEMO-FLAGGED ONLY. is_demo=true / is_test=true on every node, school and
 * learner; staff auth users use '+demo.ime.coastal.' emails so the existing
 * generate-ime-demo.cjs reset (which sweeps the whole programme subtree +
 * '+demo.ime.' auth users) also cleans these up. No schema changes.
 *
 *   node scripts/demo-data/generate-coastal-region.cjs            # reset + generate
 *   node scripts/demo-data/generate-coastal-region.cjs --reset-only
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
const emailFor = (slug) => `${EMAIL_BASE}+demo.ime.coastal.${slug}@gmail.com`
const PROGRAMME_NAME = 'IME Demo Programme'
const REGION_NAME = 'Coastal Districts Region'
const COURSE_CODE = 'eng_for_hin' // same course as the Pilot region — required for a like-for-like cohort compare

// ---------- seeded PRNG (reproducible) ----------
let seed = 20260719
function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const uuid = () => { const h = '0123456789abcdef'; let s = ''; for (let i = 0; i < 36; i++) { if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'; else if (i === 14) s += '4'; else if (i === 19) s += h[8 + Math.floor(rnd() * 4)]; else s += h[Math.floor(rnd() * 16)] } return s }

// ---------- Indian name pools (Tamil / Telugu coastal flavour) ----------
const STUDENT_FIRST = ['Karthik', 'Aravind', 'Surya', 'Vishnu', 'Harish', 'Gowtham', 'Balaji', 'Naveen', 'Praveen', 'Dinesh',
  'Lakshmi', 'Divya', 'Sowmya', 'Keerthana', 'Nithya', 'Sneha', 'Bhavya', 'Anusha', 'Swathi', 'Meghana',
  'Vijay', 'Ashwin', 'Rohit', 'Sathish', 'Manoj', 'Charan', 'Yuvan', 'Nikhil', 'Deepak', 'Kavya',
  'Priyanka', 'Ramya', 'Sridevi', 'Tejaswi', 'Varsha', 'Akhil', 'Hemanth', 'Sai', 'Pavan', 'Chaitanya']
const STUDENT_LAST = ['Subramanian', 'Krishnan', 'Raju', 'Naidu', 'Reddy', 'Rao', 'Pillai', 'Iyer', 'Menon', 'Nair',
  'Chandra', 'Prasad', 'Varma', 'Sastry', 'Gopal', 'Murthy', 'Setty', 'Achari', 'Bhat', 'Kamath']

const STAFF = {
  seaside: { admin: 'Latha Subramanian', teachers: ['Ravi Menon', 'Deepa Nair'] },
  harbour: { admin: 'Suresh Rao', teachers: ['Anjali Das'] },
}

// Two schools. Coastal is an EARLY-STAGE region — class current_seed sits in a
// LOW band (5-10) vs the Pilot region's 15-41, so its rate-of-progress reads
// meaningfully below Pilot's (the arc a class advances per week is capped by
// its current_seed in the refresh engine). classCount 1-2 as specified.
const SCHOOLS = [
  { key: 'seaside', name: 'Seaside Model School, Chennai', classCount: 2 },
  { key: 'harbour', name: 'Harbour View School, Visakhapatnam', classCount: 1 },
]
const CLASS_NAMES = ['Grade 6A', 'Grade 6B', 'Grade 7A']

// engagement distribution (Russell 2024 shape ~20/50/30) — anchors only; the
// refresh engine draws its own personas on top of these enrollment cursors.
function studentStage(classSeed) {
  const r = rnd()
  if (r < 0.20) return { seeds: between(Math.max(classSeed, 4), classSeed + 3) }
  if (r < 0.70) return { seeds: between(Math.max(2, classSeed - 3), classSeed + 1) }
  return { seeds: between(1, Math.max(2, Math.floor(classSeed / 2))) }
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
async function deleteCoastalAuthUsers() {
  const ls = await authReq('GET', '/auth/v1/admin/users?page=1&per_page=1000')
  const demos = (ls.body?.users || []).filter(u => u.email && u.email.includes('+demo.ime.coastal.'))
  for (const u of demos) await authReq('DELETE', `/auth/v1/admin/users/${u.id}`)
  return demos.length
}

// ---------- join-code registration (mirrors api/_utils/schoolJoinCodes.ts) ----------
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

// ---------- main ----------
;(async () => {
  if (!SUPABASE_URL || !SVC || !DATABASE_URL) { console.error('missing env (SUPABASE_URL / service key / DATABASE_URL)'); process.exit(1) }
  const resetOnly = process.argv.includes('--reset-only')
  const db = new Client({ connectionString: DATABASE_URL }); await db.connect()
  const q = (sql, params) => db.query(sql, params)

  // programme (parent) must already exist
  const prog = await q(`select id from public.groups where name=$1 and is_demo=true limit 1`, [PROGRAMME_NAME])
  if (prog.rowCount === 0) { console.error(`programme "${PROGRAMME_NAME}" not found — run generate-ime-demo.cjs first`); await db.end(); process.exit(1) }
  const programmeId = prog.rows[0].id

  // ---- SCOPED RESET: only the Coastal region subtree + its auth users ----
  console.log('— RESET Coastal region (scoped) —')
  await q('begin')
  const reg = await q(`select id from public.groups where name=$1 and parent_id=$2 and is_demo=true limit 1`, [REGION_NAME, programmeId])
  let counts = { classSessions: 0, sessions: 0, enrollments: 0, seedRows: 0, legoRows: 0, tags: 0, classes: 0, invites: 0, schools: 0, learners: 0, groups: 0 }
  if (reg.rowCount > 0) {
    const regionId = reg.rows[0].id
    // every group node in the region subtree (region + its school nodes)
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

    if (classIds.length) counts.classSessions = (await q(`delete from public.class_sessions where class_id = any($1::uuid[])`, [classIds])).rowCount
    if (learnerIds.length) {
      counts.sessions = (await q(`delete from public.sessions where learner_id = any($1::uuid[])`, [learnerIds])).rowCount
      counts.enrollments = (await q(`delete from public.course_enrollments where learner_id = any($1::uuid[])`, [learnerIds])).rowCount
      counts.seedRows = (await q(`delete from public.seed_progress where learner_id = any($1::uuid[])`, [learnerIds])).rowCount
      counts.legoRows = (await q(`delete from public.lego_progress where learner_id = any($1::uuid[])`, [learnerIds])).rowCount
    }
    counts.tags = (await q(`delete from public.user_tags where added_by='ime-coastal-suite'`)).rowCount
    if (classIds.length) counts.classes = (await q(`delete from public.classes where id = any($1::uuid[])`, [classIds])).rowCount
    if (schoolIds.length) counts.invites = (await q(`delete from public.invite_codes where grants_school_id = any($1::uuid[])`, [schoolIds])).rowCount
    if (schoolIds.length) counts.schools = (await q(`delete from public.schools where id = any($1::uuid[])`, [schoolIds])).rowCount
    if (learnerUserIds.length) counts.learners = (await q(`delete from public.learners where user_id = any($1::text[]) and is_demo=true`, [learnerUserIds])).rowCount
    // delete school nodes then the region node
    counts.groups = (await q(`delete from public.groups where id = any($1::uuid[])`, [subGroupIds])).rowCount
  }
  await q('commit')
  const nAuth = await deleteCoastalAuthUsers()
  console.log(`  classSessions:${counts.classSessions} sessions:${counts.sessions} enrollments:${counts.enrollments} seedRows:${counts.seedRows} legoRows:${counts.legoRows} tags:${counts.tags} classes:${counts.classes} invites:${counts.invites} schools:${counts.schools} learners:${counts.learners} groups:${counts.groups} authUsers:${nAuth}`)
  if (resetOnly) { await db.end(); console.log('reset-only done'); return }

  // ---- a REAL ssi_admin uid for created_by attribution ----
  const ssiAdminRow = await q(`select user_id from public.learners where platform_role='ssi_admin' limit 1`)
  if (ssiAdminRow.rowCount === 0) throw new Error('no ssi_admin learner found — cannot attribute created_by')
  const ssiAdminUid = ssiAdminRow.rows[0].user_id

  const creds = [`# SSi Coastal region credentials — generated ${new Date().toISOString().slice(0, 10)}`,
    `Password for ALL staff (API/password login): ${STAFF_PASSWORD}`,
    `App login: email OTP — codes arrive at ${EMAIL_BASE}@gmail.com via + addressing.`, '']

  // ---- region node under the programme (path trigger-computed) ----
  console.log(`\n— REGION: ${REGION_NAME} under ${PROGRAMME_NAME} —`)
  const regionId = uuid()
  await q(`insert into public.groups (id, name, type, is_demo, is_test, name_confirmed, parent_id)
           values ($1,$2,'region',true,true,true,$3)`, [regionId, REGION_NAME, programmeId])

  const totals = { students: 0, classes: 0, schools: 0 }
  const now = Date.now(), DAY = 86400000
  const termStart = new Date(now - 21 * DAY).getTime() // a newer region — shorter history

  for (let sIdx = 0; sIdx < SCHOOLS.length; sIdx++) {
    const sch = SCHOOLS[sIdx]
    console.log(`\n— SCHOOL: ${sch.name} —`)
    const codePrefix = `DEMO-COAST${sIdx}`

    // school NODE group under the region (path trigger-computed) -> node_group_id
    const nodeGroupId = uuid()
    await q(`insert into public.groups (id, name, type, is_demo, is_test, name_confirmed, parent_id)
             values ($1,$2,'school',true,true,true,$3)`, [nodeGroupId, sch.name, regionId])

    const staff = STAFF[sch.key]
    const adminEmail = emailFor(`${sch.key}.admin`)
    const adminUid = await ensureAuthUser(adminEmail)
    const teacherUids = []
    for (let i = 0; i < staff.teachers.length; i++) teacherUids.push(await ensureAuthUser(emailFor(`${sch.key}.teacher${i + 1}`)))
    creds.push(`## ${sch.name} (${COURSE_CODE})`,
      `- school admin: ${staff.admin} — ${adminEmail}`,
      ...staff.teachers.map((t, i) => `- teacher: ${t} — ${emailFor(`${sch.key}.teacher${i + 1}`)}`), '')

    await q('begin')
    await q(`update public.learners set display_name=$1, educational_role='school_admin', is_demo=true where user_id=$2`, [staff.admin, adminUid])
    for (let i = 0; i < teacherUids.length; i++)
      await q(`update public.learners set display_name=$1, educational_role='teacher', is_demo=true where user_id=$2`, [staff.teachers[i], teacherUids[i]])

    // schools row: node_group_id = the school node, group_id = REGION (mirrors Pilot)
    const schoolId = uuid()
    await q(`insert into public.schools
             (id, school_name, admin_user_id, teacher_join_code, admin_join_code, group_id, node_group_id, is_demo, is_test,
              platform_status, trial_kind, trial_course_code, platform_expires_at, name_confirmed)
             values ($1,$2,$3,$4,$5,$6,$7,true,true,'trial','free_1yr',$8,$9,true)`,
      [schoolId, sch.name, adminUid, `${codePrefix}-T`, `${codePrefix}-A`, regionId, nodeGroupId, COURSE_CODE, new Date(now + 365 * DAY).toISOString()])
    await registerJoinCodes(q, schoolId, adminUid)

    await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'admin','ime-coastal-suite')`,
      [adminUid, `SCHOOL:${schoolId}`])
    for (const t of teacherUids)
      await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'teacher','ime-coastal-suite')`,
        [t, `SCHOOL:${schoolId}`])

    for (let ci = 0; ci < sch.classCount; ci++) {
      const className = CLASS_NAMES[(sIdx * 2 + ci) % CLASS_NAMES.length]
      const classId = uuid()
      const teacherUid = teacherUids[ci % teacherUids.length]
      const classSeed = between(5, 10) // LOW band — early-stage region
      const classLego = `S${String(classSeed).padStart(4, '0')}L0${between(1, 3)}`
      // classes.group_id = the school NODE (matches Pilot's classes)
      await q(`insert into public.classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, last_lego_id, group_id, is_active)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
        [classId, schoolId, teacherUid, className, COURSE_CODE, `${codePrefix}-${ci + 3}`, classSeed, classLego, nodeGroupId])
      totals.classes++

      const nStudents = between(12, 15)
      for (let si = 0; si < nStudents; si++) {
        const name = `${pick(STUDENT_FIRST)} ${pick(STUDENT_LAST)}`
        const lid = uuid(), suid = uuid()
        const stage = studentStage(classSeed)
        const seeds = Math.max(1, stage.seeds)
        const lastLego = `S${String(seeds).padStart(4, '0')}L0${between(1, 4)}`
        await q(`insert into public.learners (id, user_id, display_name, educational_role, is_demo, created_at)
                 values ($1,$2,$3,'student',true,$4)`, [lid, suid, name, new Date(termStart).toISOString()])
        await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'class',$2,'student','ime-coastal-suite')`,
          [suid, `CLASS:${classId}`])
        // enrollment cursor ONLY — refresh regenerates sessions/seed/lego telemetry and
        // anchors it to highest_completed_seed. enrolled_at within the (short) window.
        await q(`insert into public.course_enrollments
                 (learner_id, course_id, enrolled_at, last_practiced_at, total_practice_minutes,
                  last_completed_lego_id, highest_completed_lego_id, highest_completed_seed,
                  last_completed_round_index, highest_completed_round_index, current_cycle_index, welcome_played)
                 values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$8,0,true)`,
          [lid, COURSE_CODE, new Date(termStart + between(0, 3) * DAY).toISOString(), new Date(now - between(0, 6) * DAY).toISOString(),
            Math.round(seeds * between(9, 15)), lastLego, seeds, seeds * 3])
        totals.students++
      }
      console.log(`  class ${className}: ${nStudents} students, current_seed=${classSeed}`)
    }
    await q('commit')
    totals.schools++
  }
  await db.end()

  const credPath = `/Users/tomcassidy/Desktop/SSi-coastal-region-credentials-${new Date().toISOString().slice(0, 10)}.md`
  fs.writeFileSync(credPath, creds.join('\n'))

  console.log(`\nDONE: region ${REGION_NAME} (${regionId}) — ${totals.schools} schools, ${totals.classes} classes, ${totals.students} students`)
  console.log(`NEXT: run 'Refresh demo activity' on the IME Demo Programme node to regenerate coherent recent telemetry across BOTH regions.`)
  console.log(`credentials -> ${credPath}`)
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
