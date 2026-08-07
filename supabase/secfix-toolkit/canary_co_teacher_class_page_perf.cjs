#!/usr/bin/env node
// canary_co_teacher_class_page_perf.cjs
//
// Canary for supabase/migrations/20260807_co_teacher_class_page_perf.sql.
//
// Method, per the RLS doctrine in CLAUDE.md: apply the migration inside ONE
// transaction, replay real app reads as real principals BEFORE and AFTER,
// assert (a) leak-closed — nobody gained a row, (b) every legit path alive —
// nobody lost a row, (c) the reported timeout is actually gone, then COMMIT
// iff green.
//
//   node supabase/secfix-toolkit/canary_co_teacher_class_page_perf.cjs        # dry run
//   APPLY=1 node supabase/secfix-toolkit/canary_co_teacher_class_page_perf.cjs # commit iff green
//
// Probe scope note (honest, so nobody reads more into a green than it earns):
// user_tags, learners and course_enrollments are compared in FULL. The three
// big learner-data tables (sessions 16.8k, seed_progress 37k, lego_progress
// 129k) are compared over a fixed learner SAMPLE — every learner in the two
// probe classes plus a deterministic 40-learner slice. Comparing them in full
// means ~130k evaluations of the pre-fix can_view_learner_data per principal
// per table, which is the very slowness under test and would run for the best
// part of an hour. The sample exercises the same predicate on the rows that
// can actually change.
const fs = require('fs'), path = require('path');
const DASH = '/home/tomcassidy/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));
const m = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8').match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
const MIG = process.env.MIGRATION ||
  path.join(__dirname, '..', 'migrations', '20260807_co_teacher_class_page_perf.sql');
