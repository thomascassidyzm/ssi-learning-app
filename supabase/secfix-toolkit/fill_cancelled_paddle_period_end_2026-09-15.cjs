/**
 * Job #851, task 2. The twelve cancelled Paddle subscriptions carry a NULL
 * current_period_end, so the #837 mirror trigger cannot migrate them into the
 * grants ledger (a missing period must never become a lifetime grant). Paddle
 * nulls current_billing_period on a canceled subscription, so the real end of
 * the last paid period comes from that subscription's last COMPLETED
 * transaction: details -> billing_period.ends_at. All twelve are in the past.
 *
 *   node ...fill_cancelled_paddle_period_end_2026-09-15.cjs            # dry run
 *   node ...fill_cancelled_paddle_period_end_2026-09-15.cjs --apply    # one txn
 *
 * Per-row before-state assertions: the row must still be provider=paddle,
 * status='cancelled' and current_period_end IS NULL, or the whole run aborts.
 * The UPDATE fires the mirror trigger; with cancel_at_period_end=false it is
 * not a refund signature, so it writes a grant expiring on the filled (past)
 * date. The applied log asserts no grant opens.
 */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const dash = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean'
const { Client } = require(path.join(dash, 'node_modules/pg'))
const connectionString = fs
  .readFileSync(path.join(dash, '.env.psql'), 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1]
  .trim()
const APPLY = process.argv.includes('--apply')
const periods = JSON.parse(fs.readFileSync(path.join(__dirname, 'paddle_period_end_2026-09-15-source.json'), 'utf8'))
const db = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await db.connect()
  const log = []
  try {
    await db.query("BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'")
    for (const row of periods) {
      const before = (
        await db.query(
          `SELECT id, learner_id, status, provider, current_period_end, cancel_at_period_end
             FROM public.subscriptions WHERE provider_subscription_id = $1 FOR UPDATE`,
          [row.subscription_id]
        )
      ).rows
      assert.equal(before.length, 1, `exactly one row for ${row.subscription_id}`)
      const b = before[0]
      assert.equal(b.provider, 'paddle', 'still a paddle row')
      assert.equal(b.status, 'cancelled', 'still cancelled')
      assert.equal(b.current_period_end, null, 'period end still null')
      assert.ok(new Date(row.period_end) < new Date(), 'the filled period end is in the past')
      assert.equal(row.paddle_status, 'canceled', 'Paddle agrees the subscription is canceled')
      await db.query(`UPDATE public.subscriptions SET current_period_end = $2 WHERE id = $1`, [b.id, row.period_end])
      const grant = (
        await db.query(
          `SELECT expires_at, revoked_at FROM public.user_entitlements
            WHERE source='paddle' AND source_ref=$1 AND learner_id=$2`,
          [row.subscription_id, b.learner_id]
        )
      ).rows[0]
      assert.ok(grant, 'the mirror trigger wrote the grant')
      assert.ok(new Date(grant.expires_at) < new Date(), 'the grant expires in the past — no access opens')
      log.push({
        subscription_id: row.subscription_id,
        sub_row: b.id,
        learner_id: b.learner_id,
        before_current_period_end: null,
        after_current_period_end: row.period_end,
        source: row.source,
        grant_expires_at: grant.expires_at,
        grant_revoked_at: grant.revoked_at,
        grant_opens_access: false,
      })
    }
    const stillOpen = (
      await db.query(`SELECT count(*)::int n FROM public.subscriptions s
         JOIN public.user_entitlements e ON e.source='paddle' AND e.source_ref=s.provider_subscription_id
         WHERE s.provider='paddle' AND s.status<>'active' AND e.revoked_at IS NULL AND e.expires_at > now()`)
    ).rows[0].n
    assert.equal(stillOpen, 0, 'no non-active Paddle subscription holds an open grant')
    if (APPLY) await db.query('COMMIT')
    else await db.query('ROLLBACK')
    const file = path.join(__dirname, `fill_cancelled_paddle_period_end_2026-09-15-${APPLY ? 'applied' : 'dryrun'}-log.json`)
    fs.writeFileSync(file, JSON.stringify(log, null, 1))
    console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${log.length} rows, no grant opens. ${file}`)
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    await db.end()
  }
}
main().catch(error => {
  console.error('ABORTED:', error.message)
  process.exitCode = 1
})
