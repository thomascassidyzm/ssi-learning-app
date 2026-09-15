/**
 * Rollback-only canary for job #837: the additive Paddle mirror trigger must
 * never be the reason a real subscription write fails. Red against the
 * as-written trigger (RAISE EXCEPTION 'Paddle grant owner mismatch'), green
 * once the trigger warns and leaves the existing grant untouched.
 */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const dash = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean'
const { Client } = require(path.join(dash, 'node_modules/pg'))
const env = fs.readFileSync(path.join(dash, '.env.psql'), 'utf8')
const connectionString = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1].trim()
const db = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
async function main() {
  await db.connect()
  try {
    await db.query("BEGIN; SET LOCAL lock_timeout = '1s'; SET LOCAL statement_timeout = '15s'")
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260915_individual_grants_ledger.sql'), 'utf8')
      .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
    await db.query(migration)
    await db.query('SET LOCAL ROLE service_role')
    const learner = async () => (await db.query(
      `INSERT INTO public.learners(user_id,is_internal) VALUES ('cs-837-canary-' || gen_random_uuid(),true) RETURNING id`)).rows[0].id
    const a = await learner()
    const b = await learner()
    const ref = 'sub_cs837_shared'
    await db.query(`INSERT INTO public.subscriptions(learner_id,status,provider,provider_subscription_id,current_period_end)
      VALUES ($1,'active','paddle',$2,'2026-10-01')`, [a, ref])
    const grantsFor = async id => (await db.query(
      'SELECT * FROM public.user_entitlements WHERE learner_id=$1 AND source=$2', [id, 'paddle'])).rows
    assert.equal((await grantsFor(a)).length, 1, 'owner A has the mirrored grant')

    // The money write: a second learner carrying the same provider subscription
    // id. On main this is an ordinary webhook upsert; it must still succeed.
    await db.query(`INSERT INTO public.subscriptions(learner_id,status,provider,provider_subscription_id,current_period_end)
      VALUES ($1,'active','paddle',$2,'2026-11-01')`, [b, ref])
    const written = (await db.query(
      'SELECT current_period_end FROM public.subscriptions WHERE learner_id=$1', [b])).rows
    assert.equal(written.length, 1, 'the subscription write landed despite the ledger conflict')
    assert.equal((await grantsFor(b)).length, 0, 'no grant is stolen for the second learner')
    const ownerGrant = (await grantsFor(a))[0]
    assert.equal(ownerGrant.expires_at.toISOString(), '2026-10-01T00:00:00.000Z', "owner A's grant is untouched")

    // A renewal on the owner's own row still mirrors normally.
    await db.query(`UPDATE public.subscriptions SET current_period_end='2026-12-01' WHERE learner_id=$1`, [a])
    assert.equal((await grantsFor(a))[0].expires_at.toISOString(), '2026-12-01T00:00:00.000Z')
    console.log('PASS: mirror trigger is fail-soft on grant owner mismatch; owner grant intact; renewal still mirrors. ROLLBACK only.')
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
}
main().catch(error => { console.error('FAIL:', error.message); process.exitCode = 1 })
