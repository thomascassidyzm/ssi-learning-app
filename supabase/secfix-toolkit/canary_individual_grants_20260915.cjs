/** Rollback-only canary: additive migration, real SQL and fixture-only writes. */
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
    await db.query('BEGIN; SET LOCAL lock_timeout = \'1s\'; SET LOCAL statement_timeout = \'10s\'')
    const before = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.user_entitlements'::regclass`)).rows[0]
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260915_individual_grants_ledger.sql'), 'utf8')
      .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
    await db.query(migration)
    const after = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.user_entitlements'::regclass`)).rows[0]
    assert.deepEqual(after, before)
    await db.query('SET LOCAL ROLE service_role')
    const learner = (await db.query(`INSERT INTO public.learners(user_id,is_internal) VALUES ('cs-812-canary-' || gen_random_uuid(),true) RETURNING id`)).rows[0].id
    const sub = (await db.query(`INSERT INTO public.subscriptions(learner_id,status,provider,provider_subscription_id,current_period_end)
      VALUES ($1,'active','paddle','sub_cs812_canary','2026-10-01') RETURNING id`, [learner])).rows[0].id
    const read = async source => (await db.query('SELECT * FROM public.user_entitlements WHERE learner_id=$1 AND source=$2', [learner, source])).rows
    assert.equal((await read('paddle')).length, 1)
    await db.query(`UPDATE public.subscriptions SET current_period_end='2026-11-01' WHERE id=$1 AND status='active'`, [sub])
    assert.equal((await read('paddle'))[0].expires_at.toISOString(), '2026-11-01T00:00:00.000Z')
    await db.query(`UPDATE public.subscriptions SET status='past_due',current_period_end='2026-12-01' WHERE id=$1 AND status='active'`, [sub])
    assert.equal((await read('paddle'))[0].expires_at.toISOString(), '2026-11-01T00:00:00.000Z')
    await db.query(`UPDATE public.subscriptions SET status='cancelled',paddle_revoked_at='2026-09-15T12:00:00Z' WHERE id=$1 AND status='past_due'`, [sub])
    assert.ok((await read('paddle'))[0].revoked_at)
    await db.query(`UPDATE public.subscriptions SET current_period_end=NULL WHERE id=$1 AND status='cancelled'`, [sub])
    assert.ok((await read('paddle'))[0].revoked_at)
    await db.query(`UPDATE public.subscriptions SET current_period_end='2026-12-01' WHERE id=$1 AND current_period_end IS NULL`, [sub])
    const call = (event, expiry, revocation = null, observed = '2026-09-15T12:00:00Z') => db.query(
      `SELECT public.apply_play_grant($1,'cs812_token','2026-09-01',$2,$3,$4,$5,NULL)`, [learner, expiry, revocation, observed, event])
    await call('cs812_event', '2026-10-01')
    await call('cs812_event', '2026-12-01')
    assert.equal((await read('play')).length, 1)
    assert.equal((await read('play'))[0].expires_at.toISOString(), '2026-10-01T00:00:00.000Z')
    await call('cs812_revoke', '2026-10-01', '2026-09-15T13:00:00Z', '2026-09-15T13:00:00Z')
    assert.ok((await read('play'))[0].revoked_at)
    await call('cs812_stale', '2026-12-01')
    assert.ok((await read('play'))[0].revoked_at)
    const replacement = (await db.query(`SELECT public.apply_play_grant(gen_random_uuid(),'cs812_replacement',
      '2026-09-15','2026-12-01',NULL,'2026-09-15T14:00:00Z','cs812_replace','cs812_token') AS owner`)).rows[0].owner
    assert.equal(replacement, learner)
    assert.ok((await read('play')).find(row => row.source_ref === 'cs812_token').revoked_at)
    await db.query(`SELECT public.write_additional_paddle_grant($1,'sub_cs812_second','2026-09-01','2026-10-01','active')`, [learner])
    assert.equal((await read('paddle')).length, 2)
    await db.query(`SELECT public.refresh_paid_paddle_grant('sub_cs812_second','2026-11-01','2026-10-01')`)
    await db.query(`SELECT public.write_additional_paddle_grant($1,'sub_cs812_second','2026-09-01','2026-11-01','paused')`, [learner])
    assert.equal((await read('paddle')).find(row => row.source_ref === 'sub_cs812_second').revoked_at, null)
    await db.query(`SELECT public.write_additional_paddle_grant($1,'sub_cs812_second','2026-09-01','2026-11-01','active')`, [learner])
    const second = (await read('paddle')).find(row => row.source_ref === 'sub_cs812_second')
    assert.equal(second.expires_at.toISOString(), '2026-11-01T00:00:00.000Z')
    await db.query(`SELECT public.refresh_paid_paddle_grant('sub_cs812_canary','2027-02-01','2027-01-01')`)
    const renewed = (await read('paddle')).find(row => row.source_ref === 'sub_cs812_canary')
    assert.equal(renewed.revoked_at, null)
    assert.equal(renewed.expires_at.toISOString(), '2027-02-01T00:00:00.000Z')
    const snapshot = (await db.query('SELECT to_jsonb(s) AS value FROM public.subscriptions s WHERE id=$1', [sub])).rows[0].value
    assert.equal((await db.query('SELECT public.backfill_paddle_grants($1) AS n', [JSON.stringify([snapshot])])).rows[0].n, 0)
    await db.query('RESET ROLE')
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated',
      'public.apply_play_grant(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,text,text)','EXECUTE') AS allowed`)).rows[0].allowed, false)
    console.log('PASS: RLS preserved; Paddle atomic mirror, renewal, payment failure and refund; Play duplicate, revocation and stale receipt; RPC restricted. ROLLBACK only.')
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
