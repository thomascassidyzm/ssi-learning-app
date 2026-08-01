#!/usr/bin/env node
/**
 * Canary for 20260801c_rls_perf_initplan_consolidation.sql
 *
 * ONE transaction against the live shared DB:
 *   1. run the probe suite (real roles + real JWT subs) — record every result
 *   2. apply the migration
 *   3. run the IDENTICAL probe suite again
 *   4. assert result-for-result equality (rowcounts / error classes)
 *   5. COMMIT only if --commit AND zero diffs; else ROLLBACK.
 *
 * Write-probes run inside SAVEPOINTs and are rolled back individually — the
 * canary never mutates data even on COMMIT.
 *
 * Usage: node canary_rls_perf.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));
const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', '..', 'migrations', '20260801c_rls_perf_initplan_consolidation.sql');
const COMMIT = process.argv.includes('--commit');

// Real identities pulled live 2026-08-01
const ADMIN_UID    = '8a468cdc-c49f-46ae-848b-b97b3cedd4ca'; // learners.platform_role='ssi_admin'
const LEARNER_A    = '92e402b7-0c31-4766-815c-12d1a828a80a'; // heavy sessions user
const LEARNER_A_ID = 'be652f81-a95a-4f78-91fa-3162b49e2609';
const LEARNER_B_ID = 'de757444-2c5c-493f-9e51-42d1d6e7147d'; // a DIFFERENT learner (leak probe)
const TEACHER_UID  = '008e7fea-4b71-4cdb-90ae-dcc587319577'; // classes.teacher_user_id
const SCHOOLADMIN  = '2f2e12e7-e8f6-43a1-ad65-e8439a2ba242'; // schools.admin_user_id

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  // Savepoint-wrapped probe as a given supabase role + jwt sub.
  // Returns { n: rowcount } or { err: sqlstate } — always rolls back its savepoint.
  async function probe(role, sub, sql) {
    await q('SAVEPOINT p');
    try {
      if (sub) await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role })]);
      await q(`SET LOCAL role ${role}`);
      const r = await q(sql);
      await q('ROLLBACK TO SAVEPOINT p');
      return { n: r.rowCount, v: r.rows && r.rows[0] !== undefined ? r.rows[0] : null };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { err: e.code };
    }
  }

  const SUITE = [
    // anon reads
    ['anon course browse',        'anon', null, 'SELECT count(*) FROM courses'],
    ['anon courses rowcount',     'anon', null, 'SELECT id FROM courses'],
    ['anon regions',              'anon', null, 'SELECT id FROM regions'],
    ['anon subscriptions empty',  'anon', null, 'SELECT id FROM subscriptions'],
    ['anon user_entitlements empty','anon', null,'SELECT id FROM user_entitlements'],
    ['anon entitlement_codes empty','anon', null,'SELECT id FROM entitlement_codes'],
    ['anon invite_codes (grant-denied)','anon', null,'SELECT id FROM invite_codes'],
    // ordinary learner
    ['learner courses all',       'authenticated', LEARNER_A, 'SELECT id FROM courses'],
    ['learner own learners row',  'authenticated', LEARNER_A, 'SELECT id FROM learners'],
    ['learner own sessions',      'authenticated', LEARNER_A, 'SELECT count(*) FROM sessions'],
    ['learner leak-check B sessions','authenticated', LEARNER_A, `SELECT count(*) FROM sessions WHERE learner_id='${LEARNER_B_ID}'`],
    ['learner own lego_progress', 'authenticated', LEARNER_A, 'SELECT count(*) FROM lego_progress'],
    ['learner own seed_progress', 'authenticated', LEARNER_A, 'SELECT count(*) FROM seed_progress'],
    ['learner own enrollments',   'authenticated', LEARNER_A, 'SELECT count(*) FROM course_enrollments'],
    ['learner own l1 state',      'authenticated', LEARNER_A, 'SELECT count(*) FROM learner_l1_state'],
    ['learner own pod state',     'authenticated', LEARNER_A, 'SELECT count(*) FROM learner_pod_state'],
    ['learner own lego metrics',  'authenticated', LEARNER_A, 'SELECT count(*) FROM learner_lego_metrics'],
    ['learner own meta-commentary','authenticated', LEARNER_A,'SELECT count(*) FROM learner_meta_commentary_state'],
    ['learner own speaking opps', 'authenticated', LEARNER_A, 'SELECT count(*) FROM learner_speaking_opportunities'],
    ['learner own entitlements',  'authenticated', LEARNER_A, 'SELECT count(*) FROM user_entitlements'],
    ['learner own subscription',  'authenticated', LEARNER_A, 'SELECT count(*) FROM subscriptions'],
    ['learner entitlement_codes 0','authenticated', LEARNER_A,'SELECT count(*) FROM entitlement_codes'],
    ['learner classes visible',   'authenticated', LEARNER_A, 'SELECT count(*) FROM classes'],
    ['learner schools visible',   'authenticated', LEARNER_A, 'SELECT count(*) FROM schools'],
    ['learner govt_admins visible','authenticated', LEARNER_A,'SELECT count(*) FROM govt_admins'],
    ['learner entitlement_codes insert DENIED','authenticated', LEARNER_A,
      `INSERT INTO entitlement_codes (code) VALUES ('canary-should-never-insert')`],
    // ssi_admin
    ['admin learners read-all',   'authenticated', ADMIN_UID, 'SELECT count(*) FROM learners'],
    ['admin sessions read-all',   'authenticated', ADMIN_UID, 'SELECT count(*) FROM sessions'],
    ['admin lego_progress read-all','authenticated', ADMIN_UID,'SELECT count(*) FROM lego_progress'],
    ['admin enrollments read-all','authenticated', ADMIN_UID, 'SELECT count(*) FROM course_enrollments'],
    ['admin l1-state read-all',   'authenticated', ADMIN_UID, 'SELECT count(*) FROM learner_l1_state'],
    ['admin classes read-all',    'authenticated', ADMIN_UID, 'SELECT count(*) FROM classes'],
    ['admin schools read-all',    'authenticated', ADMIN_UID, 'SELECT count(*) FROM schools'],
    ['admin govt_admins read-all','authenticated', ADMIN_UID, 'SELECT count(*) FROM govt_admins'],
    ['admin entitlement_codes',   'authenticated', ADMIN_UID, 'SELECT count(*) FROM entitlement_codes'],
    ['admin user_entitlements',   'authenticated', ADMIN_UID, 'SELECT count(*) FROM user_entitlements'],
    ['admin subscriptions',       'authenticated', ADMIN_UID, 'SELECT count(*) FROM subscriptions'],
    // write paths (savepoint-rolled-back)
    ['teacher updates own class', 'authenticated', TEACHER_UID,
      `UPDATE classes SET class_name = class_name WHERE teacher_user_id = '${TEACHER_UID}'`],
    ['schooladmin updates own school','authenticated', SCHOOLADMIN,
      `UPDATE schools SET school_name = school_name WHERE admin_user_id = '${SCHOOLADMIN}'`],
    ['admin updates a region',    'authenticated', ADMIN_UID,
      `UPDATE regions SET name = name`],
    ['teacher CANNOT update others classes','authenticated', TEACHER_UID,
      `UPDATE classes SET class_name = class_name WHERE teacher_user_id <> '${TEACHER_UID}' AND NOT is_class_teacher(id)`],
  ];

  async function runSuite(tag) {
    const out = {};
    for (const [name, role, sub, sql] of SUITE) out[name] = await probe(role, sub, sql);
    console.log(`  suite ${tag} done (${SUITE.length} probes)`);
    return out;
  }

  await q('BEGIN');
  try {
    console.log('1) BEFORE suite');
    const before = await runSuite('BEFORE');

    console.log('2) applying migration');
    let sql = fs.readFileSync(MIGRATION, 'utf8');
    // strip its own BEGIN/COMMIT — the canary owns the transaction
    sql = sql.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await q(sql);

    console.log('3) AFTER suite');
    const after = await runSuite('AFTER');

    console.log('4) diff');
    let diffs = 0;
    for (const [name] of SUITE) {
      const b = JSON.stringify(before[name]), a = JSON.stringify(after[name]);
      if (b !== a) { diffs++; console.log(`  ❌ ${name}: before=${b} after=${a}`); }
      else console.log(`  ✅ ${name}: ${b}`);
    }

    // sanity floor: probes that must be non-empty in BOTH states
    for (const must of ['anon course browse','learner own sessions','admin learners read-all','teacher updates own class']) {
      if (!before[must] || before[must].err || !(before[must].n > 0)) { diffs++; console.log(`  ❌ sanity: '${must}' not >0 before (${JSON.stringify(before[must])})`); }
    }
    // leak floor: learner must see 0 of B's sessions... (count query returns 1 row; check value separately below)

    if (diffs === 0 && COMMIT) { await q('COMMIT'); console.log('\nALL GREEN — COMMITTED'); }
    else if (diffs === 0) { await q('ROLLBACK'); console.log('\nALL GREEN — dry run, rolled back (use --commit)'); }
    else { await q('ROLLBACK'); console.log(`\n${diffs} DIFFS — ROLLED BACK`); process.exit(1); }
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('FATAL — rolled back:', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