const PATCH = fs.readFileSync(MIG, 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');  // we own the transaction
const APPLY = process.env.APPLY === '1';

// The class from the failing production run.
const CLASS = 'ea59ef42-ab29-46d0-a956-a4fdbe5e1d09';

const PRINCIPALS = [
  ['co-teacher (Bethan, the bug)',   'b1498ada-2943-4dd9-9ad3-d2820997d772'],
  ['school admin (Angharad)',        '1b13d17a-8b6a-4458-9ce1-28e72f0d03a3'],
  ['school admin (real school)',     'e68e031c-65a0-46f0-82ac-05c32825a292'],
  ['lead teacher A',                 '008e7fea-4b71-4cdb-90ae-dcc587319577'],
  ['lead teacher B',                 '02c04a58-a780-4c17-acaf-99a6eaebf2e4'],
  ['lead teacher C',                 '18a17b9f-f7df-4312-a66c-bca5e8d50468'],
  ['lead teacher D',                 '18f02b35-4316-4fda-87cc-f91723c3c7c1'],
  ['co-teacher (other, non-lead 1)', '40ac64bf-f627-4a3f-a03f-e9480b97ce42'],
  ['co-teacher (other, non-lead 2)', 'd2bc531d-8b13-4c38-acbf-ce8bcca16fc0'],
  ['govt admin A',                   'c2d41dec-981f-442f-b4a4-4d5643705a6c'],
  ['govt admin B',                   'fa7d92c7-0dd7-4fe8-869e-ae9658f8c397'],
  ['student A',                      '439d8a79-d643-48ef-8f4c-9d254f0bc414'],
  ['student B',                      'e73e5391-698e-4ed9-a2b1-d9cf6acfac41'],
  ['student C',                      'c4974f33-fc8f-4af1-9483-2ea7a69abe21'],
  ['stranger (no rows anywhere)',    '00000000-0000-0000-0000-000000000001'],
];

const SAMPLE = `SELECT id FROM sample_learners`;
const PROBES = {
  user_tags:              `SELECT string_agg(id::text, ',' ORDER BY id::text) v FROM user_tags`,
  learners:               `SELECT string_agg(id::text, ',' ORDER BY id::text) v FROM learners`,
  course_enrollments:     `SELECT string_agg(id::text, ',' ORDER BY id::text) v FROM course_enrollments`,
  sessions_sample:        `SELECT string_agg(id::text, ',' ORDER BY id::text) v FROM sessions       WHERE learner_id IN (${SAMPLE})`,
  seed_progress_sample:   `SELECT string_agg(id::text, ',' ORDER BY id::text) v FROM seed_progress  WHERE learner_id IN (${SAMPLE})`,
  lego_progress_sample:   `SELECT string_agg(id::text, ',' ORDER BY id::text) v FROM lego_progress  WHERE learner_id IN (${SAMPLE})`,
  class_student_progress: `SELECT string_agg(learner_id::text, ',' ORDER BY learner_id::text) v FROM class_student_progress`,
  class_activity_stats:   `SELECT string_agg(class_id::text,   ',' ORDER BY class_id::text)   v FROM class_activity_stats`,
};

async function asPrincipal(c, uid, fn) {
  await c.query(`SET LOCAL role authenticated`);
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated' })]);
  return await fn().finally(() => c.query(`RESET ROLE`).catch(() => {}));
}

async function snapshot(c) {
  const out = {};
  for (const [label, uid] of PRINCIPALS) {
    out[label] = await asPrincipal(c, uid, async () => {
      const row = {};
      for (const [k, q] of Object.entries(PROBES)) {
        try { row[k] = (await c.query(q)).rows[0].v || ''; }
        catch (e) { throw new Error(`probe ${k} as ${uid}: ${e.message}`); }
      }
      return row;
    });
  }
  return out;
}

async function timeClassPage(c, uid) {
  return asPrincipal(c, uid, async () => {
    const t0 = Date.now();
    await c.query(`SELECT * FROM class_student_progress WHERE class_id = $1`, [CLASS]);
    await c.query(`SELECT * FROM class_activity_stats   WHERE class_id = $1`, [CLASS]);
    return Date.now() - t0;
  });
}

(async () => {
  const c = new Client({ connectionString: m[1], ssl: { rejectUnauthorized: false } });
  await c.connect();
  let green = false;
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL statement_timeout = '300s'`);

    // Deterministic learner sample: everyone in the probe classes, plus a
    // stable slice of the rest. Built once, reused by both snapshots.
    await c.query(`
      CREATE TEMP TABLE sample_learners ON COMMIT DROP AS
        SELECT id FROM (
          SELECT l.id FROM learners l
           WHERE l.user_id IN (SELECT ut.user_id FROM user_tags ut
                                WHERE ut.tag_type = 'class' AND ut.removed_at IS NULL)
           ORDER BY l.id LIMIT 60) a
        UNION
        SELECT id FROM (SELECT id FROM learners ORDER BY id LIMIT 40) b`);
    await c.query(`GRANT SELECT ON sample_learners TO authenticated`);
    const n = (await c.query(`SELECT count(*)::int n FROM sample_learners`)).rows[0].n;

    const beforeCo    = await timeClassPage(c, PRINCIPALS[0][1]);
    const beforeAdmin = await timeClassPage(c, PRINCIPALS[1][1]);
    const before      = await snapshot(c);

    await c.query(PATCH);

    const afterCo    = await timeClassPage(c, PRINCIPALS[0][1]);
    const afterAdmin = await timeClassPage(c, PRINCIPALS[1][1]);
    const after      = await snapshot(c);

    const diffs = [];
    for (const [label] of PRINCIPALS)
      for (const k of Object.keys(PROBES)) {
        const b = before[label][k], a = after[label][k];
        if (b === a) continue;
        const bs = new Set(b ? b.split(',') : []), as = new Set(a ? a.split(',') : []);
        diffs.push({
          principal: label, probe: k,
          gained: [...as].filter(x => !bs.has(x)),
          lost:   [...bs].filter(x => !as.has(x)),
        });
      }

    console.log(`sample_learners: ${n} learners\n`);
    console.log('--- visible-row parity: 15 principals x 8 surfaces ---');
    if (!diffs.length)
      console.log('IDENTICAL on every surface for every principal. No row gained, no row lost.');
    else
      console.log(JSON.stringify(diffs.map(d => ({ ...d, gained: d.gained.length, lost: d.lost.length,
        sampleGained: d.gained.slice(0, 3), sampleLost: d.lost.slice(0, 3) })), null, 1));

    console.log('\n--- the failing page: both views, one load ---');
    console.log(`co-teacher   : ${beforeCo} ms  ->  ${afterCo} ms`);
    console.log(`school admin : ${beforeAdmin} ms  ->  ${afterAdmin} ms`);

    // Every-legit-path-alive: the co-teacher's own class page must still read.
    const live = await asPrincipal(c, PRINCIPALS[0][1], async () => ({
      classTeachers: (await c.query(`SELECT count(*)::int n FROM class_teachers WHERE class_id=$1`, [CLASS])).rows[0].n,
      joinCode:      (await c.query(`SELECT student_join_code FROM classes WHERE id=$1`, [CLASS])).rows[0]?.student_join_code,
      roster:        (await c.query(`SELECT count(*)::int n FROM user_tags WHERE tag_value='CLASS:'||$1`, [CLASS])).rows[0].n,
    }));
    console.log(`\nco-teacher live reads: class_teachers=${live.classTeachers}, ` +
                `join_code=${live.joinCode}, class tags visible=${live.roster}`);

    green = diffs.length === 0
         && afterCo < 500 && afterAdmin < 500
         && live.classTeachers === 2 && !!live.joinCode;
    console.log(`\nVERDICT: ${green ? 'GREEN' : 'RED'}`);

    if (green && APPLY) { await c.query('COMMIT'); console.log('COMMITTED to the live database.'); }
    else { await c.query('ROLLBACK'); console.log(APPLY ? 'ROLLED BACK — not green.' : 'ROLLED BACK — dry run. Set APPLY=1 to commit.'); }
    if (!green) process.exitCode = 1;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('CANARY ERROR:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
