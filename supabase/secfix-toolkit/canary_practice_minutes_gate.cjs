#!/usr/bin/env node
/**
 * Canary for 20260825_sec25_d02_practice_minutes_gate.sql (SEC25-D-02).
 *
 * One transaction against the live shared DB:
 *   1. snapshot the pre-state (grants, prosecdef, and the ACTUAL leak — an
 *      anon no-argument call to admin_practice_minutes_by_course returning
 *      platform-wide rows), so every assertion below is a difference, not a guess
 *   2. apply the migration
 *   3. LEAK CLOSED —
 *        a. anon can no longer EXECUTE admin_practice_minutes()
 *        b. anon can no longer EXECUTE admin_practice_minutes_by_course()
 *        c. authenticated can no longer EXECUTE admin_practice_minutes()
 *           (its only callers are service-role server handlers)
 *        d. a signed-in NON-admin can no longer get the platform-wide
 *           (no-argument) aggregate from _by_course
 *   4. EVERY LEGIT PATH ALIVE —
 *        a. service_role still calls admin_practice_minutes(ids) and gets the
 *           SAME rows as before the migration
 *        b. a signed-in non-admin still calls _by_course(ids) — the schools
 *           analytics / StudentProgressView path — same rows as before
 *        c. a real ssi_admin still gets the no-argument platform-wide aggregate
 *           — the admin Courses page path — same rows as before
 *        d. service_role still gets the no-argument aggregate
 *   5. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_practice_minutes_gate.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const DASH = path.join(os.homedir(), 'SSi', 'ssi-dashboard-v7-clean');
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260825_sec25_d02_practice_minutes_gate.sql');
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
      await q(`RESET ROLE`);
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
  const expectDeny = async (name, role, sql, claims, re = /permission denied/i) => {
    const r = await probe(role, sql, claims);
    if (r.error && re.test(r.error.message)) ok(`${name} (${r.error.message.split('\n')[0].slice(0, 70)})`);
    else if (r.error) bad(name, `denied but wrong error: ${r.error.message}`);
    else bad(name, `NOT DENIED (returned ${r.rowCount} rows)`);
    return r;
  };
  const sameRows = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  try {
    await q('BEGIN');

    // ── 1. pre-state ──────────────────────────────────────────────────────
    console.log('— pre-state');
    const grants = async () => (await q(`
      select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'),('authenticated'),('service_role')) as r(rolname)
      where n.nspname = 'public' and p.proname like 'admin_practice_minutes%'
      order by p.proname, r.rolname`)).rows;
    const preGrants = await grants();
    console.log('  grants before:', preGrants.map(g => `${g.proname}/${g.rolname}=${g.can_exec}`).join(' '));

    // a real ssi_admin's auth uid, for the admin-path probe
    const adminRow = (await q(
      `select user_id from public.learners where platform_role = 'ssi_admin' and user_id is not null limit 1`
    )).rows[0];
    if (!adminRow) { console.log('  ⚠️  no ssi_admin learner found — admin-path probe will be skipped'); }
    else console.log('  ssi_admin uid found for the admin-path probe');
    const adminClaims = adminRow ? { sub: adminRow.user_id, role: 'authenticated' } : null;

    // a plain signed-in non-admin, for the "still works / no longer works" probes
    const plainRow = (await q(
      `select user_id from public.learners
        where user_id is not null and coalesce(platform_role,'') <> 'ssi_admin' limit 1`
    )).rows[0];
    const plainClaims = { sub: plainRow.user_id, role: 'authenticated' };

    // two real learner ids to pass as the scoped argument
    const ids = (await q(
      `select l.id from public.learners l
        join public.sessions s on s.learner_id = l.id
        group by l.id order by count(*) desc limit 2`
    )).rows.map(r => r.id);
    const IDLIT = `array[${ids.map(i => `'${i}'::uuid`).join(',')}]`;
    console.log(`  scoped-argument probe uses ${ids.length} learner ids with real sessions`);

    // THE LEAK ITSELF, before the fix: anon, no argument, no login.
    const leakBefore = await probe('anon', `select * from public.admin_practice_minutes_by_course()`);
    if (leakBefore.error) console.log('  pre-state leak probe errored:', leakBefore.error.message);
    else console.log(`  🔓 PRE-STATE LEAK CONFIRMED: anon no-arg call returned ${leakBefore.rowCount} course rows`);

    // baselines to compare against after the migration (same inputs, service role)
    const baseScoped = await probe('service_role', `select * from public.admin_practice_minutes(${IDLIT}) order by learner_id`);
    const baseByCourseScoped = await probe('service_role', `select * from public.admin_practice_minutes_by_course(${IDLIT}) order by course_code`);
    const baseByCourseAll = await probe('service_role', `select * from public.admin_practice_minutes_by_course() order by course_code`);

    // ── 2. apply ──────────────────────────────────────────────────────────
    console.log('— applying migration');
    const sql = fs.readFileSync(MIGRATION, 'utf8')
      .replace(/^\s*begin;\s*$/mi, '')
      .replace(/^\s*commit;\s*$/mi, '')
      .replace(/^\s*notify pgrst.*$/mi, '');
    await q(sql);
    const postGrants = await grants();
    console.log('  grants after: ', postGrants.map(g => `${g.proname}/${g.rolname}=${g.can_exec}`).join(' '));

    // ── 3. leak closed ────────────────────────────────────────────────────
    console.log('— leak closed');
    await expectDeny('anon cannot EXECUTE admin_practice_minutes()', 'anon',
      `select * from public.admin_practice_minutes(${IDLIT})`);
    await expectDeny('anon cannot EXECUTE admin_practice_minutes_by_course() [THE FINDING]', 'anon',
      `select * from public.admin_practice_minutes_by_course()`);
    await expectDeny('authenticated cannot EXECUTE admin_practice_minutes()', 'authenticated',
      `select * from public.admin_practice_minutes(${IDLIT})`, plainClaims);
    await expectDeny('signed-in non-admin cannot get the platform-wide aggregate', 'authenticated',
      `select * from public.admin_practice_minutes_by_course()`, plainClaims, /Forbidden/i);

    // ── 4. every legit path alive, and unchanged ──────────────────────────
    console.log('— legit paths alive');
    const nowScoped = await expectOk('service_role: admin_practice_minutes(ids) [api/admin/users.ts, attention.ts]',
      'service_role', `select * from public.admin_practice_minutes(${IDLIT}) order by learner_id`);
    sameRows(nowScoped.rows, baseScoped.rows)
      ? ok('  …and returns byte-identical rows to pre-migration')
      : bad('admin_practice_minutes(ids) rows changed', `${JSON.stringify(baseScoped.rows)} -> ${JSON.stringify(nowScoped.rows)}`);

    const nowByCourseScoped = await expectOk('signed-in non-admin: _by_course(ids) [schools analytics, StudentProgressView]',
      'authenticated', `select * from public.admin_practice_minutes_by_course(${IDLIT}) order by course_code`, plainClaims);
    sameRows(nowByCourseScoped.rows, baseByCourseScoped.rows)
      ? ok('  …and returns byte-identical rows to pre-migration')
      : bad('_by_course(ids) rows changed', `${JSON.stringify(baseByCourseScoped.rows)} -> ${JSON.stringify(nowByCourseScoped.rows)}`);

    if (adminClaims) {
      const nowAdminAll = await expectOk('ssi_admin: _by_course() no-arg platform-wide [admin Courses page]',
        'authenticated', `select * from public.admin_practice_minutes_by_course() order by course_code`, adminClaims);
      sameRows(nowAdminAll.rows, baseByCourseAll.rows)
        ? ok('  …and returns byte-identical rows to pre-migration')
        : bad('_by_course() admin rows changed', `${baseByCourseAll.rowCount} rows -> ${nowAdminAll.rowCount} rows`);
    } else {
      bad('ssi_admin no-arg path', 'SKIPPED — no ssi_admin learner found to probe with');
    }

    const nowSvcAll = await expectOk('service_role: _by_course() no-arg still allowed',
      'service_role', `select * from public.admin_practice_minutes_by_course() order by course_code`);
    sameRows(nowSvcAll.rows, baseByCourseAll.rows)
      ? ok('  …and returns byte-identical rows to pre-migration')
      : bad('_by_course() service_role rows changed', 'differ');

    // ── 5. verdict ────────────────────────────────────────────────────────
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) { await q('COMMIT'); console.log('COMMITTED ✅'); }
    else { await q('ROLLBACK'); console.log(fail === 0 ? 'ROLLED BACK (dry run — pass --commit to apply)' : 'ROLLED BACK (assertions failed)'); }
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    try { await q('ROLLBACK'); } catch { /* already aborted */ }
    console.error('CANARY ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
