#!/usr/bin/env node
/**
 * #857 canary — does a Paddle refund close access ON PRODUCTION?
 *
 * Production runs `main` at ea0683f. Its resolver filters user_entitlements on
 * expires_at ALONE and never reads revoked_at, so the ONLY question that matters
 * is what expires_at says. This canary therefore asserts ACCESS through two
 * predicates transcribed from the two live resolvers, never through raw
 * timestamps:
 *   main (production): !expires_at || expires_at > now
 *   dev  (staging)   : !revoked_at && starts<=now && (!expires_at || expires_at > now)
 *
 * Modes
 *   --pre   phase A is READ-ONLY (live function text, live trigger timing, live
 *           grant baseline). Phase B replays main's refund UPDATE on a synthetic
 *           row inside a transaction that is ALWAYS ROLLED BACK — flagged as a
 *           compromise: the hole cannot be demonstrated without a write, only
 *           inferred from the function text, which phase A does separately.
 *           Expected verdict against the #851 definition: RED.
 *   (none)  same, with supabase/migrations/20260915e_*.sql applied INSIDE the
 *           rolled-back transaction. Expected verdict: GREEN.
 *
 * Neither mode commits anything. Both assert the live grant rows are unchanged.
 */
const fs = require('fs')
const path = require('path')
const { Client } = require(path.join(process.env.HOME, 'SSi/ssi-dashboard-v7-clean/node_modules/pg'))

const PRE = process.argv.includes('--pre')
const MIG = path.join(__dirname, '..', 'migrations', '20260915e_paddle_revocation_clamps_expiry.sql')
const TAG = 'cs857_canary_' + Math.random().toString(36).slice(2, 10)

