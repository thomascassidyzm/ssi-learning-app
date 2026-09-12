#!/usr/bin/env node
/**
 * player_events totals behind job #307's env finding, with explicit bounds.
 *
 * Job #317 (2026-09-12). #307 published "10,965 staging rows against 94,513
 * production in the last fortnight" and "2,294 Chepstow production rows" with
 * neither the SQL nor the window, and Astra (#316·G) could not reproduce the
 * Chepstow figure (1,818 via classes.class_learner_id; 1,831 with payload
 * identities). This script prints every total with its population rule and
 * its UTC bounds so the numbers stop moving. READ ONLY: one transaction,
 * `set transaction read only`.
 *
 * Population rules (printed with each total):
 *   fleet-env      every row, grouped by env
 *   school-class   rows whose learner_id is a class account of --school
 *                  (classes.class_learner_id); pupils' and staff's own rows
 *                  are NOT included
 *   school-class+payload
 *                  school-class OR payload->>'learnerId' is one of those
 *                  class accounts (the unattributed boot rows, see #307)
 *   fleet-class    rows whose learner_id is ANY school's class account —
 *                  this is the rule that produces #307's 2,294
 *
 * Usage:
 *   node scripts/player-events-chepstow-totals-2026-09-12.cjs \
 *     --from 2026-08-29T00:00:00Z --to 2026-09-12T00:00:00Z \
 *     [--school 0f5bd6e4-f40b-4dbf-ac4f-a93478d20255]
 *   --from/--to  UTC ISO bounds, [from, to). Default: trailing 14 days to now,
 *                which is what #307 ran; the script prints the resolved bounds.
 *   --school     schools.id; default Ysgol Cas-gwent Chepstow School.
 */
const path = require('path')
const fs = require('fs')
const DASH = process.env.DASH || '/home/tomcassidy/SSi/ssi-dashboard-v7-clean'
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const TO = opt('--to', new Date().toISOString())
const FROM = opt('--from', new Date(new Date(TO).getTime() - 14 * 86400e3).toISOString())
const SCHOOL = opt('--school', '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255')

const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1]

const CLASS_ACCOUNTS = `select class_learner_id from classes where school_id = $3 and class_learner_id is not null`
const Q = {
  'fleet-env': `
    select env, count(*)::int n from player_events
    where occurred_at >= $1 and occurred_at < $2 group by env order by n desc`,
  'school-class': `
    select env, count(*)::int n, count(distinct learner_id)::int accounts from player_events pe
    where pe.learner_id in (${CLASS_ACCOUNTS})
      and occurred_at >= $1 and occurred_at < $2 group by env order by n desc`,
  'school-class+payload': `
    select env, count(*)::int n from player_events pe
    where (pe.learner_id in (${CLASS_ACCOUNTS})
        or pe.payload->>'learnerId' in (select class_learner_id::text from classes where school_id = $3 and class_learner_id is not null))
      and occurred_at >= $1 and occurred_at < $2 group by env order by n desc`,
  'fleet-class': `
    select s.school_name, pe.env, count(*)::int n from player_events pe
    join classes c on c.class_learner_id = pe.learner_id
    join schools s on s.id = c.school_id
    where occurred_at >= $1 and occurred_at < $2
    group by 1, 2 order by n desc`,
}

;(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  await c.query('set transaction read only')
  const { rows: [{ now, school_name }] } = await c.query(
    'select now(), (select school_name from schools where id = $1) school_name', [SCHOOL])
  console.log(`ran_at ${now.toISOString()}  window [${FROM}, ${TO})  school ${SCHOOL} (${school_name})`)
  for (const [rule, sql] of Object.entries(Q)) {
    const params = sql.includes('$3') ? [FROM, TO, SCHOOL] : [FROM, TO]
    const { rows } = await c.query(sql, params)
    console.log(`\n== ${rule}`)
    console.table(rows)
    if (rule === 'fleet-class') {
      const total = rows.reduce((a, r) => a + r.n, 0)
      console.log(`fleet-class total across all schools: ${total}`)
    }
  }
  await c.query('rollback')
  await c.end()
})().catch((e) => { console.error(e); process.exit(1) })
