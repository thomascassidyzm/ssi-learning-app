#!/usr/bin/env node
/**
 * Canary for 20260911_classes_writes_server_mediated.sql
 *
 * One transaction against the live shared DB (dev/staging/main share it):
 *   0. BEFORE the change, prove the hole is open: an authenticated teacher
 *      INSERTs a class naming a premium course_code straight into classes and
 *      it succeeds; the same teacher UPDATEs course_code on their own class and
 *      it succeeds. (Both under a savepoint that is always rolled back — no
 *      row is ever left behind, commit or not.)
 *   1. apply the migration
 *   2. assert the bypass INSERT now denies, and the course_code UPDATE now
 *      denies — "permission denied" = the grant layer, which is the layer
 *      this migration changes
 *   3. assert every legitimate path is alive: the browser's last_lego_id
 *      update (owner AND co-teacher via is_class_teacher), teacher own-class
 *      SELECT, school-admin SELECT (dashboard list), tagged-student SELECT,
 *      and the service-role INSERT / UPDATE / DELETE that every API route uses
 *   4. assert the resulting grant state is exactly what the migration says
 *   5. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_classes_writes_server_mediated.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = ['/home/tomcassidy/SSi/ssi-dashboard-v7-clean', '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean']
  .find((d) => fs.existsSync(path.join(d, '.env.psql')));
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260911_classes_writes_server_mediated.sql');
const COMMIT = process.argv.includes('--commit');

// A Big-10 target (Spanish) — premium under isCommercialCourse. The canary does
// not care whether the fixture school has cover: the point is that the
// DATABASE accepted the write regardless, and afterwards refuses it regardless.
const PREMIUM_COURSE = 'spa_for_eng';

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  // Run `sql` as `role` (with PostgREST-shaped JWT claims) under a savepoint.
  // keep=false → ALWAYS roll the savepoint back, so a write that succeeds
  // leaves nothing behind even when the outer transaction commits.
  async function probe(role, sql, claims, params, keep = false) {
    await q('SAVEPOINT p');
    try {
      if (claims) await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql, params);
      await q(keep ? 'RELEASE SAVEPOINT p' : 'ROLLBACK TO SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }
  const expectOk = async (name, role, sql, claims, params, minRows = 0) => {
    const r = await probe(role, sql, claims, params);
    if (r.error) bad(name, r.error.message);
    else if (r.rowCount < minRows) bad(name, `expected ≥${minRows} rows, got ${r.rowCount} (silent empty = policy layer)`);
    else ok(name);
    return r;
  };
  const expectDeny = async (name, role, sql, claims, params) => {
    const r = await probe(role, sql, claims, params);
    if (r.error && /permission denied/i.test(r.error.message)) ok(name);
    else if (r.error) bad(name, `denied but wrong error: ${r.error.message}`);
    else bad(name, `NOT DENIED (${r.rowCount} rows affected)`);
  };
  const jwt = (sub) => ({ sub, role: 'authenticated' });

  try {
    await q('BEGIN');

    // ---- fixtures, all read from live data, none invented -----------------
    const { rows: [own] } = await q(`
      SELECT c.id, c.teacher_user_id, c.school_id, c.course_code, c.last_lego_id
      FROM public.classes c
      WHERE c.teacher_user_id IS NOT NULL AND c.school_id IS NOT NULL
      ORDER BY c.created_at DESC LIMIT 1`);
    const { rows: [co] } = await q(`
      SELECT c.id, c.last_lego_id, ut.user_id AS co_teacher
      FROM public.user_tags ut JOIN public.classes c ON ut.tag_value = 'CLASS:' || c.id::text
      WHERE ut.tag_type='class' AND ut.role_in_context='teacher' AND ut.removed_at IS NULL
        AND ut.user_id <> COALESCE(c.teacher_user_id, '') LIMIT 1`);
    const { rows: [admin] } = await q(`
      SELECT s.id AS school_id, s.admin_user_id FROM public.schools s
      WHERE s.admin_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.classes c WHERE c.school_id = s.id)
      LIMIT 1`);
    const { rows: [student] } = await q(`
      SELECT ut.user_id, c.id AS class_id
      FROM public.user_tags ut JOIN public.classes c ON ut.tag_value = 'CLASS:' || c.id::text
      WHERE ut.tag_type='class' AND ut.role_in_context='student' AND ut.removed_at IS NULL
        -- auth.uid() renders a hyphenated uuid; Clerk-era unhyphenated tag ids never match it
        -- (a pre-existing data condition, nothing to do with grants), so pick a real one.
        AND ut.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' LIMIT 1`);
    if (!own || !admin) throw new Error('fixtures missing: need a teacher-owned class and a school admin');
    console.log(`— fixtures: owner class ${own.id} (${own.course_code}), co-teacher class ${co ? co.id : 'none'}, admin school ${admin.school_id}, student ${student ? 'yes' : 'none'}`);

    const T = jwt(own.teacher_user_id);
    const bypassInsert = `INSERT INTO public.classes (school_id, teacher_user_id, class_name, course_code)
                          VALUES ($1, $2, 'canary bypass', $3) RETURNING id`;
    const courseFlip = `UPDATE public.classes SET course_code = $1 WHERE id = $2`;
    const legoWrite = `UPDATE public.classes SET last_lego_id = $1 WHERE id = $2`;

    // ---- RED: the hole, before -------------------------------------------
    console.log('— BEFORE the change (red): the database lets the browser role through');
    {
      const r = await probe('authenticated', bypassInsert, T, [own.school_id, own.teacher_user_id, PREMIUM_COURSE]);
      r.error ? bad('PRE: authenticated bypass INSERT of a premium class succeeds (hole open)', r.error.message)
              : ok('PRE: authenticated bypass INSERT of a premium class succeeds (hole open) — rolled back');
    }
    {
      const r = await probe('authenticated', courseFlip, T, [PREMIUM_COURSE, own.id]);
      r.error ? bad('PRE: authenticated UPDATE course_code on own class succeeds (second mouth open)', r.error.message)
              : r.rowCount === 1 ? ok('PRE: authenticated UPDATE course_code on own class succeeds (second mouth open) — rolled back')
              : bad('PRE: authenticated UPDATE course_code on own class', `rowCount ${r.rowCount}`);
    }

    // ---- apply ------------------------------------------------------------
    console.log('— applying 20260911_classes_writes_server_mediated.sql (in txn)');
    await q(fs.readFileSync(MIGRATION, 'utf8'));

    // ---- GREEN: the hole, after -------------------------------------------
    console.log('— AFTER (green): closed paths deny at the grant layer');
    await expectDeny('authenticated bypass INSERT of a premium class', 'authenticated', bypassInsert, T, [own.school_id, own.teacher_user_id, PREMIUM_COURSE]);
    await expectDeny('authenticated INSERT of ANY class (even the school\'s own course)', 'authenticated', bypassInsert, T, [own.school_id, own.teacher_user_id, own.course_code]);
    await expectDeny('authenticated UPDATE course_code on own class', 'authenticated', courseFlip, T, [PREMIUM_COURSE, own.id]);
    await expectDeny('authenticated UPDATE class_name on own class (rename is /api/school/rename-class)', 'authenticated',
      `UPDATE public.classes SET class_name = 'x' WHERE id = $1`, T, [own.id]);
    await expectDeny('authenticated UPDATE teacher_user_id on own class', 'authenticated',
      `UPDATE public.classes SET teacher_user_id = 'x' WHERE id = $1`, T, [own.id]);
    await expectDeny('anon INSERT', 'anon', bypassInsert, { role: 'anon' }, [own.school_id, own.teacher_user_id, PREMIUM_COURSE]);

    console.log('— legit paths stay alive');
    await expectOk('owner teacher UPDATE last_lego_id (useClassesData.updateClassProgress / LearningPlayer)', 'authenticated', legoWrite, T, ['S0001L01', own.id], 1);
    if (co) await expectOk('co-teacher UPDATE last_lego_id via is_class_teacher', 'authenticated', legoWrite, jwt(co.co_teacher), ['S0001L01', co.id], 1);
    else console.log('  (no co-teacher fixture live; policy unchanged, skipped)');
    await expectOk('owner teacher SELECT own classes', 'authenticated',
      `SELECT id FROM public.classes WHERE teacher_user_id = $1`, T, [own.teacher_user_id], 1);
    await expectOk('school admin SELECT classes of their school (dashboard list)', 'authenticated',
      `SELECT id, class_name, course_code, last_lego_id FROM public.classes WHERE school_id = $1`, jwt(admin.admin_user_id), [admin.school_id], 1);
    if (student) await expectOk('tagged student SELECT their class', 'authenticated',
      `SELECT id FROM public.classes WHERE id = $1`, jwt(student.user_id), [student.class_id], 1);
    await expectOk('service_role INSERT (api/school/create-class.ts, api/teacher/classes.ts, provision.ts)', 'service_role',
      bypassInsert, null, [own.school_id, own.teacher_user_id, PREMIUM_COURSE], 1);
    await expectOk('service_role UPDATE course_code/class_name/teacher_user_id/group_id/class_learner_id/last_lego_id', 'service_role',
      `UPDATE public.classes SET course_code = course_code, class_name = class_name, teacher_user_id = teacher_user_id,
         group_id = group_id, class_learner_id = class_learner_id, last_lego_id = last_lego_id WHERE id = $1`, null, [own.id], 1);
    await expectOk('service_role DELETE (delete-class.ts, provision.ts rollback)', 'service_role',
      `DELETE FROM public.classes WHERE id = $1`, null, [own.id], 1);

    console.log('— resulting grant state');
    {
      const { rows } = await q(`SELECT privilege_type FROM information_schema.role_table_grants
                                WHERE table_schema='public' AND table_name='classes' AND grantee='authenticated' ORDER BY 1`);
      const privs = rows.map((r) => r.privilege_type).join(',');
      privs === 'REFERENCES,SELECT,TRIGGER' ? ok(`authenticated table grants = ${privs}`) : bad('authenticated table grants', privs);
    }
    {
      const { rows } = await q(`SELECT column_name FROM information_schema.column_privileges
                                WHERE table_schema='public' AND table_name='classes' AND grantee='authenticated' AND privilege_type='UPDATE' ORDER BY 1`);
      const cols = rows.map((r) => r.column_name).join(',');
      cols === 'last_lego_id' ? ok(`authenticated UPDATE columns = ${cols}`) : bad('authenticated UPDATE columns', cols || '(none)');
    }
    {
      const { rows } = await q(`SELECT count(*)::int AS n FROM information_schema.role_table_grants
                                WHERE table_schema='public' AND table_name='classes' AND grantee='anon'`);
      rows[0].n === 0 ? ok('anon holds nothing') : bad('anon grants', `${rows[0].n}`);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) {
      await q('COMMIT');
      await q(`NOTIFY pgrst, 'reload schema'`);
      console.log('COMMITTED ✅  (PostgREST reload notified)');
    } else {
      await q('ROLLBACK');
      console.log(fail === 0 ? 'DRY RUN — all green, rolled back (re-run with --commit)' : 'ROLLED BACK ❌');
      if (fail > 0) process.exitCode = 1;
    }
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('CANARY ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
