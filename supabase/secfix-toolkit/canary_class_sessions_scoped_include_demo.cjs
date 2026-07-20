#!/usr/bin/env node
/**
 * Canary apply: 20260719_class_sessions_scoped_include_demo.sql
 *
 * Protocol (RLS doctrine rule 3 — no DB change without a canary run):
 *   1. PRE: snapshot the 2-arg behaviour — demo class rows (expect 0), and a
 *      real class with recent sessions (expect >0) as the legit-path probe.
 *   2. Apply the migration inside ONE transaction.
 *   3. REPLAY inside the txn:
 *      a. old call shape (named 2-arg) on the real class — row count must
 *         EQUAL the pre-apply count (existing caller byte-identical);
 *      b. old call shape on the demo class — still 0 (default excludes demo);
 *      c. new p_include_demo=true on the demo class — rows appear (>0);
 *      d. p_include_demo=true on the real class — count unchanged (the flag
 *         only ADDS demo rows, never changes real ones).
 *   4. COMMIT iff every assertion holds; ROLLBACK otherwise.
 *
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 * Run: node supabase/secfix-toolkit/canary_class_sessions_scoped_include_demo.cjs
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '20260719_class_sessions_scoped_include_demo.sql'),
  'utf8',
);

const DEMO_CLASS = 'e2bbe2de-cada-4aed-908a-4b36d26ca95c'; // Grade 6A, Sunrise (IME demo)

async function count(c, sql, params) {
  const r = await c.query(sql, params);
  return r.rows.length;
}

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // ── 1. PRE ──
    const realClassRow = await c.query(`
      SELECT s.class_id, count(*) AS n
      FROM class_sessions s
      JOIN classes cl ON cl.id = s.class_id
      LEFT JOIN schools sc ON sc.id = cl.school_id
      WHERE COALESCE(sc.is_demo, false) = false
        AND s.started_at >= now() - interval '90 days'
      GROUP BY s.class_id ORDER BY n DESC LIMIT 1`);
    const realClass = realClassRow.rows[0]?.class_id ?? null;
    console.log('[pre] real probe class:', realClass, 'sessions:', realClassRow.rows[0]?.n ?? 0);

    const q2 = (id) => count(c, `SELECT * FROM analytics_class_sessions_scoped($1::uuid[], 90)`, [[id]]);
    const q3 = (id, inc) => count(c, `SELECT * FROM analytics_class_sessions_scoped($1::uuid[], 90, $2)`, [[id], inc]);

    const preDemo = await q2(DEMO_CLASS);
    const preReal = realClass ? await q2(realClass) : null;
    console.log('[pre] 2-arg demo rows:', preDemo, '| 2-arg real rows:', preReal);
    if (preDemo !== 0) throw new Error(`pre: expected 0 demo rows via old exclusion, got ${preDemo}`);

    // ── 2+3. Apply + replay in one txn ──
    await c.query('BEGIN');
    await c.query(MIGRATION);

    const postDemoDefault = await q2(DEMO_CLASS);
    const postDemoInc = await q3(DEMO_CLASS, true);
    const postReal = realClass ? await q2(realClass) : null;
    const postRealInc = realClass ? await q3(realClass, true) : null;
    console.log('[replay] 2-arg demo:', postDemoDefault, '| include_demo demo:', postDemoInc,
      '| 2-arg real:', postReal, '| include_demo real:', postRealInc);

    const failures = [];
    if (postDemoDefault !== 0) failures.push(`default still excludes demo: expected 0, got ${postDemoDefault}`);
    if (postDemoInc <= 0) failures.push('include_demo=true returned no demo rows');
    if (realClass !== null && postReal !== preReal) failures.push(`real-class 2-arg changed: ${preReal} -> ${postReal}`);
    if (realClass !== null && postRealInc !== preReal) failures.push(`real-class include_demo changed: ${preReal} -> ${postRealInc}`);

    if (failures.length) {
      await c.query('ROLLBACK');
      console.error('CANARY FAILED — rolled back:\n  ' + failures.join('\n  '));
      process.exit(1);
    }
    await c.query('COMMIT');
    console.log('CANARY GREEN — committed. Demo rows via opt-in:', postDemoInc);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('CANARY ERROR — rolled back:', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
