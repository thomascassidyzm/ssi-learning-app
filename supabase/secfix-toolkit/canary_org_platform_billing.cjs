#!/usr/bin/env node
/**
 * Canary for 20260801_org_platform_billing.sql + 20260801b_org_trial_backfill.sql
 * (org platform billing columns + the 30-day trial clock on pre-existing orgs).
 *
 * One transaction against the live shared DB:
 *   1. pre-snapshot: groups count; root-org candidates the backfill WILL stamp
 *      (parent_id IS NULL, not a school node) — printed so the write is visible
 *      before it happens.
 *   2. apply both migration bodies (their own BEGIN/COMMIT/NOTIFY stripped).
 *   3. assert the column quintet exists on groups.
 *   4. assert every backfill candidate is now platform_status='trial' with
 *      platform_expires_at ≈ now()+30d.
 *   5. assert NO school node and NO sub-group was stamped (phantom-clock guard).
 *   6. assert the status CHECK rejects an illegal value (probe, rolled back).
 *   7. assert groups count unchanged (expand-only — no rows created/dropped).
 *   8. COMMIT only if --commit AND all green; else ROLLBACK. NOTIFY pgrst on
 *      real commit (PostgREST must see the new columns or the API 42703s).
 *
 * Usage: node canary_org_platform_billing.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = path.join(process.env.HOME || '', 'SSi', 'ssi-dashboard-v7-clean');
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIG_SCHEMA = path.join(__dirname, '..', 'migrations', '20260801_org_platform_billing.sql');
const MIG_BACKFILL = path.join(__dirname, '..', 'migrations', '20260801b_org_trial_backfill.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

function stripTxn(sql) {
  return sql
    .replace(/^\s*BEGIN;\s*$/gim, '')
    .replace(/^\s*COMMIT;\s*$/gim, '')
    .replace(/^\s*NOTIFY pgrst[^;]*;\s*$/gim, '');
}

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
    const preCount = (await q('SELECT count(*)::int c FROM public.groups')).rows[0].c;
    const candidates = (await q(`
      SELECT g.id, g.name, g.type FROM public.groups g
      WHERE g.parent_id IS NULL
        AND g.type IS DISTINCT FROM 'school'
        AND NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.node_group_id = g.id)
      ORDER BY g.created_at`)).rows;
    console.log(`  groups: ${preCount}; backfill will stamp ${candidates.length} root org(s):`);
    for (const r of candidates) console.log(`    · ${r.name} (${r.type}) ${r.id}`);

    console.log('— apply');
    await q(stripTxn(fs.readFileSync(MIG_SCHEMA, 'utf8')));
    await q(stripTxn(fs.readFileSync(MIG_BACKFILL, 'utf8')));

    console.log('— assertions');
    const cols = (await q(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='groups'
        AND column_name IN ('platform_status','platform_expires_at','seats',
                            'provider_subscription_id','provider_customer_id')`)).rows;
    cols.length === 5
      ? ok('column quintet present on groups')
      : bad('column quintet', `only ${cols.map(r => r.column_name).join(', ')}`);

    const stamped = (await q(`
      SELECT id, name, platform_status,
             (platform_expires_at BETWEEN now() + interval '29 days' AND now() + interval '31 days') AS clock_ok
      FROM public.groups WHERE id = ANY($1::uuid[])`, [candidates.map(r => r.id)])).rows;
    const unstamped = stamped.filter(r => r.platform_status !== 'trial' || !r.clock_ok);
    unstamped.length === 0
      ? ok(`all ${stamped.length} root orgs on trial with ~30-day clock`)
      : bad('backfill stamp', JSON.stringify(unstamped));

    const cardiff = stamped.find(r => /cardiff/i.test(r.name));
    cardiff && cardiff.platform_status === 'trial'
      ? ok(`Cardiff Council stamped (${cardiff.id})`)
      : bad('Cardiff Council', 'not found among stamped root orgs');

    const phantom = (await q(`
      SELECT count(*)::int c FROM public.groups g
      WHERE g.platform_status IS NOT NULL
        AND (g.parent_id IS NOT NULL
             OR g.type = 'school'
             OR EXISTS (SELECT 1 FROM public.schools s WHERE s.node_group_id = g.id))`)).rows[0].c;
    phantom === 0
      ? ok('no phantom clock on any sub-group or school node')
      : bad('phantom clocks', `${phantom} non-org node(s) carry a platform_status`);

    const badStatus = await probe(
      `UPDATE public.groups SET platform_status='bogus' WHERE id=$1`, [candidates[0]?.id]);
    badStatus.error
      ? ok('status CHECK rejects illegal value')
      : bad('status CHECK', 'bogus status was accepted');

    const postCount = (await q('SELECT count(*)::int c FROM public.groups')).rows[0].c;
    postCount === preCount
      ? ok('groups row count unchanged (expand-only)')
      : bad('row count', `${preCount} → ${postCount}`);

    console.log(`\n${pass} pass / ${fail} fail`);
    if (fail === 0 && COMMIT) {
      await q('COMMIT');
      await q(`NOTIFY pgrst, 'reload schema'`);
      console.log('COMMITTED (schema reload notified).');
    } else {
      await q('ROLLBACK');
      console.log(COMMIT ? 'ROLLED BACK — assertions failed.' : 'ROLLED BACK (dry run — pass --commit to apply).');
    }
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
