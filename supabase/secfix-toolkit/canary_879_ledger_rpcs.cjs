#!/usr/bin/env node
/**
 * #879 canary — the two ledger-RPC defects found by Astra's cold-verify of #857.
 *
 * WHAT #857's CANARY DID NOT COVER, and why this file exists: it exercises the
 * TRIGGER only. Neither refresh_paid_paddle_grant nor write_additional_paddle_grant
 * is called by it at all, and its --pre mode performs a write inside an
 * always-rolled-back transaction. This canary calls both RPCs for real, exercises
 * the trigger's past_due path, and its --pre mode performs NO WRITE OF ANY KIND.
 *
 * Access is asserted through the two live resolver predicates, transcribed, never
 * through raw timestamps:
 *   main (production): !expires_at || expires_at > now         [expiry ALONE]
 *   dev  (staging)   : !revoked_at && starts<=now && (!expires_at || expires_at > now)
 *
 * Modes
 *   --pre   GENUINELY READ-ONLY. No transaction is opened, no row is written,
 *           nothing is rolled back. It asserts (i) what the LIVE function text
 *           says, via pg_get_functiondef, and (ii) what the live PostgreSQL
 *           evaluator makes of the exact CASE expressions those definitions
 *           carry, via plain SELECT on literal values. Against #857's live
 *           definition the expected verdict is RED.
 *   (none)  applies supabase/migrations/20260915f_*.sql INSIDE a transaction
 *           that is ALWAYS ROLLED BACK, then calls the RPCs and drives the
 *           trigger on synthetic rows. Expected verdict: GREEN.
 *
 * Neither mode commits. Both assert the live paddle grants are unchanged.
 */
const fs = require('fs')
const path = require('path')
const { Client } = require(path.join(process.env.HOME, 'SSi/ssi-dashboard-v7-clean/node_modules/pg'))

