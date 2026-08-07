import { createClient } from '@supabase/supabase-js'
const APPLY = process.env.APPLY === '1'
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const { data: schools, error } = await sb.from('schools')
  .select('id,school_name,platform_status,trial_kind,trial_course_code,is_demo,is_test,created_at')
  .like('platform_status','trial%').is('trial_course_code', null)
if (error) throw error
console.log(`CANDIDATES (platform_status LIKE 'trial%' AND trial_course_code IS NULL): ${schools.length}`)

const log = []
for (const s of schools) {
  const { data: cls } = await sb.from('classes').select('id,class_name,course_code,is_active').eq('school_id', s.id)
  const codes = [...new Set((cls||[]).map(c=>c.course_code).filter(Boolean))]
  let verdict, derived = null
  if (codes.length === 0) verdict = 'SKIP: no classes with a course_code'
  else if (codes.length > 1) verdict = `SKIP: classes disagree (${codes.join(', ')})`
  else { derived = codes[0]; verdict = `SET ${derived}` }
  log.push({ id: s.id, school_name: s.school_name, is_demo: s.is_demo, is_test: s.is_test, platform_status: s.platform_status, classes: (cls||[]).length, codes, verdict, derived })
}
for (const r of log) console.log(` ${r.verdict.padEnd(46)} ${r.is_demo?'[demo]':'[real]'} ${r.school_name} (${r.classes} classes)`)
const toWrite = log.filter(r=>r.derived)
console.log(`\nWRITABLE: ${toWrite.length}   SKIPPED: ${log.length - toWrite.length}`)

if (!APPLY) { console.log('\nDRY RUN — no writes.'); process.exit(0) }

const applied = []
for (const r of toWrite) {
  // before-state assertion, per-row, abort on drift
  const { data: before } = await sb.from('schools').select('platform_status,trial_course_code').eq('id', r.id).maybeSingle()
  if (!before || before.trial_course_code !== null || !String(before.platform_status||'').startsWith('trial')) {
    console.error(`ABORT on drift at ${r.id}: ${JSON.stringify(before)}`); process.exit(1)
  }
  const { data: upd, error: uErr } = await sb.from('schools')
    .update({ trial_course_code: r.derived }).eq('id', r.id)
    .is('trial_course_code', null).like('platform_status','trial%')
    .select('id,school_name,trial_course_code')
  if (uErr) { console.error(`ABORT write error at ${r.id}:`, uErr); process.exit(1) }
  if (!upd || upd.length !== 1) { console.error(`ABORT: expected 1 row, got ${upd?.length} at ${r.id}`); process.exit(1) }
  applied.push({ id: r.id, school_name: r.school_name, before: null, after: upd[0].trial_course_code, evidence_codes: r.codes })
  console.log(`  WROTE ${upd[0].trial_course_code}  ${r.school_name}`)
}
console.log(`\nAPPLIED ${applied.length} rows`)
console.log(JSON.stringify(applied, null, 1))
