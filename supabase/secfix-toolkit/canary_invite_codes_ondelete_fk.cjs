#!/usr/bin/env node
/**
 * Canary for 20260718c_invite_codes_ondelete_fk.sql
 *
 * One transaction against the live shared DB:
 *   1. reproduce the founder's live bug PRE-migration (school->class->class-code
 *      delete 500s on fk_invite_codes_class) — proves we're fixing the real hole
 *   2. apply the migration (6 FK re-declarations: 3 CASCADE + 3 SET NULL)
 *   3. replay the real delete paths as throwaway fixtures, each in its own
 *      savepoint so only the DDL survives to COMMIT:
 *        A. school -> class -> class-code + learner redeemer  (the exact bug)
 *        B. group  -> group-code + learner redeemer           (subtree code)
 *        C. school -> school-code (schools.invite_code_id reverse-ref) + learner
 *           — deleted WITHOUT the app's manual unlink, proving the delete is now
 *           FK-sound on its own
 *      assert every org row + its codes are gone AND every learner redeemer
 *      survives with invite_code_id nulled (never deleted).
 *   4. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_invite_codes_ondelete_fk.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260718c_invite_codes_ondelete_fk.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];

  // run sql in a nested savepoint; return {error} instead of aborting the txn
  async function probe(sql) {
    await q('SAVEPOINT p');
    try {
      const r = await q(sql);
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }

  const CREATED_BY = 'canary-invite-fk';
  let n = 0;
  const uniq = (p) => `${p}-${CREATED_BY}-${++n}`;

  // fixture builders — return the ids the assertions need
  async function mkSchool() {
    return (await one(
      `INSERT INTO public.schools (school_name, teacher_join_code, admin_join_code)
       VALUES ($1,$2,$3) RETURNING id`,
      [uniq('CANARY school'), uniq('tj'), uniq('aj')],
    )).id;
  }
  async function mkClass(schoolId) {
    return (await one(
      `INSERT INTO public.classes (class_name, course_code, student_join_code, school_id)
       VALUES ($1,'afr_for_eng',$2,$3) RETURNING id`,
      [uniq('CANARY class'), uniq('sj'), schoolId],
    )).id;
  }
  async function mkGroup() {
    return (await one(`INSERT INTO public.groups (name) VALUES ($1) RETURNING id`, [uniq('CANARY group')])).id;
  }
  async function mkCode(grants) {
    // grants = { grants_class_id | grants_school_id | grants_group_id }
    const col = Object.keys(grants)[0];
    return (await one(
      `INSERT INTO public.invite_codes (code, code_type, created_by, ${col})
       VALUES ($1,'student',$2,$3) RETURNING id`,
      [uniq('code'), CREATED_BY, grants[col]],
    )).id;
  }
  async function mkLearner(codeId) {
    return (await one(
      `INSERT INTO public.learners (user_id, invite_code_id) VALUES ($1,$2) RETURNING id`,
      [uniq('learner'), codeId],
    )).id;
  }
  const exists = async (tbl, id) => Number((await one(`SELECT count(*)::int n FROM public.${tbl} WHERE id=$1`, [id])).n) > 0;
  const learnerCode = async (id) => (await one(`SELECT invite_code_id FROM public.learners WHERE id=$1`, [id])).invite_code_id;

  try {
    await q('BEGIN');

    // ---- 1. reproduce the bug PRE-migration ------------------------------
    console.log('— PRE-migration: founder bug reproduces');
    await q('SAVEPOINT pre');
    {
      const schoolId = await mkSchool();
      const classId = await mkClass(schoolId);
      await mkCode({ grants_class_id: classId });
      const del = await probe(`DELETE FROM public.schools WHERE id='${schoolId}'`);
      if (del.error && /fk_invite_codes_class/.test(del.error.message)) {
        ok('school delete 500s on fk_invite_codes_class (bug confirmed)');
      } else if (del.error) {
        bad('pre-migration school delete', `wrong error: ${del.error.message}`);
      } else {
        bad('pre-migration school delete', 'expected FK violation but delete succeeded');
      }
    }
    await q('ROLLBACK TO SAVEPOINT pre');

    // ---- 2. apply migration ----------------------------------------------
    console.log('— applying 20260718c_invite_codes_ondelete_fk.sql (in txn)');
    await q(fs.readFileSync(MIGRATION, 'utf8'));

    // ---- 3. replay real delete paths, each in its own savepoint ----------
    console.log('— POST-migration: delete family is FK-sound');

    // A. school -> class -> class-code + learner redeemer (the exact founder case)
    await q('SAVEPOINT ta');
    {
      const schoolId = await mkSchool();
      const classId = await mkClass(schoolId);
      const codeId = await mkCode({ grants_class_id: classId });
      const learnerId = await mkLearner(codeId);
      const del = await probe(`DELETE FROM public.schools WHERE id='${schoolId}'`);
      if (del.error) bad('A: school delete', del.error.message);
      else {
        (!(await exists('schools', schoolId))) ? ok('A: school gone') : bad('A: school gone', 'still present');
        (!(await exists('classes', classId))) ? ok('A: class cascaded') : bad('A: class cascaded', 'still present');
        (!(await exists('invite_codes', codeId))) ? ok('A: class-code cascaded') : bad('A: class-code cascaded', 'still present');
        const surv = await exists('learners', learnerId);
        const lc = surv ? await learnerCode(learnerId) : 'GONE';
        (surv && lc === null) ? ok('A: learner survives, invite_code_id nulled') : bad('A: learner survives', `exists=${surv} invite_code_id=${lc}`);
      }
    }
    await q('ROLLBACK TO SAVEPOINT ta');

    // B. group -> group-code + learner redeemer (subtree code cascade)
    await q('SAVEPOINT tb');
    {
      const groupId = await mkGroup();
      const codeId = await mkCode({ grants_group_id: groupId });
      const learnerId = await mkLearner(codeId);
      const del = await probe(`DELETE FROM public.groups WHERE id='${groupId}'`);
      if (del.error) bad('B: group delete', del.error.message);
      else {
        (!(await exists('groups', groupId))) ? ok('B: group gone') : bad('B: group gone', 'still present');
        (!(await exists('invite_codes', codeId))) ? ok('B: group-code cascaded') : bad('B: group-code cascaded', 'still present');
        const surv = await exists('learners', learnerId);
        const lc = surv ? await learnerCode(learnerId) : 'GONE';
        (surv && lc === null) ? ok('B: learner survives, invite_code_id nulled') : bad('B: learner survives', `exists=${surv} invite_code_id=${lc}`);
      }
    }
    await q('ROLLBACK TO SAVEPOINT tb');

    // C. school -> school-code with schools.invite_code_id reverse-ref + learner,
    //    deleted WITHOUT the app's manual unlink — proves it's FK-sound alone.
    await q('SAVEPOINT tc');
    {
      const schoolId = await mkSchool();
      const codeId = await mkCode({ grants_school_id: schoolId });
      await q(`UPDATE public.schools SET invite_code_id='${codeId}' WHERE id='${schoolId}'`);
      const learnerId = await mkLearner(codeId);
      const del = await probe(`DELETE FROM public.schools WHERE id='${schoolId}'`);
      if (del.error) bad('C: school delete (reverse-ref, no unlink)', del.error.message);
      else {
        (!(await exists('schools', schoolId))) ? ok('C: school gone') : bad('C: school gone', 'still present');
        (!(await exists('invite_codes', codeId))) ? ok('C: school-code cascaded') : bad('C: school-code cascaded', 'still present');
        const surv = await exists('learners', learnerId);
        const lc = surv ? await learnerCode(learnerId) : 'GONE';
        (surv && lc === null) ? ok('C: learner survives, invite_code_id nulled') : bad('C: learner survives', `exists=${surv} invite_code_id=${lc}`);
      }
    }
    await q('ROLLBACK TO SAVEPOINT tc');

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
