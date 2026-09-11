#!/usr/bin/env node
/**
 * Canary for 20260911b_class_progress_copy_audit.sql.
 *
 * One transaction against the live shared DB:
 *   1. apply the migration
 *   2. LEAK-CLOSED — as anon and as a real authenticated school admin: SELECT
 *      returns nothing / is denied, INSERT is denied
 *   3. LEGIT-PATH-ALIVE — service_role inserts a record, reads it back by the
 *      (source, target, course) pair index, then the fixture is rolled back
 *   4. COMMIT only with --commit AND every assertion green; else ROLLBACK.
 *
 * Usage: node canary_class_progress_copy_audit.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));
const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8').match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260911b_class_progress_copy_audit.sql');
const COMMIT = process.argv.includes('--commit');
// Angharad at Ysgol Cas-gwent — a real school admin auth uid, read live 2026-09-11.
const ADMIN = '96105179-6598-4f2b-9281-a1d28270581b';

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

    const asRole = async (role, claims, sql) => {
      await c.query('SAVEPOINT r');
      try {
        await c.query(`SET LOCAL ROLE ${role}`);
        await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        const r = await c.query(sql);
        await c.query('ROLLBACK TO SAVEPOINT r');
        return { rows: r.rows, err: null };
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT r');
        return { rows: null, err: e.message };
      }
    };

    // leak-closed
    let r = await asRole('anon', {}, `SELECT count(*) FROM public.class_progress_copy_audit`);
    r.err ? ok(`anon SELECT denied (${r.err.split('\n')[0]})`) : bad('anon SELECT', 'returned rows');
    r = await asRole('authenticated', { sub: ADMIN, role: 'authenticated' }, `SELECT count(*) FROM public.class_progress_copy_audit`);
    r.err ? ok(`authenticated SELECT denied (${r.err.split('\n')[0]})`) : bad('authenticated SELECT', 'returned rows');
    r = await asRole('authenticated', { sub: ADMIN, role: 'authenticated' },
      `INSERT INTO public.class_progress_copy_audit (actor_user_id, class_id, course_code, source_learner_id, target_learner_id, record) VALUES ('x', gen_random_uuid(), 'c', gen_random_uuid(), gen_random_uuid(), '{}')`);
    r.err ? ok('authenticated INSERT denied') : bad('authenticated INSERT', 'landed');

    // legit path alive (service_role)
    await c.query('SAVEPOINT fx');
    r = await asRole('service_role', { role: 'service_role' },
      `INSERT INTO public.class_progress_copy_audit (actor_user_id, class_id, course_code, source_learner_id, target_learner_id, record)
       VALUES ('${ADMIN}', '82296000-2c57-4d28-adef-38464a50204e', 'cym_s_for_eng', 'b5fbf097-50e2-4907-9ce0-6bd446b32dff', 'e80e45b5-a613-4ffd-8c15-da082a5af212', '{"copied":{"sessions":{"a":"b"}},"skipped":[]}') RETURNING id`);
    r.err ? bad('service_role INSERT', r.err) : ok('service_role INSERT lands');
    // asRole rolled the insert back; do it again and read within one savepoint
    await c.query(`SET LOCAL ROLE service_role`);
    await c.query(`INSERT INTO public.class_progress_copy_audit (actor_user_id, class_id, course_code, source_learner_id, target_learner_id, record)
       VALUES ('${ADMIN}', '82296000-2c57-4d28-adef-38464a50204e', 'cym_s_for_eng', 'b5fbf097-50e2-4907-9ce0-6bd446b32dff', 'e80e45b5-a613-4ffd-8c15-da082a5af212', '{"copied":{"sessions":{"a":"b"}},"skipped":[]}')`);
    const rd = await c.query(`SELECT record->'copied'->'sessions'->>'a' AS v FROM public.class_progress_copy_audit WHERE source_learner_id='b5fbf097-50e2-4907-9ce0-6bd446b32dff' AND target_learner_id='e80e45b5-a613-4ffd-8c15-da082a5af212' AND course_code='cym_s_for_eng'`);
    rd.rows[0]?.v === 'b' ? ok('service_role reads the record back by pair') : bad('service_role read', JSON.stringify(rd.rows));
    await c.query('ROLLBACK TO SAVEPOINT fx');
    await c.query('RESET ROLE');

    const post = await c.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.class_progress_copy_audit'::regclass`);
    post.rows[0].relrowsecurity ? ok('RLS on') : bad('RLS', 'off');
    const pol = await c.query(`SELECT count(*)::int n FROM pg_policies WHERE tablename='class_progress_copy_audit'`);
    pol.rows[0].n === 0 ? ok('zero policies') : bad('policies', pol.rows[0].n);
    const gr = await c.query(`SELECT grantee, string_agg(privilege_type, ',') p FROM information_schema.role_table_grants WHERE table_name='class_progress_copy_audit' GROUP BY grantee`);
    const badGrant = gr.rows.find(g => g.grantee === 'anon' || g.grantee === 'authenticated');
    badGrant ? bad('grants', JSON.stringify(gr.rows)) : ok(`grants: ${gr.rows.map(g => g.grantee + '=' + g.p).join('; ')}`);

    console.log(`\n${pass} pass, ${fail} fail`);
    if (fail === 0 && COMMIT) { await c.query('COMMIT'); console.log('COMMITTED'); }
    else { await c.query('ROLLBACK'); console.log(COMMIT ? 'ROLLED BACK (failures)' : 'ROLLED BACK (dry run — pass --commit)'); }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('CANARY ERROR:', e.message);
    process.exit(1);
  } finally { await c.end(); }
})();
