#!/usr/bin/env node
/**
 * Canary for 20260704_course_scope_progress_unique.sql
 *
 * One transaction against the live shared DB:
 *   1. pre-check: no (learner_id, lego_id) / (learner_id, seed_id) duplicates
 *      exist yet (would violate the OLD stricter key too — sanity check).
 *   2. apply the constraint swap
 *   3. assert the new 3-column unique constraints exist
 *   4. assert a legit upsert (single course) still works
 *   5. assert a same-learner-different-course insert on the SAME lego_id now
 *      succeeds (the bug this migration fixes) instead of colliding
 *   6. assert a true duplicate (same learner, lego, course) still violates
 *      the new unique (constraint didn't accidentally get dropped/loosened)
 *   7. COMMIT only if --commit AND all assertions green; else ROLLBACK
 *      (fixture rows rolled back with everything else on dry run; explicitly
 *      deleted before COMMIT on a real run).
 *
 * Usage: node canary_course_scope_progress_unique.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260704_course_scope_progress_unique.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  async function probe(sql, params) {
    await q('SAVEPOINT p');
    try {
      const r = await q(sql, params);
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }
  const expectOk = async (name, sql, params) => {
    const r = await probe(sql, params);
    r.error ? bad(name, r.error.message) : ok(name);
    return r;
  };
  const expectDeny = async (name, sql, params, pattern = /duplicate key|unique constraint/i) => {
    const r = await probe(sql, params);
    if (r.error && pattern.test(r.error.message)) ok(name);
    else if (r.error) bad(name, `failed but wrong error: ${r.error.message}`);
    else bad(name, `NOT DENIED (${r.rowCount} rows affected)`);
  };

  try {
    await q('BEGIN');

    console.log('— pre-check: no existing (learner_id, lego_id) / (learner_id, seed_id) dupes');
    const dupes = await q(`
      SELECT 'lego_progress' AS tbl, learner_id, lego_id, count(*) c
      FROM public.lego_progress GROUP BY learner_id, lego_id HAVING count(*) > 1
      UNION ALL
      SELECT 'seed_progress' AS tbl, learner_id, seed_id, count(*) c
      FROM public.seed_progress GROUP BY learner_id, seed_id HAVING count(*) > 1
    `);
    if (dupes.rows.length > 0) {
      throw new Error(`FOUND ${dupes.rows.length} pre-existing duplicate(s) — STOP, do not apply: ${JSON.stringify(dupes.rows)}`);
    }
    ok('no pre-existing duplicates');

    console.log('— applying 20260704_course_scope_progress_unique.sql (in txn)');
    await q(fs.readFileSync(MIGRATION, 'utf8'));

    console.log('— new constraints present');
    const cons = await q(`
      SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid IN ('public.lego_progress'::regclass, 'public.seed_progress'::regclass) AND contype = 'u'
    `);
    const legoCon = cons.rows.find(r => r.tbl === 'lego_progress');
    const seedCon = cons.rows.find(r => r.tbl === 'seed_progress');
    if (legoCon && legoCon.conname === 'lego_progress_learner_id_lego_id_course_id_key' && /learner_id, lego_id, course_id/.test(legoCon.def)) {
      ok('lego_progress has 3-col unique (learner_id, lego_id, course_id)');
    } else bad('lego_progress constraint', JSON.stringify(legoCon));
    if (seedCon && seedCon.conname === 'seed_progress_learner_id_seed_id_course_id_key' && /learner_id, seed_id, course_id/.test(seedCon.def)) {
      ok('seed_progress has 3-col unique (learner_id, seed_id, course_id)');
    } else bad('seed_progress constraint', JSON.stringify(seedCon));

    // fixture ingredients: a real learner + two distinct real course_ids
    const learner = (await q(`SELECT id FROM public.learners LIMIT 1`)).rows[0];
    const courses = (await q(`SELECT DISTINCT course_id FROM public.course_enrollments LIMIT 2`)).rows;
    if (!learner || courses.length < 2) {
      throw new Error('no learner or <2 distinct course_ids to model the cross-course fixture on');
    }
    const [courseA, courseB] = courses.map(r => r.course_id);
    const legoId = 'CANARY_L01';
    const seedId = 'CANARY_S01';

    console.log('— legit single-course upsert still works');
    await expectOk('lego_progress insert (course A)',
      `INSERT INTO public.lego_progress (learner_id, lego_id, course_id, thread_id, fibonacci_position)
       VALUES ($1, $2, $3, 1, 0)`, [learner.id, legoId, courseA]);

    console.log('— the bug this fixes: same learner+lego, different course, now succeeds');
    await expectOk('lego_progress insert (course B, same lego_id — was colliding before this migration)',
      `INSERT INTO public.lego_progress (learner_id, lego_id, course_id, thread_id, fibonacci_position)
       VALUES ($1, $2, $3, 1, 0)`, [learner.id, legoId, courseB]);

    console.log('— true duplicate (same learner+lego+course) still denied');
    await expectDeny('lego_progress insert (course A again — true dupe)',
      `INSERT INTO public.lego_progress (learner_id, lego_id, course_id, thread_id, fibonacci_position)
       VALUES ($1, $2, $3, 1, 0)`, [learner.id, legoId, courseA]);

    await expectOk('seed_progress insert (course A)',
      `INSERT INTO public.seed_progress (learner_id, seed_id, course_id, thread_id)
       VALUES ($1, $2, $3, 1)`, [learner.id, seedId, courseA]);
    await expectOk('seed_progress insert (course B, same seed_id — was colliding before this migration)',
      `INSERT INTO public.seed_progress (learner_id, seed_id, course_id, thread_id)
       VALUES ($1, $2, $3, 1)`, [learner.id, seedId, courseB]);
    await expectDeny('seed_progress insert (course A again — true dupe)',
      `INSERT INTO public.seed_progress (learner_id, seed_id, course_id, thread_id)
       VALUES ($1, $2, $3, 1)`, [learner.id, seedId, courseA]);

    // fixture cleanup, pre-COMMIT
    await q(`DELETE FROM public.lego_progress WHERE lego_id = $1 AND learner_id = $2`, [legoId, learner.id]);
    await q(`DELETE FROM public.seed_progress WHERE seed_id = $1 AND learner_id = $2`, [seedId, learner.id]);
    console.log('— fixtures cleaned');

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
