#!/usr/bin/env node
/**
 * Canary for 20260718d_the_model_delete_family.sql.
 *
 * One transaction:
 *   1. pre: reproduce the deployed-dev verification failure — deleting a
 *      group referenced by demo_orgs.group_id raises demo_orgs_group_id_fkey.
 *   2. apply the migration (3 FKs -> SET NULL).
 *   3. fixture replay:
 *        A. delete a group referenced by demo_orgs -> group gone, demo_orgs
 *           row SURVIVES with group_id nulled (mint history kept).
 *        B. delete a school referenced by demo_orgs.school_id -> same shape.
 *        C. delete a group that is some school's node_group_id -> school
 *           survives with node pointer nulled (belt-and-braces path).
 *   4. COMMIT only if --commit AND all green; else ROLLBACK.
 *
 * Usage: node canary_the_model_delete_family.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260718d_the_model_delete_family.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];

  async function probe(sql) {
    await q('SAVEPOINT p');
    try { const r = await q(sql); await q('RELEASE SAVEPOINT p'); return { rows: r.rows } }
    catch (e) { await q('ROLLBACK TO SAVEPOINT p'); return { error: e } }
  }
  const mkGroup = async (name) => (await one(
    `INSERT INTO public.groups (name, type, is_demo, is_test) VALUES ($1,'group',true,true) RETURNING id`, [name])).id;

  try {
    await q('BEGIN');

    console.log('— PRE: demo_orgs FK blocks group delete (the verification failure)');
    {
      await q('SAVEPOINT pre');
      const gid = await mkGroup('fk-canary-pre');
      await q(`INSERT INTO public.demo_orgs (created_by, prospect_name, org_shape, course_code, group_id, expires_at)
               VALUES ('canary','fk-canary','group','spa_for_eng_v2',$1, now() + interval '1 day')`, [gid]);
      const del = await probe(`DELETE FROM public.groups WHERE id='${gid}'`);
      del.error && /demo_orgs_group_id_fkey/.test(del.error.message)
        ? ok('bug reproduces pre-migration')
        : bad('pre-check', del.error ? del.error.message : 'delete unexpectedly succeeded');
      await q('ROLLBACK TO SAVEPOINT pre');
    }

    console.log('— applying migration (in txn)');
    const body = fs.readFileSync(MIGRATION, 'utf8').replace(/^\s*NOTIFY[^;]*;\s*$/m, '');
    await q(body);
    ok('migration applied');

    console.log('— fixture replay');
    {
      // A: group with demo_orgs pointer
      const gid = await mkGroup('fk-canary-a');
      const dorg = (await one(
        `INSERT INTO public.demo_orgs (created_by, prospect_name, org_shape, course_code, group_id, expires_at)
         VALUES ('canary','fk-canary-a','group','spa_for_eng_v2',$1, now() + interval '1 day') RETURNING id`, [gid])).id;
      const del = await probe(`DELETE FROM public.groups WHERE id='${gid}'`);
      del.error ? bad('A: group delete', del.error.message) : ok('A: group deletes clean');
      const row = await one(`SELECT group_id FROM public.demo_orgs WHERE id=$1`, [dorg]);
      row && row.group_id === null ? ok('A: demo_orgs history survives, pointer nulled')
        : bad('A: demo_orgs', JSON.stringify(row));
      await q(`DELETE FROM public.demo_orgs WHERE id=$1`, [dorg]);
    }
    {
      // B: school with demo_orgs pointer
      const sid = (await one(
        `INSERT INTO public.schools (school_name, teacher_join_code, admin_join_code, is_demo, is_test)
         VALUES ('fk-canary-b','FKB-T1','FKB-A1',true,true) RETURNING id`)).id;
      const dorg = (await one(
        `INSERT INTO public.demo_orgs (created_by, prospect_name, org_shape, course_code, school_id, expires_at)
         VALUES ('canary','fk-canary-b','single_school','spa_for_eng_v2',$1, now() + interval '1 day') RETURNING id`, [sid])).id;
      const del = await probe(`DELETE FROM public.schools WHERE id='${sid}'`);
      del.error ? bad('B: school delete', del.error.message) : ok('B: school deletes clean');
      const row = await one(`SELECT school_id FROM public.demo_orgs WHERE id=$1`, [dorg]);
      row && row.school_id === null ? ok('B: demo_orgs history survives, pointer nulled')
        : bad('B: demo_orgs', JSON.stringify(row));
      await q(`DELETE FROM public.demo_orgs WHERE id=$1`, [dorg]);
    }
    {
      // C: bare delete of a school's node -> school survives, pointer nulled
      const gid = await mkGroup('fk-canary-c-node');
      const sid = (await one(
        `INSERT INTO public.schools (school_name, teacher_join_code, admin_join_code, node_group_id, is_demo, is_test)
         VALUES ('fk-canary-c','FKC2-T1','FKC2-A1',$1,true,true) RETURNING id`, [gid])).id;
      const del = await probe(`DELETE FROM public.groups WHERE id='${gid}'`);
      del.error ? bad('C: node delete', del.error.message) : ok('C: bare node delete no longer 500s');
      const row = await one(`SELECT node_group_id FROM public.schools WHERE id=$1`, [sid]);
      row && row.node_group_id === null ? ok('C: school survives with node pointer nulled')
        : bad('C: school', JSON.stringify(row));
      await q(`DELETE FROM public.schools WHERE id=$1`, [sid]);
    }

    console.log(`\n${pass} pass / ${fail} fail`);
    if (fail === 0 && COMMIT) {
      await q('COMMIT');
      await q(`NOTIFY pgrst, 'reload schema'`);
      console.log('COMMITTED (live) + pgrst reload');
    } else {
      await q('ROLLBACK');
      console.log(COMMIT ? 'ROLLED BACK (failures)' : 'ROLLED BACK (dry run — pass --commit to apply)');
      if (fail > 0) process.exit(1);
    }
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('CANARY ERROR:', e.message);
    process.exit(1);
  } finally { await c.end(); }
})();
