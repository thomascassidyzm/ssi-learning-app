#!/usr/bin/env node
/**
 * Canary for 20260807d_school_admin_tag_read_parity.sql
 *
 * The bug: a school admin who holds a school ADMIN TAG rather than being the
 * schools.admin_user_id pointer reads nothing — no classes, no staff tags, no
 * pupils — because every school-admin predicate in the live policy set tested
 * the pointer column only. Found live 2026-08-07 on "Harbour Leader".
 *
 * One transaction against the live shared DB:
 *   1. pick a REAL school that has classes, staff tags and pupils, plus its
 *      POINTER admin (the parity target — what an admin is supposed to read)
 *   2. mint a synthetic TAG admin on that school and measure BEFORE the fix.
 *      They must read ~nothing. If they can already read it, the migration is
 *      a no-op and this canary FAILS LOUDLY rather than rubber-stamping it.
 *   3. apply the migration
 *   4. LEGIT PATHS ALIVE — pointer admin unchanged, lead teacher unchanged
 *   5. LEAK CLOSED — an unrelated stranger, and a school TEACHER tag (not
 *      admin), still read zero school-wide
 *   6. PARITY — the tag admin now matches the pointer admin exactly
 *   7. COMMIT only with --commit and all assertions green; else ROLLBACK.
 *
 * Usage: node canary_school_admin_tag_read_parity.cjs [--commit]
 *
 * NOTE: once the migration is live, a rerun FAILS step 2 ("BUG NOT REPRODUCED")
 * by design — the bug it demonstrates no longer exists. Steps 4-6 still pass
 * and are the ones worth rereading.
 */
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260807d_school_admin_tag_read_parity.sql');
const COMMIT = process.argv.includes('--commit');

// Synthetic actors. Fixed uuids so reruns are deterministic; they exist only
// inside the transaction.
const TAG_ADMIN   = '00000000-5c40-4aaa-8aaa-000000000011';
const TAG_TEACHER = '00000000-5c40-4bbb-8bbb-000000000012';
const STRANGER    = '00000000-5c40-4ccc-8ccc-000000000013';

