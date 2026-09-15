/**
 * Rollback-only canary for job #851: a FULL Paddle refund written by
 * production (main, ea0683f) must close the mirrored individual grant.
 *
 * Main's refund writer sets only `status='cancelled', cancel_at_period_end=true,
 * updated_at=now()`; it cannot write paddle_revoked_at. Red against the #837
 * trigger as it stands (grant stays open until current_period_end), green once
 * 20260915d_paddle_refund_revokes_grant.sql is in place.
 *
 *   node supabase/secfix-toolkit/canary_851_refund_revokes_grant.cjs        # green: applies the fix in-txn
 *   node supabase/secfix-toolkit/canary_851_refund_revokes_grant.cjs --pre  # red:   live trigger, no fix
 *
 * Everything runs in one transaction and is ROLLED BACK. Nothing is committed.
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
const APPLY_FIX = !process.argv.includes('--pre')
const db = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await db.connect()
  try {
    await db.query("BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '20s'")
    if (APPLY_FIX) {
      const fix = fs
        .readFileSync(path.join(__dirname, '../migrations/20260915d_paddle_refund_revokes_grant.sql'), 'utf8')
        .replace(/^BEGIN;$/m, '')
        .replace(/^COMMIT;$/m, '')
        .replace(/^SET LOCAL lock_timeout.*$/m, '')
        .replace(/^NOTIFY pgrst.*$/m, '')
      await db.query(fix)
    }
    await db.query('SET LOCAL ROLE service_role')

    const learner = async () =>
      (
        await db.query(
          `INSERT INTO public.learners(user_id,is_internal) VALUES ('cs-851-canary-' || gen_random_uuid(),true) RETURNING id`
        )
      ).rows[0].id
    const grantOf = async ref =>
      (
        await db.query(
          `SELECT expires_at, revoked_at FROM public.user_entitlements WHERE source='paddle' AND source_ref=$1`,
          [ref]
        )
      ).rows[0]
    const future = '2027-09-14T20:18:09.019Z'
    const newSub = async (id, ref, extra = {}) => {
      await db.query(
        `INSERT INTO public.subscriptions(learner_id,status,provider,provider_subscription_id,provider_customer_id,plan_id,plan_name,current_period_end,cancel_at_period_end)
         VALUES ($1,'active','paddle',$2,'ctm_851','pri_851','SSi Premium',$3,$4)`,
        [id, ref, future, !!extra.cancelAtPeriodEnd]
      )
    }

    // 1. THE HOLE. An annual subscriber is fully refunded. Main's exact write.
    const a = await learner()
    await newSub(a, 'sub_cs851_refund')
    assert.equal((await grantOf('sub_cs851_refund')).revoked_at, null, 'active subscriber holds an open grant')
    await db.query(
      `UPDATE public.subscriptions SET status='cancelled', cancel_at_period_end=true, updated_at=now() WHERE learner_id=$1`,
      [a]
    )
    const refunded = await grantOf('sub_cs851_refund')
    assert.notEqual(refunded.revoked_at, null, 'THE FIX: a full refund closes the grant immediately')

    // 2. A period-end cancellation must be untouched — access to the paid end.
    //    Main writes it as cancelled with cancel_at_period_end=false.
    const b = await learner()
    await newSub(b, 'sub_cs851_periodend', { cancelAtPeriodEnd: true })
    await db.query(
      `UPDATE public.subscriptions SET status='cancelled', cancel_at_period_end=false, updated_at=now() WHERE learner_id=$1`,
      [b]
    )
    const periodEnd = await grantOf('sub_cs851_periodend')
    assert.equal(periodEnd.revoked_at, null, 'a period-end cancellation keeps access to the paid period end')
    assert.equal(periodEnd.expires_at.toISOString(), future, 'and keeps its expiry')

    // 3. An ordinary renewal must be untouched.
    const c = await learner()
    await newSub(c, 'sub_cs851_renewal')
    await db.query(
      `UPDATE public.subscriptions SET current_period_end='2028-01-01T00:00:00Z', updated_at=now() WHERE learner_id=$1`,
      [c]
    )
    const renewed = await grantOf('sub_cs851_renewal')
    assert.equal(renewed.revoked_at, null, 'a renewal leaves the grant open')
    assert.equal(renewed.expires_at.toISOString(), '2028-01-01T00:00:00.000Z', 'and moves the expiry out')

    // 4. A reverse adjustment (refund reversed) re-opens access. Main writes
    //    status='active', cancel_at_period_end=false.
    await db.query(
      `UPDATE public.subscriptions SET status='active', cancel_at_period_end=false, updated_at=now() WHERE learner_id=$1`,
      [a]
    )
    assert.equal((await grantOf('sub_cs851_refund')).revoked_at, null, 'a reversed refund re-opens the grant')

    // 5. The seven live active subscribers must resolve identically.
    const live = await db.query(
      `SELECT s.provider_subscription_id, e.expires_at, e.revoked_at FROM public.subscriptions s
       JOIN public.user_entitlements e ON e.source='paddle' AND e.source_ref=s.provider_subscription_id
       WHERE s.provider='paddle' AND s.status='active'
         AND s.provider_subscription_id NOT LIKE 'sub_cs851%' ORDER BY 1`
    )
    assert.equal(live.rows.length, 7, 'seven live Paddle subscribers')
    assert.equal(live.rows.filter(r => r.revoked_at).length, 0, 'no live subscriber is revoked by this change')

    console.log('PASS: refund closes the grant; period-end cancel, renewal and reversal untouched; 7 live subscribers unaffected. ROLLBACK only.')
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
}
main().catch(error => {
  console.error('FAIL:', error.message)
  process.exitCode = 1
})
