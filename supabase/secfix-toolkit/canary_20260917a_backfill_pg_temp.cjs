#!/usr/bin/env node
/**
 * Canary for 20260917a_record_lego_pairings_backfill_pg_temp.sql.
 *
 * One transaction against the live shared DB:
 *   1. PRE-STATE — record_lego_pairings_backfill pins `search_path=public`
 *      with no pg_temp, and it is the ONLY DEFINER function in public in that
 *      state (or unpinned entirely).
 *   2. apply the migration.
 *   3. HOLE CLOSED — it now pins `search_path=public, pg_temp`, and the count
 *      of DEFINER functions in public that are unpinned OR missing pg_temp is
 *      ZERO.
 *   4. NOTHING ELSE MOVED — proconfig aside, every DEFINER function's body
 *      (prosrc md5), ACL, owner, prosecdef and prokind are byte-identical
 *      before and after. ALTER FUNCTION ... SET must change resolution and
 *      nothing else.
 *   5. EVERY LEGIT PATH ALIVE — the altered function is actually CALLED with
 *      real arguments as service_role (the only role it is granted to), inside
 *      a savepoint that is rolled back, and the rows it would have written are
 *      compared against the same call made before the migration. A pin that
 *      broke an unqualified reference surfaces here, which no source-text test
 *      can see.
 *   6. COMMIT only if --commit AND every assertion green; else ROLLBACK.
 *
 * Usage: node canary_20260917a_backfill_pg_temp.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const DASH = path.join(os.homedir(), 'SSi', 'ssi-dashboard-v7-clean');
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260917a_record_lego_pairings_backfill_pg_temp.sql');
const COMMIT = process.argv.includes('--commit');

const FN = 'record_lego_pairings_backfill';
// A real call, with a learner and course that exist. Arguments are shaped
// exactly as job #59's replay script sends them.
const TAG = 'canary-20260917a';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, p) => c.query(sql, p);

  const snapshot = async () => (await q(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
           p.proconfig, p.prosecdef, p.prokind,
           pg_get_userbyid(p.proowner) as owner,
           md5(coalesce(p.prosrc,'')) as body_md5,
           coalesce(p.proacl::text, '') as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
     order by p.proname, args`)).rows;

  const key = (r) => `${r.proname}(${r.args})`;
  const defective = (rows) => rows.filter((r) => {
    const pin = (r.proconfig || []).find((s) => s.startsWith('search_path='));
    return !pin || !/pg_temp/.test(pin);
  }).map(key);

  // Call the function for real under a savepoint and report what it wrote.
  const callAndCount = async (learnerId, courseCode) => {
    await q('SAVEPOINT call');
    try {
      await q(`SET LOCAL ROLE service_role`);
      await q(
        `select public.${FN}($1::uuid, $2::text, $3::text[], $4::int[], $5::text, now() - interval '1 hour', now())`,
        [learnerId, courseCode, [['ZZZ_CANARY_A', 'ZZZ_CANARY_B']], [3], TAG],
      );
      await q('RESET ROLE');
      const r = await q(
        `select lego_a, lego_b, fire_count from public.learner_lego_pairings
          where learner_id = $1 and course_code = $2 and lego_a = 'ZZZ_CANARY_A'`,
        [learnerId, courseCode],
      );
      await q('ROLLBACK TO SAVEPOINT call');
      await q('RELEASE SAVEPOINT call');
      return { ok: true, rows: r.rows };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT call');
      await q('RELEASE SAVEPOINT call');
      return { ok: false, error: e.message };
    }
  };

  try {
    await q('BEGIN');

    // A real learner+course to call with — any learner with an enrollment.
    const subject = (await q(
      `select learner_id, course_id from public.course_enrollments limit 1`,
    )).rows[0];
    if (!subject) throw new Error('no course_enrollments row to call with');

    const before = await snapshot();
    const beforeDefective = defective(before);
    const mine = before.find((r) => r.proname === FN);
    if (!mine) bad('PRE: function exists', `${FN} not found`);
    else if ((mine.proconfig || []).join() === 'search_path=public') ok(`PRE: ${FN} pins search_path=public with NO pg_temp`);
    else bad('PRE: the defect is present', `proconfig = ${JSON.stringify(mine.proconfig)}`);
    if (beforeDefective.length === 1 && beforeDefective[0].startsWith(FN)) ok('PRE: it is the only defective DEFINER function');
    else bad('PRE: only one defect', `defective = ${JSON.stringify(beforeDefective)}`);

    const callBefore = await callAndCount(subject.learner_id, subject.course_id);
    if (callBefore.ok) ok(`PRE: ${FN} callable as service_role, wrote ${callBefore.rows.length} row(s)`);
    else bad('PRE: callable', callBefore.error);

    await q(fs.readFileSync(MIGRATION, 'utf8'));

    const after = await snapshot();
    const mineAfter = after.find((r) => r.proname === FN);
    if ((mineAfter.proconfig || []).join() === 'search_path=public, pg_temp') ok('HOLE CLOSED: pg_temp explicit and LAST');
    else bad('HOLE CLOSED', `proconfig = ${JSON.stringify(mineAfter.proconfig)}`);
    if (defective(after).length === 0) ok('HOLE CLOSED: zero defective DEFINER functions in public');
    else bad('zero defective', JSON.stringify(defective(after)));

    // Nothing else moved.
    const drift = [];
    if (before.length !== after.length) drift.push(`count ${before.length} → ${after.length}`);
    for (const b of before) {
      const a = after.find((r) => key(r) === key(b));
      if (!a) { drift.push(`${key(b)} disappeared`); continue; }
      for (const col of ['prosecdef', 'prokind', 'owner', 'body_md5', 'acl']) {
        if (String(a[col]) !== String(b[col])) drift.push(`${key(b)}.${col}: ${b[col]} → ${a[col]}`);
      }
      const bCfg = JSON.stringify(b.proconfig), aCfg = JSON.stringify(a.proconfig);
      if (bCfg !== aCfg && b.proname !== FN) drift.push(`${key(b)}.proconfig: ${bCfg} → ${aCfg}`);
    }
    if (drift.length === 0) ok('NOTHING ELSE MOVED: bodies, ACLs, owners, prosecdef, prokind and every other proconfig identical');
    else bad('NOTHING ELSE MOVED', drift.join('; '));

    const callAfter = await callAndCount(subject.learner_id, subject.course_id);
    if (!callAfter.ok) bad('PATH ALIVE', callAfter.error);
    else if (JSON.stringify(callAfter.rows) === JSON.stringify(callBefore.rows)) {
      ok(`PATH ALIVE: ${FN} still callable and writes an identical row set`);
    } else {
      bad('PATH ALIVE', `rows changed: ${JSON.stringify(callBefore.rows)} → ${JSON.stringify(callAfter.rows)}`);
    }

    console.log(`\n  ${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) { await q('COMMIT'); console.log('  COMMITTED'); }
    else { await q('ROLLBACK'); console.log(fail === 0 ? '  green — ROLLED BACK (pass --commit to apply)' : '  RED — ROLLED BACK'); }
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('  canary threw, rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
  if (fail > 0) process.exitCode = 1;
})();