let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  async function asUser(uid, sql, params) {
    await q('SAVEPOINT p');
    try {
      await q(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await q('SET LOCAL ROLE authenticated');
      const r = await q(sql, params);
      await q('RESET ROLE');
      await q('RELEASE SAVEPOINT p');
      return r.rows;
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      console.log(`     (probe error: ${e.message})`);
      return null;
    }
  }

  // The four reads the /schools client actually makes, as one row of counts.
  const PROBE = `
    SELECT
      (SELECT count(*) FROM public.classes
        WHERE school_id = $1 AND is_active)                            AS classes,
      (SELECT count(*) FROM public.user_tags
        WHERE tag_value = 'SCHOOL:' || $1::text
          AND removed_at IS NULL)                                      AS school_tags,
      (SELECT count(*) FROM public.class_teachers ct
        JOIN public.classes c2 ON c2.id = ct.class_id
        WHERE c2.school_id = $1)                                       AS class_teachers,
      (SELECT count(*) FROM public.learners l
        WHERE EXISTS (SELECT 1 FROM public.user_tags ut
                      WHERE ut.user_id = l.user_id
                        AND ut.tag_value = 'SCHOOL:' || $1::text
                        AND ut.removed_at IS NULL))                    AS school_learners`;

  const shape = (r) => r
    ? `classes=${r.classes} school_tags=${r.school_tags} class_teachers=${r.class_teachers} learners=${r.school_learners}`
    : 'ERROR';
  const same = (a, b) => a && b && shape(a) === shape(b);
  // Used for the stranger probe: a true outsider must read literally zero.
  const allZero = (r) => r && Number(r.classes) === 0 && Number(r.school_tags) === 0
    && Number(r.class_teachers) === 0 && Number(r.school_learners) === 0;

  try {
    await q('BEGIN');

    // ---- fixture: a real, populated school with a POINTER admin -----------
    const school = (await q(`
      SELECT s.id, s.school_name, s.admin_user_id
      FROM public.schools s
      WHERE s.admin_user_id IS NOT NULL
        AND (SELECT count(*) FROM public.classes c WHERE c.school_id = s.id AND c.is_active) >= 2
        AND (SELECT count(*) FROM public.user_tags ut
             WHERE ut.tag_value = 'SCHOOL:' || s.id::text AND ut.removed_at IS NULL) >= 3
      ORDER BY (SELECT count(*) FROM public.classes c WHERE c.school_id = s.id) DESC
      LIMIT 1`)).rows[0];
    if (!school) throw new Error('no populated school with a pointer admin — cannot canary');
    console.log(`\nFixture school: ${school.school_name} (${school.id})`);
    console.log(`Pointer admin:  ${school.admin_user_id}`);

    const leadTeacher = (await q(
      `SELECT teacher_user_id FROM public.classes
        WHERE school_id = $1 AND teacher_user_id IS NOT NULL AND is_active LIMIT 1`,
      [school.id])).rows[0]?.teacher_user_id;

    // ---- synthetic actors, inside the transaction only --------------------
    for (const [uid, name, role] of [
      [TAG_ADMIN, 'Canary Tag Admin', 'admin'],
      [TAG_TEACHER, 'Canary Tag Teacher', 'teacher'],
      [STRANGER, 'Canary Stranger', null],
    ]) {
      await q(`INSERT INTO public.learners (user_id, display_name, educational_role)
               VALUES ($1, $2, $3)`,
        [uid, name, role === 'admin' ? 'school_admin' : role === 'teacher' ? 'teacher' : 'student']);
      if (role) {
        await q(`INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
                 VALUES ($1, 'school', 'SCHOOL:' || $2::text, $3, 'canary')`, [uid, school.id, role]);
      }
    }

    // ---- 1. the parity target --------------------------------------------
    console.log('\nBEFORE the migration');
    const pointerBefore = (await asUser(school.admin_user_id, PROBE, [school.id]))?.[0];
    console.log(`  pointer admin: ${shape(pointerBefore)}`);
    if (pointerBefore && Number(pointerBefore.classes) >= 2) ok('pointer admin reads the school today (parity target)');
    else bad('pointer admin reads the school today', shape(pointerBefore));

    const leadBefore = leadTeacher ? (await asUser(leadTeacher, PROBE, [school.id]))?.[0] : null;
    if (leadBefore) console.log(`  lead teacher:  ${shape(leadBefore)}`);

    // ---- 2. the bug demonstration ----------------------------------------
    const tagBefore = (await asUser(TAG_ADMIN, PROBE, [school.id]))?.[0];
    console.log(`  TAG admin:     ${shape(tagBefore)}`);
    // "Nothing" means nothing SCHOOL-WIDE. Own-row RLS legitimately shows the
    // tag admin their own learner row and their own school tag — that is the
    // floor, not a leak, so the bug is: zero classes, zero class_teachers, and
    // no more than their own tag / own learner row.
    const blindBefore = tagBefore
      && Number(tagBefore.classes) === 0
      && Number(tagBefore.class_teachers) === 0
      && Number(tagBefore.school_tags) <= 1
      && Number(tagBefore.school_learners) <= 1;
    if (blindBefore) ok('BUG REPRODUCED — tag admin reads nothing school-wide before the fix');
    else bad('BUG NOT REPRODUCED — migration may be a no-op', shape(tagBefore));

    // ---- 3. apply ---------------------------------------------------------
    console.log('\nApplying 20260807d_school_admin_tag_read_parity.sql …');
    await q(fs.readFileSync(MIGRATION, 'utf8'));

    // ---- 4. legit paths alive --------------------------------------------
    console.log('\nAFTER the migration');
    const pointerAfter = (await asUser(school.admin_user_id, PROBE, [school.id]))?.[0];
    console.log(`  pointer admin: ${shape(pointerAfter)}`);
    if (same(pointerBefore, pointerAfter)) ok('LEGIT ALIVE — pointer admin unchanged');
    else bad('pointer admin CHANGED', `${shape(pointerBefore)} → ${shape(pointerAfter)}`);

    if (leadTeacher) {
      const leadAfter = (await asUser(leadTeacher, PROBE, [school.id]))?.[0];
      console.log(`  lead teacher:  ${shape(leadAfter)}`);
      if (same(leadBefore, leadAfter)) ok('LEGIT ALIVE — lead teacher unchanged');
      else bad('lead teacher CHANGED', `${shape(leadBefore)} → ${shape(leadAfter)}`);
    }

    // ---- 5. leak closed ---------------------------------------------------
    const strangerAfter = (await asUser(STRANGER, PROBE, [school.id]))?.[0];
    console.log(`  stranger:      ${shape(strangerAfter)}`);
    if (allZero(strangerAfter)) ok('LEAK CLOSED — unrelated stranger still reads zero');
    else bad('LEAK — stranger can read the school', shape(strangerAfter));

    const teacherTagAfter = (await asUser(TAG_TEACHER, PROBE, [school.id]))?.[0];
    console.log(`  school TEACHER tag: ${shape(teacherTagAfter)}`);
    if (teacherTagAfter && Number(teacherTagAfter.classes) === 0) {
      ok('LEAK CLOSED — a school TEACHER tag grants no school-wide class read');
    } else {
      bad('LEAK — a teacher tag now reads the whole school', shape(teacherTagAfter));
    }

    // ---- 6. parity --------------------------------------------------------
    const tagAfter = (await asUser(TAG_ADMIN, PROBE, [school.id]))?.[0];
    console.log(`  TAG admin:     ${shape(tagAfter)}`);
    if (same(pointerAfter, tagAfter)) ok('PARITY — tag admin now reads exactly what the pointer admin reads');
    else bad('NO PARITY', `pointer ${shape(pointerAfter)} vs tag ${shape(tagAfter)}`);

    // ---- 7. verdict -------------------------------------------------------
    // Drop the synthetic actors BEFORE any commit. --commit commits the whole
    // transaction, fixtures included, so without this the three canary
    // learners and their tags would land in the live DB. (Found the hard way
    // on the first --commit run, 2026-08-07; the rows were deleted by hand.)
    await q(`DELETE FROM public.user_tags WHERE user_id = ANY($1)`, [[TAG_ADMIN, TAG_TEACHER, STRANGER]]);
    await q(`DELETE FROM public.learners WHERE user_id = ANY($1)`, [[TAG_ADMIN, TAG_TEACHER, STRANGER]]);

    const green = fail === 0;
    console.log(`\n${pass} passed, ${fail} failed`);
    if (green && COMMIT) {
      await q('COMMIT');
      console.log('COMMITTED — migration is live.');
    } else {
      await q('ROLLBACK');
      console.log(green ? 'ROLLED BACK (dry run — pass --commit to apply).' : 'ROLLED BACK — assertions failed.');
    }
    process.exitCode = green ? 0 : 1;
  } catch (e) {
    try { await q('ROLLBACK'); } catch { /* already dead */ }
    console.error('\nCANARY ABORTED:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
