#!/usr/bin/env node
/**
 * Canary for 20260914d_support_inbox_no_auth_users.sql (job #680).
 *
 * One transaction against the live shared DB:
 *   1. apply the migration body (its own BEGIN/COMMIT stripped)
 *   2. assert the new view definition names no auth.users relation
 *   3. LEGIT-PATH-ALIVE — SET LOCAL ROLE service_role and read the view: the
 *      read 20260914c made impossible (42501) must return rows from
 *      bug_reports AND at least one legacy table, with the full column list
 *   4. LEAK-CLOSED — anon and authenticated still cannot read the view
 *   5. COMMIT only if --commit AND every assertion is green; else ROLLBACK.
 * PostgREST cannot see an uncommitted transaction, so the REST 200 is
 * confirmed by the caller after COMMIT, not inside it.
 *
 * Usage: node canary_support_inbox_no_auth_users.cjs [--commit]
 * Creds: DATABASE_URL (postgres role) from ~/.secrets/ssi-dashboard.env.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join('/home/tomcassidy/SSi/ssi-dashboard-v7-clean', 'node_modules', 'pg'));

const DB_URL = fs.readFileSync(path.join(process.env.HOME, '.secrets', 'ssi-dashboard.env'), 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260914d_support_inbox_no_auth_users.sql');
const COMMIT = process.argv.includes('--commit');
const EXPECTED_COLS = ['door','source','id','created_at','learner_id','account_code','reporter_email','platform_role','educational_role','school_role','school_id','school_name','school_is_test','group_id','course_code','build','deployment_env','device','route','body','context','screenshot_url','delivered_at'];

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ❌ ${n} — ${d}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);
  async function probe(role, sql) {
    await q('SAVEPOINT p');
    try {
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql);
      await q('RESET ROLE'); await q('RELEASE SAVEPOINT p');
      return { rows: r.rows, fields: r.fields.map(f => f.name) };
    } catch (e) { await q('ROLLBACK TO SAVEPOINT p'); await q('RESET ROLE'); return { error: e }; }
  }
  try {
    await q('BEGIN');
    const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
    await q(sql);
    console.log('migration applied inside the transaction');

    const def = (await q(`SELECT pg_get_viewdef('public.support_inbox'::regclass, true) AS d`)).rows[0].d;
    if (/auth\.users|\busers\b/.test(def)) bad('no auth.users in view', 'definition still names users'); else ok('view definition names no auth.users');
    const opts = (await q(`SELECT reloptions FROM pg_class WHERE oid = 'public.support_inbox'::regclass`)).rows[0].reloptions || [];
    if (opts.some(o => /security_invoker=(on|true)/.test(o))) ok('security_invoker still on'); else bad('security_invoker', JSON.stringify(opts));

    const r = await probe('service_role', `SELECT * FROM public.support_inbox ORDER BY created_at DESC`);
    if (r.error) bad('service_role reads the view', r.error.message);
    else {
      ok(`service_role reads the view: ${r.rows.length} rows`);
      const missing = EXPECTED_COLS.filter(k => !r.fields.includes(k));
      if (missing.length || r.fields.length !== EXPECTED_COLS.length) bad('column list unchanged', `missing ${missing} / got ${r.fields}`); else ok('column list unchanged (23 columns, same order)');
      const doors = {};
      for (const row of r.rows) doors[row.door] = (doors[row.door] || 0) + 1;
      console.log('  rows by door:', JSON.stringify(doors));
      if (doors.bug_report > 0) ok('rows from bug_reports present'); else bad('bug_reports rows', JSON.stringify(doors));
      const legacy = ['support_message','tester_feedback','content_feedback','handbook_question'].filter(d => doors[d] > 0);
      if (legacy.length) ok(`legacy rows present: ${legacy.join(', ')}`); else bad('legacy rows', JSON.stringify(doors));
      const withEmail = r.rows.filter(x => x.reporter_email).length;
      console.log(`  rows with reporter_email: ${withEmail}/${r.rows.length}`);
    }
    for (const role of ['anon', 'authenticated']) {
      const p = await probe(role, `SELECT count(*) FROM public.support_inbox`);
      if (p.error && p.error.code === '42501') ok(`${role} cannot read the view (42501)`); else bad(`${role} leak-closed`, p.error ? p.error.message : 'read succeeded');
    }

    if (fail === 0 && COMMIT) { await q('COMMIT'); console.log(`\nCOMMITTED — ${pass} green`); }
    else { await q('ROLLBACK'); console.log(`\nROLLED BACK — ${pass} green, ${fail} red${COMMIT ? '' : ' (dry run; pass --commit)'}`); }
  } catch (e) { await q('ROLLBACK').catch(() => {}); console.error('aborted:', e.message); fail++; }
  finally { await c.end(); }
  process.exit(fail ? 1 : 0);
})();
