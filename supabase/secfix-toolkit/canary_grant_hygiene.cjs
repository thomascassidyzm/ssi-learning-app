#!/usr/bin/env node
/**
 * Canary for 20260704_grant_hygiene_org_tables.sql
 *
 * One transaction against the live shared DB:
 *   1. apply the revokes
 *   2. assert every LEGIT path still works (authenticated SELECTs everywhere
 *      they exist today; classes INSERT/UPDATE — the live create/rename/
 *      ratchet feature paths)
 *   3. assert every CLOSED path now denies (classes DELETE/TRUNCATE,
 *      govt_admins DELETE/TRUNCATE, anon SELECT entitlement_grants)
 *   4. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_grant_hygiene.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260704_grant_hygiene_org_tables.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  // savepoint-wrapped probe: returns {error} instead of aborting the txn
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
    else bad(name, `NOT DENIED (${r.rowCount} rows affected)`);
  };

  try {
    await q('BEGIN');
    console.log('— applying 20260704_grant_hygiene_org_tables.sql (in txn)');
    await q(fs.readFileSync(MIGRATION, 'utf8'));

    // fixture ingredients gathered as postgres
    const seed = (await q(`SELECT school_id, course_code FROM public.classes WHERE school_id IS NOT NULL LIMIT 1`)).rows[0];
    const teacher = (await q(`SELECT teacher_user_id FROM public.classes WHERE teacher_user_id IS NOT NULL LIMIT 1`)).rows[0];
    if (!seed || !teacher) throw new Error('no seed class row to model the fixture on');
    const claims = { sub: teacher.teacher_user_id, role: 'authenticated' };

    console.log('— legit paths stay alive');
    await expectOk('authenticated SELECT schools', 'authenticated', 'SELECT id FROM public.schools LIMIT 1', claims);
    await expectOk('authenticated SELECT classes', 'authenticated', 'SELECT id FROM public.classes LIMIT 1', claims);
    await expectOk('authenticated SELECT groups', 'authenticated', 'SELECT id FROM public.groups LIMIT 1', claims);
    await expectOk('authenticated SELECT govt_admins', 'authenticated', 'SELECT user_id FROM public.govt_admins LIMIT 1', claims);
    await expectOk('authenticated SELECT entitlement_grants', 'authenticated', 'SELECT id FROM public.entitlement_grants LIMIT 1', claims);
    await expectOk('authenticated SELECT invite_codes (until gated revoke)', 'authenticated', 'SELECT id FROM public.invite_codes LIMIT 1', claims);

    const ins = await expectOk('authenticated INSERT classes (create-class path)', 'authenticated',
      `INSERT INTO public.classes (class_name, course_code, school_id, teacher_user_id)
       VALUES ('CANARY grant-hygiene', '${seed.course_code}', '${seed.school_id}', '${teacher.teacher_user_id}')
       RETURNING id`, claims);
    const fixtureId = ins.rows && ins.rows[0] && ins.rows[0].id;
    if (fixtureId) {
      await expectOk('authenticated UPDATE classes rename (ClassDetail path)', 'authenticated',
        `UPDATE public.classes SET class_name = 'CANARY renamed' WHERE id = '${fixtureId}'`, claims);
      await expectOk('authenticated UPDATE classes last_lego_id (ratchet path)', 'authenticated',
        `UPDATE public.classes SET last_lego_id = 'S0001L01' WHERE id = '${fixtureId}'`, claims);
    } else {
      bad('classes UPDATE probes', 'skipped — INSERT fixture failed');
    }

    console.log('— closed paths deny');
    await expectDeny('authenticated DELETE classes', 'authenticated',
      `DELETE FROM public.classes WHERE class_name = 'never-matches-anything'`, claims);
    await expectDeny('authenticated TRUNCATE classes', 'authenticated', 'TRUNCATE public.classes', claims);
    await expectDeny('authenticated DELETE govt_admins', 'authenticated',
      `DELETE FROM public.govt_admins WHERE user_id = 'never-matches'`, claims);
    await expectDeny('authenticated TRUNCATE govt_admins', 'authenticated', 'TRUNCATE public.govt_admins', claims);
    await expectDeny('anon SELECT entitlement_grants', 'anon', 'SELECT id FROM public.entitlement_grants LIMIT 1');

    // fixture cleanup as postgres, pre-COMMIT
    await q('RESET ROLE');
    if (fixtureId) {
      await q(`DELETE FROM public.classes WHERE id = $1`, [fixtureId]);
      console.log('— fixture cleaned');
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