function dburl() {
  for (const f of ['.env.psql', '.env']) {
    const p = path.join(process.env.HOME, 'SSi/ssi-dashboard-v7-clean', f)
    if (!fs.existsSync(p)) continue
    const m = fs.readFileSync(p, 'utf8').match(/postgresql:\/\/[^\s"']+/)
    if (m) return m[0]
  }
  throw new Error('no DATABASE_URL found')
}

const now = () => new Date()
const mainSees = (g) => !g.expires_at || new Date(g.expires_at) > now()
const devSees = (g) => {
  if (g.revoked_at) return false
  const s = g.starts_at || g.redeemed_at
  if (s && !(new Date(s) <= now())) return false
  if (!g.expires_at) return true
  return new Date(g.expires_at) > now()
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function main() {
  const c = new Client({ connectionString: dburl() })
  await c.connect()
  try {
    // ── PHASE A — READ ONLY ────────────────────────────────────────────────
    console.log('\n=== PHASE A (read-only) ===')
    const def = (await c.query(
      `SELECT pg_get_functiondef('public.mirror_paddle_individual_grant()'::regprocedure) AS d`
    )).rows[0].d
    const trg = (await c.query(
      `SELECT tgname, tgtype FROM pg_trigger WHERE tgrelid='public.subscriptions'::regclass
         AND NOT tgisinternal AND tgname='mirror_paddle_individual_grant'`
    )).rows[0]
    const isBefore = trg ? (trg.tgtype & 2) === 2 : false
    console.log(`live trigger timing: ${trg ? (isBefore ? 'BEFORE' : 'AFTER') + ' ROW (tgtype=' + trg.tgtype + ')' : 'ABSENT'}`)
    const clamps = /least\(/i.test(def) && /revoked/i.test(def)
    check('live definition clamps expires_at against the revocation instant',
      PRE ? !clamps : clamps,
      PRE ? 'expected ABSENT pre-fix (the #851 hole): ' + (clamps ? 'present' : 'absent')
          : 'expected PRESENT post-fix: ' + (clamps ? 'present' : 'absent'))

    const baseline = (await c.query(
      `SELECT id, learner_id, expires_at, revoked_at, starts_at, redeemed_at
         FROM public.user_entitlements WHERE source='paddle' ORDER BY id`
    )).rows
    const openNow = baseline.filter(mainSees)
    console.log(`live paddle grants: ${baseline.length}; main would see ${openNow.length} open, dev ${baseline.filter(devSees).length}`)

    // ── PHASE B — synthetic, ALWAYS ROLLED BACK ────────────────────────────
    console.log(`\n=== PHASE B (synthetic, rolled back; tag ${TAG}) ===`)
    await c.query('BEGIN')
    await c.query("SET LOCAL lock_timeout='5s'")
    if (!PRE) {
      await c.query(fs.readFileSync(MIG, 'utf8').replace(/^\s*BEGIN;/m, '').replace(/COMMIT;\s*$/m, ''))
      console.log('applied 20260915e inside the transaction')
    }
    // One subscription per learner (subscriptions_learner_id_key), so each
    // scenario gets its own synthetic learner.
    const mkSub = async (suffix, status, cape, periodEndSql) => {
      const ref = TAG + '_' + suffix
      const learner = (await c.query(
        `INSERT INTO public.learners (user_id, display_name, is_internal)
         VALUES ($1, $1, true) RETURNING id`, [ref]
      )).rows[0].id
      const id = (await c.query(
        `INSERT INTO public.subscriptions
           (learner_id, provider, provider_subscription_id, provider_customer_id,
            status, cancel_at_period_end, plan_id, plan_name, current_period_end)
         VALUES ($1,'paddle',$2,'ctm_'||$2,$3,$4,'pri_x','SSi Premium',${periodEndSql})
         RETURNING id`, [learner, ref, status, cape]
      )).rows[0].id
      return { id, ref, learner }
    }
    const grant = async (ref) => (await c.query(
      `SELECT expires_at, revoked_at, starts_at, redeemed_at FROM public.user_entitlements
         WHERE source='paddle' AND source_ref=$1`, [ref]
    )).rows[0]

    // 1. active subscription, a year out → open on both
    const A = await mkSub('a', 'active', false, "now() + interval '1 year'")
    const refA = A.ref, subA = A.id
    let g = await grant(refA)
    check('active synthetic: main sees ACCESS OPEN', !!g && mainSees(g), g && `expires_at=${g.expires_at}`)
    check('active synthetic: dev sees ACCESS OPEN', !!g && devSees(g))

    // 2. main's exact refund UPDATE
    await c.query(
      `UPDATE public.subscriptions
          SET status='cancelled', cancel_at_period_end=true, updated_at=now() WHERE id=$1`, [subA])
    g = await grant(refA)
    check('after refund: main sees ACCESS CLOSED', !!g && !mainSees(g),
      g && `expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)
    check('after refund: dev sees ACCESS CLOSED', !!g && !devSees(g))
    const marker = (await c.query(`SELECT paddle_revoked_at FROM public.subscriptions WHERE id=$1`, [subA])).rows[0]
    check('after refund: durable marker stamped on subscriptions.paddle_revoked_at',
      PRE ? marker.paddle_revoked_at === null : marker.paddle_revoked_at !== null,
      PRE ? 'expected NULL pre-fix (main cannot write it)' : String(marker.paddle_revoked_at))

    // 3. replay main's held-plan write (base fields only, same values)
    await c.query(
      `UPDATE public.subscriptions SET status='active', current_period_end=current_period_end,
         cancel_at_period_end=false, provider='paddle', provider_customer_id=provider_customer_id,
         updated_at=now() WHERE id=$1`, [subA])
    g = await grant(refA)
    check('held-plan-shaped replay (status active): main STILL CLOSED', !!g && !mainSees(g),
      g && `expires_at=${g.expires_at}`)

    // 4. replay a full upsert-shaped write (base + plan fields)
    await c.query(
      `UPDATE public.subscriptions SET status='active', plan_id='pri_x', plan_name='SSi Premium',
         current_period_end=current_period_end, cancel_at_period_end=false,
         provider_customer_id=provider_customer_id, updated_at=now() WHERE id=$1`, [subA])
    g = await grant(refA)
    check('full-upsert-shaped replay (status active): main STILL CLOSED', !!g && !mainSees(g),
      g && `expires_at=${g.expires_at}`)

    // 5. period-end cancellation on a SECOND synthetic subscription
    const B = await mkSub('b', 'active', false, "now() + interval '90 days'")
    const refB = B.ref, subB = B.id
    await c.query(
      `UPDATE public.subscriptions SET status='cancelled', cancel_at_period_end=false, updated_at=now()
        WHERE id=$1`, [subB])
    g = await grant(refB)
    check('period-end cancellation: main STILL OPEN to the paid period end', !!g && mainSees(g),
      g && `expires_at=${g.expires_at}`)
    check('period-end cancellation: dev STILL OPEN', !!g && devSees(g))

    // 6. renewal on a healthy row still moves expiry out
    const C = await mkSub('c', 'active', false, "now() + interval '30 days'")
    const refC = C.ref, subC = C.id
    const before = await grant(refC)
    await c.query(`UPDATE public.subscriptions SET current_period_end = now() + interval '395 days',
      status='active', updated_at=now() WHERE id=$1`, [subC])
    const after = await grant(refC)
    check('renewal on an unrevoked row moves expiry out',
      new Date(after.expires_at) > new Date(before.expires_at),
      `${before.expires_at} → ${after.expires_at}`)

    // 7. live grants untouched, row by row
    const post = (await c.query(
      `SELECT id, expires_at, revoked_at FROM public.user_entitlements
         WHERE source='paddle' AND source_ref NOT LIKE $1 ORDER BY id`, [TAG + '%']
    )).rows
    const same = post.length === baseline.length && post.every((r, i) =>
      r.id === baseline[i].id &&
      String(r.expires_at) === String(baseline[i].expires_at) &&
      String(r.revoked_at) === String(baseline[i].revoked_at))
    check('every live paddle grant unchanged (expires_at and revoked_at, row by row)', same,
      `${post.length} rows compared`)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    const left = (await c.query(
      `SELECT count(*)::int n FROM public.learners WHERE user_id LIKE $1`, ['cs857_canary_%'])).rows[0].n
    check('nothing synthetic survives the rollback', left === 0, `${left} synthetic learners found`)
    await c.end()
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length === 0 ? 'GREEN' : 'RED'} — ${results.length - failed.length}/${results.length} passed` +
    (PRE ? '   (--pre: RED here means the live definition leaves production open)' : ''))
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('canary error:', e.message); process.exit(2) })
