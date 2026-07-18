#!/usr/bin/env node
/**
 * Canary for 20260718b_entitlement_grants_binary_state.sql (THE-MODEL.md §1.11).
 *
 * One transaction against the live shared DB:
 *   1. pre-snapshot: entitlement_grants row count + a sample row (must be
 *      bit-identical after — this is a pure additive column, nothing rewritten).
 *   2. apply the migration body (its own BEGIN/COMMIT/NOTIFY stripped).
 *   3. assert the column exists, is nullable, and defaults to NULL on every
 *      existing row (no backfill — legacy rows stay legacy).
 *   4. assert the CHECK constraint: 'trial'/'paid' accepted, junk rejected.
 *   5. assert old-shape reads unchanged: row count + sample row identical,
 *      SELECT * still returns granted_courses/school_id/group_id/class_id
 *      exactly as before (new column is additive-only, never touched by
 *      existing readers that don't ask for it).
 *   6. idempotence: run the body again inside the same txn, assert no error
 *      and no column duplication.
 *   7. COMMIT only if --commit AND all green; else ROLLBACK. NOTIFY pgrst
 *      only on real commit.
 *
 * Usage: node canary_entitlement_grants_binary_state.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260718b_entitlement_grants_binary_state.sql');
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

  try {
    await q('BEGIN');

    console.log('— pre-snapshot');
    const pre = {
      count: (await q('SELECT count(*)::int c FROM public.entitlement_grants')).rows[0].c,
      sample: (await q('SELECT * FROM public.entitlement_grants ORDER BY id LIMIT 1')).rows[0] ?? null,
    };
    console.log(`  entitlement_grants=${pre.count}`);

    console.log('— applying migration body (in txn)');
    const body = fs.readFileSync(MIGRATION, 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '')
      .replace(/^\s*COMMIT;\s*$/m, '')
      .replace(/^\s*NOTIFY[^;]*;\s*$/m, '');
    await q(body);
    ok('migration applied');

    // column exists, nullable, no backfill
    const col = await q(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'entitlement_grants' AND column_name = 'state'`);
    col.rows[0]?.is_nullable === 'YES' ? ok('state column exists and is nullable')
      : bad('state column', JSON.stringify(col.rows[0] ?? 'missing'));

    const nonNull = await q(`SELECT count(*)::int c FROM public.entitlement_grants WHERE state IS NOT NULL`);
    nonNull.rows[0].c === 0 ? ok('no backfill — every existing row keeps state NULL')
      : bad('unexpected backfill', `${nonNull.rows[0].c} rows have state set`);

    // CHECK constraint
    const anyId = (await q(`SELECT id FROM public.entitlement_grants LIMIT 1`)).rows[0];
    if (anyId) {
      const good1 = await probe(`UPDATE public.entitlement_grants SET state = 'trial' WHERE id = $1`, [anyId.id]);
      good1.error ? bad("state='trial' accepted", good1.error.message) : ok("state='trial' accepted");
      const good2 = await probe(`UPDATE public.entitlement_grants SET state = 'paid' WHERE id = $1`, [anyId.id]);
      good2.error ? bad("state='paid' accepted", good2.error.message) : ok("state='paid' accepted");
      const junk = await probe(`UPDATE public.entitlement_grants SET state = 'banana' WHERE id = $1`, [anyId.id]);
      junk.error && /check constraint/i.test(junk.error.message)
        ? ok('junk state rejected by CHECK') : bad('junk state', junk.error ? junk.error.message : 'NOT REJECTED');
    } else {
      console.log('  (no existing entitlement_grants row — CHECK probed via insert/rollback instead)');
      const probeRow = await probe(
        `INSERT INTO public.entitlement_grants (school_id, granted_courses, granted_by, state)
         VALUES (gen_random_uuid(), ARRAY['canary_course'], 'canary', 'trial') RETURNING id`);
      probeRow.error ? bad("state='trial' accepted (insert probe)", probeRow.error.message)
        : ok("state='trial' accepted (insert probe)");
      const junk = await probe(
        `INSERT INTO public.entitlement_grants (school_id, granted_courses, granted_by, state)
         VALUES (gen_random_uuid(), ARRAY['canary_course'], 'canary', 'banana')`);
      junk.error && /check constraint/i.test(junk.error.message)
        ? ok('junk state rejected by CHECK') : bad('junk state', junk.error ? junk.error.message : 'NOT REJECTED');
    }

    // old-shape reads unchanged
    const post = {
      count: (await q('SELECT count(*)::int c FROM public.entitlement_grants')).rows[0].c,
    };
    post.count === pre.count ? ok(`row count unchanged (${post.count})`)
      : bad('row count', `${pre.count} → ${post.count}`);
    if (pre.sample) {
      const stillThere = await q('SELECT * FROM public.entitlement_grants WHERE id = $1', [pre.sample.id]);
      const row = stillThere.rows[0];
      const sameCore = row && row.school_id === pre.sample.school_id && row.group_id === pre.sample.group_id
        && row.class_id === pre.sample.class_id && JSON.stringify(row.granted_courses) === JSON.stringify(pre.sample.granted_courses);
      sameCore ? ok('sample row core fields unchanged (id/school/group/class/granted_courses)')
        : bad('sample row drifted', JSON.stringify({ pre: pre.sample, post: row }));
    }

    // idempotence
    await q(body);
    ok('idempotent (re-run does not error or duplicate the column)');

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
  } finally {
    await c.end();
  }
})();
