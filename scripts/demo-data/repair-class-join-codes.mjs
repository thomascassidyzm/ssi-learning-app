// One-off repair (2026-07-20): demo generators wrote classes.student_join_code
// without registering the matching invite_codes row, so every demo class's
// /redeem/<code> link was DEAD (validate finds no row). Registers the missing
// rows for DEMO schools only, idempotently. Generators fixed in the same
// commit (generate-ime-demo.cjs, generate-demo-suite.cjs).
//   node --env-file=.env --env-file=.env.local scripts/demo-data/repair-class-join-codes.mjs [--apply]
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const svc = createClient(
  (process.env.VITE_SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
)

const { data: demoSchools, error: sErr } = await svc
  .from('schools')
  .select('id, school_name, admin_user_id, is_demo')
  .eq('is_demo', true)
if (sErr) throw sErr

let missing = 0, repaired = 0, present = 0
for (const school of demoSchools || []) {
  const { data: classes, error: cErr } = await svc
    .from('classes')
    .select('id, class_name, student_join_code, is_active')
    .eq('school_id', school.id)
    .eq('is_active', true)
  if (cErr) throw cErr
  for (const cls of classes || []) {
    if (!cls.student_join_code) continue
    const { data: existing } = await svc
      .from('invite_codes')
      .select('id')
      .eq('code', cls.student_join_code)
      .maybeSingle()
    if (existing) { present++; continue }
    missing++
    console.log(`MISSING: ${school.school_name} / ${cls.class_name} — ${cls.student_join_code}`)
    if (APPLY) {
      const { error: iErr } = await svc.from('invite_codes').insert({
        code: cls.student_join_code,
        code_type: 'student',
        grants_class_id: cls.id,
        created_by: school.admin_user_id,
        is_active: true,
      })
      if (iErr) { console.error(`  INSERT FAILED: ${iErr.message}`) } else { repaired++ }
    }
  }
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${present} already registered, ${missing} missing${APPLY ? `, ${repaired} repaired` : ''}`)
