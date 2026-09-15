#!/usr/bin/env node
/**
 * Canary for 20260915b_class_progress_copy_claim_index.sql (job #811).
 *
 * One transaction against the live shared DB:
 *   1. apply the migration (partial unique index on running copy claims)
 *   2. LEGIT-PATH-ALIVE — service_role inserts one {state: running} claim,
 *      a second for the same source+course is REFUSED with 23505, a claim
 *      for another course is allowed, and finalising the first (state gone)
 *      frees the slot; fixture rolled back to a savepoint
 *   3. posture unchanged — RLS still on, zero policies
 *   4. COMMIT only with --commit AND every assertion green; else ROLLBACK.
 * No progress row is read or written.
 *
 * Usage: node canary_class_progress_copy_claim_index.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));
const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8').match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260915b_class_progress_copy_claim_index.sql');
const COMMIT = process.argv.includes('--commit');
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('BEGIN');
  try {
    await c.query(fs.readFileSync(MIGRATION, 'utf8'));
    ok('migration applied in txn');
    const idx = await c.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_class_progress_copy_audit_running_claim'`);
    if (idx.rows.length === 1 && /UNIQUE/.test(idx.rows[0].indexdef) && /'running'/.test(idx.rows[0].indexdef)) ok('partial unique index present'); else bad('index', JSON.stringify(idx.rows));

    await c.query('SAVEPOINT fixture');
    const src = '00000000-0000-4000-8000-000000000811', tgt = '00000000-0000-4000-8000-000000000812', cls = '00000000-0000-4000-8000-000000000813';
    const ins = (course, state) => c.query(
      `INSERT INTO public.class_progress_copy_audit (actor_user_id, class_id, course_code, source_learner_id, target_learner_id, record) VALUES ('canary-811', $1, $2, $3, $4, $5) RETURNING id`,
      [cls, course, src, tgt, JSON.stringify({ state, started_at: new Date().toISOString() })]);
    const first = await ins('canary_course', 'running');
    ok('first running claim inserted');
    await c.query('SAVEPOINT dup');
    try { await ins('canary_course', 'running'); bad('second running claim', 'was accepted'); }
    catch (e) { if (e.code === '23505') ok('second running claim refused with 23505'); else bad('second claim', e.message); await c.query('ROLLBACK TO SAVEPOINT dup'); }
    await ins('other_course', 'running'); ok('a claim for another course is allowed');
    await c.query(`UPDATE public.class_progress_copy_audit SET record = '{"copied":{}}'::jsonb WHERE id = $1`, [first.rows[0].id]);
    await ins('canary_course', 'running'); ok('slot free once the first claim is finalised');
    await c.query('ROLLBACK TO SAVEPOINT fixture');
    const left = await c.query(`SELECT count(*)::int AS n FROM public.class_progress_copy_audit WHERE actor_user_id = 'canary-811'`);
    if (left.rows[0].n === 0) ok('fixture rolled back'); else bad('fixture', `${left.rows[0].n} rows left`);

    const pol = await c.query(`SELECT relrowsecurity, (SELECT count(*) FROM pg_policies WHERE tablename = 'class_progress_copy_audit') AS policies FROM pg_class WHERE relname = 'class_progress_copy_audit'`);
    if (pol.rows[0].relrowsecurity && Number(pol.rows[0].policies) === 0) ok('posture unchanged: RLS on, zero policies'); else bad('posture', JSON.stringify(pol.rows));

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) { await c.query('COMMIT'); console.log('COMMITTED'); }
    else { await c.query('ROLLBACK'); console.log(COMMIT ? 'ROLLED BACK (failures)' : 'ROLLED BACK (dry run — pass --commit)'); }
  } catch (e) {
    await c.query('ROLLBACK'); console.error('ERROR, rolled back:', e.message); process.exit(1);
  } finally { await c.end(); }
  process.exit(fail === 0 ? 0 : 1);
})();
