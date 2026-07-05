#!/usr/bin/env node
/**
 * Canary for 20260704_gated_invite_codes_select_revoke.sql
 *
 * One transaction against the live shared DB:
 *   1. apply the revoke
 *   2. assert authenticated SELECT on invite_codes now denies (leak closed)
 *   3. assert service_role SELECT still works (api/admin/codes.ts,
 *      api/code/validate.ts, api/code/redeem.ts, try-link/create.ts all use
 *      the service-role key, unaffected by an authenticated-only revoke)
 *   4. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_invite_codes_select_revoke.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260704_gated_invite_codes_select_revoke.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  async function probe(role, sql, claims) {
    await q('SAVEPOINT p');
    try {
      if (claims) await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql);
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }
  const expectOk = async (name, role, sql, claims) => {
    const r = await probe(role, sql, claims);
    r.error ? bad(name, r.error.message) : ok(name);
    return r;
  };
  const expectDeny = async (name, role, sql, claims) => {
    const r = await probe(role, sql, claims);
    if (r.error && /permission denied/i.test(r.error.message)) ok(name);
    else if (r.error) bad(name, `denied but wrong error: ${r.error.message}`);
    else bad(name, `NOT DENIED (${r.rowCount} rows returned)`);
  };

  try {
    await q('BEGIN');
    console.log('— applying 20260704_gated_invite_codes_select_revoke.sql (in txn)');
    await q(fs.readFileSync(MIGRATION, 'utf8'));

    const claims = { sub: 'canary-fixture-user', role: 'authenticated' };

    console.log('— closed path denies');
    await expectDeny('authenticated SELECT invite_codes', 'authenticated',
      'SELECT id FROM public.invite_codes LIMIT 1', claims);

    console.log('— legit paths stay alive');
    await expectOk('service_role SELECT invite_codes (admin/codes.ts, code/validate.ts, code/redeem.ts, try-link/create.ts)',
      'service_role', 'SELECT id FROM public.invite_codes LIMIT 1');
    await expectOk('postgres SELECT invite_codes (unaffected, sanity check)',
      'postgres', 'SELECT id FROM public.invite_codes LIMIT 1');

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
