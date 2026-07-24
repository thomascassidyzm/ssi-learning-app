#!/usr/bin/env node
/**
 * Canary for 20260724_backfill_meta_commentary_exposure.sql.gated
 *
 * Data backfill (no schema change): restore per-learner instruction exposure
 * in learner_meta_commentary_state from commentary_start telemetry + a
 * practice-minutes estimate, furthest-wins, idempotent.
 *
 * One transaction against the live shared DB:
 *   1. snapshot BEFORE: full copy of learner_meta_commentary_state into a
 *      temp table; RLS policy + grant posture fingerprint
 *   2. apply the migration BODY (its own BEGIN;/COMMIT; stripped — this
 *      script owns the transaction)
 *   3. assert: NO learner downgraded (index lowered or complete true→false);
 *      owner row (81987d60…) still complete=true; row/complete deltas match
 *      the independently-computed projection exactly; RLS posture unchanged
 *   4. replay the real app read path (MetaCommentaryService.syncFromServer:
 *      SELECT instruction_index, instructions_complete WHERE learner_id = own)
 *      as role `authenticated` with real JWT claims — own row visible,
 *      cross-learner rows invisible
 *   5. COMMIT only if --commit AND all assertions green; else ROLLBACK
 *
 * Usage: node canary_backfill_meta_commentary_exposure.cjs [--commit]
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const MIGRATION = path.join(__dirname, '..', 'migrations', '20260724_backfill_meta_commentary_exposure.sql.gated');
const COMMIT = process.argv.includes('--commit');
const OWNER_LEARNER = '81987d60-0c00-4553-8a36-79f83cdf1774';

let pass = 0, fail = 0;
const ok = (name, detail) => { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail) => { fail++; console.log(`  ❌ ${name} — ${detail}`); };

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);

  // role-replay probe: ALWAYS rolls back to the savepoint so SET LOCAL ROLE /
  // jwt claims never leak into later superuser assertions.
  async function asRole(role, sql, params, claims) {
    await q('SAVEPOINT p');
    try {
      if (claims) await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await q(`SET LOCAL ROLE ${role}`);
      const r = await q(sql, params);
      await q('ROLLBACK TO SAVEPOINT p');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return { error: e };
    }
  }

  const POSTURE_SQL = `
    SELECT md5(string_agg(x, '|' ORDER BY x)) AS fp FROM (
      SELECT 'policy:' || polname || ':' || pg_get_expr(polqual, polrelid) AS x
      FROM pg_policy WHERE polrelid = 'public.learner_meta_commentary_state'::regclass
      UNION ALL
      SELECT 'grant:' || grantee || ':' || privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'learner_meta_commentary_state'
    ) s`;

  try {
    await q('BEGIN');

    console.log('— snapshot BEFORE');
    await q(`CREATE TEMP TABLE canary_before ON COMMIT DROP AS
             SELECT * FROM public.learner_meta_commentary_state`);
    const before = (await q(`SELECT count(*) AS rows, count(*) FILTER (WHERE instructions_complete) AS complete
                             FROM canary_before`)).rows[0];
    const postureBefore = (await q(POSTURE_SQL)).rows[0].fp;
    console.log(`  rows=${before.rows} complete=${before.complete}`);

    // Independent projection of what the backfill SHOULD do (same rule,
    // computed against the snapshot) — the apply must match it exactly.
    const proj = (await q(`
      WITH telemetry AS (
        SELECT COALESCE(learner_id, user_id) AS learner_id,
               COUNT(DISTINCT payload->>'textPreview') AS heard_count
        FROM public.player_events
        WHERE event_type = 'commentary_start'
          AND payload->>'type' = 'instruction'
          AND COALESCE(learner_id, user_id) IS NOT NULL
        GROUP BY COALESCE(learner_id, user_id)
      ),
      practice AS (
        SELECT learner_id, SUM(total_practice_minutes) AS total_minutes
        FROM public.course_enrollments GROUP BY learner_id
      ),
      evidence AS (
        SELECT l.id AS learner_id,
               GREATEST(COALESCE(t.heard_count, 0),
                        LEAST(FLOOR(COALESCE(p.total_minutes, 0) / 10.0)::int, 30)) AS derived
        FROM public.learners l
        LEFT JOIN telemetry t ON t.learner_id = l.id
        LEFT JOIN practice  p ON p.learner_id = l.id
        WHERE COALESCE(t.heard_count, 0) > 0 OR COALESCE(p.total_minutes, 0) >= 30
      )
      SELECT count(*) FILTER (WHERE b.learner_id IS NULL) AS new_rows,
             count(*) FILTER (WHERE b.learner_id IS NOT NULL AND e.derived > b.instruction_index) AS upgraded,
             count(*) FILTER (WHERE e.derived >= 30 AND (b.learner_id IS NULL OR NOT b.instructions_complete)) AS newly_complete
      FROM evidence e LEFT JOIN canary_before b ON b.learner_id = e.learner_id`)).rows[0];
    console.log(`  projection: new_rows=${proj.new_rows} upgraded=${proj.upgraded} newly_complete=${proj.newly_complete}`);

    console.log('— applying migration body (BEGIN/COMMIT stripped; this txn owns it)');
    const body = fs.readFileSync(MIGRATION, 'utf8')
      .split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;\s*$/.test(l)).join('\n');
    if (/^\s*(BEGIN|COMMIT)\s*;/m.test(body)) throw new Error('BEGIN/COMMIT still present after strip — refusing');
    await q(body);

    console.log('— assertions');
    const after = (await q(`SELECT count(*) AS rows, count(*) FILTER (WHERE instructions_complete) AS complete
                            FROM public.learner_meta_commentary_state`)).rows[0];

    // 1. no downgrade, any learner
    const downgrades = (await q(`
      SELECT b.learner_id FROM canary_before b
      JOIN public.learner_meta_commentary_state a ON a.learner_id = b.learner_id
      WHERE a.instruction_index < b.instruction_index
         OR (b.instructions_complete AND NOT a.instructions_complete)`)).rows;
    downgrades.length === 0
      ? ok('no learner downgraded (index lowered or complete revoked)')
      : bad('downgrades found', JSON.stringify(downgrades));

    // 2. no row vanished
    const lost = (await q(`
      SELECT count(*) AS n FROM canary_before b
      WHERE NOT EXISTS (SELECT 1 FROM public.learner_meta_commentary_state a WHERE a.learner_id = b.learner_id)`)).rows[0];
    lost.n === '0' ? ok('no pre-existing row lost') : bad('rows lost', lost.n);

    // 3. owner row protected
    const owner = (await q(`SELECT instruction_index, instructions_complete
                            FROM public.learner_meta_commentary_state WHERE learner_id = $1`, [OWNER_LEARNER])).rows[0];
    owner && owner.instructions_complete
      ? ok('owner row still instructions_complete=true', `index now ${owner.instruction_index}`)
      : bad('owner row', JSON.stringify(owner));

    // 4. deltas match the independent projection exactly
    const rowDelta = Number(after.rows) - Number(before.rows);
    const completeDelta = Number(after.complete) - Number(before.complete);
    rowDelta === Number(proj.new_rows)
      ? ok(`row delta matches projection`, `${before.rows} → ${after.rows} (+${rowDelta})`)
      : bad('row delta', `expected +${proj.new_rows}, got +${rowDelta}`);
    completeDelta === Number(proj.newly_complete)
      ? ok(`complete delta matches projection`, `${before.complete} → ${after.complete} (+${completeDelta})`)
      : bad('complete delta', `expected +${proj.newly_complete}, got +${completeDelta}`);

    // 5. RLS posture untouched
    const postureAfter = (await q(POSTURE_SQL)).rows[0].fp;
    postureAfter === postureBefore
      ? ok('RLS policies + grants fingerprint unchanged')
      : bad('RLS posture changed', `${postureBefore} → ${postureAfter}`);

    // 6. idempotency: re-running the body changes nothing
    const pre2 = (await q(`SELECT md5(string_agg(learner_id::text || ':' || instruction_index || ':' || instructions_complete, '|' ORDER BY learner_id)) AS fp
                           FROM public.learner_meta_commentary_state`)).rows[0].fp;
    await q(body);
    const post2 = (await q(`SELECT md5(string_agg(learner_id::text || ':' || instruction_index || ':' || instructions_complete, '|' ORDER BY learner_id)) AS fp
                            FROM public.learner_meta_commentary_state`)).rows[0].fp;
    pre2 === post2 ? ok('idempotent: second run is a no-op') : bad('NOT idempotent', `${pre2} → ${post2}`);

    // 7. replay the real read path as `authenticated` (MetaCommentaryService.syncFromServer)
    console.log('— replaying app read path as authenticated');
    const ownerUid = (await q(`SELECT user_id FROM public.learners WHERE id = $1`, [OWNER_LEARNER])).rows[0].user_id;
    const otherLearner = (await q(`
      SELECT l.id, l.user_id FROM public.learner_meta_commentary_state s
      JOIN public.learners l ON l.id = s.learner_id
      WHERE l.id <> $1 AND l.user_id IS NOT NULL AND l.user_id <> $2 LIMIT 1`,
      [OWNER_LEARNER, ownerUid])).rows[0];

    const own = await asRole('authenticated',
      `SELECT instruction_index, instructions_complete FROM public.learner_meta_commentary_state WHERE learner_id = '${OWNER_LEARNER}'`,
      undefined, { sub: ownerUid, role: 'authenticated' });
    own.rows && own.rowCount === 1 && own.rows[0].instructions_complete
      ? ok('owner reads own row via RLS', `index=${own.rows[0].instruction_index} complete=true`)
      : bad('owner own-row read', own.error ? own.error.message : JSON.stringify(own.rows));

    const cross = await asRole('authenticated',
      `SELECT * FROM public.learner_meta_commentary_state WHERE learner_id = '${OWNER_LEARNER}'`,
      undefined, { sub: otherLearner.user_id, role: 'authenticated' });
    cross.rows && cross.rowCount === 0
      ? ok('cross-learner read sees nothing (RLS holds)')
      : bad('cross-learner leak', cross.error ? cross.error.message : `${cross.rowCount} rows visible`);

    const other = await asRole('authenticated',
      `SELECT instruction_index FROM public.learner_meta_commentary_state WHERE learner_id = '${otherLearner.id}'`,
      undefined, { sub: otherLearner.user_id, role: 'authenticated' });
    other.rows && other.rowCount === 1
      ? ok('second learner reads own (backfilled) row via RLS', `index=${other.rows[0].instruction_index}`)
      : bad('second learner own-row read', other.error ? other.error.message : JSON.stringify(other.rows));

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail === 0 && COMMIT) {
      await q('COMMIT');
      console.log('COMMITTED ✅');
    } else {
      await q('ROLLBACK');
      console.log(COMMIT ? 'ROLLED BACK — assertions failed ❌' : 'ROLLED BACK (dry run — pass --commit to apply)');
    }
  } catch (e) {
    try { await q('ROLLBACK'); } catch { /* already gone */ }
    console.error('CANARY ABORTED, ROLLED BACK:', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
