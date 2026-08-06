#!/usr/bin/env node
/**
 * Canary for 20260806b_co_teacher_manage_ruling.sql  (item A-74, co-teaching)
 *
 * The founder ruling of 2026-08-06 says only the class's CURRENT (lead) teacher
 * or a leader ABOVE the class may change who teaches it. The read-parity
 * migration earlier the same day left `user_tags_update` wide enough for a
 * plain co-teacher to write TEACHER rows on their class straight from the
 * browser. This canary proves that hole open, closes it, and proves every
 * legitimate path still alive.
 *
 * One transaction against the live shared DB:
 *   1. fixture — a real class with a lead teacher and a real student tag; add a
 *      synthetic CO-TEACHER tag to it
 *   2. BUG DEMONSTRATION (pre-migration): the co-teacher CAN soft-delete the
 *      lead teacher's own class tag. If that already fails, the migration is a
 *      no-op and this canary FAILS LOUDLY rather than rubber-stamping it.
 *   3. apply the migration
 *   4. LEAK CLOSED — the co-teacher can no longer touch any teacher row
 *   5. EVERY LEGIT PATH ALIVE — the co-teacher can still remove a STUDENT (the
 *      whole reason the disjunct exists); the lead teacher can still manage
 *      teacher rows; the school_admin can still manage teacher rows; a
 *      stranger still writes nothing
 *   6. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_co_teacher_manage_ruling.cjs [--commit]
 * Creds: DATABASE_URL — ssi-dashboard-v7-clean/.env.psql, else this repo's .env.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const DASH_CANDIDATES = [
  '/home/tomcassidy/SSi/ssi-dashboard-v7-clean',
  '/home/tomcassidy/ssi-dashboard-v7-clean',
];
const dash = DASH_CANDIDATES.find((d) => fs.existsSync(path.join(d, '.env.psql')));
const { Client } = require(
  dash && fs.existsSync(path.join(dash, 'node_modules', 'pg'))
    ? path.join(dash, 'node_modules', 'pg')
    : path.join(REPO, 'node_modules', 'pg'),
);
const envText = dash
  ? fs.readFileSync(path.join(dash, '.env.psql'), 'utf8')
  : fs.readFileSync(path.join(REPO, '.env'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];

const MIGRATION = path.join(__dirname, '..', 'migrations', '20260806b_co_teacher_manage_ruling.sql');
const COMMIT = process.argv.includes('--commit');

const CO_TEACHER = '00000000-c0de-4ccc-8ccc-000000000011';
const STRANGER   = '00000000-c0de-4ddd-8ddd-000000000012';

let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  // Probe as a real role with real JWT claims, inside a savepoint so a denial
  // (or a policy error) cannot poison the outer transaction.
  async function asUser(uid, sql, params) {
    await q('SAVEPOINT p');
    try {
      await q(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await q('SET LOCAL ROLE authenticated');
      const r = await q(sql, params);
      await q('RESET ROLE');
      await q('RELEASE SAVEPOINT p');
      return { rowCount: r.rowCount, rows: r.rows };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }

  // An UPDATE blocked by RLS reports rowCount 0 rather than throwing (USING),
  // or throws a check violation (WITH CHECK). Both are "blocked".
  const blocked = (r) => !!r.error || r.rowCount === 0;
  const wrote = (r) => !r.error && r.rowCount > 0;

  try {
    await q('BEGIN');

    // ---- fixture ---------------------------------------------------------
    const cls = (await q(`
      SELECT c.id, c.class_name, c.teacher_user_id, c.school_id, s.admin_user_id
      FROM public.classes c
      LEFT JOIN public.schools s ON s.id = c.school_id
      WHERE c.teacher_user_id IS NOT NULL
      ORDER BY (SELECT count(*) FROM public.user_tags ut
                WHERE ut.tag_value = 'CLASS:' || c.id::text
                  AND ut.role_in_context = 'student' AND ut.removed_at IS NULL) DESC
      LIMIT 1`)).rows[0];
    if (!cls) throw new Error('no fixture class with a lead teacher');
    const tag = `CLASS:${cls.id}`;
    console.log(`\nFixture: "${cls.class_name}" (${cls.id})`);
    console.log(`  lead teacher ${cls.teacher_user_id} · school admin ${cls.admin_user_id ?? '—'}\n`);

    // The lead teacher's own class/teacher tag — the row a co-teacher must not
    // be able to touch. Create it if the class predates the tag backfill.
    await q(`INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
             VALUES ($1,'class',$2,'teacher',$1)
             ON CONFLICT DO NOTHING`, [cls.teacher_user_id, tag]);
    const leadTagId = (await q(
      `SELECT id FROM public.user_tags WHERE user_id=$1 AND tag_type='class'
         AND tag_value=$2 AND role_in_context='teacher' LIMIT 1`,
      [cls.teacher_user_id, tag])).rows[0].id;

    // A synthetic co-teacher on the same class.
    await q(`INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
             VALUES ($1,'class',$2,'teacher',$3)`, [CO_TEACHER, tag, cls.teacher_user_id]);

    // A student row on the class — the write the disjunct legitimately exists for.
    let studentTagId = (await q(
      `SELECT id FROM public.user_tags WHERE tag_type='class' AND tag_value=$1
         AND role_in_context='student' AND removed_at IS NULL LIMIT 1`, [tag])).rows[0]?.id;
    if (!studentTagId) {
      studentTagId = (await q(
        `INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
         VALUES ('00000000-c0de-4eee-8eee-000000000013','class',$1,'student',$2) RETURNING id`,
        [tag, cls.teacher_user_id])).rows[0].id;
    }

    const touchTeacher = `UPDATE public.user_tags SET removed_at = now() WHERE id = $1`;
    const touchStudent = `UPDATE public.user_tags SET removed_at = now() WHERE id = $1`;
    const undo = (id) => q(`UPDATE public.user_tags SET removed_at = NULL WHERE id = $1`, [id]);

    // ---- 2. BUG DEMONSTRATION (pre-migration) ----------------------------
    console.log('BEFORE — the hole the ruling closes:');
    const preLeak = await asUser(CO_TEACHER, touchTeacher, [leadTagId]);
    if (wrote(preLeak)) ok('co-teacher CAN soft-delete the lead teacher\'s tag (bug reproduced)');
    else bad('bug NOT reproduced — migration would be a no-op', preLeak.error?.message ?? 'rowCount 0');
    await undo(leadTagId);

    const preStudent = await asUser(CO_TEACHER, touchStudent, [studentTagId]);
    if (wrote(preStudent)) ok('co-teacher can remove a student (the ability we must preserve)');
    else bad('co-teacher cannot remove a student even BEFORE the fix', preStudent.error?.message ?? 'rowCount 0');
    await undo(studentTagId);

    if (fail) throw new Error('pre-migration assertions failed — refusing to apply');

    // ---- 3. apply --------------------------------------------------------
    console.log('\nApplying 20260806b_co_teacher_manage_ruling.sql …');
    const sql = fs.readFileSync(MIGRATION, 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '')
      .replace(/^\s*COMMIT;\s*$/m, '');
    await q(sql);
    console.log('  applied inside the open transaction\n');

    // ---- 4. LEAK CLOSED --------------------------------------------------
    console.log('AFTER — leak closed:');
    const postLeak = await asUser(CO_TEACHER, touchTeacher, [leadTagId]);
    if (blocked(postLeak)) ok('co-teacher can NO LONGER touch the lead teacher\'s tag');
    else { bad('LEAK STILL OPEN — co-teacher wrote a teacher row', `rowCount ${postLeak.rowCount}`); await undo(leadTagId); }

    const postSelfTeacher = await asUser(CO_TEACHER,
      `UPDATE public.user_tags SET removed_at = now() WHERE user_id = $1 AND tag_value = $2 AND role_in_context = 'teacher'`,
      [CO_TEACHER, tag]);
    if (blocked(postSelfTeacher)) ok('co-teacher cannot client-write their OWN teacher row either (server endpoint owns leaving)');
    else { bad('co-teacher wrote their own teacher row client-side', `rowCount ${postSelfTeacher.rowCount}`); await undo(leadTagId); }

    // ---- 5. EVERY LEGIT PATH ALIVE ---------------------------------------
    console.log('\nAFTER — every legitimate path still alive:');
    const postStudent = await asUser(CO_TEACHER, touchStudent, [studentTagId]);
    if (wrote(postStudent)) ok('co-teacher STILL removes a student (read/write parity preserved)');
    else bad('REGRESSION — co-teacher lost the student write', postStudent.error?.message ?? 'rowCount 0');
    await undo(studentTagId);

    const leadWrite = await asUser(cls.teacher_user_id, touchTeacher, [leadTagId]);
    if (wrote(leadWrite)) ok('lead teacher still manages teacher rows on their class');
    else bad('REGRESSION — lead teacher lost teacher-row writes', leadWrite.error?.message ?? 'rowCount 0');
    await undo(leadTagId);

    if (cls.admin_user_id) {
      const adminWrite = await asUser(cls.admin_user_id, touchTeacher, [leadTagId]);
      if (wrote(adminWrite)) ok('school admin still manages teacher rows on the class');
      else bad('REGRESSION — school admin lost teacher-row writes', adminWrite.error?.message ?? 'rowCount 0');
      await undo(leadTagId);
    } else {
      console.log('  – no school admin on the fixture class; branch not exercised');
    }

    const strangerWrite = await asUser(STRANGER, touchStudent, [studentTagId]);
    if (blocked(strangerWrite)) ok('unrelated stranger still writes nothing');
    else { bad('LEAK — stranger wrote a class tag', `rowCount ${strangerWrite.rowCount}`); await undo(studentTagId); }

    // ---- 6. verdict ------------------------------------------------------
    console.log(`\n${pass} passed · ${fail} failed`);
    if (fail === 0 && COMMIT) {
      // Drop the synthetic co-teacher before committing the policy change.
      await q(`DELETE FROM public.user_tags WHERE user_id = ANY($1)`,
        [[CO_TEACHER, STRANGER, '00000000-c0de-4eee-8eee-000000000013']]);
      await q('COMMIT');
      console.log('\n✅ COMMITTED — user_tags_update narrowed to the ruling.');
    } else {
      await q('ROLLBACK');
      console.log(fail === 0
        ? '\n↩︎  ROLLED BACK (dry run) — all green. Re-run with --commit to apply.'
        : '\n↩︎  ROLLED BACK — assertions failed, nothing changed.');
      process.exitCode = fail === 0 ? 0 : 1;
    }
  } catch (e) {
    try { await q('ROLLBACK'); } catch { /* already unwound */ }
    console.error('\n💥 CANARY ABORTED:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
