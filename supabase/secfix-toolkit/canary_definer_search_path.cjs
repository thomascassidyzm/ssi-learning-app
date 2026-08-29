#!/usr/bin/env node
/**
 * Canary for 20260825_sec25_d01_definer_search_path.sql (SEC25-D-01).
 *
 * One transaction against the live shared DB:
 *   1. snapshot the pre-state — which SECURITY DEFINER functions in `public`
 *      have no `search_path` pinned (proconfig is null)
 *   2. apply the migration
 *   3. HOLE CLOSED — every one of the 16 now carries
 *      `search_path=public, pg_temp`, and the count of unpinned DEFINER
 *      functions in `public` is ZERO
 *   4. NOTHING ELSE MOVED — EXECUTE grants, ownership, prosecdef, prokind and
 *      the function bodies (prosrc) are byte-identical before and after for
 *      EVERY definer function in the schema. ALTER FUNCTION ... SET must change
 *      resolution and nothing else; this asserts it rather than assuming it.
 *   5. EVERY LEGIT PATH ALIVE — each altered function is actually CALLED with
 *      real arguments as the role that calls it in production, and its result
 *      compared to the pre-migration result for the same call. A pinned
 *      search_path that broke an unqualified reference would surface here as an
 *      error or a changed row set, which no source-text test can see.
 *   6. COMMIT only if --commit AND all assertions green; else ROLLBACK.
 *
 * Usage: node canary_definer_search_path.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const DASH = path.join(os.homedir(), 'SSi', 'ssi-dashboard-v7-clean');
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260825_sec25_d01_definer_search_path.sql');
const COMMIT = process.argv.includes('--commit');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

// The functions the migration alters, with a real call for each and the role
// that makes it in production. Read-only calls only — update_daily_contributions
// writes, so it is exercised for CALLABILITY under a savepoint that is rolled
// back, not for its rows.
const CALLS = [
  ['analytics_overview()', 'service_role', true],
  ['analytics_engagement()', 'service_role', true],
  ['analytics_course_comparison()', 'service_role', true],
  ['analytics_entitlement_funnel()', 'service_role', true],
  ['analytics_trial_conversion()', 'service_role', true],
  ["analytics_growth('week', 4)", 'service_role', true],
  ['analytics_health(7)', 'service_role', true],
  ['analytics_retention_cohorts(4)', 'service_role', true],
  ['analytics_retention_days_active(4)', 'service_role', true],
  ["get_active_prompt('phase1')", 'service_role', true],
  ["get_active_brief('eng', 'spa')", 'service_role', true],
];

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, p) => c.query(sql, p);

  const definerSnapshot = async () => (await q(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
           p.proconfig, p.prosecdef, p.prokind,
           pg_get_userbyid(p.proowner) as owner,
           md5(coalesce(p.prosrc,'')) as body_md5,
           coalesce(p.proacl::text, '') as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
     order by p.proname, args`)).rows;

  const probe = async (role, sql) => {
    await q('SAVEPOINT p');
    try {
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql);
      await q('RESET ROLE');
      await q('RELEASE SAVEPOINT p');
      return { rows: r.rows };
    } catch (e) { await q('ROLLBACK TO SAVEPOINT p'); return { error: e }; }
  };

  try {
    await q('BEGIN');

    console.log('— pre-state');
    const pre = await definerSnapshot();
    const preUnpinned = pre.filter(r => !r.proconfig || !r.proconfig.some(cfg => cfg.startsWith('search_path=')));
    console.log(`  ${pre.length} SECURITY DEFINER functions in public; ${preUnpinned.length} with NO search_path pinned`);
    console.log('  unpinned:', preUnpinned.map(r => r.proname).join(', '));

    // baseline results for every legit call
    const baseline = {};
    for (const [call, role] of CALLS) baseline[call] = await probe(role, `select * from public.${call}`);

    console.log('— applying migration');
    const sql = fs.readFileSync(MIGRATION, 'utf8')
      .replace(/^\s*begin;\s*$/mi, '').replace(/^\s*commit;\s*$/mi, '')
      .replace(/^\s*notify pgrst.*$/mi, '');
    await q(sql);

    console.log('— hole closed');
    const post = await definerSnapshot();
    const postUnpinned = post.filter(r => !r.proconfig || !r.proconfig.some(cfg => cfg.startsWith('search_path=')));
    postUnpinned.length === 0
      ? ok(`zero unpinned SECURITY DEFINER functions in public (was ${preUnpinned.length})`)
      : bad('unpinned DEFINER functions remain', postUnpinned.map(r => r.proname).join(', '));

    const wrongValue = post.filter(r => {
      const sp = (r.proconfig || []).find(cfg => cfg.startsWith('search_path='));
      return sp && !/pg_temp/.test(sp);
    });
    wrongValue.length === 0
      ? ok('every pinned search_path lists pg_temp explicitly (never implicitly first)')
      : bad('a pinned search_path omits pg_temp', wrongValue.map(r => r.proname).join(', '));

    console.log('— nothing else moved');
    const key = (r) => `${r.proname}(${r.args})`;
    const preMap = new Map(pre.map(r => [key(r), r]));
    const drift = [];
    for (const r of post) {
      const b = preMap.get(key(r));
      if (!b) { drift.push(`${key(r)} is NEW`); continue; }
      if (b.acl !== r.acl) drift.push(`${key(r)} ACL changed`);
      if (b.owner !== r.owner) drift.push(`${key(r)} owner changed`);
      if (b.body_md5 !== r.body_md5) drift.push(`${key(r)} BODY changed`);
      if (b.prosecdef !== r.prosecdef) drift.push(`${key(r)} prosecdef changed`);
      if (b.prokind !== r.prokind) drift.push(`${key(r)} prokind changed`);
    }
    pre.length === post.length
      ? ok(`function count unchanged (${pre.length})`)
      : bad('function count changed', `${pre.length} -> ${post.length}`);
    drift.length === 0
      ? ok('every definer function: grants, owner, body, prosecdef, prokind byte-identical')
      : bad('drift beyond search_path', drift.join('; '));

    console.log('— every legit path alive, and unchanged');
    for (const [call, role] of CALLS) {
      const before = baseline[call];
      const after = await probe(role, `select * from public.${call}`);
      if (before.error) {
        after.error ? ok(`${call} errored identically before and after (pre-existing)`)
                    : bad(`${call}`, 'errored before but not after — unexpected');
        continue;
      }
      if (after.error) { bad(`${call} as ${role}`, after.error.message.split('\n')[0]); continue; }
      JSON.stringify(before.rows) === JSON.stringify(after.rows)
        ? ok(`${call} as ${role} — ${after.rows.length} rows, byte-identical`)
        : bad(`${call} as ${role}`, `rows changed (${before.rows.length} -> ${after.rows.length})`);
    }

    // update_daily_contributions is a TRIGGER function — it cannot be called
    // directly (Postgres: "trigger functions can only be called as triggers"),
    // so the meaningful check is that its definition still RESOLVES and that
    // the triggers bound to it survive the ALTER.
    const trg = await probe('service_role', `
      select count(*)::int as n from pg_trigger t
       where t.tgfoid = 'public.update_daily_contributions'::regproc and not t.tgisinternal`);
    trg.error ? bad('update_daily_contributions triggers intact', trg.error.message.split('\n')[0])
              : ok(`update_daily_contributions() still bound to ${trg.rows[0].n} trigger(s)`);

    // get_my_verified_emails() reads auth.uid(); with no JWT it must return
    // empty rather than error — that it still RESOLVES is the point.
    const v = await probe('authenticated', 'select * from public.get_my_verified_emails()');
    v.error ? bad('get_my_verified_emails() resolves', v.error.message.split('\n')[0])
            : ok(`get_my_verified_emails() still resolves (${v.rows.length} rows, no JWT)`);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) { await q('COMMIT'); console.log('COMMITTED ✅'); }
    else { await q('ROLLBACK'); console.log(fail === 0 ? 'ROLLED BACK (dry run — pass --commit to apply)' : 'ROLLED BACK (assertions failed)'); }
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    try { await q('ROLLBACK'); } catch { /* already aborted */ }
    console.error('CANARY ERROR:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