const PRE = process.argv.includes('--pre')
const MIG = path.join(__dirname, '..', 'migrations', '20260915f_paddle_ledger_rpc_null_period_and_past_due.sql')
const TAG = 'cs879_canary_' + Math.random().toString(36).slice(2, 10)

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
  let baseline = []
  try {
    // ── PHASE A — READ ONLY IN BOTH MODES ──────────────────────────────────
    console.log('\n=== PHASE A (read-only: live text + live evaluator) ===')
    const defOf = async (sig) =>
      (await c.query(`SELECT pg_get_functiondef($1::regprocedure) AS d`, [sig])).rows[0].d
    const refresh = await defOf('public.refresh_paid_paddle_grant(text,timestamptz,timestamptz)')
    const additional = await defOf('public.write_additional_paddle_grant(uuid,text,timestamptz,timestamptz,text)')
    const mirror = await defOf('public.mirror_paddle_individual_grant()')

    // A1 — defect 1: is the NULL-unsafe guard still in the live text?
    const nullUnsafe = /NOT \(p_period_start > revoked_at\)/.test(refresh)
    check('refresh_paid: NULL-unsafe guard `NOT (p_period_start > revoked_at)` is GONE',
      !nullUnsafe, nullUnsafe ? 'still present (defect 1)' : 'replaced by coalesce(...,false)')
    const coalesced = (refresh.match(/coalesce\(p_period_start > /g) || []).length
    check('refresh_paid: every period-start comparison is coalesce(...,false)',
      coalesced >= 4, `${coalesced} coalesced comparisons found (expect >= 4)`)

    // A2 — defect 1b: does the ON CONFLICT clamp read BOTH markers?
    const bothMarkers = /coalesce\(user_entitlements\.revoked_at, s\.paddle_revoked_at\)/.test(refresh)
    check('refresh_paid: clamp reads coalesce(grant revoked_at, subscription marker)',
      bothMarkers, bothMarkers ? 'both markers' : 'subscription marker only (defect 1b)')

    // A3 — defect 2: past_due must not revoke.
    const triggerPastDue = /NEW\.status = 'past_due' THEN NULL/.test(mirror)
    check("trigger: past_due yields v_revoked_at NULL before the NOT IN arm",
      triggerPastDue, triggerPastDue ? 'present' : "falls into NOT IN ('active','cancelled') THEN now() (defect 2)")
    const additionalPastDue = /p_status IN \('active','trialing','canceled','paused','past_due'\)/.test(additional)
    check('write_additional: past_due is in the non-revoking INSERT list',
      additionalPastDue, additionalPastDue ? 'present' : 'INSERTs revoked_at=now() beside a future expiry (defect 2)')

    // A4 — the live evaluator's own verdict on the exact CASE expressions.
    // These are SELECTs on literals: no table is touched, nothing is written.
    const ev = async (sql, params) => (await c.query(sql, params)).rows[0]

    // defect 1, no-subscription-row branch, p_period_start NULL, revoked grant.
    const d1pre = await ev(`
      SELECT CASE WHEN r IS NOT NULL AND NOT (ps > r)
                  THEN least(greatest(e, pe), r) ELSE greatest(e, pe) END AS expires_at, r AS revoked_at
      FROM (SELECT now()-interval '1 day' r, now()-interval '1 day' e,
                   now()+interval '365 days' pe, NULL::timestamptz ps) t`)
    const d1post = await ev(`
      SELECT CASE WHEN r IS NOT NULL AND NOT coalesce(ps > r, false)
                  THEN least(greatest(e, pe), r) ELSE greatest(e, pe) END AS expires_at, r AS revoked_at
      FROM (SELECT now()-interval '1 day' r, now()-interval '1 day' e,
                   now()+interval '365 days' pe, NULL::timestamptz ps) t`)
    check('defect 1 evaluated live: the OLD guard leaves main OPEN on a revoked grant',
      mainSees(d1pre) && !devSees(d1pre), `old expression → expires_at=${d1pre.expires_at}`)
    check('defect 1 evaluated live: the NEW guard closes main on the same input',
      !mainSees(d1post) && !devSees(d1post), `new expression → expires_at=${d1post.expires_at}`)
    // and the reversal path must still reopen on a PROVABLY later period start.
    const d1rev = await ev(`
      SELECT CASE WHEN r IS NOT NULL AND NOT coalesce(ps > r, false)
                  THEN least(greatest(e, pe), r) ELSE greatest(e, pe) END AS expires_at,
             CASE WHEN coalesce(ps > r, false) THEN NULL ELSE r END AS revoked_at
      FROM (SELECT now()-interval '30 days' r, now()-interval '30 days' e,
                   now()+interval '335 days' pe, now()-interval '1 day' ps) t`)
    check('reversal path intact: a provably later period start still reopens both',
      mainSees(d1rev) && devSees(d1rev), `expires_at=${d1rev.expires_at} revoked_at=${d1rev.revoked_at}`)

    // defect 1b, ON CONFLICT clamp with the marker on the GRANT row only.
    const d1bpre = await ev(`
      SELECT CASE WHEN s IS NOT NULL THEN least(greatest(e, x), s) ELSE greatest(e, x) END AS expires_at,
             ur AS revoked_at
      FROM (SELECT NULL::timestamptz s, now()-interval '1 day' ur, now()-interval '1 day' e,
                   now()+interval '365 days' x) t`)
    const d1bpost = await ev(`
      SELECT CASE
               WHEN coalesce(ps > coalesce(ur, s), false) THEN greatest(e, x)
               WHEN coalesce(ur, s) IS NOT NULL THEN least(greatest(e, x), coalesce(ur, s))
               ELSE greatest(e, x) END AS expires_at,
             CASE WHEN coalesce(ps > coalesce(ur, s), false) THEN NULL ELSE coalesce(ur, s) END AS revoked_at
      FROM (SELECT NULL::timestamptz s, now()-interval '1 day' ur, now()-interval '1 day' e,
                   now()+interval '365 days' x, NULL::timestamptz ps) t`)
    check('defect 1b evaluated live: the OLD clamp leaves main OPEN (grant-row marker ignored)',
      mainSees(d1bpre), `old expression → expires_at=${d1bpre.expires_at} revoked_at=${d1bpre.revoked_at}`)
    check('defect 1b evaluated live: the NEW clamp closes main and keeps the row consistent',
      !mainSees(d1bpost) && !devSees(d1bpost) && d1bpost.revoked_at !== null,
      `new expression → expires_at=${d1bpost.expires_at} revoked_at=${d1bpost.revoked_at}`)

    // defect 2, write_additional INSERT on raw paddle status past_due.
    const d2pre = await ev(`SELECT now()+interval '365 days' AS expires_at,
      CASE WHEN 'past_due' IN ('active','trialing','canceled','paused') THEN NULL ELSE now() END AS revoked_at`)
    const d2post = await ev(`SELECT now()+interval '365 days' AS expires_at,
      CASE WHEN 'past_due' IN ('active','trialing','canceled','paused','past_due') THEN NULL ELSE now() END AS revoked_at`)
    check('defect 2 evaluated live: the OLD INSERT row is self-contradictory (main open, dev closed)',
      mainSees(d2pre) && !devSees(d2pre), `old → expires_at=${d2pre.expires_at} revoked_at=${d2pre.revoked_at}`)
    check('defect 2 evaluated live: the NEW INSERT row keeps the payer open on BOTH resolvers',
      mainSees(d2post) && devSees(d2post), `new → revoked_at=${d2post.revoked_at}`)

    // A5 — live baseline, read-only.
    baseline = (await c.query(
      `SELECT * FROM public.user_entitlements WHERE source='paddle' ORDER BY id`)).rows
    console.log(`live paddle grants: ${baseline.length}; main would see ` +
      `${baseline.filter(mainSees).length} open, dev ${baseline.filter(devSees).length}`)
    check('no synthetic canary rows are live', baseline.every((r) => !/^cs8\d\d_canary_/.test(r.source_ref || '')),
      `${baseline.length} rows scanned`)

    if (!PRE) {

    // ── PHASE B — RPCs CALLED FOR REAL, ALWAYS ROLLED BACK ─────────────────
    console.log(`\n=== PHASE B (synthetic, rolled back; tag ${TAG}) ===`)
    await c.query('BEGIN')
    await c.query("SET LOCAL lock_timeout='5s'")
    await c.query(fs.readFileSync(MIG, 'utf8').replace(/^\s*BEGIN;/m, '').replace(/COMMIT;\s*$/m, ''))
    console.log('applied 20260915f inside the transaction')

    const mkLearner = async (suffix) => (await c.query(
      `INSERT INTO public.learners (user_id, display_name, is_internal)
       VALUES ($1,$1,true) RETURNING id`, [TAG + '_' + suffix])).rows[0].id
    const mkSub = async (suffix, status, cape, periodEndSql) => {
      const ref = TAG + '_' + suffix
      const learner = await mkLearner(suffix)
      const id = (await c.query(
        `INSERT INTO public.subscriptions
           (learner_id, provider, provider_subscription_id, provider_customer_id,
            status, cancel_at_period_end, plan_id, plan_name, current_period_end)
         VALUES ($1,'paddle',$2,'ctm_'||$2,$3,$4,'pri_x','SSi Premium',${periodEndSql})
         RETURNING id`, [learner, ref, status, cape])).rows[0].id
      return { id, ref, learner }
    }
    const grant = async (ref) => (await c.query(
      `SELECT expires_at, revoked_at, starts_at, redeemed_at FROM public.user_entitlements
         WHERE source='paddle' AND source_ref=$1`, [ref])).rows[0]

    // B1 — refresh_paid_paddle_grant, NO subscription row, revoked grant,
    //      p_period_start NULL. This is the exact live shape: the caller at
    //      paddle-webhook.ts:1788 passes billingPeriod?.startsAt || null.
    const l1 = await mkLearner('r1')
    const ref1 = TAG + '_r1'
    await c.query(
      `INSERT INTO public.user_entitlements (learner_id,source,source_ref,access_type,starts_at,expires_at,revoked_at)
       VALUES ($1,'paddle',$2,'full',now()-interval '90 days',now()-interval '1 day',now()-interval '1 day')`,
      [l1, ref1])
    await c.query(`SELECT public.refresh_paid_paddle_grant($1,$2,NULL)`,
      [ref1, new Date(Date.now() + 365 * 864e5)])
    let g = await grant(ref1)
    check('RPC refresh_paid (no sub row, NULL period start, revoked): main sees ACCESS CLOSED',
      !!g && !mainSees(g), g && `expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)
    check('RPC refresh_paid (same): dev sees ACCESS CLOSED', !!g && !devSees(g))

    // B2 — same RPC, same row, a PROVABLY later period start: must reopen.
    await c.query(`SELECT public.refresh_paid_paddle_grant($1,$2,$3)`,
      [ref1, new Date(Date.now() + 365 * 864e5), new Date(Date.now() - 2 * 3600e3)])
    g = await grant(ref1)
    check('RPC refresh_paid: a provably later period start REOPENS on both resolvers',
      !!g && mainSees(g) && devSees(g), g && `expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)

    // B3 — refresh_paid WITH a subscription row whose grant carries revoked_at
    //      but whose paddle_revoked_at is NULL (defect 1b's live shape).
    const S = await mkSub('r3', 'active', false, "now() + interval '30 days'")
    await c.query(
      `UPDATE public.user_entitlements SET revoked_at = now()-interval '1 day',
         expires_at = now()-interval '1 day' WHERE source='paddle' AND source_ref=$1`, [S.ref])
    await c.query(`SELECT public.refresh_paid_paddle_grant($1,$2,NULL)`,
      [S.ref, new Date(Date.now() + 365 * 864e5)])
    g = await grant(S.ref)
    check('RPC refresh_paid (grant-row marker, subscription marker NULL): main CLOSED',
      !!g && !mainSees(g), g && `expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)
    check('RPC refresh_paid (same): the row is not self-contradictory',
      !!g && !!g.revoked_at && new Date(g.expires_at) <= new Date(g.revoked_at))

    // B4 — write_additional_paddle_grant, raw paddle status past_due, NEW row.
    //      A live payer in dunning must keep access on BOTH resolvers.
    const l4 = await mkLearner('w4')
    const ref4 = TAG + '_w4'
    await c.query(`SELECT public.write_additional_paddle_grant($1,$2,$3,$4,'past_due')`,
      [l4, ref4, new Date(Date.now() - 30 * 864e5), new Date(Date.now() + 335 * 864e5)])
    g = await grant(ref4)
    check('RPC write_additional (INSERT, past_due): main sees ACCESS OPEN',
      !!g && mainSees(g), g && `expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)
    check('RPC write_additional (INSERT, past_due): dev sees ACCESS OPEN — dunning is not revocation',
      !!g && devSees(g))

    // B5 — write_additional, past_due on ON CONFLICT: dates kept, not extended,
    //      not cut short.
    const before5 = await grant(ref4)
    await c.query(`SELECT public.write_additional_paddle_grant($1,$2,$3,$4,'past_due')`,
      [l4, ref4, new Date(Date.now() - 30 * 864e5), new Date(Date.now() + 700 * 864e5)])
    const after5 = await grant(ref4)
    check('RPC write_additional (UPDATE, past_due): existing dates kept unchanged',
      String(before5.expires_at) === String(after5.expires_at) && !after5.revoked_at,
      `${before5.expires_at} → ${after5.expires_at}`)

    // B6 — write_additional on a REVOKED row still clamps (the #857 invariant).
    const l6 = await mkLearner('w6')
    const ref6 = TAG + '_w6'
    await c.query(
      `INSERT INTO public.user_entitlements (learner_id,source,source_ref,access_type,starts_at,expires_at,revoked_at)
       VALUES ($1,'paddle',$2,'full',now()-interval '90 days',now()-interval '1 day',now()-interval '1 day')`,
      [l6, ref6])
    await c.query(`SELECT public.write_additional_paddle_grant($1,$2,$3,$4,'active')`,
      [l6, ref6, new Date(Date.now() - 90 * 864e5), new Date(Date.now() + 365 * 864e5)])
    g = await grant(ref6)
    check('RPC write_additional on a revoked grant: #857 clamp still holds, main CLOSED',
      !!g && !mainSees(g), g && `expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)

    // B7 — trigger, past_due path: a dunning subscription keeps paid dates.
    const T = await mkSub('t7', 'active', false, "now() + interval '300 days'")
    const before7 = await grant(T.ref)
    check('trigger: active synthetic opens on both', mainSees(before7) && devSees(before7),
      `expires_at=${before7.expires_at}`)
    await c.query(`UPDATE public.subscriptions SET status='past_due', updated_at=now() WHERE id=$1`, [T.id])
    const after7 = await grant(T.ref)
    check('trigger past_due: main STILL OPEN (dunning is not revocation)',
      mainSees(after7), `expires_at=${after7.expires_at} revoked_at=${after7.revoked_at}`)
    check('trigger past_due: dev STILL OPEN', devSees(after7))
    check('trigger past_due: dates unchanged by the dunning write',
      String(before7.expires_at) === String(after7.expires_at),
      `${before7.expires_at} → ${after7.expires_at}`)

    // B8 — trigger, past_due INSERT path: a brand-new dunning row is not
    //      revoked-and-clamped at birth.
    const T8 = await mkSub('t8', 'past_due', false, "now() + interval '200 days'")
    const g8 = await grant(T8.ref)
    check('trigger past_due on INSERT: main OPEN to the paid period end',
      mainSees(g8), `expires_at=${g8.expires_at} revoked_at=${g8.revoked_at}`)
    check('trigger past_due on INSERT: dev OPEN', devSees(g8))

    // B9 — the refund signature of #857 is untouched.
    const R = await mkSub('t9', 'active', false, "now() + interval '365 days'")
    await c.query(
      `UPDATE public.subscriptions SET status='cancelled', cancel_at_period_end=true, updated_at=now()
        WHERE id=$1`, [R.id])
    const g9 = await grant(R.ref)
    check('#857 refund signature unchanged: main sees ACCESS CLOSED', !mainSees(g9),
      `expires_at=${g9.expires_at} revoked_at=${g9.revoked_at}`)
    const mk = (await c.query(`SELECT paddle_revoked_at FROM public.subscriptions WHERE id=$1`, [R.id])).rows[0]
    check('#857 durable marker still stamped', mk.paddle_revoked_at !== null, String(mk.paddle_revoked_at))
    await c.query(
      `UPDATE public.subscriptions SET status='active', cancel_at_period_end=false, updated_at=now()
        WHERE id=$1`, [R.id])
    check('#857 fail-closed replay unchanged: main STILL CLOSED after an active replay',
      !mainSees(await grant(R.ref)))

    // B10 — period-end cancellation still keeps paid access.
    const P = await mkSub('t10', 'active', false, "now() + interval '90 days'")
    await c.query(
      `UPDATE public.subscriptions SET status='cancelled', cancel_at_period_end=false, updated_at=now()
        WHERE id=$1`, [P.id])
    const g10 = await grant(P.ref)
    check('period-end cancellation: still OPEN to the paid period end on both',
      mainSees(g10) && devSees(g10), `expires_at=${g10.expires_at}`)

    // B11 — live grants untouched, every column, row by row.
    const post = (await c.query(
      `SELECT * FROM public.user_entitlements WHERE source='paddle' AND source_ref NOT LIKE $1 ORDER BY id`,
      [TAG + '%'])).rows
    const cols = baseline.length ? Object.keys(baseline[0]) : []
    const same = post.length === baseline.length &&
      post.every((r, i) => cols.every((k) => String(r[k]) === String(baseline[i][k])))
    check('every live paddle grant unchanged, ALL columns, row by row', same,
      `${post.length} rows × ${cols.length} columns compared`)
    } else {
      console.log('\n--pre: STOPPING HERE. No transaction was opened and nothing was written.')
    }
  } finally {
    if (!PRE) {
      await c.query('ROLLBACK').catch(() => {})
      const left = (await c.query(
        `SELECT count(*)::int n FROM public.learners WHERE user_id LIKE $1`, ['cs879_canary_%'])).rows[0].n
      check('nothing synthetic survives the rollback', left === 0, `${left} synthetic learners found`)
    }
    await c.end()
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length === 0 ? 'GREEN' : 'RED'} — ${results.length - failed.length}/${results.length} passed` +
    (PRE ? '   (--pre: RED here means the live definitions still carry the defects)' : ''))
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('canary error:', e.message); process.exit(2) })
