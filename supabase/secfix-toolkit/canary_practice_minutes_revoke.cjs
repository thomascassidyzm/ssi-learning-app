#!/usr/bin/env node
/**
 * Canary for 20260907_practice_minutes_scope_repoint_revoke.sql.
 *
 * The August canary (canary_practice_minutes_gate.cjs) kept `authenticated`
 * on admin_practice_minutes_by_course because four browser callers still read
 * it directly. They no longer do — every one goes through
 * POST /api/school/practice-by-course, which runs as the SERVICE ROLE behind
 * resolveVisibleScope — so this canary asserts the opposite of that one for
 * the `authenticated` role, and the same thing for every service path.
 *
 * One transaction against the live shared DB:
 *   1. snapshot the pre-state, including THE LEAK: a signed-in non-admin
 *      calling _by_course with a learner UUID that is not theirs
 *   2. apply the migration
 *   3. LEAK CLOSED — that same call is now permission-denied, and so is the
 *      no-argument form; anon stays denied
 *   4. EVERY LEGIT PATH ALIVE — service_role's scoped and platform-wide calls
 *      return byte-identical rows to pre-migration, and
 *      admin_practice_minutes() is untouched
 *   5. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_practice_minutes_revoke.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const DASH = path.join(os.homedir(), 'SSi', 'ssi-dashboard-v7-clean');
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260907_practice_minutes_scope_repoint_revoke.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  PASS ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  FAIL ${name} — ${detail}`); };

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

    console.log('— pre-state');
    const grants = async () => (await q(`
      select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'),('authenticated'),('service_role')) as r(rolname)
      where n.nspname = 'public' and p.proname like 'admin_practice_minutes%'
      order by p.proname, r.rolname`)).rows;
    console.log('  grants before:', (await grants()).map(g => `${g.proname}/${g.rolname}=${g.can_exec}`).join(' '));

    const plainRow = (await q(
      `select user_id from public.learners
        where user_id is not null and coalesce(platform_role,'') <> 'ssi_admin' limit 1`
    )).rows[0];
    const plainClaims = { sub: plainRow.user_id, role: 'authenticated' };

    const ids = (await q(
      `select l.id from public.learners l
        join public.sessions s on s.learner_id = l.id
        group by l.id order by count(*) desc limit 2`
    )).rows.map(r => r.id);
    const IDLIT = `array[${ids.map(i => `'${i}'::uuid`).join(',')}]`;

    // THE LEAK ITSELF, before the fix: a signed-in non-admin, someone else's ids.
    const leakBefore = await probe('authenticated',
      `select * from public.admin_practice_minutes_by_course(${IDLIT})`, plainClaims);
    if (leakBefore.error) console.log('  pre-state leak probe errored:', leakBefore.error.message);
    else console.log(`  PRE-STATE LEAK CONFIRMED: signed-in non-admin named-learner call returned ${leakBefore.rowCount} course rows`);

    // PostgREST presents the service key as BOTH the service_role DB role and a
    // JWT whose `role` claim is service_role — and the function's own
    // platform-wide guard reads auth.role(), i.e. the CLAIM. Probing with the
    // DB role alone raises "Forbidden", which is an artefact of the probe, not
    // of the app path: the running endpoint's no-argument call is verified live
    // against dev and production. So the service_role probes carry the claim.
    const svcClaims = { role: 'service_role' };
    const baseScoped = await probe('service_role', `select * from public.admin_practice_minutes(${IDLIT}) order by learner_id`, svcClaims);
    const baseByCourseScoped = await probe('service_role', `select * from public.admin_practice_minutes_by_course(${IDLIT}) order by course_code`, svcClaims);
    const baseByCourseAll = await probe('service_role', `select * from public.admin_practice_minutes_by_course() order by course_code`, svcClaims);

    console.log('— applying migration');
    const sql = fs.readFileSync(MIGRATION, 'utf8')
      .replace(/^\s*begin;\s*$/mi, '')
      .replace(/^\s*commit;\s*$/mi, '')
      .replace(/^\s*notify pgrst.*$/mi, '');
    await q(sql);
    console.log('  grants after: ', (await grants()).map(g => `${g.proname}/${g.rolname}=${g.can_exec}`).join(' '));

    console.log('— leak closed');
    await expectDeny('signed-in non-admin cannot read a NAMED learner [THE FINDING]', 'authenticated',
      `select * from public.admin_practice_minutes_by_course(${IDLIT})`, plainClaims);
    await expectDeny('signed-in non-admin cannot get the platform-wide aggregate either', 'authenticated',
      `select * from public.admin_practice_minutes_by_course()`, plainClaims);
    await expectDeny('anon still cannot execute _by_course', 'anon',
      `select * from public.admin_practice_minutes_by_course()`);
    await expectDeny('anon still cannot execute admin_practice_minutes', 'anon',
      `select * from public.admin_practice_minutes(${IDLIT})`);

    console.log('— legit paths alive');
    const nowByCourseScoped = await expectOk('service_role: _by_course(ids) [POST /api/school/practice-by-course]',
      'service_role', `select * from public.admin_practice_minutes_by_course(${IDLIT}) order by course_code`, svcClaims);
    sameRows(nowByCourseScoped.rows, baseByCourseScoped.rows)
      ? ok('  …and returns byte-identical rows to pre-migration')
      : bad('_by_course(ids) rows changed', 'differ');

    const nowByCourseAll = await expectOk('service_role: _by_course() platform-wide [admin Courses page]',
      'service_role', `select * from public.admin_practice_minutes_by_course() order by course_code`, svcClaims);
    sameRows(nowByCourseAll.rows, baseByCourseAll.rows)
      ? ok('  …and returns byte-identical rows to pre-migration')
      : bad('_by_course() rows changed', 'differ');

    const nowScoped = await expectOk('service_role: admin_practice_minutes(ids) untouched [api/admin/users.ts, attention.ts]',
      'service_role', `select * from public.admin_practice_minutes(${IDLIT}) order by learner_id`, svcClaims);
    sameRows(nowScoped.rows, baseScoped.rows)
      ? ok('  …and returns byte-identical rows to pre-migration')
      : bad('admin_practice_minutes(ids) rows changed', 'differ');

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) { await q('COMMIT'); console.log('COMMITTED'); }
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
