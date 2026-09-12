#!/usr/bin/env node
/**
 * Backfill player_events rows whose learner is in the payload but not on the row.
 *
 * Job #307 (2026-09-12). The client stamps `payload.learnerId` into every
 * event; the server attributes `learner_id` / `user_id` only from a verified
 * bearer (SEC25 INPUT-04). A tab-hide or unmount inside the first seconds of
 * a session flushed boot events before the bearer cache was primed, so they
 * landed with a null learner. The write path is fixed in the same job; this
 * repairs the rows it left behind.
 *
 * A row is repaired ONLY when the payload learner is provably right:
 *   - learner_id IS NULL and user_id IS NULL;
 *   - payload->>'learnerId' is a uuid that exists in learners.id;
 *   - the SAME session_id has at least one attributed row whose learner_id
 *     equals that payload learner (session corroboration).
 * A guest session that happened to carry a stale learnerId has no attributed
 * sibling and is never touched — that is exactly the case the security rule
 * exists for.
 *
 * Both dual-write columns are set (user_id is the legacy name and holds the
 * learner pk; see migration 20260619_player_events_learner_id_expand.sql).
 *
 * Usage:
 *   node scripts/backfill-player-events-orphan-learner-2026-09-12.cjs            # DRY RUN (default)
 *   node scripts/backfill-player-events-orphan-learner-2026-09-12.cjs --apply    # write, in one txn
 *   --days N      window on occurred_at (default 30)
 *   --learner ID  restrict to one payload learner
 *   --log PATH    where to write the per-row log (default $CS_SCRATCH or cwd)
 *
 * Per-row before-state is re-asserted inside the UPDATE's WHERE, so a row
 * that changed under us is skipped, never overwritten; the txn aborts if the
 * updated count differs from the dry-run candidate count.
 */
const fs = require('fs')
const path = require('path')
const DASH = process.env.DASH || '/home/tomcassidy/SSi/ssi-dashboard-v7-clean'
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const APPLY = flag('--apply')
const DAYS = Number(opt('--days', '30'))
const LEARNER = opt('--learner', null)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG = opt('--log', path.join(process.env.CS_SCRATCH || process.cwd(),
  `backfill-orphan-learner-${APPLY ? 'applied' : 'dryrun'}-${stamp}.json`))

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1]

const CANDIDATES = `
  select p.id, p.occurred_at, p.event_type, p.session_id, p.env,
         (p.payload->>'learnerId')::uuid as payload_learner,
         (select min(s.id) from player_events s
            where s.session_id = p.session_id and s.learner_id = (p.payload->>'learnerId')::uuid) as corroborating_sibling
  from player_events p
  where p.learner_id is null and p.user_id is null
    and p.payload->>'learnerId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p.occurred_at > now() - ($1 || ' days')::interval
    and ($2::uuid is null or (p.payload->>'learnerId')::uuid = $2::uuid)
    and exists (select 1 from learners l where l.id = (p.payload->>'learnerId')::uuid)
    and exists (select 1 from player_events s
                where s.session_id = p.session_id and s.learner_id = (p.payload->>'learnerId')::uuid)
  order by p.occurred_at`

;(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  if (!APPLY) await c.query('set transaction read only')
  const { rows } = await c.query(CANDIDATES, [String(DAYS), LEARNER])
  const byLearner = {}
  for (const r of rows) byLearner[r.payload_learner] = (byLearner[r.payload_learner] || 0) + 1
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} candidate rows in the last ${DAYS} days${LEARNER ? ` for ${LEARNER}` : ''}`)
  console.table(byLearner)
  let updated = 0
  if (APPLY && rows.length) {
    const ids = rows.map((r) => r.id)
    const res = await c.query(
      `update player_events p
          set learner_id = (p.payload->>'learnerId')::uuid,
              user_id    = (p.payload->>'learnerId')::uuid
        where p.id = any($1::bigint[])
          and p.learner_id is null and p.user_id is null
          and exists (select 1 from player_events s
                      where s.session_id = p.session_id and s.learner_id = (p.payload->>'learnerId')::uuid)
        returning p.id, p.learner_id`,
      [ids],
    )
    updated = res.rowCount
    if (updated !== rows.length) {
      await c.query('rollback')
      console.error(`ABORT: expected ${rows.length} updates, got ${updated} — rows changed under us; rolled back`)
      process.exit(2)
    }
    await c.query('commit')
  } else {
    await c.query('rollback')
  }
  fs.writeFileSync(LOG, JSON.stringify({ mode: APPLY ? 'applied' : 'dryrun', days: DAYS, learner: LEARNER,
    candidates: rows.length, updated, rows }, null, 2))
  console.log(`${APPLY ? `updated ${updated}` : 'no writes'}; log: ${LOG}`)
  await c.end()
})().catch((e) => { console.error(e); process.exit(1) })
